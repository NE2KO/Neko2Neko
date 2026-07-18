const API = import.meta.env.VITE_API_URL || '';

export async function fetchDevices() {
  const res = await fetch(`${API}/api/adb/devices`);
  if (!res.ok) throw new Error('Failed to fetch devices');
  return res.json();
}

export async function listDeviceDir(device, path) {
  const res = await fetch(`${API}/api/adb/ls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to list directory');
  }
  return res.json();
}

export async function statDevicePath(device, path) {
  const res = await fetch(`${API}/api/adb/stat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, path }),
  });
  if (!res.ok) throw new Error('Failed to stat path');
  return res.json();
}

export async function listLocalDir(path) {
  const res = await fetch(`${API}/api/adb/localls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to list local directory');
  }
  return res.json();
}

export async function statLocalPath(path) {
  const res = await fetch(`${API}/api/adb/localstat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error('Failed to stat local path');
  return res.json();
}

export async function pushFiles(device, sources, dest, options = {}) {
  const body = {
    device,
    sources,
    dest,
    maxWorkers: options.maxWorkers || 3,
    conflictStrategy: options.conflictStrategy || 'ask',
  };
  if (options.txOptions) body.txOptions = options.txOptions;

  const res = await fetch(`${API}/api/adb/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to start push');
  return res.json();
}

export async function checkDuplicates(device, sources, dest) {
  const res = await fetch(`${API}/api/adb/check-duplicates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, sources, dest }),
  });
  if (!res.ok) throw new Error('Failed to check duplicates');
  return res.json();
}

export async function pullFiles(device, sources, dest) {
  const res = await fetch(`${API}/api/adb/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, sources, dest }),
  });
  if (!res.ok) throw new Error('Failed to start pull');
  return res.json();
}

export async function fetchJobs() {
  const res = await fetch(`${API}/api/adb/jobs`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function fetchJobTransactions(jobId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/transactions`);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function cancelJob(jobId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to cancel job');
  return res.json();
}

export async function pauseJob(jobId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/pause`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to pause job');
  return res.json();
}

export async function resumeJob(jobId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/resume`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to resume job');
  return res.json();
}

export async function retryFailed(jobId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/retry-failed`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to retry failed files');
  return res.json();
}

export async function resolveConflict(jobId, decision) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/conflict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  if (!res.ok) throw new Error('Failed to resolve conflict');
  return res.json();
}

export function subscribeJobProgress(jobId, onProgress, onDone, onConflict) {
  const es = new EventSource(`${API}/api/adb/jobs/${jobId}/progress`);

  es.addEventListener('progress', (e) => {
    try {
      onProgress(JSON.parse(e.data));
    } catch {}
  });

  es.addEventListener('conflict', (e) => {
    try {
      const data = JSON.parse(e.data);
      onConflict?.(data);
    } catch {}
  });

  es.addEventListener('done', (e) => {
    try {
      onDone(JSON.parse(e.data));
    } catch {}
    es.close();
  });

  es.onerror = () => {
    es.close();
  };

  return () => es.close();
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 Mb/s';
  const bitsPerSec = bytesPerSec * 8;
  const units = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s'];
  const i = Math.floor(Math.log(bitsPerSec) / Math.log(1000));
  return (bitsPerSec / Math.pow(1000, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export { formatSize, formatSpeed, formatEta };

export function buildTxOptions(decisions) {
  const overwritePaths = [];
  const skipPaths = [];
  const renameMap = {};

  for (const d of decisions) {
    if (d.action === 'overwrite') overwritePaths.push(d.source);
    else if (d.action === 'skip') skipPaths.push(d.source);
    else if (d.action === 'rename' && d.newName) renameMap[d.source] = d.newName;
  }

  return { overwritePaths, skipPaths, renameMap };
}

export function sourcesFromDecisions(decisions) {
  const sources = [];
  for (const d of decisions) {
    if (d.action === 'skip') continue;
    if (d.action === 'rename' && d.newName) {
      const parts = d.source.split('/');
      parts[parts.length - 1] = d.newName;
      sources.push(parts.join('/'));
    } else {
      sources.push(d.source);
    }
  }
  return sources;
}

export async function reassignDevice(jobId, deviceId) {
  const res = await fetch(`${API}/api/adb/jobs/${jobId}/reassign-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) throw new Error('Failed to reassign device');
  return res.json();
}
