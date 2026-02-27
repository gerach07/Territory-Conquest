/**
 * ============================================================================
 * TERRITORY CONQUEST - Sanitizers
 * Input sanitization utilities
 * ============================================================================
 */

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
    .replace(/[<>"'`&]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

module.exports = { sanitizeInput };
