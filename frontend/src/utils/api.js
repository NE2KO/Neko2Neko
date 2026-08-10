export const API = import.meta.env.VITE_API_URL || '';

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

export async function fetchFolder(path, cursor = null, limit = null, folderId = null, sortBy = null, sortOrder = 'asc', prevCursor = null) {
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
  if (prevCursor) params.set('prev_cursor', prevCursor);
  const url = `${API}/api/files?${params}`;
  if (cursor || sortBy || prevCursor) {
    const res = await dedupFetch(url);
    if (!res.ok) throw new Error('Failed to fetch folder');
    return res.json();
  }
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
  if (!res.ok) throw new Error('Failed to toggle favorite');
  return res.json();
}

export async function toggleLock(fileId) {
  const res = await fetch(`${API}/api/files/${fileId}/lock`, { method: 'PATCH' });
  if (!res.ok) throw new Error('Failed to toggle lock');
  return res.json();
}

export async function getLock(fileId) {
  const res = await fetch(`${API}/api/files/${fileId}/lock`);
  if (!res.ok) throw new Error('Failed to read lock');
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

export async function getSendQueue(status, cursor = 0, limit = 100, target, opts = {}) {
  const params = new URLSearchParams({ status, cursor: String(cursor), limit: String(limit) });
  if (target) params.set('target', target);
  if (opts.sortBy != null) params.set('sortBy', String(opts.sortBy));
  if (opts.sortOrder) params.set('sortOrder', String(opts.sortOrder));
  if (opts.typeFilter) params.set('typeFilter', String(opts.typeFilter));
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

// === AI API FUNCTIONS ===

export async function fetchAiStatus(localId) {
  const headers = localId ? { 'X-AI-Local-Id': localId } : undefined;
  const res = await dedupFetch(`${API}/api/ai`, { headers });
  return res.json();
}

export async function fetchAiConversations(localId) {
  const res = await dedupFetch(`${API}/api/ai/conversations`, { headers: { 'X-AI-Local-Id': localId } });
  return res.json();
}

export async function createAiConversation(localId, title) {
  const res = await fetch(`${API}/api/ai/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Local-Id': localId },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

export async function fetchAiConversation(localId, id) {
  const res = await dedupFetch(`${API}/api/ai/conversations/${id}`, { headers: { 'X-AI-Local-Id': localId } });
  return res.json();
}

export async function updateAiConversation(localId, id, patch) {
  const res = await fetch(`${API}/api/ai/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-AI-Local-Id': localId },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function deleteAiConversation(localId, id) {
  const res = await fetch(`${API}/api/ai/conversations/${id}`, {
    method: 'DELETE',
    headers: { 'X-AI-Local-Id': localId },
  });
  return res.json();
}

export async function searchAiConversationMessages(localId, id, q) {
  const url = `${API}/api/ai/conversations/${id}/search?q=${encodeURIComponent(q)}`;
  const res = await dedupFetch(url, { headers: { 'X-AI-Local-Id': localId } });
  return res.json();
}

export async function fetchAiTools(localId) {
  const res = await dedupFetch(`${API}/api/ai/tools`, { headers: { 'X-AI-Local-Id': localId } });
  return res.json();
}

export async function fetchAiSettings() {
  const res = await dedupFetch(`${API}/api/ai/settings`);
  return res.json();
}

export async function updateAiSetting(key, value) {
  const res = await fetch(`${API}/api/ai/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  return res.json();
}

export async function exportAiConversation(localId, conversationId) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/export`, {
    headers: { 'X-AI-Local-Id': localId },
  });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}

export async function downloadAsFile(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function sendAiMessage(localId, conversationId, message, onChunk, onDone, onError) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Local-Id': localId },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onDone?.();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { onDone?.(); return; }
      try {
        const data = JSON.parse(payload);
        if (data.type === 'error') { onError?.(data.error); return; }
        if (data.type === 'delta') onChunk({ type: 'text_delta', text: data.text });
        else if (data.type === 'text') onChunk({ type: 'text_delta', text: data.text });
        else if (data.type === 'tool_call_delta') onChunk({ type: 'tool_call_delta', ...data });
        else if (data.type === 'tool_call_start') onChunk({ type: 'tool_call_start', id: data.id, name: data.name });
        else if (data.type === 'tool_result') onChunk({ type: 'tool_result', id: data.id, name: data.name, result: data.result });
        else if (data.type === 'done') { onDone?.(data.finishReason); return; }
        else if (data.type === 'started') { /* noop */ }
      } catch {}
    }
  }
}

// === AI PROVIDER STATUS & VERIFICATION ===

export async function fetchProviderStatus() {
  const res = await dedupFetch(`${API}/api/ai/providers/status`);
  return res.json();
}

export async function verifyProvider(providerId) {
  const res = await fetch(`${API}/api/ai/providers/${providerId}/verify`, { method: 'POST' });
  return res.json();
}

export async function fetchProviderModels(providerId, refresh = false) {
  const url = `${API}/api/ai/providers/${providerId}/models${refresh ? '?refresh=true' : ''}`;
  const res = await dedupFetch(url);
  return res.json();
}

export async function refreshProviderModels(providerId) {
  const res = await fetch(`${API}/api/ai/providers/${providerId}/models/refresh`, { method: 'POST' });
  return res.json();
}

// === AI MODELS ===

export async function fetchAllModels(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API}/api/ai/models${qs ? '?' + qs : ''}`;
  const res = await dedupFetch(url);
  return res.json();
}

export async function updateModelPreference(providerId, modelId, pref) {
  const res = await fetch(`${API}/api/ai/models/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, ...pref }),
  });
  return res.json();
}

