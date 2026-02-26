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
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pkg = require('./package.json');

const {
  GRID_SIZE, TICK_MS, MAX_PLAYERS_PER_ROOM,
  ROOM_CLEANUP_INTERVAL_MS, ROOM_INACTIVE_TIMEOUT_MS,
  ROOM_GAMEOVER_TIMEOUT_MS, IP_RATE_LIMIT_MAX, MAX_CHAT_LENGTH,
  PLAYER_COLORS, DIRECTIONS, GameState,
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
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: isOriginAllowed, methods: ['GET', 'POST'], credentials: true }));
app.use(express.json({ limit: '16kb' }));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: isOriginAllowed, methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000, pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  transports: ['websocket', 'polling'],
});

// ============================================================================
// GLOBAL STATE
// ============================================================================

const rooms = {};
const playerToRoom = {};
const ipRateLimiter = new RateLimiter(60000, IP_RATE_LIMIT_MAX);
const pinTracker = new Map();
const PIN_RATE_WINDOW = 60000;
const PIN_RATE_MAX = 5;

// Room locks (mutex for concurrent operations)
const roomLocks = new Map();

function acquireRoomLock(roomId) {
  let chain = roomLocks.get(roomId) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  roomLocks.set(roomId, chain.then(() => next));
  return chain.then(() => release);
}

// ============================================================================
// IP CONNECTION TRACKER
// ============================================================================

const ipConnectionTracker = new Map();

function trackIpConnection(ip) {
  const now = Date.now();
  let entry = ipConnectionTracker.get(ip);
  if (!entry) { entry = { ts: [] }; ipConnectionTracker.set(ip, entry); }
  entry.ts = entry.ts.filter(t => now - t < 60000);
  if (entry.ts.length >= IP_RATE_LIMIT_MAX) return false;
  entry.ts.push(now);
  return true;
}

// ============================================================================
// GAME LOOP
// ============================================================================

