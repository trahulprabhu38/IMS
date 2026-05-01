import { addConnection, removeConnection, broadcast, getConnectionCount } from '../websocket/ConnectionManager.js';

export default async function wsRoutes(app) {
  app.get('/ws', { websocket: true }, (socket) => {
    addConnection(socket);
    socket.send(JSON.stringify({ type: 'CONNECTED', payload: { clients: getConnectionCount() } }));
    socket.on('close', () => removeConnection(socket));
    socket.on('error', () => removeConnection(socket));
  });
}