export async function markModelUsed(providerId, modelId) {
  const res = await fetch(`${API}/api/ai/models/mark-used`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId }),
  });
  return res.json();
}

export async function fetchFavoriteModels() {
  const res = await dedupFetch(`${API}/api/ai/models/favorites`);
  return res.json();
}

export async function fetchProviderPresets() {
  const res = await dedupFetch(`${API}/api/ai/providers/presets`);
  return res.json();
}

// === AI MEMORIES ===

export async function fetchMemories(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${API}/api/ai/memories${qs ? '?' + qs : ''}`;
  const res = await dedupFetch(url);
  return res.json();
}

export async function fetchMemoryCount() {
  const res = await dedupFetch(`${API}/api/ai/memories/count`);
  return res.json();
}

export async function createMemory(content, options = {}) {
  const res = await fetch(`${API}/api/ai/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, ...options }),
  });
  return res.json();
}

export async function updateMemory(id, updates) {
  const res = await fetch(`${API}/api/ai/memories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteMemory(id) {
  const res = await fetch(`${API}/api/ai/memories/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function toggleMemoryPin(id) {
  const res = await fetch(`${API}/api/ai/memories/${id}/toggle-pin`, { method: 'POST' });
  return res.json();
}

export async function toggleMemoryEnabled(id) {
  const res = await fetch(`${API}/api/ai/memories/${id}/toggle-enabled`, { method: 'POST' });
  return res.json();
}

export async function extractMemories(conversationId) {
  const res = await fetch(`${API}/api/ai/memories/extract/${conversationId}`, { method: 'POST' });
  return res.json();
}

export async function exportMemories() {
  const res = await fetch(`${API}/api/ai/memories/export`);
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}

// === AI CONVERSATION SETTINGS ===

export async function fetchConversationSettings(conversationId) {
  const res = await dedupFetch(`${API}/api/ai/conversations/${conversationId}/settings`);
  return res.json();
}

export async function updateConversationSettings(conversationId, settings) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

// === AI CONTEXT ===

export async function fetchConversationContext(conversationId) {
  const res = await dedupFetch(`${API}/api/ai/conversations/${conversationId}/context`);
  return res.json();
}

export async function compactConversationContext(conversationId) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/context/compact`, { method: 'POST' });
  return res.json();
}

// === AI PINNED MESSAGES ===

export async function pinMessage(conversationId, messageId) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/pin/${messageId}`, { method: 'POST' });
  return res.json();
}

export async function unpinMessage(conversationId, messageId) {
  const res = await fetch(`${API}/api/ai/conversations/${conversationId}/pin/${messageId}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchPinnedMessages(conversationId) {
  const res = await dedupFetch(`${API}/api/ai/conversations/${conversationId}/pinned`);
  return res.json();
}

