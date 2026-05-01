import { getAuditTrail } from '../controllers/auditController.js';

export default async function auditRoutes(app) {
  app.get('/work-items/:id/audit', getAuditTrail);
}
