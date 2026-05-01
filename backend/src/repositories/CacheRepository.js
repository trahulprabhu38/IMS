// Functional cache repository — no class, named function exports.
import { getRedis } from '../db/redis.js';

const DASHBOARD_KEY = 'dashboard:work_items';
const TTL           = 30;

export async function setWorkItem(workItem) {
  const redis = getRedis();
  await redis.set(`work_item:${workItem.id}`, JSON.stringify(workItem), 'EX', TTL);
  const score = ({ P0: 0, P1: 1, P2: 2, P3: 3 })[workItem.severity] ?? 3;
  await redis.zadd(DASHBOARD_KEY, score, workItem.id);
  await redis.expire(DASHBOARD_KEY, 60);
}

export async function getWorkItem(id) {
  const raw = await getRedis().get(`work_item:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function getDashboard() {
  const redis = getRedis();
  const ids   = await redis.zrange(DASHBOARD_KEY, 0, 99);
  if (!ids.length) return null;
  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`work_item:${id}`));
  const results = await pipeline.exec();
  return results.map(([, raw]) => (raw ? JSON.parse(raw) : null)).filter(Boolean);
}

export async function removeWorkItem(id) {
  await getRedis().del(`work_item:${id}`);
  await getRedis().zrem(DASHBOARD_KEY, id);
}

export async function setAllWorkItems(workItems) {
  await Promise.all(workItems.map(setWorkItem));
}

// Legacy compat
export const CacheRepository = {
  setWorkItem,
  getWorkItem,
  getDashboard,
  removeWorkItem,
  setAll: setAllWorkItems,
};
