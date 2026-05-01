import { getPool }  from '../db/postgres.js';
import { getRedis } from '../db/redis.js';
import mongoose     from 'mongoose';
import { signalQueue } from '../core/BoundedQueue.js';

export default async function healthRoutes(app) {
  app.get('/health', async (_req, reply) => {
    const checks = await Promise.allSettled([
      getPool().query('SELECT 1'),
      // readyState 1 = connected; avoids crash when db object isn't ready yet
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
  });
}
