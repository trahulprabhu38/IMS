/**
 * Bounded in-memory queue that decouples signal ingestion from persistence.
 * put() returns false (backpressure) when the queue is full instead of blocking,
 * so the HTTP layer can immediately return a 503 without crashing.
 */
export class BoundedQueue {
  constructor(maxSize = 50_000) {
    this._queue   = [];
    this._maxSize = maxSize;
    this._waiters = [];
  }

  /** @returns {boolean} false when queue is full (caller should 503) */
  put(item) {
    if (this._queue.length >= this._maxSize) return false;
    this._queue.push(item);
    if (this._waiters.length > 0) this._waiters.shift()();
    return true;
  }

  /** Async — resolves as soon as an item is available. */
  async get() {
    while (this._queue.length === 0) {
      await new Promise(resolve => this._waiters.push(resolve));
    }
    return this._queue.shift();
  }

  get size() { return this._queue.length; }
  get maxSize() { return this._maxSize; }
}

export const signalQueue = new BoundedQueue();
