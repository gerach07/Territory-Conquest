/**
 * ============================================================================
 * TERRITORY CONQUEST - Game Server
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const msgpack = require('msgpack-lite'); // binary serialization
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pkg = require('./package.json');

const {
  GRID_SIZE, TICK_MS, MAX_PLAYERS_PER_ROOM,
  ROOM_CLEANUP_INTERVAL_MS, ROOM_INACTIVE_TIMEOUT_MS,
  ROOM_GAMEOVER_TIMEOUT_MS, IP_RATE_LIMIT_MAX, MAX_CHAT_LENGTH,
  PLAYER_COLORS, DIRECTIONS, GameState, RECONNECT_GRACE_MS,
  MIN_GAME_TIME_SECONDS, MAX_GAME_TIME_SECONDS, DEFAULT_GAME_TIME_SECONDS,
} = require('./src/constants');
const Room = require('./src/models/Room');
const RateLimiter = require('./src/utils/RateLimiter');
const { sanitizeInput } = require('./src/utils/sanitizers');

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:5000,https://absnakeab.web.app,https://absnakeab.firebaseapp.com')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Ensure production URL is always allowed if not in env
if (!ALLOWED_ORIGINS.includes('https://absnakeab.web.app')) {
  ALLOWED_ORIGINS.push('https://absnakeab.web.app');
}

/**
 * CORS origin validator.
 * Allows:
 *  - any origin in the ALLOWED_ORIGINS list
 *  - null / undefined origin (desktop app loaded via file://)
 */
