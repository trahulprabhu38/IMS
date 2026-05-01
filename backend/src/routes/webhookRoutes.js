import { handleAlertmanager, handleGrafana, handleRawSignal, handleUptimeKuma } from '../controllers/webhookController.js';
import { ingestLogs, queryLogs, logStats } from '../controllers/universalLogController.js';

export default async function webhookRoutes(app) {
  // Existing webhook receivers
  app.post('/webhooks/alertmanager', handleAlertmanager);
  app.post('/webhooks/grafana',      handleGrafana);
  app.post('/webhooks/signal',       handleRawSignal);

  // Uptime Kuma
  app.post('/webhooks/uptime-kuma',  handleUptimeKuma);

  // Universal log ingestion — JSON object, array, or plain text
  app.post('/webhooks/logs', {
    config: { rawBody: true },
  }, ingestLogs);

  // Log query / stats
  app.get('/logs',       queryLogs);
  app.get('/logs/stats', logStats);
}
