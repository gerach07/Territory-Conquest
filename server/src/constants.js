/**
 * ============================================================================
 * TERRITORY CONQUEST - Server Constants
 * ============================================================================
 */

const GRID_SIZE = 80;
const TICK_RATE = 10;
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS_PER_ROOM = 6;
const MAX_SPECTATORS = 20;
const RESPAWN_DELAY_MS = 3000;
const RECONNECT_GRACE_MS = 15000; // 15 second grace period for reconnection
const START_TERRITORY_SIZE = 3;
const ROOM_CLEANUP_INTERVAL_MS = 30000;
const ROOM_INACTIVE_TIMEOUT_MS = 10 * 60 * 1000;   // 10 min
const ROOM_GAMEOVER_TIMEOUT_MS = 2 * 60 * 1000;     // 2 min (shorter for finished games)

// Timer settings (seconds)
const MIN_GAME_TIME_SECONDS = 60;
const MAX_GAME_TIME_SECONDS = 600;
const DEFAULT_GAME_TIME_SECONDS = 180;

// Rate-limiting
const RATE_LIMIT_ACTIONS_PER_SECOND = 15;  // direction changes per second
const RATE_LIMIT_CHAT_PER_SECOND = 3;
const MAX_CHAT_LENGTH = 200;
const MAX_CHAT_HISTORY = 100;
const IP_RATE_LIMIT_MAX = 15;

const PLAYER_COLORS = [
  { name: 'Red',    hex: '#e74c3c', light: '#ff6b6b' },
  { name: 'Blue',   hex: '#3498db', light: '#74b9ff' },
  { name: 'Green',  hex: '#2ecc71', light: '#55efc4' },
  { name: 'Yellow', hex: '#f1c40f', light: '#ffeaa7' },
  { name: 'Purple', hex: '#9b59b6', light: '#a29bfe' },
  { name: 'Orange', hex: '#e67e22', light: '#fab1a0' },
  { name: 'Pink',   hex: '#e91e63', light: '#fd79a8' },
  { name: 'Cyan',   hex: '#00bcd4', light: '#81ecec' },
];

const DIRECTIONS = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

const START_POSITIONS = [
  { x: 15, y: 15 }, { x: 65, y: 65 },
  { x: 65, y: 15 }, { x: 15, y: 65 },
  { x: 40, y: 15 }, { x: 40, y: 65 },
];

const GameState = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished',
};

// Valid state transitions
const VALID_TRANSITIONS = {
  [GameState.WAITING]: [GameState.PLAYING],
  [GameState.PLAYING]: [GameState.FINISHED],
  [GameState.FINISHED]: [GameState.WAITING],
};

module.exports = {
  GRID_SIZE, TICK_RATE, TICK_MS,
  MAX_PLAYERS_PER_ROOM, MAX_SPECTATORS,
  RESPAWN_DELAY_MS, RECONNECT_GRACE_MS, START_TERRITORY_SIZE,
  ROOM_CLEANUP_INTERVAL_MS, ROOM_INACTIVE_TIMEOUT_MS,
  ROOM_GAMEOVER_TIMEOUT_MS,
  MIN_GAME_TIME_SECONDS, MAX_GAME_TIME_SECONDS, DEFAULT_GAME_TIME_SECONDS,
  RATE_LIMIT_ACTIONS_PER_SECOND, RATE_LIMIT_CHAT_PER_SECOND,
  MAX_CHAT_LENGTH, MAX_CHAT_HISTORY, IP_RATE_LIMIT_MAX,
  PLAYER_COLORS, DIRECTIONS, START_POSITIONS, GameState, VALID_TRANSITIONS,
};
