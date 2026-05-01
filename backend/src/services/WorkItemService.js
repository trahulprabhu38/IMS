import { findWorkItemById, updateWorkItemStatus, createRCA, acknowledgeWorkItem, setWorkItemOwner } from '../repositories/WorkItemRepository.js';
import { setWorkItem }                from '../repositories/CacheRepository.js';
import { stateFromStatus, validateRCA } from '../patterns/WorkItemState.js';
import { sendAlert }                  from '../patterns/AlertStrategy.js';
import { broadcast }                  from '../websocket/ConnectionManager.js';
import { insertTimelineEvent }        from '../repositories/TimelineRepository.js';
import { insertAuditEntry }           from '../repositories/AuditRepository.js';

export async function transitionWorkItem(id, targetStatus, actor = 'system') {
  const workItem = await findWorkItemById(id);
  if (!workItem) throw Object.assign(new Error('Work item not found'), { statusCode: 404 });

  const state    = stateFromStatus(workItem.status);
  const newState = state.transition(targetStatus);

  const beforeStatus = workItem.status;
  const updated      = await updateWorkItemStatus(id, newState.getStatus());
  await setWorkItem(updated);

  await Promise.all([
    insertTimelineEvent({
      workItemId: id,
      eventType:  'STATUS_CHANGED',
      actor,
      metadata:   { from: beforeStatus, to: newState.getStatus() },
    }),
    insertAuditEntry({
      workItemId:  id,
      action:      'STATUS_TRANSITION',
      actor,
      beforeState: { status: beforeStatus },
      afterState:  { status: newState.getStatus() },
    }),
  ]);

  broadcast('WORK_ITEM_UPDATED', updated);
  return updated;
}

export async function submitWorkItemRCA(id, rcaData, actor = 'system') {
  const workItem = await findWorkItemById(id);
  if (!workItem) throw Object.assign(new Error('Work item not found'), { statusCode: 404 });

  if (workItem.status !== 'RESOLVED') {
    throw Object.assign(
      new Error(`Work item must be RESOLVED to submit RCA (current: ${workItem.status})`),
      { statusCode: 422 }
    );
  }

  validateRCA(rcaData);

  const { rca, workItem: closed } = await createRCA({ workItemId: id, ...rcaData });
  await setWorkItem(closed);

  await Promise.all([
    insertTimelineEvent({
      workItemId: id,
      eventType:  'RCA_SUBMITTED',
      actor,
      metadata:   {
        rootCauseCategory: rcaData.rootCauseCategory,
        mttrSeconds:       closed.mttrSeconds,
      },
    }),
    insertAuditEntry({
      workItemId:  id,
      action:      'RCA_SUBMITTED',
      actor,
      beforeState: { status: 'RESOLVED' },
      afterState:  { status: 'CLOSED', rootCauseCategory: rcaData.rootCauseCategory, mttrSeconds: closed.mttrSeconds },
    }),
  ]);

  broadcast('WORK_ITEM_UPDATED', closed);
  return { rca, workItem: closed };
}

export async function acknowledgeIncident(id, actor = 'user') {
  const workItem = await findWorkItemById(id);
  if (!workItem) throw Object.assign(new Error('Work item not found'), { statusCode: 404 });
  if (workItem.acknowledgedAt) return workItem;

  const updated = await acknowledgeWorkItem(id);
  if (!updated) return workItem;

  await setWorkItem(updated);

  await Promise.all([
    insertTimelineEvent({
      workItemId: id,
      eventType:  'ACKNOWLEDGED',
      actor,
      metadata:   { owner: workItem.owner },
    }),
    insertAuditEntry({
      workItemId:  id,
      action:      'ACKNOWLEDGED',
      actor,
      beforeState: { acknowledgedAt: null },
      afterState:  { acknowledgedAt: updated.acknowledgedAt },
    }),
  ]);

  broadcast('WORK_ITEM_UPDATED', updated);
  return updated;
}

export async function reassignOwner(id, newOwner, actor = 'user') {
  const workItem = await findWorkItemById(id);
  if (!workItem) throw Object.assign(new Error('Work item not found'), { statusCode: 404 });

  const prevOwner = workItem.owner;
  const updated   = await setWorkItemOwner(id, newOwner);

  await setWorkItem(updated);

  await Promise.all([
    insertTimelineEvent({
      workItemId: id,
      eventType:  'OWNER_CHANGED',
      actor,
      metadata:   { from: prevOwner, to: newOwner },
    }),
    insertAuditEntry({
      workItemId:  id,
      action:      'OWNER_CHANGED',
      actor,
      beforeState: { owner: prevOwner },
      afterState:  { owner: newOwner },
    }),
  ]);

  broadcast('WORK_ITEM_UPDATED', updated);
  return updated;
}

// Legacy compat
export const WorkItemService = {
  transition: transitionWorkItem,
  submitRCA:  submitWorkItemRCA,
};
