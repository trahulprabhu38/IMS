import { getRedis } from '../db/redis.js';
import { config } from '../config.js';

/**
 * Redis-based debounce: within a sliding window per componentId,
 * only one Work Item is created no matter how many signals arrive.
 *
 * Key layout:
 *   debounce:<componentId>  →  workItemId  (TTL = debounceWindowSeconds)
 */
export class DebounceManager {
  constructor(windowSeconds = config.debounceWindowSeconds) {
    this._window = windowSeconds;
    // Per-process mutex prevents duplicate creates inside the same event loop
    this._inFlight = new Map();
  }

  /**
   * Returns { workItemId, isNew }
   * If isNew === true the caller MUST call register() after creating the work item.
   */
  async check(componentId) {
    const key = `debounce:${componentId}`;

    // Fast path — existing active work item
    const existing = await getRedis().get(key);
    if (existing) return { workItemId: existing, isNew: false };

    // Guard against concurrent in-process creates for the same componentId
    if (this._inFlight.has(componentId)) {
      const workItemId = await this._inFlight.get(componentId);
      return { workItemId, isNew: false };
    }

    // Claim the slot: we are responsible for creating the work item
    let resolveInflight;
    const promise = new Promise(r => { resolveInflight = r; });
    this._inFlight.set(componentId, promise);

    return { workItemId: null, isNew: true, _resolve: resolveInflight };
  }

  async register(componentId, workItemId, _resolve) {
    const key = `debounce:${componentId}`;
    await getRedis().set(key, workItemId, 'EX', this._window);
    this._inFlight.delete(componentId);
    if (_resolve) _resolve(workItemId);
  }
}

export const debounceManager = new DebounceManager();
