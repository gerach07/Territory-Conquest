/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Utility Helpers (ES Module)
   ═══════════════════════════════════════════════════════════ */
import { GRID_SIZE } from '../constants';

/**
 * Escape HTML special characters.
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format seconds → human-readable uptime.
 */
export function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Build waiting-room data from server payload.
 */
export function buildWaitingData(data, roomCode, gameTimeLimit) {
  const hostId  = data.hostId || null;
  const players = (data.players || []).map((p) => ({
    id:         p.id,
    name:       p.name,
    colorIndex: p.colorIndex,
    isHost:     p.id === hostId,
  }));
  return {
    roomCode,
    players,
    hasPassword:  !!(data.password || data.hasPassword),
    gameStarted:  false,
    timeLimit:    data.timeLimit || gameTimeLimit || null,
  };
}

/** Get room code and password from URL path (e.g., /ABC123 or /ABC123/123) */
export function getRoomFromURL() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return { roomCode: null, password: null };

    const parts = path.split('/');
    const roomCode = parts[0];
    const rawPassword = parts[1] || null;

    // Password must be exactly 3 digits
    let password = null;
    if (rawPassword && /^\d{3}$/.test(rawPassword)) {
        password = rawPassword;
    }

    if (roomCode && /^[A-Z0-9]{4,10}$/i.test(roomCode)) {
        return { roomCode: roomCode.toUpperCase(), password };
    }
    return { roomCode: null, password: null };
}

/** Update URL to reflect current room and optionally password */
export function setURLRoom(roomCode, password = null) {
    if (roomCode) {
        const path = password ? `/${roomCode}/${password}` : `/${roomCode}`;
        window.history.replaceState(null, '', path);
    } else {
        window.history.replaceState(null, '', '/');
    }
}

/**
 * Process gameState from server format to client format.
 * Server sends players as object { [socketId]: {...} }; we need an array.
 * Server sends grid as flat array; we need 2D.
 */
export function processGameState(state, flatGrid, prevGrid) {
  const result = { players: [], grid: prevGrid || null };

  // Convert players object → array
  if (state.players) {
    if (Array.isArray(state.players)) {
      result.players = state.players;
    } else {
      result.players = Object.entries(state.players).map(([id, p]) => ({
        id,
        name:        p.name,
        x:           p.x,
        y:           p.y,
        direction:   p.direction,
        trail:       p.trail ? p.trail.map((t) => [t.x, t.y]) : [],
        alive:       p.alive,
        color:       p.color,
        colorIndex:  p.colorIndex,
        score:       p.score,
        kills:       p.kills,
        playerIndex: p.playerIndex,
        spectator:   false,
      }));
    }
  }

  // Build 2D grid from flat array (initial full grid)
  if (flatGrid) {
    result.grid = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      result.grid[y] = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        result.grid[y][x] = flatGrid[y * GRID_SIZE + x];
      }
    }
  }

  // Apply incremental grid changes
  if (state.gridChanges && result.grid) {
    state.gridChanges.forEach((change) => {
      if (change.y >= 0 && change.y < GRID_SIZE && change.x >= 0 && change.x < GRID_SIZE) {
        result.grid[change.y][change.x] = change.owner;
      }
    });
  }

  // Player index → color index map for grid rendering
  result.playerColorMap = {};
  result.players.forEach((p) => {
    if (p.playerIndex !== undefined) {
      result.playerColorMap[p.playerIndex] = p.colorIndex;
    }
  });

  return result;
}
