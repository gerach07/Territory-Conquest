/**
 * ============================================================================
 * TERRITORY CONQUEST - Room Model
 * (mirrors Battleships server/src/models/Room.js)
 * ============================================================================
 */

const {
  GRID_SIZE, MAX_PLAYERS_PER_ROOM, MAX_SPECTATORS,
  RESPAWN_DELAY_MS, START_TERRITORY_SIZE,
  PLAYER_COLORS, DIRECTIONS, START_POSITIONS, GameState, VALID_TRANSITIONS,
  RATE_LIMIT_ACTIONS_PER_SECOND, RATE_LIMIT_CHAT_PER_SECOND,
  MAX_CHAT_LENGTH, DEFAULT_GAME_TIME_SECONDS,
} = require('../constants');
const RateLimiter = require('../utils/RateLimiter');

// ============================================================================
// CAPTURE ALGORITHM (Flood Fill)
// ============================================================================

function captureTerritory(grid, playerId, trail) {
  if (!trail || trail.length === 0) return [];

  for (const pos of trail) {
    grid[pos.y][pos.x] = playerId;
  }

  let minX = GRID_SIZE, maxX = 0, minY = GRID_SIZE, maxY = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (grid[y][x] === playerId) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(GRID_SIZE - 1, maxX + 1);
  maxY = Math.min(GRID_SIZE - 1, maxY + 1);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  const visited = new Array(height);
  for (let i = 0; i < height; i++) visited[i] = new Uint8Array(width);

  const queue = [];
  for (let x = minX; x <= maxX; x++) {
    const lx = x - minX;
    if (grid[minY][x] !== playerId && !visited[0][lx]) { visited[0][lx] = 1; queue.push(lx, 0); }
    if (grid[maxY][x] !== playerId && !visited[height - 1][lx]) { visited[height - 1][lx] = 1; queue.push(lx, height - 1); }
  }
  for (let y = minY; y <= maxY; y++) {
    const ly = y - minY;
    if (grid[y][minX] !== playerId && !visited[ly][0]) { visited[ly][0] = 1; queue.push(0, ly); }
    if (grid[y][maxX] !== playerId && !visited[ly][width - 1]) { visited[ly][width - 1] = 1; queue.push(width - 1, ly); }
  }

  let head = 0;
  while (head < queue.length) {
    const lx = queue[head++];
    const ly = queue[head++];
    for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = lx + ddx, ny = ly + ddy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
        if (grid[ny + minY][nx + minX] !== playerId) { visited[ny][nx] = 1; queue.push(nx, ny); }
      }
    }
  }

  const captured = [];
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      if (!visited[ly][lx]) {
        const gx = lx + minX, gy = ly + minY;
        if (grid[gy][gx] !== playerId) { grid[gy][gx] = playerId; captured.push({ x: gx, y: gy }); }
      }
    }
  }
  return captured;
}

// ============================================================================
// ROOM CLASS
// ============================================================================

class Room {
  constructor(roomId, password, hostName, hostId) {
    this.roomId = roomId;
    this.password = password || null;
    this.hostName = hostName;
    this.hostId = hostId;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.state = GameState.WAITING;
    this.players = {};
    this.spectators = new Set();
    this.grid = null;
    this.trailGrid = null;
    this.tickTimer = null;
    this.playerOrder = [];
    this.gameStartTime = null;

    // Timer
    this.timeLimit = DEFAULT_GAME_TIME_SECONDS;
    this.gameEndTime = null;

    // Chat
    this.chatHistory = [];

    // Play-again votes
    this.playAgainVotes = new Set();

    // Winner info
    this.winnerId = null;
    this.winnerName = null;

    // Per-player rate limiters
    this.actionLimiter = new RateLimiter(RATE_LIMIT_ACTIONS_PER_SECOND, 1000);
    this.chatLimiter = new RateLimiter(RATE_LIMIT_CHAT_PER_SECOND, 1000);
  }

  // ── State Machine ──

