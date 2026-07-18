const MAX_LOG = 500;
const logBuffer = [];
let sseClients = [];

export function captureLog(level, source, message) {
  const entry = {
    time: Date.now(),
    level,
    source,
    message,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG) logBuffer.shift();
  broadcast(entry);
}

// Monkey-patch console.log to capture thumbnail/scan logs
const origLog = console.log;
console.log = function(...args) {
  origLog.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (msg.includes('[thumbnails]') || msg.includes('[server]') || msg.includes('[db]') || msg.includes('[scan]') || msg.includes('[watcher]')) {
    const source = msg.includes('[thumbnails]') ? 'thumbnails' :
                   msg.includes('[scan]') ? 'scan' :
                   msg.includes('[watcher]') ? 'watcher' : 'server';
    captureLog('info', source, msg);
  }
};

function broadcast(entry) {
  const data = JSON.stringify(entry);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch { /* ignore */ }
  }
}

export function addLogClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send recent history
  for (const entry of logBuffer) {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { break; }
  }

  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
}

export function getLogs(limit = 100) {
  return logBuffer.slice(-limit);
}
