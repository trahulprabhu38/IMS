import { getPool }      from '../db/postgres.js';
import { getRedis }     from '../db/redis.js';
import mongoose         from 'mongoose';
import { signalQueue }  from '../core/BoundedQueue.js';

export async function getHealth(req, reply) {
  const checks = await Promise.allSettled([
    getPool().query('SELECT 1'),
    Promise.resolve(mongoose.connection.readyState === 1 || Promise.reject(new Error('mongo not ready'))),
    getRedis().ping(),
  ]);

  const [pg, mongo, redis] = checks.map(r => r.status === 'fulfilled');
  const ok = pg && mongo && redis;

  return reply.status(ok ? 200 : 503).send({
    status:     ok ? 'ok' : 'degraded',
    postgres:   pg,
    mongodb:    mongo,
    redis,
    queueDepth: signalQueue.size,
    queueMax:   signalQueue.maxSize,
    timestamp:  new Date().toISOString(),
  });
}
