import { submitRCA } from '../controllers/rcaController.js';

const RCA_SCHEMA = {
  body: {
    type: 'object',
    required: ['incidentStart', 'incidentEnd', 'rootCauseCategory', 'fixApplied', 'preventionSteps'],
    properties: {
      incidentStart:     { type: 'string', format: 'date-time' },
      incidentEnd:       { type: 'string', format: 'date-time' },
      rootCauseCategory: { type: 'string', enum: ['INFRASTRUCTURE','SOFTWARE_BUG','HUMAN_ERROR','CAPACITY','EXTERNAL'] },
      fixApplied:        { type: 'string', minLength: 1 },
      preventionSteps:   { type: 'string', minLength: 1 },
    },
  },
};

export default async function rcaRoutes(app) {
  app.post('/work-items/:id/rca', { schema: RCA_SCHEMA }, submitRCA);
}
