import { signalQueue }          from '../core/BoundedQueue.js';
import { debounceManager }       from '../core/DebounceManager.js';
import { incrementProcessed }    from '../core/MetricsReporter.js';
import { insertSignal, insertSignalMetric } from '../repositories/SignalRepository.js';
import { createWorkItem, incrementSignalCount } from '../repositories/WorkItemRepository.js';
import { setWorkItem }           from '../repositories/CacheRepository.js';
import { dispatchAlert }         from './AlertService.js';
import { broadcast }             from '../websocket/ConnectionManager.js';
import { insertTimelineEvent }   from '../repositories/TimelineRepository.js';
import { config }                from '../config.js';

async function processOne(signal) {
  const { workItemId: existingId, isNew, _resolve } = await debounceManager.check(signal.componentId);

  let workItemId;

  if (isNew) {
    const workItem = await createWorkItem({
      title:         `${signal.componentId} — ${signal.signalType}`,
      componentId:   signal.componentId,
      componentType: signal.componentType,
      severity:      signal.severity,
      startTime:     signal.timestamp || new Date(),
    });
    workItemId = workItem.id;

    await debounceManager.register(signal.componentId, workItemId, _resolve);
    await dispatchAlert(workItem);
    await setWorkItem(workItem);
    await insertTimelineEvent({
      workItemId: workItem.id,
      eventType:  'CREATED',
      actor:      'system',
      metadata:   { severity: workItem.severity, componentId: workItem.componentId, componentType: workItem.componentType, owner: workItem.owner },
    });
    broadcast('WORK_ITEM_CREATED', workItem);
  } else {
    workItemId = existingId;
    await incrementSignalCount(workItemId);
  }

  await insertSignal(signal, workItemId);
  await insertSignalMetric(signal);
  incrementProcessed();
}

async function workerLoop() {
  while (true) {
    try {
      const signal = await signalQueue.get();
      await processOne(signal);
    } catch (err) {
      console.error('[WORKER] Error processing signal:', err.message);
    }
  }
}

export function startWorkers(count = config.workerCount) {
  for (let i = 0; i < count; i++) workerLoop();
  console.log(`[WORKERS] ${count} signal-processor workers started`);
}
