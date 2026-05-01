import { signalQueue }  from '../core/BoundedQueue.js';
import { rateLimiter } from '../core/RateLimiter.js';

export async function ingestSignal(req, reply) {
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

  if (!signalQueue.put(signal)) {
    return reply
      .status(503)
      .header('Retry-After', '1')
      .send({ error: 'Server overloaded. Retry after 1 second.' });
  }

  return reply.status(202).send({ status: 'accepted', queueDepth: signalQueue.size });
}
