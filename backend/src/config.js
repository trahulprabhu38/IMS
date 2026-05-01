import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://ims:ims_secret@localhost:5432/ims',
  mongodbUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/ims',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  workerCount: parseInt(process.env.WORKER_COUNT || '10', 10),
  rateLimitPerSec: parseInt(process.env.RATE_LIMIT_PER_SEC || '10000', 10),
  queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE || '50000', 10),
  debounceWindowSeconds: parseInt(process.env.DEBOUNCE_WINDOW_SECONDS || '10', 10),
  corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:3000',
};
