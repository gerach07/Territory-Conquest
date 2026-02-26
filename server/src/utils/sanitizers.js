/**
 * ============================================================================
 * TERRITORY CONQUEST - Sanitizers
 * (mirrors Battleships server/src/utils/sanitizers.js)
 * Input sanitization utilities
 * ============================================================================
 */

const { GRID_SIZE } = require('../constants');

/**
 * Sanitize user string input - removes HTML special characters,
 * backticks, and control characters, then trims.
 * @param {*} input - The input to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 100)
 * @returns {string} Sanitized string
 */
function sanitizeInput(input, maxLength = 100) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>"'`&]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Deep-clone a 2D grid array to prevent mutation.
 * @param {Array[]} grid
 * @returns {Array[]}
 */
function deepCloneGrid(grid) {
  return grid.map(row => [...row]);
}

/**
 * Check if coordinates are valid integers within the grid.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isValidCoordinate(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) &&
    x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

module.exports = { sanitizeInput, deepCloneGrid, isValidCoordinate };