  _transitionState(newState) {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      console.warn(`Invalid state transition: ${this.state} → ${newState} in room ${this.roomId}`);
      return false;
    }
    this.state = newState;
    return true;
  }

  // ── Basics ──

  touch() { this.lastActivity = Date.now(); }
  isInactive(ms) { return Date.now() - this.lastActivity > ms; }
  isEmpty() { return Object.keys(this.players).length === 0; }
  playerCount() { return Object.keys(this.players).length; }
  isFull() { return this.playerCount() >= MAX_PLAYERS_PER_ROOM; }
  hasPassword() { return this.password !== null && this.password !== ''; }
  checkPassword(pwd) { return !this.hasPassword() || this.password === pwd; }
  isHost(pid) { return this.hostId === pid; }

  getPlayerList() {
    return Object.values(this.players).map(p => ({
      id: p.id, name: p.name, color: p.color, colorIndex: p.colorIndex,
    }));
  }

  addSpectator(sid) {
    if (this.spectators.size >= MAX_SPECTATORS) return false;
    this.spectators.add(sid);
    return true;
  }

  addPlayer(playerId, playerName, colorIndex) {
    if (this.isFull()) return false;
    const takenColors = new Set(Object.values(this.players).map(p => p.colorIndex));
    if (takenColors.has(colorIndex)) {
      for (let i = 0; i < PLAYER_COLORS.length; i++) {
        if (!takenColors.has(i)) { colorIndex = i; break; }
      }
    }
    this.players[playerId] = {
      id: playerId, name: playerName, colorIndex,
      color: PLAYER_COLORS[colorIndex] || PLAYER_COLORS[0],
      x: 0, y: 0, direction: 'right', trail: [],
      alive: true, deathTime: 0, score: 0, kills: 0,
      joinedAt: Date.now(),
    };
    return true;
  }

  kickPlayer(kickerId, targetId) {
    if (!this.isHost(kickerId)) return { success: false, error: 'Only host can kick' };
    if (targetId === kickerId) return { success: false, error: 'Cannot kick yourself' };
    if (!this.players[targetId]) return { success: false, error: 'Player not found' };
    delete this.players[targetId];
    this.actionLimiter.removeKey(targetId);
    this.chatLimiter.removeKey(targetId);
    return { success: true };
  }

  getTakenColors() {
    return Object.values(this.players).map(p => p.colorIndex);
  }

  // ── Chat ──

  addChatMessage(playerId, message) {
    if (!this.chatLimiter.isAllowed(playerId)) return null;
    const player = this.players[playerId];
    const isSpectator = this.spectators.has(playerId);
    const name = player ? player.name : (isSpectator ? 'Spectator' : 'Unknown');
    const color = player ? player.color : PLAYER_COLORS[0];
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      playerId,
      playerName: name,
      playerColor: color,
      message: message.slice(0, MAX_CHAT_LENGTH),
      timestamp: Date.now(),
      isSpectator,
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 100) {
      this.chatHistory = this.chatHistory.slice(-50);
    }
    return msg;
  }

  initGame() {
    this.grid = new Array(GRID_SIZE);
    this.trailGrid = new Array(GRID_SIZE);
    for (let y = 0; y < GRID_SIZE; y++) {
      this.grid[y] = new Int8Array(GRID_SIZE);
      this.trailGrid[y] = new Int8Array(GRID_SIZE);
    }

    this.playerOrder = Object.keys(this.players);
    this.playerOrder.forEach((pid, idx) => {
      const p = this.players[pid];
      const startPos = START_POSITIONS[idx % START_POSITIONS.length];
      p.x = startPos.x; p.y = startPos.y;
      p.direction = 'right'; p.trail = [];
      p.alive = true; p.deathTime = 0; p.score = 0; p.kills = 0;
      p.playerIndex = idx + 1;
      p.forfeited = false;

      const half = Math.floor(START_TERRITORY_SIZE / 2);
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const gx = p.x + dx, gy = p.y + dy;
          if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
            this.grid[gy][gx] = p.playerIndex;
          }
        }
      }
    });

    this._transitionState(GameState.PLAYING);
    this.gameStartTime = Date.now();
    this.gameEndTime = Date.now() + this.timeLimit * 1000;
    this.winnerId = null;
    this.winnerName = null;
    this.playAgainVotes.clear();
    this.chatHistory = [];
  }

  // ── Timer ──

  isTimeUp() {
    if (!this.gameEndTime) return false;
    return Date.now() >= this.gameEndTime;
  }

  getRemainingTime() {
    if (!this.gameEndTime) return this.timeLimit;
    return Math.max(0, Math.ceil((this.gameEndTime - Date.now()) / 1000));
  }

  // ── Game End ──

  finishGame(winnerId) {
    if (this.state !== GameState.PLAYING) return false;
    this._transitionState(GameState.FINISHED);
    this.winnerId = winnerId || null;
    if (winnerId && this.players[winnerId]) {
      this.winnerName = this.players[winnerId].name;
    } else {
      let best = null;
      for (const pid of this.playerOrder) {
        const p = this.players[pid];
        if (p && (!best || p.score > best.score)) best = p;
      }
      if (best) {
        this.winnerId = best.id;
        this.winnerName = best.name;
      }
    }
    this.lastActivity = Date.now();
    return true;
  }

  // ── Play Again ──

  addPlayAgainVote(playerId) {
    if (this.state !== GameState.FINISHED) return { success: false };
    this.playAgainVotes.add(playerId);
    const activePlayers = Object.keys(this.players);
    const allVoted = activePlayers.every(pid => this.playAgainVotes.has(pid));
    return { success: true, allVoted };
  }

  removePlayAgainVote(playerId) {
    this.playAgainVotes.delete(playerId);
  }

  resetToWaiting() {
    if (this.state !== GameState.FINISHED) return false;
    this._transitionState(GameState.WAITING);
    this.grid = null;
    this.trailGrid = null;
    this.gameStartTime = null;
    this.gameEndTime = null;
    this.winnerId = null;
    this.winnerName = null;
    this.playAgainVotes.clear();
    this.chatHistory = [];
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (p) {
        p.score = 0; p.kills = 0; p.alive = true;
        p.trail = []; p.deathTime = 0; p.forfeited = false;
      }
    }
    return true;
  }

  // ── Forfeit ──

  forfeitPlayer(playerId) {
    if (this.state !== GameState.PLAYING) return null;
    const player = this.players[playerId];
    if (!player) return null;
    const gridChanges = [];
    this.killPlayer(playerId, 'forfeit', null, gridChanges);
    player.forfeited = true;

    const alivePlayers = this.playerOrder.filter(pid => {
      const p = this.players[pid];
      return p && p.alive && !p.forfeited;
    });

    let gameEnded = false;
    if (alivePlayers.length <= 1) {
      this.finishGame(alivePlayers[0] || null);
      gameEnded = true;
    }

    return { gridChanges, gameEnded, alivePlayers };
  }

  tick() {
    if (this.state !== GameState.PLAYING) return null;

    // Check timer
    if (this.isTimeUp()) {
      this.updateScores();
      this.finishGame(null);
      return { events: [{ type: 'timeUp' }], gridChanges: [], gameFinished: true };
    }

    const events = [], gridChanges = [];

    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (!p) continue;
      if (p.forfeited) continue;

      if (!p.alive) {
        if (Date.now() - p.deathTime > RESPAWN_DELAY_MS) {
          this.respawnPlayer(pid, gridChanges);
          events.push({ type: 'respawn', playerId: pid });
        }
        continue;
      }

      const dir = DIRECTIONS[p.direction];
      if (!dir) continue;
      const newX = p.x + dir.dx, newY = p.y + dir.dy;

      if (newX < 0 || newX >= GRID_SIZE || newY < 0 || newY >= GRID_SIZE) {
        this.killPlayer(pid, 'boundary', null, gridChanges);
        events.push({ type: 'kill', victim: pid, reason: 'boundary' });
        continue;
      }

      const trailOwnerIdx = this.trailGrid[newY][newX];
      if (trailOwnerIdx !== 0) {
        const trailOwnerId = this.playerOrder.find(id => this.players[id] && this.players[id].playerIndex === trailOwnerIdx);
        if (trailOwnerIdx === p.playerIndex) {
          this.killPlayer(pid, 'self_trail', null, gridChanges);
          events.push({ type: 'kill', victim: pid, reason: 'self_trail' });
        } else if (trailOwnerId) {
          this.killPlayer(trailOwnerId, 'trail_cut', pid, gridChanges);
          events.push({ type: 'kill', victim: trailOwnerId, killer: pid, reason: 'trail_cut' });
        }
        if (!p.alive) continue;
      }

      for (const otherId of this.playerOrder) {
        if (otherId === pid) continue;
        const other = this.players[otherId];
        if (!other || !other.alive) continue;
        if (other.x === newX && other.y === newY) {
          if (p.trail.length > 0) {
            this.killPlayer(pid, 'collision', otherId, gridChanges);
            events.push({ type: 'kill', victim: pid, killer: otherId, reason: 'collision' });
          }
          if (other.trail.length > 0) {
            this.killPlayer(otherId, 'collision', pid, gridChanges);
            events.push({ type: 'kill', victim: otherId, killer: pid, reason: 'collision' });
          }
        }
      }
      if (!p.alive) continue;

      p.x = newX; p.y = newY;
      const cellOwner = this.grid[newY][newX];

      if (cellOwner === p.playerIndex && p.trail.length > 0) {
        const captured = captureTerritory(this.grid, p.playerIndex, p.trail);
        for (const pos of p.trail) { this.trailGrid[pos.y][pos.x] = 0; }
        for (const pos of p.trail) { gridChanges.push({ x: pos.x, y: pos.y, owner: p.playerIndex, type: 'trail_to_territory' }); }
        for (const pos of captured) { gridChanges.push({ x: pos.x, y: pos.y, owner: p.playerIndex, type: 'captured' }); }
        p.trail = [];
        events.push({ type: 'capture', playerId: pid, capturedCount: captured.length });
      } else if (cellOwner !== p.playerIndex) {
        p.trail.push({ x: newX, y: newY });
        this.trailGrid[newY][newX] = p.playerIndex;
        gridChanges.push({ x: newX, y: newY, owner: p.playerIndex, type: 'trail' });
      }
    }

    this.updateScores();
    return { events, gridChanges, gameFinished: false };
  }

  killPlayer(pid, reason, killerId, gridChanges) {
    const p = this.players[pid];
    if (!p || !p.alive) return;
    p.alive = false; p.deathTime = Date.now();
    for (const pos of p.trail) {
      this.trailGrid[pos.y][pos.x] = 0;
      gridChanges.push({ x: pos.x, y: pos.y, owner: 0, type: 'trail_removed' });
    }
    p.trail = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (this.grid[y][x] === p.playerIndex) {
          this.grid[y][x] = 0;
          gridChanges.push({ x, y, owner: 0, type: 'territory_wiped' });
        }
      }
    }
    if (killerId && this.players[killerId]) this.players[killerId].kills++;
  }

  respawnPlayer(pid, gridChanges) {
    const p = this.players[pid];
    if (!p || p.forfeited) return;
    let bestX = Math.floor(Math.random() * (GRID_SIZE - 10)) + 5;
    let bestY = Math.floor(Math.random() * (GRID_SIZE - 10)) + 5;
    let bestDist = 0;

    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = Math.floor(Math.random() * (GRID_SIZE - 10)) + 5;
      const cy = Math.floor(Math.random() * (GRID_SIZE - 10)) + 5;
      let minDist = Infinity;
      for (const otherId of this.playerOrder) {
        if (otherId === pid) continue;
        const other = this.players[otherId];
        if (!other || !other.alive) continue;
        const dist = Math.abs(cx - other.x) + Math.abs(cy - other.y);
        if (dist < minDist) minDist = dist;
      }
      let onClaimed = false;
      const half = Math.floor(START_TERRITORY_SIZE / 2);
      for (let dy = -half; dy <= half && !onClaimed; dy++) {
        for (let dx = -half; dx <= half && !onClaimed; dx++) {
          const gx = cx + dx, gy = cy + dy;
          if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE && this.grid[gy][gx] !== 0) onClaimed = true;
        }
      }
      if (!onClaimed && minDist > bestDist) { bestDist = minDist; bestX = cx; bestY = cy; }
    }

    p.x = bestX; p.y = bestY; p.direction = 'right';
    p.trail = []; p.alive = true; p.deathTime = 0;

    const half = Math.floor(START_TERRITORY_SIZE / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const gx = p.x + dx, gy = p.y + dy;
        if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
          this.grid[gy][gx] = p.playerIndex;
          gridChanges.push({ x: gx, y: gy, owner: p.playerIndex, type: 'respawn_territory' });
        }
      }
    }
  }

  updateScores() {
    const totalCells = GRID_SIZE * GRID_SIZE;
    const counts = {};
    for (const pid of this.playerOrder) { const p = this.players[pid]; if (p) counts[p.playerIndex] = 0; }
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const owner = this.grid[y][x];
        if (owner !== 0 && counts[owner] !== undefined) counts[owner]++;
      }
    }
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (p) p.score = Math.round((counts[p.playerIndex] / totalCells) * 10000) / 100;
    }
  }

  getStateForClients() {
    const players = {};
    for (const pid of this.playerOrder) {
      const p = this.players[pid];
      if (!p) continue;
      players[pid] = {
        x: p.x, y: p.y, d: p.direction,
        t: p.trail.length > 0 ? p.trail.map(pt => [pt.x, pt.y]) : [],
        a: p.alive ? 1 : 0,
        s: p.score, k: p.kills,
        // Static fields needed for first render / reconnection
        name: p.name, colorIndex: p.colorIndex, playerIndex: p.playerIndex,
        forfeited: p.forfeited || false,
      };
    }
    return {
      players, tick: Date.now(),
      timeRemaining: this.getRemainingTime(),
      state: this.state,
    };
  }

  getFullGridForClient() {
    const data = new Array(GRID_SIZE * GRID_SIZE);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        data[y * GRID_SIZE + x] = this.grid[y][x];
      }
    }
    return data;
  }

  getGameOverData() {
    const players = this.playerOrder.map(pid => {
      const p = this.players[pid];
      if (!p) return null;
      return { id: p.id, name: p.name, score: p.score, kills: p.kills, color: p.color, colorIndex: p.colorIndex };
    }).filter(Boolean);
    players.sort((a, b) => b.score - a.score);
    return {
      winnerId: this.winnerId,
      winnerName: this.winnerName,
      players,
      state: this.state,
    };
  }

  cleanup() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }
}

module.exports = Room;