function startGameLoop(roomId) {
  const room = rooms[roomId];
  if (!room || room.tickTimer) return;
  room.tickTimer = setInterval(async () => {
    if (!rooms[roomId] || room.state !== GameState.PLAYING) {
      clearInterval(room.tickTimer); room.tickTimer = null; return;
    }
    const release = await acquireRoomLock(roomId);
    try {
      if (room.state !== GameState.PLAYING) return;
      const result = room.tick();
      if (!result) return;
      const state = room.getStateForClients();
      state.gridChanges = result.gridChanges;
      state.events = result.events;
      io.to(roomId).emit('gameState', state);

      // Game finished by timer
      if (result.gameFinished) {
        clearInterval(room.tickTimer); room.tickTimer = null;
        const gameOverData = room.getGameOverData();
        io.to(roomId).emit('gameOver', gameOverData);
      }

      room.touch();
    } finally {
      release();
    }
  }, TICK_MS);
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

  if (room.state === GameState.PLAYING && player) {
    const gridChanges = [];
    room.killPlayer(socketId, 'disconnect', null, gridChanges);
    io.to(roomId).emit('gameState', {
      ...room.getStateForClients(), gridChanges,
      events: [{ type: 'disconnect', playerId: socketId }],
    });
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
  } else {
    if (room.hostId === socketId) {
      const remaining = Object.keys(room.players)[0];
      if (remaining) { room.hostId = remaining; room.hostName = room.players[remaining].name; }
    }
    if (room.state === GameState.WAITING) {
      io.to(roomId).emit('playerLeft', {
        playerId: socketId, playerName,
        players: room.getPlayerList(), hostId: room.hostId,
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

  if (!ipRateLimiter.isAllowed(clientIp)) {
    socket.emit('error', { error: 'Too many connections. Please wait.' });
    socket.disconnect(true); return;
  }

  console.log(`Connected: ${socket.id}`);

  // ── JOIN ──
  socket.on('joinGame', async (payload) => {
    if (!payload || typeof payload !== 'object') return socket.emit('error', { error: 'Invalid request' });
    const { gameId, playerName, password, colorIndex, isCreating, isSpectating, timeLimit } = payload;
    if (playerToRoom[socket.id]) handlePlayerLeave(socket.id);

    const roomId = sanitizeInput(gameId, 50).toUpperCase();
    const name = sanitizeInput(playerName, 50) || 'Anonymous';
    const pwd = password ? sanitizeInput(password, 3) : null;
    let cIdx = typeof colorIndex === 'number' ? Math.max(0, Math.min(PLAYER_COLORS.length - 1, colorIndex)) : 0;
    if (!roomId) return socket.emit('error', { error: 'Invalid room ID' });

    let room = rooms[roomId];

    if (isSpectating) {
      if (!room) return socket.emit('error', { error: 'Room does not exist' });
      if (!room.checkPassword(pwd)) return socket.emit('error', { error: 'Incorrect PIN' });
      if (!room.addSpectator(socket.id)) return socket.emit('error', { error: 'Spectator slots full' });
      playerToRoom[socket.id] = roomId; socket.join(roomId);
      const data = { roomId: room.roomId, players: room.getPlayerList(), state: room.state, gridSize: GRID_SIZE };
      if (room.state === GameState.PLAYING) {
        data.grid = room.getFullGridForClient();
        data.gameState = room.getStateForClients();
      }
      if (room.state === GameState.FINISHED) {
        data.gameOverData = room.getGameOverData();
      }
      data.chatHistory = room.chatHistory.slice(-50);
      socket.emit('spectatorJoined', data);
      io.to(roomId).emit('spectatorUpdate', { count: room.spectators.size });
      room.touch(); return;
    }

    if (isCreating) {
      if (room) return socket.emit('error', { error: 'Room already exists. Try a different code.' });
      room = new Room(roomId, pwd, name, socket.id);
      // Apply time limit if provided
      if (typeof timeLimit === 'number') {
        room.timeLimit = Math.max(MIN_GAME_TIME_SECONDS, Math.min(MAX_GAME_TIME_SECONDS, Math.floor(timeLimit)));
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
    if (!payload || typeof payload !== 'object') return;
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
  });

  // ── CHAT ──
  socket.on('sendChat', async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const message = sanitizeInput(payload.message, MAX_CHAT_LENGTH);
    if (!message) return;
    const release = await acquireRoomLock(roomId);
    try {
      const msg = room.addChatMessage(socket.id, message);
      if (msg) {
        io.to(roomId).emit('chatMessage', msg);
      }
      room.touch();
    } finally {
      release();
    }
  });

  // ── HOST START ──
  socket.on('hostStartGame', async () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    if (!room.isHost(socket.id)) return socket.emit('error', { error: 'Only the host can start the game' });
    if (room.state !== GameState.WAITING) return socket.emit('error', { error: 'Game already started' });
    if (room.playerCount() < 2) return socket.emit('error', { error: 'Need at least 2 players' });

    const release = await acquireRoomLock(roomId);
    try {
      room.initGame();
      io.to(roomId).emit('gameStarted', {
        grid: room.getFullGridForClient(), gameState: room.getStateForClients(),
        gridSize: GRID_SIZE, players: room.getPlayerList(),
        timeLimit: room.timeLimit,
      });
      startGameLoop(roomId); room.touch();
    } finally {
      release();
    }
  });

  // ── FORFEIT ──
  socket.on('forfeit', async () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.PLAYING) return;
    const player = room.players[socket.id];
    if (!player || player.forfeited) return;

    const release = await acquireRoomLock(roomId);
    try {
      const result = room.forfeitPlayer(socket.id);
      if (!result) return;

      io.to(roomId).emit('gameState', {
        ...room.getStateForClients(),
        gridChanges: result.gridChanges,
        events: [{ type: 'forfeit', playerId: socket.id, playerName: player.name }],
      });

      if (result.gameEnded) {
        if (room.tickTimer) { clearInterval(room.tickTimer); room.tickTimer = null; }
        const gameOverData = room.getGameOverData();
        io.to(roomId).emit('gameOver', gameOverData);
      }
      room.touch();
    } finally {
      release();
    }
  });

  // ── PLAY AGAIN ──
  socket.on('requestPlayAgain', async () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== GameState.FINISHED) return;

    const release = await acquireRoomLock(roomId);
    try {
      const result = room.addPlayAgainVote(socket.id);
      if (!result.success) return;

      if (result.allVoted) {
        room.resetToWaiting();
        io.to(roomId).emit('gameReset', {
          players: room.getPlayerList(),
          hostId: room.hostId,
          state: room.state,
          takenColors: room.getTakenColors(),
        });
      } else {
        const player = room.players[socket.id];
        io.to(roomId).emit('playAgainVote', {
          playerId: socket.id,
          playerName: player ? player.name : 'Player',
          votes: Array.from(room.playAgainVotes),
          totalPlayers: room.playerCount(),
        });
      }
      room.touch();
    } finally {
      release();
    }
  });

  socket.on('declinePlayAgain', () => {
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    room.removePlayAgainVote(socket.id);
    const player = room.players[socket.id];
    io.to(roomId).emit('playAgainDeclined', {
      playerId: socket.id,
      playerName: player ? player.name : 'Player',
    });
  });

  // ── KICK ──
  socket.on('kickPlayer', async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { targetId } = payload;
    const roomId = playerToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;
    const release = await acquireRoomLock(roomId);
    try {
      const result = room.kickPlayer(socket.id, targetId);
      if (!result.success) return socket.emit('error', { error: result.error });
      io.to(targetId).emit('kicked', { message: 'You have been kicked from the room' });
      delete playerToRoom[targetId];
      const kickedSocket = io.sockets.sockets.get(targetId); kickedSocket?.leave(roomId);
      room.playerOrder = room.playerOrder.filter(id => id !== targetId);
      io.to(roomId).emit('playerKicked', {
        targetId, players: room.getPlayerList(),
        hostId: room.hostId, takenColors: room.getTakenColors(),
      });
      room.touch();
    } finally {
      release();
    }
  });

  // ── LEAVE ──
  socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); socket.emit('leftRoom'); });
  socket.on('disconnect', () => { handlePlayerLeave(socket.id); console.log(`Disconnected: ${socket.id}`); });
});

