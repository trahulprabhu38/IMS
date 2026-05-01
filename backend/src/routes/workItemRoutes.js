import { listWorkItems, getWorkItem, transitionStatus } from '../controllers/workItemController.js';

export default async function workItemRoutes(app) {
  app.get('/work-items', listWorkItems);

  app.get('/work-items/:id', getWorkItem);

  app.patch('/work-items/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['INVESTIGATING', 'RESOLVED', 'CLOSED'] } },
      },
    },
  }, transitionStatus);
}
