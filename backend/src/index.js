import Fastify          from 'fastify';
import fastifyCors      from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';

import { config }                      from './config.js';
import { connectPostgres, initSchema } from './db/postgres.js';
import { connectMongo }                from './db/mongo.js';
import { connectRedis }                from './db/redis.js';
import { startWorkers }                from './services/SignalProcessor.js';
import { startMetricsReporter }        from './core/MetricsReporter.js';

// ── MVC routes ────────────────────────────────────────────────────────────────
import signalRoutes      from './routes/signalRoutes.js';
import workItemRoutes    from './routes/workItemRoutes.js';
import rcaRoutes         from './routes/rcaRoutes.js';
import healthRoutes      from './routes/healthRoutes.js';
import webhookRoutes     from './routes/webhookRoutes.js';
import wsRoutes          from './routes/wsRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import timelineRoutes    from './routes/timelineRoutes.js';
import auditRoutes       from './routes/auditRoutes.js';
import ownerRoutes       from './routes/ownerRoutes.js';
import { startEscalationWorker } from './services/EscalationWorker.js';

// ── Connect databases FIRST ───────────────────────────────────────────────────
try {
  await connectPostgres();
  await initSchema();
  await connectMongo();
  await connectRedis();
} catch (err) {
  console.error('[STARTUP] Database connection failed:', err.message);
  process.exit(1);
}

// ── Build Fastify app ─────────────────────────────────────────────────────────
const app = Fastify({ logger: { level: 'info' } });

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  reply.status(err.statusCode || 500).send({
    error: err.message || 'Internal Server Error',
    code:  err.code,
  });
});

await app.register(fastifyCors, { origin: true, credentials: true });
await app.register(fastifyWebsocket);

// Accept plain-text bodies (used by universal log webhook)
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));

// ── Register routes ───────────────────────────────────────────────────────────
await app.register(signalRoutes,      { prefix: '/api/v1' });
await app.register(workItemRoutes,    { prefix: '/api/v1' });
await app.register(rcaRoutes,         { prefix: '/api/v1' });
await app.register(webhookRoutes,     { prefix: '/api/v1' });
await app.register(integrationRoutes, { prefix: '/api/v1' });
await app.register(timelineRoutes,    { prefix: '/api/v1' });
await app.register(auditRoutes,       { prefix: '/api/v1' });
await app.register(ownerRoutes,       { prefix: '/api/v1' });
await app.register(healthRoutes);
await app.register(wsRoutes);

// ── Start workers + server ────────────────────────────────────────────────────
try {
  startWorkers();
  startMetricsReporter();
  startEscalationWorker();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`\n IMS Backend  →  http://0.0.0.0:${config.port}`);
  console.log(`  Health       →  http://localhost:${config.port}/health`);
  console.log(`  Integrations →  http://localhost:${config.port}/api/v1/integrations\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
