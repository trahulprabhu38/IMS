import { getTimeline } from '../repositories/TimelineRepository.js';

export async function getIncidentTimeline(req, reply) {
  const events = await getTimeline(req.params.id);
  return reply.send(events);
}
