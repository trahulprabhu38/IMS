import { signalQueue }  from '../core/BoundedQueue.js';
import { rateLimiter } from '../core/RateLimiter.js';

const SIGNAL_SCHEMA = {
  body: {
    type: 'object',
    required: ['componentId', 'componentType', 'signalType', 'severity'],
    properties: {
      componentId:   { type: 'string' },
      componentType: { type: 'string', enum: ['RDBMS','API','MCP_HOST','DISTRIBUTED_CACHE','ASYNC_QUEUE','NOSQL'] },
      signalType:    { type: 'string', enum: ['LATENCY_SPIKE','ERROR','OUTAGE','DEGRADED'] },
      severity:      { type: 'string', enum: ['P0','P1','P2','P3'] },
      payload:       { type: 'object' },
      timestamp:     { type: 'string', format: 'date-time' },
    },
  },
};

export default async function signalRoutes(app) {
  app.post('/signals', { schema: SIGNAL_SCHEMA }, async (req, reply) => {
    // Rate-limit gate
    if (!rateLimiter.allow()) {
      return reply
        .status(429)
        .header('X-RateLimit-Reset', '1')
        .send({ error: 'Rate limit exceeded. Retry after 1 second.' });
    }

    const signal = {
      ...req.body,
      timestamp: req.body.timestamp ? new Date(req.body.timestamp) : new Date(),
    };

    // Enqueue — backpressure: return 503 if the in-memory queue is full
    const accepted = signalQueue.put(signal);
    if (!accepted) {
      return reply
        .status(503)
        .header('Retry-After', '1')
        .send({ error: 'Server is overloaded. Retry after 1 second.' });
    }

    return reply.status(202).send({ status: 'accepted', queueDepth: signalQueue.size });
  });
}
