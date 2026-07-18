const API = import.meta.env.VITE_API_URL || '';

// === REQUEST DEDUPLICATION ===
// In-flight cache: if same GET URL is already pending, reuse the promise
const inFlight = new Map();

function dedupFetch(url) {
  if (inFlight.has(url)) return inFlight.get(url);
  const promise = fetch(url).finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
}

// === RESPONSE CACHE ===
// Short-lived cache for frequently accessed endpoints (e.g. folder listings)
const responseCache = new Map();
const CACHE_TTL = 2000; // 2 seconds

function cachedFetch(url, ttl = CACHE_TTL) {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached && now - cached.time < ttl) return Promise.resolve(cached.data);
  return dedupFetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    responseCache.set(url, { data, time: now });
    // Evict old entries
    if (responseCache.size > 100) {
      for (const [key, val] of responseCache) {
        if (now - val.time > ttl * 2) responseCache.delete(key);
      }
    }
    return data;
  });
}

export function clearResponseCache() {
  responseCache.clear();
}

// === API FUNCTIONS ===

export async function fetchFolder(path, cursor = null, limit = null, folderId = null, sortBy = null, sortOrder = 'asc') {
  const params = new URLSearchParams();
  if (folderId) {
    params.set('folder_id', String(folderId));
  } else {
    params.set('path', path);
  }
  if (cursor) params.set('cursor', cursor);
  if (limit !== null) params.set('limit', String(limit));
  if (sortBy) params.set('sortBy', sortBy);
  params.set('sortOrder', sortOrder);
  const url = `${API}/api/files?${params}`;
  // Non-cached for paginated/sorted requests (user expects fresh data)
  if (cursor || sortBy) {
    const res = await dedupFetch(url);
    if (!res.ok) throw new Error('Failed to fetch folder');
    return res.json();
  }
  // Cached for root/folder listings (same page won't change in 2s)
  return cachedFetch(url, 2000);
}

export async function fetchStats() {
  const url = `${API}/api/files/stats`;
  return cachedFetch(url, 5000);
}

export async function fetchFileById(id) {
  const url = `${API}/api/files/${id}`;
  const res = await dedupFetch(url);
  if (!res.ok) throw new Error('File not found');
  return res.json();
}

export function getThumbnailUrl(file) {
  return `${API}/thumbnails/${file.id}.jpg`;
}

// === PLAYLIST API FUNCTIONS ===

export async function fetchPlaylists() {
  const url = `${API}/api/playlists`;
  const res = await dedupFetch(url);
  if (!res.ok) throw new Error('Failed to fetch playlists');
  return res.json();
}

export async function fetchPlaylistById(id) {
  const url = `${API}/api/playlists/${id}`;
  const res = await dedupFetch(url);
  if (!res.ok) throw new Error('Playlist not found');
  return res.json();
}

export async function fetchPlaylistPlay(id, { sortBy, sortOrder } = {}) {
  const params = new URLSearchParams();
  if (sortBy) params.set('sortBy', sortBy);
  if (sortOrder) params.set('sortOrder', sortOrder);
  const qs = params.toString();
  const url = `${API}/api/playlists/${id}/play${qs ? `?${qs}` : ''}`;
  const res = await dedupFetch(url);
  if (!res.ok) throw new Error('Failed to get playlist queue');
  return res.json();
}

export async function scanPlaylists() {
  const url = `${API}/api/playlists/scan`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to scan playlists');
  return res.json();
}

export async function refreshPlaylist(id) {
  const url = `${API}/api/playlists/${id}/refresh`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to refresh playlist');
  return res.json();
}

export async function deletePlaylist(id) {
  const url = `${API}/api/playlists/${id}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete playlist');
  return res.json();
}

export async function createManualPlaylist(title, fileIds) {
  const url = `${API}/api/playlists/create/manual`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, fileIds }),
  });
  if (!res.ok) throw new Error('Failed to create manual playlist');
  return res.json();
}

export async function createFolderPlaylist(folderPath, title) {
  const url = `${API}/api/playlists/create/folder`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath, title }),
  });
  if (!res.ok) throw new Error('Failed to create folder playlist');
  return res.json();
}

export async function importXSPFPlaylist(file) {
  const url = `${API}/api/playlists/import`;
  const formData = new FormData();
  formData.append('playlist', file);
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to import playlist');
  return res.json();
}

// === SCRCPY API ===

export async function fetchScrcpyDevices() {
  const res = await fetch(`${API}/api/scrcpy/devices`);
  if (!res.ok) throw new Error('Failed to fetch scrcpy devices');
  return res.json();
}

export async function fetchScrcpyStatus() {
  const res = await fetch(`${API}/api/scrcpy/status`);
  if (!res.ok) throw new Error('Failed to fetch scrcpy status');
  return res.json();
}

export async function startScrcpySession(device, mode, settings) {
  const res = await fetch(`${API}/api/scrcpy/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, mode, settings }),
  });
  return res.json();
}

export async function stopScrcpySession(device) {
  const res = await fetch(`${API}/api/scrcpy/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  return res.json();
}

export async function stopAllScrcpy() {
  const res = await fetch(`${API}/api/scrcpy/stop-all`, { method: 'POST' });
  return res.json();
}

export async function sendScrcpyInput(device, command) {
  const res = await fetch(`${API}/api/scrcpy/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, command }),
  });
  return res.json();
}

export async function toggleFavorite(fileId) {
  const res = await fetch(`${API}/api/files/${fileId}/favorite`, { method: 'PATCH' });
  return res.json();
}

