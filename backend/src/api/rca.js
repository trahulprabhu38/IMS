import { WorkItemService }  from '../services/WorkItemService.js';
import { RCAValidationError } from '../patterns/WorkItemState.js';

const workItemService = new WorkItemService();

const RCA_SCHEMA = {
  body: {
    type: 'object',
    required: ['incidentStart', 'incidentEnd', 'rootCauseCategory', 'fixApplied', 'preventionSteps'],
    properties: {
      incidentStart:       { type: 'string', format: 'date-time' },
      incidentEnd:         { type: 'string', format: 'date-time' },
      rootCauseCategory:   { type: 'string', enum: ['INFRASTRUCTURE','SOFTWARE_BUG','HUMAN_ERROR','CAPACITY','EXTERNAL'] },
      fixApplied:          { type: 'string', minLength: 1 },
      preventionSteps:     { type: 'string', minLength: 1 },
    },
  },
};

export default async function rcaRoutes(app) {
  app.post('/work-items/:id/rca', { schema: RCA_SCHEMA }, async (req, reply) => {
    try {
      const result = await workItemService.submitRCA(req.params.id, req.body);
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof RCAValidationError) return reply.status(422).send({ error: err.message });
      if (err.statusCode === 422) return reply.status(422).send({ error: err.message });
      if (err.statusCode === 404) return reply.status(404).send({ error: err.message });
      throw err;
    }
  });
}
