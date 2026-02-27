/**
 * ============================================================================
 * TERRITORY CONQUEST - Rate Limiter
 * (mirrors Battleships server/src/utils/RateLimiter.js)
 * Sliding window rate limiter for socket/HTTP connections
 * ============================================================================
 */

class RateLimiter {
  /**
   * @param {number} maxRequests - Maximum allowed requests within the window
   * @param {number} windowMs - Time window in milliseconds
   */
  constructor(maxRequests = 20, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.tracker = new Map();
  }

  /**
   * Check if a key is allowed to make a request.
   * @param {string} key - Unique identifier (IP, socket ID, etc.)
   * @returns {boolean} true if allowed, false if rate-limited
   */
  isAllowed(key) {
    const now = Date.now();
    let entry = this.tracker.get(key);

    if (!entry) {
      entry = { ts: [] };
      this.tracker.set(key, entry);
    }

    // Remove timestamps outside the window (in-place, no allocation)
    const cutoff = now - this.windowMs;
    let writeIdx = 0;
    for (let i = 0; i < entry.ts.length; i++) {
      if (entry.ts[i] >= cutoff) entry.ts[writeIdx++] = entry.ts[i];
    }
    entry.ts.length = writeIdx;

    // Check if over limit
    if (entry.ts.length >= this.maxRequests) {
      return false;
    }

    entry.ts.push(now);
    return true;
  }

  /**
   * Remove tracking for a key (e.g., on disconnect).
   * @param {string} key
   */
  removeKey(key) {
    this.tracker.delete(key);
  }

  /**
   * Periodic cleanup of stale entries.
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, entry] of this.tracker) {
      let writeIdx = 0;
      for (let i = 0; i < entry.ts.length; i++) {
        if (entry.ts[i] >= cutoff) entry.ts[writeIdx++] = entry.ts[i];
      }
      entry.ts.length = writeIdx;
      if (entry.ts.length === 0) {
        this.tracker.delete(key);
      }
    }
  }
}

module.exports = RateLimiter;