export async function sendToTelegram(fileId) {
  const res = await fetch(`${API}/api/send/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  if (data && data.ok !== false) window.dispatchEvent(new Event('media-vault:send-changed'));
  return data;
}

export async function sendToAll(fileId) {
  const res = await fetch(`${API}/api/send/all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  if (data && data.ok !== false) window.dispatchEvent(new Event('media-vault:send-changed'));
  return data;
}

export async function sendToWhatsApp(fileId) {
  const res = await fetch(`${API}/api/send/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  if (data && data.ok !== false) window.dispatchEvent(new Event('media-vault:send-changed'));
  return data;
}

export async function sendToChannel(fileId) {
  const res = await fetch(`${API}/api/send/channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  if (data && data.ok !== false) window.dispatchEvent(new Event('media-vault:send-changed'));
  return data;
}

export async function sendToStatus(fileId) {
  const res = await fetch(`${API}/api/send/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  const data = await res.json();
  if (data && data.ok !== false) window.dispatchEvent(new Event('media-vault:send-changed'));
  return data;
}

// Is the WhatsApp client connected? Used to enable/disable the WA send button
// independently of Telegram configuration.
export async function getWhatsAppSendStatus() {
  const res = await fetch(`${API}/api/whatsapp/status`);
  if (!res.ok) return null;
  return res.json();
}

// Build a user-friendly message from the send response, surfacing per-target
// failures (especially WhatsApp) instead of swallowing them.
export function describeSendResult(res) {
  if (!res) return 'Gagal mengirim';
  if (res.duplicate) return res.message || 'Sudah dikirim/antri (duplikat dilewati)';
  if (res.error) return 'Gagal: ' + res.error;
  const r = res.results;
  if (!r) return res.ok ? 'Terkirim' : 'Gagal mengirim';

  const parts = [];
  if (r.telegram == null) {
    // 'all' without Telegram? still show what we have.
  } else if (r.telegram === 'sent') {
    parts.push('Telegram: OK');
  } else if (r.telegram?.startsWith('err')) {
    parts.push('Telegram: ' + r.telegram.slice(4).trim());
  } else {
    parts.push('Telegram: ' + (r.telegram || '?'));
  }

  if (r.whatsapp_channel == null) {
    // not attempted
  } else if (r.whatsapp_channel === 'sent') {
    parts.push('WA Channel: OK');
  } else if (r.whatsapp_channel?.startsWith('err')) {
    parts.push('WA Channel: ' + r.whatsapp_channel.slice(4).trim());
  } else {
    parts.push('WA Channel: ' + (r.whatsapp_channel || '?'));
  }

  if (r.whatsapp_status == null) {
    // not attempted
  } else if (r.whatsapp_status === 'sent') {
    parts.push('WA Status: OK');
  } else if (r.whatsapp_status?.startsWith('err')) {
    parts.push('WA Status: ' + r.whatsapp_status.slice(4).trim());
  } else {
    parts.push('WA Status: ' + (r.whatsapp_status || '?'));
  }

  const failedParts = parts.filter(p => {
    const m = p.match(/: (.*)$/);
    return m && m[1] !== 'OK';
  });

  if (failedParts.length === 0) {
    return 'Terkirim: ' + parts.join(' · ');
  }
  // At least one target failed — do NOT report blanket success.
  const tgFailed = r.telegram?.startsWith('err');
  const waFailed = r.whatsapp_channel?.startsWith('err') || r.whatsapp_status?.startsWith('err');
  const prefix = tgFailed && waFailed ? 'Gagal total'
    : tgFailed ? 'Telegram gagal'
    : 'WA gagal';
  return prefix + ' — ' + failedParts.join(' · ');
}

export async function getSendQueueStatuses(target) {
  const qs = target ? `?target=${encodeURIComponent(target)}` : '';
  const res = await fetch(`${API}/api/send/queue/statuses${qs}`);
  return res.json();
}

export async function getSendQueue(status, cursor = 0, limit = 100, target) {
  const params = new URLSearchParams({ status, cursor: String(cursor), limit: String(limit) });
  if (target) params.set('target', target);
  const res = await fetch(`${API}/api/send/queue?${params.toString()}`);
  return res.json();
}

// Live per-target progress for a combined send, keyed by queueId.
export async function getSendProgress(qid) {
  const res = await fetch(`${API}/api/send/progress?qid=${qid}`);
  if (!res.ok) return null;
  return res.json();
}

export async function cancelSendQueueItem(id) {
  const res = await fetch(`${API}/api/send/queue/${id}/cancel`, { method: 'POST' });
  return res.json();
}

export async function retrySendQueueItem(id) {
  const res = await fetch(`${API}/api/send/queue/${id}/retry`, { method: 'POST' });
  return res.json();
}

export async function removeSendQueueItem(id) {
  const res = await fetch(`${API}/api/send/queue/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function clearSendQueueHistory() {
  const res = await fetch(`${API}/api/send/queue/clear-history`, { method: 'POST' });
  return res.json();
}

export async function setQueueCaption(id, caption) {
  const res = await fetch(`${API}/api/send/queue/${id}/caption`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption }),
  });
  return res.json();
}

export async function reorderQueueItem(id, direction) {
  const res = await fetch(`${API}/api/send/queue/${id}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  return res.json();
}

export async function rescheduleQueueItem(id, scheduledAt) {
  const res = await fetch(`${API}/api/send/queue/${id}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledAt }),
  });
  return res.json();
}

export async function resendQueueItem(id) {
  const res = await fetch(`${API}/api/send/queue/${id}/resend`, { method: 'POST' });
  return res.json();
}

export async function getSendSettings() {
  const res = await fetch(`${API}/api/send/settings`);
  if (!res.ok) return null;
  return res.json();
}

export async function setSendSettings(settings) {
  const res = await fetch(`${API}/api/send/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}
