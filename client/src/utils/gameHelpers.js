/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Utility Helpers (ES Module)
   ═══════════════════════════════════════════════════════════ */
import { GRID_SIZE } from '../constants';

/**
 * Format seconds → human-readable uptime.
 */
export function formatUptime(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
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
 * Optimized to reduce GC pressure.
 */
export function processGameState(state, flatGrid, prevGrid) {
  const result = { players: [], grid: prevGrid || null };

  // Convert players object → array (supports both compact and legacy formats)
  if (state.players) {
    if (Array.isArray(state.players)) {
      result.players = state.players;
    } else {
      const entries = Object.keys(state.players);
      const players = new Array(entries.length);
      for (let i = 0; i < entries.length; i++) {
        const id = entries[i];
        const p = state.players[id];
        const trail = p.t ? p.t : (p.trail ? p.trail.map(pt => [pt.x, pt.y]) : []);
        players[i] = {
          id,
          name:        p.name,
          x:           p.x,
          y:           p.y,
          direction:   p.d || p.direction,
          trail,
          alive:       p.a !== undefined ? !!p.a : p.alive,
          color:       p.color,
          colorIndex:  p.colorIndex,
          score:       p.s !== undefined ? p.s : p.score,
          kills:       p.k !== undefined ? p.k : p.kills,
          playerIndex: p.playerIndex,
          lis:         p.lis || 0,
          spectator:   false,
          forfeited:   p.forfeited || false,
        };
      }
      result.players = players;
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

  // If server sent a periodic full grid sync, rebuild grid from it
  // (overrides incremental gridChanges to correct any drift)
  if (state.fullGrid && Array.isArray(state.fullGrid)) {
    result.grid = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      result.grid[y] = [];
      for (let x = 0; x < GRID_SIZE; x++) {
        result.grid[y][x] = state.fullGrid[y * GRID_SIZE + x];
      }
    }
  } else if (state.gridChanges && result.grid) {
    // Apply incremental grid changes (clone affected rows for React immutability)
    const clonedRows = new Set();
    for (let i = 0; i < state.gridChanges.length; i++) {
      const change = state.gridChanges[i];
      if (change.y >= 0 && change.y < GRID_SIZE && change.x >= 0 && change.x < GRID_SIZE) {
        if (!clonedRows.has(change.y)) {
          result.grid[change.y] = [...result.grid[change.y]];
          clonedRows.add(change.y);
        }
        result.grid[change.y][change.x] = change.owner;
      }
    }
  }

  // Player index → color index map for grid rendering
  // Rebuild only when player data changes (compare by generating a stable key)
  const colorMapKey = result.players.map(p => `${p.playerIndex}:${p.colorIndex}`).join(',');
  if (prevGrid?.playerColorMap && prevGrid._colorMapKey === colorMapKey) {
    result.playerColorMap = prevGrid.playerColorMap;
    result._colorMapKey = colorMapKey;
  } else {
    result.playerColorMap = {};
    for (let i = 0; i < result.players.length; i++) {
      const p = result.players[i];
      if (p.playerIndex !== undefined) {
        result.playerColorMap[p.playerIndex] = p.colorIndex;
      }
    }
    result._colorMapKey = colorMapKey;
  }

  return result;
}
