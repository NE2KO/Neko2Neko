const sessions = new Map();
let idCounter = 0;

// Clean stale sessions every 30s instead of per-request
setInterval(() => {
  const stale = Date.now() - 5 * 60 * 1000;
  for (const [key, session] of sessions) {
    if (session.lastSeen < stale) sessions.delete(key);
  }
}, 30000);

export function trackRequest(req) {
  if (!req) return;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const ua = req.headers?.['user-agent'] || 'unknown';

  // Use IP+UA as session key (simple approach)
  const key = `${ip}:${ua}`;
  const now = Date.now();

  let session = sessions.get(key);
  if (!session) {
    session = {
      id: ++idCounter,
      ip,
      userAgent: ua,
      platform: detectPlatform(ua),
      page: req.path || '/',
      connectedSince: now,
      lastSeen: now,
      requestCount: 0,
    };
    sessions.set(key, session);
  }

  session.lastSeen = now;
  session.requestCount++;
  session.page = req.path || '/';
}

function detectPlatform(ua) {
  if (!ua) return 'Unknown';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function cleanup() {
  const stale = Date.now() - 5 * 60 * 1000;
  for (const [key, session] of sessions) {
    if (session.lastSeen < stale) {
      sessions.delete(key);
    }
  }
}

export function getActiveSessions() {
  cleanup();
  return Array.from(sessions.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 50);
}

export function getSessionStats() {
  cleanup();
  const now = Date.now();
  const all = Array.from(sessions.values());
  const mobile = all.filter(s => s.platform === 'Android' || s.platform === 'iOS');
  const recent = all.filter(s => now - s.lastSeen < 60000);

  return {
    total: all.length,
    active: recent.length,
    mobile: mobile.length,
    desktop: all.length - mobile.length,
    platforms: {},
  };
}

export function disconnectSession(id) {
  for (const [key, session] of sessions) {
    if (session.id === id) {
      sessions.delete(key);
      return true;
    }
  }
  return false;
}

// Middleware that auto-tracks every API request
export function sessionMiddleware(req, res, next) {
  // Skip non-API paths to reduce noise
  const path = req.path || '';
  if (path.startsWith('/api/') || path.startsWith('/stream/') || path.startsWith('/thumbnails/')) {
    trackRequest(req);
  }
  next();
}
