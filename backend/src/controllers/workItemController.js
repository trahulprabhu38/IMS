import { findAllWorkItems, findWorkItemById }  from '../repositories/WorkItemRepository.js';
import { findSignalsByWorkItemId }             from '../repositories/SignalRepository.js';
import { getDashboard, setAllWorkItems }       from '../repositories/CacheRepository.js';
import { transitionWorkItem }                  from '../services/WorkItemService.js';
import { getRCA }                              from '../repositories/WorkItemRepository.js';

export async function listWorkItems(req, reply) {
  try {
    const cached = await getDashboard();
    if (cached) return reply.send(cached);
  } catch {
    // Redis unavailable — fall through to PostgreSQL
  }
  const items = await findAllWorkItems();
  setAllWorkItems(items).catch(() => {});
  return reply.send(items);
}

export async function getWorkItem(req, reply) {
  const workItem = await findWorkItemById(req.params.id);
  if (!workItem) return reply.status(404).send({ error: 'Not found' });

  const [signals, rca] = await Promise.all([
    findSignalsByWorkItemId(workItem.id),
    getRCA(workItem.id),
  ]);

  return reply.send({ workItem, signals, rca });
}

export async function transitionStatus(req, reply) {
  const actor   = req.body?.actor || 'user';
  const updated = await transitionWorkItem(req.params.id, req.body.status, actor);
  return reply.send(updated);
}
