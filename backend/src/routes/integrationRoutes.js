import {
  getAllIntegrations,
  configureIntegration,
  testIntegration,
  removeIntegration,
} from '../controllers/integrationController.js';

export default async function integrationRoutes(app) {
  // List all integrations with their status
  app.get('/integrations', getAllIntegrations);

  // Configure an integration: PUT /integrations/prometheus
  app.put('/integrations/:type', {
    schema: { body: { type: 'object' } },
  }, configureIntegration);

  // Test connectivity: POST /integrations/prometheus/test
  app.post('/integrations/:type/test', testIntegration);

  // Remove an integration: DELETE /integrations/prometheus
  app.delete('/integrations/:type', removeIntegration);
}
