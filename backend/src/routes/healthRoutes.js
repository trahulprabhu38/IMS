import { getHealth } from '../controllers/healthController.js';

export default async function healthRoutes(app) {
  app.get('/health', getHealth);
}
