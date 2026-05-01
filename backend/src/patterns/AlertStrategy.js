// Functional alert strategies — no classes, no constructors.
// Each handler is a plain async function stored in a map.

const handlers = {
  P0: async (workItemId, componentId, severity, title) => {
    console.error(
      `\n[P0 CRITICAL] ${title}\n` +
      `  Component : ${componentId}\n` +
      `  WorkItem  : ${workItemId}\n` +
      `  ACTION    : Page on-call team IMMEDIATELY\n`
    );
  },
  P1: async (workItemId, componentId, severity, title) => {
    console.error(`[P1 HIGH]    ${title} | ${componentId} | workItem=${workItemId}`);
  },
  P2: async (workItemId, componentId, severity, title) => {
    console.warn(`[P2 MEDIUM]  ${title} | ${componentId} | workItem=${workItemId}`);
  },
  P3: async (workItemId, componentId, severity, title) => {
    console.info(`[P3 LOW]     ${title} | ${componentId} | workItem=${workItemId}`);
  },
};

export async function sendAlert(severity, workItemId, componentId, title) {
  const handler = handlers[severity] ?? handlers.P3;
  await handler(workItemId, componentId, severity, title);
}
