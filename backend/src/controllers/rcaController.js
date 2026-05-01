import { submitWorkItemRCA } from '../services/WorkItemService.js';

export async function submitRCA(req, reply) {
  const actor  = req.body?.actor || 'user';
  const result = await submitWorkItemRCA(req.params.id, req.body, actor);
  return reply.status(201).send(result);
}