function isOriginAllowed(origin, callback) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin '${origin}' not allowed by CORS`));
  }
}

// ============================================================================
// SERVER SETUP
// ============================================================================

const app = express();
app.set('trust proxy', 1);
app.use(compression({
  filter: (req, res) => {
    // Don't compress Socket.IO traffic (WebSocket upgrade / polling fallback)
    if (req.url && req.url.startsWith('/socket.io/')) return false;
    return compression.filter(req, res);
  },
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'wss:', 'ws:', ...ALLOWED_ORIGINS],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: isOriginAllowed, methods: ['GET', 'POST'], credentials: true }));
app.use(express.json({ limit: '16kb' }));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: isOriginAllowed, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000, pingInterval: 25000,
  maxHttpBufferSize: 64e3,
  transports: ['websocket'],   // WebSocket only — no polling
  allowUpgrades: false,
  perMessageDeflate: false,    // Disable per-message compression (adds CPU latency)
});

// ============================================================================
// GLOBAL STATE
// ============================================================================

const rooms = {};
const playerToRoom = {};
const disconnectedPlayers = new Map(); // key: `${roomId}:${playerName}`, value: { socketId, playerData, roomId, timestamp, password }
const MAX_DISCONNECTED_PLAYERS = 5000;
const ipRateLimiter = new RateLimiter(IP_RATE_LIMIT_MAX, 60000);
const pinTracker = new Map();
const PIN_RATE_WINDOW = 60000;
const PIN_RATE_MAX = 3;  // Reduced from 5 for better brute-force protection

// Room locks (mutex for concurrent operations)
const roomLocks = new Map();

function acquireRoomLock(roomId) {
  let chain = roomLocks.get(roomId) || Promise.resolve();
  let release;
  const next = new Promise(resolve => {
    release = () => {
      resolve();
      // Clean up: if this is the last pending lock, remove from map
      if (roomLocks.get(roomId) === next) {
        roomLocks.delete(roomId);
      }
    };
  });
  roomLocks.set(roomId, chain.then(() => next));
  return chain.then(() => release);
}

// ============================================================================
// GAME LOOP
// ============================================================================

// Full-grid sync interval (every N ticks, send the entire grid to keep clients in sync)
const FULL_GRID_SYNC_TICKS = 100; // = 10 seconds at 10 ticks/sec

function startGameLoop(roomId) {
  const room = rooms[roomId];
  if (!room || room.tickTimer) return;
  let tickCount = 0;
  room.tickTimer = setInterval(() => {
    if (!rooms[roomId] || room.state !== GameState.PLAYING) {
      clearInterval(room.tickTimer); room.tickTimer = null; return;
    }
    // No lock needed — Node.js is single-threaded, setInterval callback
    // runs atomically within a single event-loop turn.
    if (room.state !== GameState.PLAYING) return;
    const result = room.tick();
    if (!result) return;

    // If room is now empty (all players disconnected & removed), clean up
    if (room.isEmpty()) {
      clearInterval(room.tickTimer); room.tickTimer = null;
      room.cleanup();
      room.spectators.forEach(sid => {
        io.to(sid).emit('roomClosed');
        const specSocket = io.sockets.sockets.get(sid); specSocket?.leave(roomId);
        delete playerToRoom[sid];
      });
      delete rooms[roomId];
      roomLocks.delete(roomId);
      return;
    }

    // Transfer host if current host was removed
    if (!room.players[room.hostId]) {
      transferHost(room, roomId);
    }

    const state = room.getStateForClients();
    const gc = room.compactGridChanges(result.gridChanges);
    if (gc.length > 0) state.gc = gc;
    if (result.events.length > 0) state.events = result.events;

    // Periodically include full grid so clients can self-correct drift
    tickCount++;
    state.seq = tickCount;
    if (tickCount % FULL_GRID_SYNC_TICKS === 0) {
      state.fullGrid = room.getFullGridForClient();
    }

    // binary-encode state for bandwidth reduction
    try {
      const buf = msgpack.encode(state);
      io.to(roomId).emit('gameState', buf);
    } catch (err) {
      console.error(`msgpack encode error in room ${roomId}:`, err.message);
      // fallback to JSON if msgpack fails for whatever reason
      io.to(roomId).emit('gameState', state);
    }

    // Game finished by timer
    if (result.gameFinished) {
      clearInterval(room.tickTimer); room.tickTimer = null;
      const gameOverData = room.getGameOverData();
      io.to(roomId).emit('gameOver', gameOverData);
    }

    room.touch();
  }, TICK_MS);
}

// ============================================================================
// HOST TRANSFER HELPER
// ============================================================================

function transferHost(room, roomId) {
  const remaining = Object.keys(room.players).find(id => !room.players[id]?.disconnected) || Object.keys(room.players)[0];
  if (remaining) {
    room.hostId = remaining;
    room.hostName = room.players[remaining].name;
    io.to(roomId).emit('hostChanged', { hostId: room.hostId, hostName: room.hostName });
  }
}

// ============================================================================
// PLAYER LEAVE
// ============================================================================

function handlePlayerLeave(socketId) {
  const roomId = playerToRoom[socketId];
  if (!roomId) return;
  const room = rooms[roomId];
  if (!room) { delete playerToRoom[socketId]; return; }

  if (room.spectators.has(socketId)) {
    room.spectators.delete(socketId);
    io.to(roomId).emit('spectatorUpdate', { count: room.spectators.size });
    const s = io.sockets.sockets.get(socketId); s?.leave(roomId);
    delete playerToRoom[socketId]; return;
  }

  const player = room.players[socketId];
  const playerName = player?.name;

  // During PLAYING state, store player for reconnection instead of killing immediately
  if (room.state === GameState.PLAYING && player && player.alive) {
    const reconnectKey = `${roomId}:${playerName}`;
    // Enforce upper bound on disconnectedPlayers Map
    if (disconnectedPlayers.size >= MAX_DISCONNECTED_PLAYERS) {
      // Remove oldest entry
      const oldestKey = disconnectedPlayers.keys().next().value;
      disconnectedPlayers.delete(oldestKey);
    }
    disconnectedPlayers.set(reconnectKey, {
      oldSocketId: socketId,
      playerData: { ...player }, // shallow copy
      roomId,
      timestamp: Date.now(),
      password: room.password, // Store room password for rejoin validation
    });
    // Mark as disconnected but keep player in room (will be killed if grace period expires)
    player.disconnected = true;
    player.disconnectTime = Date.now();
    io.to(roomId).emit('playerDisconnecting', { playerId: socketId, playerName, gracePeriod: RECONNECT_GRACE_MS });
    // Transfer host immediately so remaining players have a host
    if (room.hostId === socketId) transferHost(room, roomId);
  } else if (room.state === GameState.PLAYING && player) {
    // Player already dead, just emit disconnect
    const gridChanges = [];
    room.killPlayer(socketId, 'disconnect', null, gridChanges);
    const disconnectState = room.getStateForClients();
    disconnectState.gc = room.compactGridChanges(gridChanges);
    disconnectState.events = [{ type: 'disconnect', playerId: socketId }];
    io.to(roomId).emit('gameState', disconnectState);
  }

  // If alive and playing, don't delete yet — wait for reconnection or grace period
  if (room.state === GameState.PLAYING && player?.alive && player?.disconnected) {
    const s = io.sockets.sockets.get(socketId); s?.leave(roomId);
    delete playerToRoom[socketId];
    return; // Don't delete player yet
  }

  delete room.players[socketId];
  room.playerOrder = room.playerOrder.filter(id => id !== socketId);

  if (room.isEmpty()) {
    room.cleanup();
    room.spectators.forEach(sid => {
      io.to(sid).emit('roomClosed');
      const specSocket = io.sockets.sockets.get(sid); specSocket?.leave(roomId);
      delete playerToRoom[sid];
    });
    delete rooms[roomId];
    roomLocks.delete(roomId);
  } else {
    if (room.hostId === socketId) {
      transferHost(room, roomId);
    }
    if (room.state === GameState.WAITING) {
      io.to(roomId).emit('playerLeft', {
        playerId: socketId, playerName,
        players: room.getPlayerList(), hostId: room.hostId,
      });
    } else if (room.state === GameState.FINISHED) {
      // Clean up their votes
      room.playAgainVotes.delete(socketId);
      room.playAgainDeclined.delete(socketId);
      // Send disconnect + updated play-again status with 'left' marker
      const status = room.getPlayAgainStatus();
      status.leftPlayer = { id: socketId, name: playerName };
      io.to(roomId).emit('playerDisconnected', {
        playerId: socketId, playerName,
        players: room.getPlayerList(),
        playAgainStatus: status,
      });
    } else {
      io.to(roomId).emit('playerDisconnected', {
        playerId: socketId, playerName,
        players: room.getPlayerList(),
      });
    }
    room.touch();
  }

  const s = io.sockets.sockets.get(socketId); s?.leave(roomId);
  delete playerToRoom[socketId];
}

// ============================================================================
// SOCKET HANDLERS
// ============================================================================

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  // attach ping/offset storage on socket
  socket.playerPing = 0;
  socket.serverTimeOffset = 0;

  // time synchronization handshake (simple NTP-style)
  socket.on('timeSyncReq', ({ clientTime }) => {
    // reply immediately with server time and echo clientTime
    socket.emit('timeSyncResp', { clientTime, serverTime: Date.now() });
  });

  socket.on('pingReport', ({ rtt }) => {
    socket.playerPing = rtt;
    // propagate into room record if player already in a game
    const roomId = playerToRoom[socket.id];
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].ping = rtt;
    }
  });

  // optional periodic server time push for jitter smoothing
  const timeSyncInterval = setInterval(() => {
    socket.emit('timeSync', { serverTime: Date.now() });
  }, 30000);
  socket.on('disconnect', () => clearInterval(timeSyncInterval));

  if (!ipRateLimiter.isAllowed(clientIp)) {
    socket.emit('error', { error: 'Too many connections. Please wait.' });
    socket.disconnect(true); return;
  }

  if (process.env.DEBUG) console.log(`Connected: ${socket.id}`);

  // ── JOIN ──
  socket.on('joinGame', async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return socket.emit('error', { error: 'Invalid request' });
    const { gameId, playerName, password, colorIndex, isCreating, isSpectating, timeLimit } = payload;
    if (playerToRoom[socket.id]) handlePlayerLeave(socket.id);

    const roomId = sanitizeInput(gameId, 50).toUpperCase();
    const name = sanitizeInput(playerName, 50) || 'Anonymous';
    const pwd = password ? sanitizeInput(password, 3) : null;
    let cIdx = typeof colorIndex === 'number' ? Math.max(0, Math.min(PLAYER_COLORS.length - 1, colorIndex)) : 0;
    if (!roomId || roomId.length < 4 || roomId.length > 10) {
      return socket.emit('error', { error: 'Room ID must be 4-10 characters' });
    }
    if (!/^[A-Z0-9]+$/.test(roomId)) {
      return socket.emit('error', { error: 'Invalid room ID format' });
    }

    let room = rooms[roomId];

    if (isSpectating) {
      if (!room) return socket.emit('error', { error: 'Room does not exist' });
      if (!room.allowSpectators) return socket.emit('error', { error: 'Spectators are not allowed in this room' });
      if (!ipRateLimiter.isAllowed(clientIp)) return socket.emit('error', { error: 'Too many requests' });
      if (!room.checkPassword(pwd)) return socket.emit('error', { error: 'Incorrect PIN' });
      if (!room.addSpectator(socket.id)) return socket.emit('error', { error: 'Spectator slots full' });
      playerToRoom[socket.id] = roomId; socket.join(roomId);
      const data = { roomId: room.roomId, players: room.getPlayerList(), state: room.state, gridSize: GRID_SIZE, hostId: room.hostId };
      if (room.state === GameState.PLAYING) {
        data.grid = room.getFullGridForClient();
        data.gameState = room.getStateForClients();
      }
      if (room.state === GameState.FINISHED) {
        data.gameOverData = room.getGameOverData();
      }
      data.chatHistory = room.chatHistory.slice(-50);
      data.allowSpectators = room.allowSpectators;
      socket.emit('spectatorJoined', data);
      io.to(roomId).emit('spectatorUpdate', { count: room.spectators.size });
      room.touch(); return;
    }

    if (isCreating) {
      if (room) return socket.emit('error', { error: 'Room already exists. Try a different code.' });
      room = new Room(roomId, pwd, name, socket.id);
      // Apply time limit if provided (0 = no limit)
      if (typeof timeLimit === 'number' && Number.isFinite(timeLimit) && timeLimit >= 0) {
        if (timeLimit === 0) {
          room.timeLimit = 0;
        } else {
          room.timeLimit = Math.max(MIN_GAME_TIME_SECONDS, Math.min(MAX_GAME_TIME_SECONDS, Math.floor(timeLimit)));
        }
      }
      rooms[roomId] = room;
    } else {
      if (!room) return socket.emit('error', { error: 'Room does not exist' });
      if (room.state !== GameState.WAITING) return socket.emit('error', { error: 'Game already in progress' });
      if (room.isFull()) return socket.emit('error', { error: 'Room is full' });
      if (!room.checkPassword(pwd)) return socket.emit('error', { error: 'Incorrect PIN' });
    }

    if (room.addPlayer(socket.id, name, cIdx)) {
      playerToRoom[socket.id] = roomId; socket.join(roomId);
      socket.emit('gameJoined', {
        playerId: socket.id, roomId: room.roomId,
        password: isCreating ? room.password : undefined,
        players: room.getPlayerList(), state: room.state,
        hostId: room.hostId, isHost: room.isHost(socket.id),
        takenColors: room.getTakenColors(),
        gridSize: GRID_SIZE, maxPlayers: MAX_PLAYERS_PER_ROOM, colors: PLAYER_COLORS,
        timeLimit: room.timeLimit,
        allowSpectators: room.allowSpectators,
      });
      socket.to(roomId).emit('playerJoined', {
        players: room.getPlayerList(), hostId: room.hostId,
        takenColors: room.getTakenColors(),
      });
      room.touch();
    }
  });

  // ── DIRECTION ──
  socket.on('changeDirection', (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const { direction } = payload;
    if (!DIRECTIONS[direction]) return;
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.PLAYING) return;
    if (!room.actionLimiter.isAllowed(socket.id)) return;
    const player = room.players[socket.id];
    if (!player || !player.alive || player.forfeited) return;
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[player.direction] === direction) return;
    player.direction = direction;
    // Track last confirmed input sequence for client-side prediction reconciliation
    if (typeof payload.seq === 'number' && payload.seq > (player.lastInputSeq || 0)) {
      player.lastInputSeq = payload.seq;
    }
  });

  // ── CHAT ──
  socket.on('sendChat', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const message = sanitizeInput(payload.message, MAX_CHAT_LENGTH);
    if (!message) return;
    const msg = room.addChatMessage(socket.id, message);
    if (msg) {
      io.to(roomId).emit('chatMessage', msg);
    }
    room.touch();
  });

  // ── REQUEST FULL GRID (client resync) ──
  socket.on('requestFullGrid', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.PLAYING) return;
    socket.emit('fullGridSync', {
      grid: room.getFullGridForClient(),
      tick: Date.now(),
    });
  });

  // ── HOST START ──
  socket.on('hostStartGame', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    if (!room.isHost(socket.id)) return socket.emit('error', { error: 'Only the host can start the game' });
    if (room.state !== GameState.WAITING) return socket.emit('error', { error: 'Game already started' });
    if (room.playerCount() < 2) return socket.emit('error', { error: 'Need at least 2 players' });

    room.initGame();
    io.to(roomId).emit('gameStarted', {
      grid: room.getFullGridForClient(), gameState: room.getStateForClients(),
      gridSize: GRID_SIZE, players: room.getPlayerList(),
      timeLimit: room.timeLimit,
    });
    startGameLoop(roomId); room.touch();
  });

  // ── FORFEIT (Leave Game) ──
  socket.on('forfeit', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.PLAYING) return;
    const player = room.players[socket.id];
    if (!player) return;

    const playerName = player.name;
    const wasAlive = player.alive && !player.forfeited;
    
    // Kill player if alive (clears their territory)
    const gridChanges = [];
    if (wasAlive) {
      room.killPlayer(socket.id, 'leave', null, gridChanges);
    }
    
    // Remove player from room entirely
    delete room.players[socket.id];
    room.playerOrder = room.playerOrder.filter(id => id !== socket.id);

    // Remove from room tracking
    socket.leave(roomId);
    delete playerToRoom[socket.id];
    socket.emit('leftRoom');

    // If no players left, close room and kick spectators
    if (room.isEmpty()) {
      if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
      room.cleanup();
      room.spectators.forEach(sid => {
        io.to(sid).emit('roomClosed');
        const specSocket = io.sockets.sockets.get(sid); specSocket?.leave(roomId);
        delete playerToRoom[sid];
      });
      delete rooms[roomId];
      roomLocks.delete(roomId);
      return;
    }
    
    // Count remaining alive players
    const alivePlayers = room.playerOrder.filter(pid => {
      const p = room.players[pid];
      return p && p.alive && !p.forfeited;
    });
    
    // Emit leave event to remaining players
    const leaveState = room.getStateForClients();
    leaveState.gc = room.compactGridChanges(gridChanges);
    leaveState.events = [{ type: 'leave', playerId: socket.id, playerName }];
    io.to(roomId).emit('gameState', leaveState);
    
    // Check if game should end (only 1 player left)
    if (alivePlayers.length <= 1) {
      room.finishGame(alivePlayers[0] || null);
      if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
      const gameOverData = room.getGameOverData();
      io.to(roomId).emit('gameOver', gameOverData);
    } else {
      // Transfer host if needed
      if (room.hostId === socket.id) {
        transferHost(room, roomId);
      }
    }
    
    room.touch();
  });

  // ── PLAY AGAIN ──
  socket.on('requestPlayAgain', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.FINISHED) return;

    const result = room.addPlayAgainVote(socket.id);
    if (!result.success) return;

    if (result.allVoted) {
      room.resetToWaiting();
      io.to(roomId).emit('gameReset', {
        players: room.getPlayerList(),
        hostId: room.hostId,
        state: room.state,
        takenColors: room.getTakenColors(),
        allowSpectators: room.allowSpectators,
      });
    } else {
      const status = room.getPlayAgainStatus();
      io.to(roomId).emit('playAgainVote', status);
    }
    room.touch();
  });

  socket.on('declinePlayAgain', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.FINISHED) return;

    room.addPlayAgainDeclined(socket.id);
    const status = room.getPlayAgainStatus();
    io.to(roomId).emit('playAgainVote', status);
    room.touch();
  });

  // ── KICK ──
  socket.on('kickPlayer', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { targetId } = payload;
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const result = room.kickPlayer(socket.id, targetId);
    if (!result.success) return socket.emit('error', { error: result.error });
    io.to(targetId).emit('kicked', { reason: 'host_kick' });
    delete playerToRoom[targetId];
    const kickedSocket = io.sockets.sockets.get(targetId); kickedSocket?.leave(roomId);
    io.to(roomId).emit('playerKicked', {
      targetId, players: room.getPlayerList(),
      hostId: room.hostId, takenColors: room.getTakenColors(),
    });
    room.touch();
  });

  // ── REJOIN (reconnection recovery) ──
  socket.on('rejoinRoom', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const roomId = sanitizeInput(payload.gameId, 50).toUpperCase();
    const playerName = sanitizeInput(payload.playerName, 50);
    const password = payload.password ? sanitizeInput(payload.password, 3) : null;
    const room = rooms[roomId];
    if (!room) return socket.emit('roomClosed');

    // Check for disconnected player awaiting reconnection
    const reconnectKey = `${roomId}:${playerName}`;
    const disconnected = disconnectedPlayers.get(reconnectKey);

    if (disconnected && Date.now() - disconnected.timestamp < RECONNECT_GRACE_MS) {
      // Validate password if room had one
      if (disconnected.password && disconnected.password !== password) {
        return socket.emit('error', { error: 'Invalid PIN for reconnection' });
      }

      // Reconnect: swap old socket ID to new socket ID in room
      const oldSocketId = disconnected.oldSocketId;
      const playerData = room.players[oldSocketId];

      if (playerData && playerData.alive) {
        // Move player data to new socket ID
        delete room.players[oldSocketId];
        room.players[socket.id] = playerData;
        playerData.disconnected = false;
        playerData.disconnectTime = 0;
        room.playerOrder = room.playerOrder.map(id => id === oldSocketId ? socket.id : id);
        if (room.hostId === oldSocketId) room.hostId = socket.id;

        socket.join(roomId);
        playerToRoom[socket.id] = roomId;
        disconnectedPlayers.delete(reconnectKey);

        if (room.state === GameState.PLAYING) {
          const state = room.getStateForClients();
          state.gridChanges = [];
          state.events = [];
          socket.emit('gameStarted', {
            gameState: state,
            grid: room.getFullGridForClient(),
            timeLimit: room.timeLimit,
          });
          io.to(roomId).emit('playerReconnected', { playerId: socket.id, playerName });
        }
        return;
      }
    }

    // Fallback: check if this socket.id is already in the room (same session)
    if (room.players[socket.id]) {
      socket.join(roomId);
      playerToRoom[socket.id] = roomId;
      if (room.state === GameState.PLAYING) {
        const state = room.getStateForClients();
        state.gridChanges = [];
        state.events = [];
        socket.emit('gameStarted', {
          gameState: state,
          grid: room.getFullGridForClient(),
          timeLimit: room.timeLimit,
        });
      } else if (room.state === GameState.FINISHED) {
        socket.emit('gameOver', room.getGameOverData());
      } else {
        socket.emit('gameJoined', {
          playerId: socket.id, roomId: room.roomId,
          players: room.getPlayerList(), state: room.state,
          hostId: room.hostId, isHost: room.isHost(socket.id),
          takenColors: room.getTakenColors(),
          gridSize: GRID_SIZE, maxPlayers: MAX_PLAYERS_PER_ROOM, colors: PLAYER_COLORS,
          timeLimit: room.timeLimit,
        });
      }
    }
  });

  // ── TOGGLE SPECTATORS ──
  socket.on('toggleSpectators', (payload) => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    if (!room.isHost(socket.id)) return socket.emit('error', { error: 'Only the host can toggle spectators' });
    const allow = payload && typeof payload.allow === 'boolean' ? payload.allow : !room.allowSpectators;
    room.allowSpectators = allow;
    io.to(roomId).emit('spectatorsToggled', { allowSpectators: allow });
    // If disabling, kick existing spectators
    if (!allow) {
      room.spectators.forEach(sid => {
        io.to(sid).emit('kicked', { reason: 'spectators_disabled' });
        const specSock = io.sockets.sockets.get(sid); specSock?.leave(roomId);
        delete playerToRoom[sid];
      });
      room.spectators.clear();
      io.to(roomId).emit('spectatorUpdate', { count: 0 });
    }
    room.touch();
  });

  // ── LEAVE ──
  socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); socket.emit('leftRoom'); });
  socket.on('disconnect', () => { handlePlayerLeave(socket.id); if (process.env.DEBUG) console.log(`Disconnected: ${socket.id}`); });
});

// ============================================================================
// HTTP API
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version,
    rooms: Object.keys(rooms).length,
    players: io.engine?.clientsCount || 0,
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

app.get('/version', (req, res) => {
  res.json({
    name: pkg.name,
    version: pkg.version,
    activeRooms: Object.keys(rooms).length,
    connectedSockets: io.engine?.clientsCount || 0,
    node: process.version,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

app.get('/rooms', (req, res) => {
  const list = Object.values(rooms)
    .filter(r => {
      if (r.state === GameState.WAITING && !r.isFull()) return true;
      if (r.state === GameState.PLAYING) return true;
      return false;
    })
    .map(r => ({
      roomId: r.roomId, hostName: r.hostName,
      hasPassword: r.hasPassword(), createdAt: r.createdAt,
      state: r.state, playerCount: r.playerCount(),
      maxPlayers: MAX_PLAYERS_PER_ROOM, spectatorCount: r.spectators.size,
      allowSpectators: r.allowSpectators,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  res.json({ rooms: list });
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms[req.params.id.toUpperCase()];
  if (!room) return res.json({ exists: false });
  res.json({
    exists: true, state: room.state, hasPassword: room.hasPassword(),
    playerCount: room.playerCount(), maxPlayers: MAX_PLAYERS_PER_ROOM,
    takenColors: room.getTakenColors(),
    allowSpectators: room.allowSpectators,
  });
});

app.post('/rooms/:id/check-password', (req, res) => {
  const clientIp = req.ip || 'unknown';
  const key = `${clientIp}:${req.params.id.toUpperCase()}`;
  const now = Date.now();

  // Unbounded-growth protection — cap at 5000 entries
  if (pinTracker.size > 5000) {
    for (const [k, e] of pinTracker) {
      e.ts = e.ts.filter(t => now - t < PIN_RATE_WINDOW);
      if (e.ts.length === 0) pinTracker.delete(k);
    }
  }

  let entry = pinTracker.get(key) || { ts: [] };
  pinTracker.set(key, entry);
  entry.ts = entry.ts.filter(t => now - t < PIN_RATE_WINDOW);
  if (entry.ts.length >= PIN_RATE_MAX) return res.status(429).json({ error: 'Too many attempts' });
  entry.ts.push(now);
  const room = rooms[req.params.id.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { password } = req.body;
  if (room.checkPassword(sanitizeInput(password, 3))) res.json({ valid: true });
  else res.status(401).json({ valid: false, error: 'Incorrect PIN' });
});

// ============================================================================
// CLEANUP
// ============================================================================

setInterval(() => {
  const now = Date.now();
  Object.keys(rooms).forEach(id => {
    const room = rooms[id];
    const timeout = room.state === GameState.FINISHED
      ? ROOM_GAMEOVER_TIMEOUT_MS
      : ROOM_INACTIVE_TIMEOUT_MS;
    if (room.isInactive(timeout) || room.isEmpty()) {
      room.cleanup();
      Object.keys(room.players).forEach(pid => {
        io.to(pid).emit('roomClosed');
        const sock = io.sockets.sockets.get(pid); sock?.leave(id); delete playerToRoom[pid];
      });
      room.spectators.forEach(sid => {
        io.to(sid).emit('roomClosed');
        const sock = io.sockets.sockets.get(sid); sock?.leave(id); delete playerToRoom[sid];
      });
      console.log(`Cleaning up stale room: ${id}`);
      delete rooms[id];
      roomLocks.delete(id);
    }
  });
  // Cleanup expired PIN rate limit entries
  for (const [key, entry] of pinTracker) {
    entry.ts = entry.ts.filter(t => now - t < PIN_RATE_WINDOW);
    if (entry.ts.length === 0) pinTracker.delete(key);
  }
  // Cleanup expired IP rate limit entries
  ipRateLimiter.cleanup();
  // Cleanup expired disconnectedPlayers entries
  const dcNow = Date.now();
  for (const [key, entry] of disconnectedPlayers) {
    if (dcNow - entry.timestamp > RECONNECT_GRACE_MS) disconnectedPlayers.delete(key);
  }
  // Cleanup orphaned locks
  for (const [id] of roomLocks) {
    if (!rooms[id]) roomLocks.delete(id);
  }
}, ROOM_CLEANUP_INTERVAL_MS);

// ============================================================================
// START
// ============================================================================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`\n\x1b[36m🏴 ${pkg.name} v${pkg.version}\x1b[0m`);
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});

function gracefulShutdown(signal) {
  console.log(`\n${signal} received — shutting down…`);
  io.emit('error', { error: 'Server restarting. Reconnect shortly.' });
  for (const id in rooms) rooms[id].cleanup();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
