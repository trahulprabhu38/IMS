import { WorkItemRepository } from '../repositories/WorkItemRepository.js';
import { CacheRepository }    from '../repositories/CacheRepository.js';
import { SignalRepository }   from '../repositories/SignalRepository.js';
import { WorkItemService }    from '../services/WorkItemService.js';
import { InvalidTransitionError } from '../patterns/WorkItemState.js';

const workItemRepo = new WorkItemRepository();
const cacheRepo    = new CacheRepository();
const signalRepo   = new SignalRepository();
const workItemService = new WorkItemService();

export default async function workItemRoutes(app) {
  // List all work items — hot-path via Redis cache, falls back to PostgreSQL
  app.get('/work-items', async (_req, reply) => {
    try {
      const cached = await cacheRepo.getDashboard();
      if (cached) return reply.send(cached);
    } catch {
      // Redis unavailable — fall through to PostgreSQL
    }

    const items = await workItemRepo.findAll();
    // Warm the cache in the background; never block the response
    cacheRepo.setAll(items).catch(() => {});
    return reply.send(items);
  });

  // Get single work item with linked raw signals
  app.get('/work-items/:id', async (req, reply) => {
    const workItem = await workItemRepo.findById(req.params.id);
    if (!workItem) return reply.status(404).send({ error: 'Not found' });

    const [signals, rca] = await Promise.all([
      signalRepo.findByWorkItemId(workItem.id),
      workItemRepo.getRCA(workItem.id),
    ]);

    return reply.send({ workItem, signals, rca });
  });

  // Transition work item status (OPEN → INVESTIGATING → RESOLVED)
  app.patch('/work-items/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['INVESTIGATING', 'RESOLVED', 'CLOSED'] } },
      },
    },
  }, async (req, reply) => {
    try {
      const updated = await workItemService.transition(req.params.id, req.body.status);
      return reply.send(updated);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return reply.status(422).send({ error: err.message });
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      throw err;
    }
  });
}
