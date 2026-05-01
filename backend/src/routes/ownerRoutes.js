import { acknowledge, setOwner } from '../controllers/ownerController.js';

export default async function ownerRoutes(app) {
  app.post('/work-items/:id/acknowledge', acknowledge);
  app.patch('/work-items/:id/owner',      setOwner);
}
