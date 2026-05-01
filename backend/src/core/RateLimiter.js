import { config } from '../config.js';

/**
 * Token-bucket rate limiter.
 * Refills `rate` tokens per second; burst capacity equals `rate`.
 * Returns true if the request is allowed, false if throttled.
 */
export class TokenBucketRateLimiter {
  constructor(rate = config.rateLimitPerSec) {
    this._tokens   = rate;
    this._maxTokens = rate;
    this._refillRate = rate;          // tokens per second
    this._lastRefill = Date.now();
  }

  allow() {
    this._refill();
    if (this._tokens < 1) return false;
    this._tokens -= 1;
    return true;
  }

  _refill() {
    const now     = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;        // seconds
    const add     = elapsed * this._refillRate;
    this._tokens  = Math.min(this._maxTokens, this._tokens + add);
    this._lastRefill = now;
  }

  get remainingTokens() {
    this._refill();
    return Math.floor(this._tokens);
  }
}

export const rateLimiter = new TokenBucketRateLimiter();
