import { ingestSignal } from '../controllers/signalController.js';

const SIGNAL_SCHEMA = {
  body: {
    type: 'object',
    required: ['componentId', 'componentType', 'signalType', 'severity'],
    properties: {
      componentId:   { type: 'string' },
      componentType: { type: 'string', enum: ['RDBMS','API','MCP_HOST','DISTRIBUTED_CACHE','ASYNC_QUEUE','NOSQL'] },
      signalType:    { type: 'string', enum: ['LATENCY_SPIKE','ERROR','OUTAGE','DEGRADED'] },
      severity:      { type: 'string', enum: ['P0','P1','P2','P3'] },
      payload:       { type: 'object' },
      timestamp:     { type: 'string', format: 'date-time' },
    },
  },
};

export default async function signalRoutes(app) {
  app.post('/signals', { schema: SIGNAL_SCHEMA }, ingestSignal);
}
