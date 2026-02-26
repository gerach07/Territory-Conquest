/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Client Constants (ES Module)
   ═══════════════════════════════════════════════════════════ */

export const GRID_SIZE = 80;

export const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4'
];

export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Cyan'];

export const LOCAL_SERVER_URL  = 'http://localhost:3001';
export const PUBLIC_SERVER_URL = window.location.origin;

// If REACT_APP_SERVER_URL is explicitly set at build time, use only that.
// Otherwise the app will try LOCAL first, then fall back to PUBLIC at runtime (see useSocket.js).
export const SOCKET_URL = process.env.REACT_APP_SERVER_URL || null;
