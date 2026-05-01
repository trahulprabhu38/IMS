import mongoose from 'mongoose';

const signalSchema = new mongoose.Schema({
  componentId:   { type: String, required: true, index: true },
  componentType: { type: String, required: true, enum: ['RDBMS','API','MCP_HOST','DISTRIBUTED_CACHE','ASYNC_QUEUE','NOSQL'] },
  signalType:    { type: String, required: true, enum: ['LATENCY_SPIKE','ERROR','OUTAGE','DEGRADED'] },
  severity:      { type: String, required: true, enum: ['P0','P1','P2','P3'] },
  payload:       { type: mongoose.Schema.Types.Mixed, default: {} },
  workItemId:    { type: String, default: null, index: true },
  timestamp:     { type: Date, default: Date.now, index: true },
});

export const Signal = mongoose.model('Signal', signalSchema);
