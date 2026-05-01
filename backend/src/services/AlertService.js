// Thin functional wrapper — delegates to AlertStrategy handlers.
import { sendAlert } from '../patterns/AlertStrategy.js';

export async function dispatchAlert(workItem) {
  await sendAlert(workItem.severity, workItem.id, workItem.componentId, workItem.title);
}

// Legacy compat
export const AlertService = {
  dispatch: dispatchAlert,
};
