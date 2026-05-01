import { getAuditLog } from '../repositories/AuditRepository.js';

export async function getAuditTrail(req, reply) {
  const entries = await getAuditLog(req.params.id);
  return reply.send(entries);
}
