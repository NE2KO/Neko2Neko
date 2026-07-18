import { useEffect, useRef, useCallback } from 'react';
import useMonitoringStore from '../monitoring/stores/monitoringStore';

const TAG = '[WS]';
const MAX_DELAY = 30000;
const HEALTH_FG_MS = 2000;
const HEALTH_BG_MS = 10000;
const HEALTH_TIMEOUT_MS = 5000;
const POLL_FG_MS = 1000;
const POLL_BG_MS = 15000;
const POLL_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL = 10000;
const HEARTBEAT_TIMEOUT = 30000;
const CONNECTING_TIMEOUT_MS = 10000;
const MAX_RETRIES = 15;
const FORCE_RELOAD_MS = 60000;

function shortId() {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export default function useWebSocket() {
  const setStats = useMonitoringStore(s => s.setStats);
  const setConnected = useMonitoringStore(s => s.setConnected);
  const applyRuntimeSetting = useMonitoringStore(s => s.applyRuntimeSetting);

  const coreRef = useRef({ ws: null, retryCount: 0, connectionId: '', lastMessageTime: 0, firstFailTime: 0 });
  const timersRef = useRef({ reconnect: null, health: null, poll: null, healthAbort: null, heartbeat: null, connectingTimeout: null, healthEpoch: 0 });
  const envRef = useRef({ isOnline: navigator.onLine, isVisible: !document.hidden });

  const log = useCallback((...args) => {
    const id = coreRef.current.connectionId || '--------';
    console.log(`${TAG}#${id}`, ...args);
  }, []);

  // ─── Polling ──────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (timersRef.current.poll) {
      clearInterval(timersRef.current.poll);
      timersRef.current.poll = null;
      log('POLL stop');
    }
  }, [log]);

  const startPolling = useCallback(() => {
    if (timersRef.current.poll) return;
    const ms = envRef.current.isVisible ? POLL_FG_MS : POLL_BG_MS;
    timersRef.current.poll = setInterval(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
      try {
        const res = await fetch('/api/monitoring/stats', { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data && data.timestamp) {
            setStats(data);
          }
        }
      } catch (err) {
        clearTimeout(timer);
      }
    }, ms);
    log('POLL start', { interval: ms });
  }, [setStats, log]);

  // ─── Reconnect ────────────────────────────────────────────────────

  const cancelReconnect = useCallback(() => {
    if (timersRef.current.reconnect) {
      clearTimeout(timersRef.current.reconnect);
      timersRef.current.reconnect = null;
      log('RETRY cancelled');
    }
  }, [log]);

  const scheduleReconnect = useCallback(() => {
    cancelReconnect();
    const count = coreRef.current.retryCount;
    if (count >= MAX_RETRIES) {
      log('MAX_RETRIES reached — force reload', { count: MAX_RETRIES });
      window.location.reload();
      return;
    }
    const base = Math.min(1000 * Math.pow(2, count), MAX_DELAY);
    const jitter = base * 0.2 * Math.random();
    const delay = Math.round(base + jitter);
    log('RETRY scheduled', { delay, retryCount: count });
    timersRef.current.reconnect = setTimeout(() => {
      timersRef.current.reconnect = null;
      log('RETRY fired');
      connect();
    }, delay);
  }, [log, cancelReconnect]);

  // ─── Heartbeat ────────────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (timersRef.current.heartbeat) {
      clearTimeout(timersRef.current.heartbeat);
      timersRef.current.heartbeat = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (timersRef.current.heartbeat) return;
    const check = () => {
      const ws = coreRef.current.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        timersRef.current.heartbeat = null;
        return;
      }
      const elapsed = Date.now() - coreRef.current.lastMessageTime;
      if (coreRef.current.lastMessageTime > 0 && elapsed > HEARTBEAT_TIMEOUT) {
        log('HEARTBEAT timeout — no message for', Math.round(elapsed / 1000) + 's');
        setConnected(false);
        try { ws.close(); } catch {}
        coreRef.current.ws = null;
        coreRef.current.retryCount++;
        startPolling();
        scheduleReconnect();
        timersRef.current.heartbeat = null;
        return;
      }
      timersRef.current.heartbeat = setTimeout(check, HEARTBEAT_INTERVAL);
    };
    timersRef.current.heartbeat = setTimeout(check, HEARTBEAT_INTERVAL);
  }, [log, setConnected, startPolling, scheduleReconnect]);

  // ─── Connect ──────────────────────────────────────────────────────

  const stopConnectingTimeout = useCallback(() => {
    if (timersRef.current.connectingTimeout) {
      clearTimeout(timersRef.current.connectingTimeout);
      timersRef.current.connectingTimeout = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!envRef.current.isOnline) {
      log('CONNECT skipped — offline');
      return;
    }
    if (coreRef.current.ws) {
      const s = coreRef.current.ws.readyState;
      if (s === WebSocket.OPEN || s === WebSocket.CONNECTING) return;
    }
    if (timersRef.current.reconnect) {
      cancelReconnect();
    }
    stopConnectingTimeout();

    if (!coreRef.current.firstFailTime) {
      coreRef.current.firstFailTime = Date.now();
    }

    const id = shortId();
    coreRef.current.connectionId = id;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/monitor`;

    log('CONNECT', { url, retryCount: coreRef.current.retryCount });

    try {
      const ws = new WebSocket(url);
      coreRef.current.ws = ws;

      const onConnectingTimeout = () => {
        if (ws.readyState === WebSocket.CONNECTING) {
          log('CONNECTING timeout — force close', { elapsed: CONNECTING_TIMEOUT_MS });
          try { ws.close(); } catch {}
        }
      };
      timersRef.current.connectingTimeout = setTimeout(onConnectingTimeout, CONNECTING_TIMEOUT_MS);

      ws.onopen = () => {
        stopConnectingTimeout();
        log('OPEN');
        setConnected(true);
        coreRef.current.retryCount = 0;
        coreRef.current.firstFailTime = 0;
        coreRef.current.connectionId = id;
        coreRef.current.lastMessageTime = Date.now();
        stopPolling();
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          coreRef.current.lastMessageTime = Date.now();
          const msg = JSON.parse(event.data);
          if (msg.type === 'stats' && msg.data) {
            setStats(msg.data);
          }
        } catch {}
      };

      ws.onclose = (e) => {
        stopConnectingTimeout();
        log('CLOSE', { code: e.code, reason: e.reason || 'none', wasClean: e.wasClean });
        setConnected(false);
        coreRef.current.ws = null;
        coreRef.current.retryCount++;
        stopHeartbeat();

        const uptime = coreRef.current.firstFailTime ? Date.now() - coreRef.current.firstFailTime : 0;
        if (uptime > FORCE_RELOAD_MS) {
          log('FORCE RELOAD — reconnecting too long', { uptimeMs: uptime });
          window.location.reload();
          return;
        }

        startPolling();
        scheduleReconnect();
      };

      ws.onerror = (e) => {
        log('ERROR', { type: e.type });
        try { ws.close(); } catch {}
      };
    } catch (err) {
      log('CONNECT failed', { error: err.message });
      coreRef.current.retryCount++;
      scheduleReconnect();
    }
  }, [setStats, setConnected, log, stopPolling, startPolling, scheduleReconnect, cancelReconnect, startHeartbeat, stopHeartbeat, stopConnectingTimeout]);

  // ─── Health Check ─────────────────────────────────────────────────

  const healthCheck = useCallback(async () => {
    const ws = coreRef.current.ws;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    if (timersRef.current.healthAbort) {
      timersRef.current.healthAbort.abort();
      timersRef.current.healthAbort = null;
    }

    const ctrl = new AbortController();
    timersRef.current.healthAbort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);

    try {
      log('HEALTH start');
      const res = await fetch(`/health?_t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        log('HEALTH OK — BACKEND detected');
        cancelReconnect();
        connect();
      } else {
        log('HEALTH failed', { status: res.status });
      }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        log('HEALTH timeout');
      } else {
        log('HEALTH failed', { error: err.message });
      }
    } finally {
      timersRef.current.healthAbort = null;
      clearTimeout(timer);
    }
  }, [log, connect, cancelReconnect]);

  const restartHealthTimer = useCallback((intervalMs) => {
    if (timersRef.current.health) {
      clearTimeout(timersRef.current.health);
      timersRef.current.health = null;
    }
    timersRef.current.healthEpoch++;
    const epoch = timersRef.current.healthEpoch;
    const tick = async () => {
      if (timersRef.current.healthEpoch !== epoch) return;
      await healthCheck();
      if (timersRef.current.healthEpoch !== epoch) return;
      timersRef.current.health = setTimeout(tick, intervalMs);
    };
    timersRef.current.health = setTimeout(tick, intervalMs);
  }, [healthCheck]);

  // ─── Mount / Cleanup ──────────────────────────────────────────────

  useEffect(() => {
    log('MOUNT');

    (async () => {
      try {
        const res = await fetch('/api/settings/monitoring');
        if (!res.ok) return;
        const d = await res.json();
        for (const s of d.settings || []) {
          applyRuntimeSetting(s.key, s.value);
        }
      } catch {}
    })();

    connect();
    startPolling();
    restartHealthTimer(HEALTH_FG_MS);

    const onOnline = () => {
      log('ONLINE');
      envRef.current.isOnline = true;
      cancelReconnect();
      coreRef.current.retryCount = 0;
      coreRef.current.firstFailTime = 0;
      connect();
    };

    const onOffline = () => {
      log('OFFLINE');
      envRef.current.isOnline = false;
      cancelReconnect();
    };

    const onVisibility = () => {
      const visible = !document.hidden;
      envRef.current.isVisible = visible;
      log(visible ? 'VISIBILITY visible' : 'VISIBILITY hidden');

      const healthMs = visible ? HEALTH_FG_MS : HEALTH_BG_MS;
      restartHealthTimer(healthMs);

      if (visible) {
        if (!coreRef.current.ws || coreRef.current.ws.readyState !== WebSocket.OPEN) {
          startPolling();
        }
      } else {
        stopPolling();
      }
    };

    const onRuntimeSetting = (ev) => {
      const { key, value } = ev?.detail || {};
      if (!key) return;
      applyRuntimeSetting(key, value);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('runtime-setting', onRuntimeSetting);

    return () => {
      log('CLEANUP');

      stopConnectingTimeout();

      if (coreRef.current.ws) {
        try { coreRef.current.ws.close(); } catch {}
        coreRef.current.ws = null;
      }

      if (timersRef.current.reconnect) {
        clearTimeout(timersRef.current.reconnect);
        timersRef.current.reconnect = null;
      }
      if (timersRef.current.health) {
        clearTimeout(timersRef.current.health);
        timersRef.current.health = null;
      }
      timersRef.current.healthEpoch++;
      if (timersRef.current.poll) {
        clearInterval(timersRef.current.poll);
        timersRef.current.poll = null;
      }
      if (timersRef.current.heartbeat) {
        clearTimeout(timersRef.current.heartbeat);
        timersRef.current.heartbeat = null;
      }
      if (timersRef.current.healthAbort) {
        timersRef.current.healthAbort.abort();
        timersRef.current.healthAbort = null;
      }

      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('runtime-setting', onRuntimeSetting);

      coreRef.current.retryCount = 0;
      coreRef.current.connectionId = '';
      coreRef.current.lastMessageTime = 0;
      coreRef.current.firstFailTime = 0;
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ws: coreRef };
}
