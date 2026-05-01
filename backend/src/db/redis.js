import Redis from 'ioredis';
import { config } from '../config.js';

let client;

export function getRedis() {
  return client;
}

export async function connectRedis() {
  client = new Redis(config.redisUrl);
  await client.ping();   // verify the connection is live before proceeding
  console.log('[DB] Redis connected');
}
