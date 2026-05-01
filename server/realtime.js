const sockets = new Set();

function normalizeSocket(connection) {
  return connection?.socket || connection;
}

export function addSocket(connection) {
  const socket = normalizeSocket(connection);
  if (!socket || typeof socket.send !== "function") {
    throw new Error("Invalid websocket connection");
  }

  sockets.add(socket);
  const cleanup = () => sockets.delete(socket);
  if (typeof socket.on === "function") {
    socket.on("close", cleanup);
  } else if (typeof socket.addEventListener === "function") {
    socket.addEventListener("close", cleanup, { once: true });
  }
  return socket;
}

export function broadcast(message = { type: "state-changed" }) {
  const data = JSON.stringify({ ...message, at: new Date().toISOString() });
  for (const socket of sockets) {
    try {
      if (socket.readyState === socket.OPEN || socket.readyState === 1) {
        socket.send(data);
      }
    } catch {
      sockets.delete(socket);
    }
  }
}
