/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Client Constants (ES Module)
   Note: GRID_SIZE, TICK_RATE must match server/src/constants.js
   ═══════════════════════════════════════════════════════════ */

export const GRID_SIZE = 80;
export const TICK_RATE = 10;
export const TICK_MS   = 1000 / TICK_RATE;

export const PLAYER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#e91e63', '#00bcd4'
];

export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan'];

export const LOCAL_SERVER_URL  = 'http://localhost:3001';
export const PUBLIC_SERVER_URL = 'https://territory-conquest-production.up.railway.app';

// If REACT_APP_SERVER_URL is explicitly set at build time, use only that.
// Otherwise the app will try LOCAL first, then fall back to PUBLIC at runtime (see useSocket.js).
export const SOCKET_URL = process.env.REACT_APP_SERVER_URL || null;
