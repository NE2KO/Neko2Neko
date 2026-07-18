import { WebSocketServer } from 'ws';

function ts() {
  return new Date().toISOString().slice(11, 23);
}

let wss = null;
let startTime = 0;
const clients = new Set();

function cleanupZombieClients() {
  for (const ws of clients) {
    const state = ws.readyState;
    if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
      clients.delete(ws);
    }
  }
}

export function startWebSocketServer(server) {
  startTime = Date.now();
  wss = new WebSocketServer({ server, path: '/ws/monitor' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    try {
      const addr = ws._socket && ws._socket.remoteAddress ? ws._socket.remoteAddress : 'unknown';
      console.log(`[monitor] ${ts()} WS client connected from ${addr} (total: ${clients.size}) +${Date.now() - startTime}ms`);
    } catch(e) {}

    ws.on('close', () => {
      clients.delete(ws);
      try { console.log(`[monitor] ${ts()} WS client disconnected (total: ${clients.size}) +${Date.now() - startTime}ms`); } catch(e) {}
    });
    ws.on('error', (err) => {
      clients.delete(ws);
      try { console.log(`[monitor] ${ts()} WS client error: ${err?.message || err} +${Date.now() - startTime}ms`); } catch(e) {}
    });
  });

  console.log(`[monitor] ${ts()} WebSocket server ready at /ws/monitor`);

  setInterval(cleanupZombieClients, 30000);

  return wss;
}

export function broadcast(data) {
  const msg = JSON.stringify(data);
  const clientsArr = [...clients];
  let i = 0;

  function sendNext() {
    if (i >= clientsArr.length) return;
    const ws = clientsArr[i++];
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { clients.delete(ws); }
    }
    if (i < clientsArr.length) {
      setImmediate(sendNext);
    }
  }

  sendNext();
}

export function getClientCount() {
  return clients.size;
}

export function stopWebSocketServer() {
  if (wss) {
    for (const ws of clients) {
      try { ws.close(); } catch {}
    }
    clients.clear();
    try { wss.close(); } catch {}
    wss = null;
  }
  console.log('[monitor] WebSocket server stopped');
}
