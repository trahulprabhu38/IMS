import { getIncidentTimeline } from '../controllers/timelineController.js';

export default async function timelineRoutes(app) {
  app.get('/work-items/:id/timeline', getIncidentTimeline);
}
