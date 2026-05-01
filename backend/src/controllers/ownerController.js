import { acknowledgeIncident, reassignOwner } from '../services/WorkItemService.js';

export async function acknowledge(req, reply) {
  const actor   = req.body?.actor || 'user';
  const updated = await acknowledgeIncident(req.params.id, actor);
  return reply.send(updated);
}

export async function setOwner(req, reply) {
  const { owner, actor = 'user' } = req.body || {};
  if (!owner) return reply.status(400).send({ error: 'owner is required' });
  const updated = await reassignOwner(req.params.id, owner, actor);
  return reply.send(updated);
}
