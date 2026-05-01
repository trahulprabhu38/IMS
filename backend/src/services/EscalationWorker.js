import { findUnacknowledgedOpenItems, setEscalated } from '../repositories/WorkItemRepository.js';
import { setWorkItem }       from '../repositories/CacheRepository.js';
import { insertTimelineEvent } from '../repositories/TimelineRepository.js';
import { insertAuditEntry }  from '../repositories/AuditRepository.js';
import { broadcast }         from '../websocket/ConnectionManager.js';

const SLA_SECONDS = { P0: 300, P1: 900, P2: 3600, P3: 14400 };

async function runEscalationCheck() {
  let items;
  try {
    items = await findUnacknowledgedOpenItems();
  } catch (err) {
    console.error('[ESCALATION] DB query failed:', err.message);
    return;
  }

  const now = Date.now();
  for (const item of items) {
    const sla    = SLA_SECONDS[item.severity] ?? SLA_SECONDS.P3;
    const ageMs  = now - new Date(item.startTime).getTime();
    const ageSec = ageMs / 1000;

    if (ageSec < sla) continue;

    const newLevel = item.escalationLevel + 1;
    try {
      const updated = await setEscalated(item.id, newLevel);
      await setWorkItem(updated);

      const unacknowledgedMinutes = Math.round(ageSec / 60);
      await Promise.all([
        insertTimelineEvent({
          workItemId: item.id,
          eventType:  'ESCALATED',
          actor:      'system',
          metadata:   { level: newLevel, unacknowledgedMinutes, severity: item.severity, owner: item.owner },
        }),
        insertAuditEntry({
          workItemId:  item.id,
          action:      'ESCALATED',
          actor:       'system',
          beforeState: { escalationLevel: item.escalationLevel },
          afterState:  { escalationLevel: newLevel, unacknowledgedMinutes },
        }),
      ]);

      broadcast('WORK_ITEM_UPDATED', updated);
      console.warn(`[ESCALATION] ${item.severity} ${item.id} escalated to level ${newLevel} after ${unacknowledgedMinutes}m unacknowledged`);
    } catch (err) {
      console.error('[ESCALATION] Failed to escalate', item.id, err.message);
    }
  }
}

export function startEscalationWorker(intervalMs = 60_000) {
  // Stagger initial run by 10s to let DB init complete
  setTimeout(() => {
    runEscalationCheck();
    setInterval(runEscalationCheck, intervalMs);
  }, 10_000);
  console.log('[ESCALATION] Worker started — checks every', intervalMs / 1000, 's');
}