// ============================================================================
// HTTP API
// ============================================================================

app.get('/health', (req, res) => res.json({
  status: 'ok',
  uptime: process.uptime(),
  version: pkg.version,
  rooms: Object.keys(rooms).length,
  players: io.engine?.clientsCount || 0,
  nodeVersion: process.version,
  memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
}));

app.get('/version', (req, res) => {
  res.json({
    name: pkg.name, version: pkg.version, node: process.version,
    uptime: Math.floor(process.uptime()),
    activeRooms: Object.keys(rooms).length,
    connectedSockets: io.engine?.clientsCount || 0,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

app.get('/rooms', (req, res) => {
  const list = Object.values(rooms)
    .filter(r => r.state === GameState.WAITING && !r.isFull())
    .map(r => ({
      roomId: r.roomId, hostName: r.hostName,
      hasPassword: r.hasPassword(), createdAt: r.createdAt,
      state: r.state, playerCount: r.playerCount(),
      maxPlayers: MAX_PLAYERS_PER_ROOM, spectatorCount: r.spectators.size,
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
  });
});

app.post('/rooms/:id/check-password', (req, res) => {
  const clientIp = req.ip || 'unknown';
  const key = `${clientIp}:${req.params.id.toUpperCase()}`;
  const now = Date.now();

  // Unbounded-growth protection
  if (pinTracker.size > 10000) {
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
    }
  });
  // Cleanup expired PIN rate limit entries
  for (const [key, entry] of pinTracker) {
    entry.ts = entry.ts.filter(t => now - t < PIN_RATE_WINDOW);
    if (entry.ts.length === 0) pinTracker.delete(key);
  }
  // Cleanup expired IP rate limit entries
  ipRateLimiter.cleanup();
  // Cleanup IP connection tracker
  for (const [ip, entry] of ipConnectionTracker) {
    entry.ts = entry.ts.filter(t => now - t < 60000);
    if (entry.ts.length === 0) ipConnectionTracker.delete(ip);
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
