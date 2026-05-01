import mongoose from 'mongoose';

const rawLogSchema = new mongoose.Schema({
  message:              { type: String, required: true },
  level:                String,
  service:              String,
  host:                 String,
  timestamp:            { type: Date, default: Date.now, index: true },
  score:                Number,
  classifiedSeverity:   String,
  classifiedSignalType: String,
  componentType:        String,
  workItemCreated:      { type: Boolean, default: false },
  workItemId:           String,
  metadata:             mongoose.Schema.Types.Mixed,
  raw:                  mongoose.Schema.Types.Mixed,
}, { collection: 'raw_logs' });

rawLogSchema.index({ service: 1, timestamp: -1 });
rawLogSchema.index({ classifiedSeverity: 1, timestamp: -1 });

export const RawLog = mongoose.model('RawLog', rawLogSchema);
