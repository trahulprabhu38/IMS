import { connectionManager } from '../websocket/ConnectionManager.js';

export default async function wsRoutes(app) {
  app.get('/ws', { websocket: true }, (socket) => {
    connectionManager.add(socket);

    // Send connection ack
    socket.send(JSON.stringify({ type: 'CONNECTED', payload: { clients: connectionManager.count } }));

    socket.on('close', () => connectionManager.remove(socket));
    socket.on('error', () => connectionManager.remove(socket));
  });
}
