// Functional WebSocket connection manager — no class, module-level state.

const connections = new Set();

export function addConnection(socket) {
  connections.add(socket);
}

export function removeConnection(socket) {
  connections.delete(socket);
}

export function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, ts: Date.now() });
  for (const socket of [...connections]) {
    try {
      socket.send(message);
    } catch {
      connections.delete(socket);
    }
  }
}

export function getConnectionCount() {
  return connections.size;
}

// Legacy: some files import `connectionManager` as a named object
export const connectionManager = {
  add:       addConnection,
  remove:    removeConnection,
  broadcast,
  get count() { return connections.size; },
};
