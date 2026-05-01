import { signalQueue } from './BoundedQueue.js';

let processedCount = 0;

export function incrementProcessed() {
  processedCount++;
}

export function startMetricsReporter(intervalMs = 5000) {
  setInterval(() => {
    const rate = (processedCount / (intervalMs / 1000)).toFixed(1);
    console.log(
      `[METRICS] Signals/sec: ${rate} | Queue depth: ${signalQueue.size}/${signalQueue.maxSize}`
    );
    processedCount = 0;
  }, intervalMs);

  console.log('[METRICS] Reporter started — printing every 5 s');
}
