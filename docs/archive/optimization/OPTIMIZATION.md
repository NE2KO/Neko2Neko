# Backend Optimization — Full Change Log

**Date:** 2026-07-05
**Status:** DONE

## Goal
Reduce backend memory usage, CPU overhead, and network bandwidth on a resource-constrained system (14GB RAM, 11GB used, 72 Chromium processes eating 6.9GB).

---

## P0 — Critical (High Impact)

### 1. Add gzip compression middleware
**File:** `backend/src/server.js`
**What:** Install `compression` npm package and add middleware.

```bash
cd backend && npm install compression
```

**server.js changes:**

Add import (line ~7):
```js
import compression from 'compression';
```

Add middleware AFTER cors(), BEFORE express.json() (line ~59):
```js
app.use(cors());
app.use(compression({ threshold: 1024 }));  // ADD THIS — skip tiny responses
app.use(express.json());
```

**Impact:** 70-80% smaller API responses. Monitoring stats payloads go from ~5KB to ~1KB.

---

### 2. Fix static asset caching
**File:** `backend/src/server.js`
**What:** Vite fingerprints bundle filenames, so 1-year cache is safe.

Change lines 196-200 FROM:
```js
app.use(express.static(join(__dirname, '../../frontend/dist'), {
  maxAge: 0,
  immutable: false,
  index: false,
}));
```

TO:
```js
app.use(express.static(join(__dirname, '../../frontend/dist'), {
  maxAge: 31536000000,  // 1 year — safe because Vite fingerprints filenames
  immutable: true,
  index: false,
}));
```

**Impact:** Browser stops re-downloading CSS/JS/fonts on every page load.

---

### 3. Remove blanket Connection: close
**File:** `backend/src/server.js`
**What:** Forces new TCP connection per request. Negates keep-alive. Causes 1s monitoring poll to do TCP handshake every time.

Remove or comment out lines 73-76:
```js
// REMOVE THIS BLOCK:
app.use((req, res, next) => {
  res.set('Connection', 'close');
  next();
});
```

**Impact:** HTTP keep-alive works. Monitoring dashboard reuses single TCP connection.

---

### 4. Reduce SQLite cache_size
**File:** `backend/src/db.js`
**What:** 200MB cache is aggressive for a 14GB system.

Change line 18 FROM:
```js
db.pragma('cache_size = -200000'); // ~200MB cache
```

TO:
```js
db.pragma('cache_size = -80000'); // ~80MB cache — sufficient for 112K files
```

**Impact:** Frees ~120MB RAM.

---

### 5. Reduce mmap_size
**File:** `backend/src/db.js`
**What:** 30GB mmap hint on a 14GB system is excessive.

Change line 19 FROM:
```js
db.pragma('mmap_size = 30000000000'); // 30GB
```

TO:
```js
db.pragma('mmap_size = 4294967296'); // 4GB — prevents kernel over-mapping
```

**Impact:** Prevents kernel from over-mapping memory.

---

### 6. Fix monitoring poll interval mismatch
**File:** `backend/src/monitor/engine.js`
**What:** Engine polls every 1s but only broadcasts every 3s. 66% of collector work is thrown away.

Change line 20 FROM:
```js
let pollIntervalMs = 1000;
```

TO:
```js
let pollIntervalMs = 3000;
```

Also change default in `startEngine` (line 121) FROM:
```js
pollIntervalMs = clampInterval(get('monitor.refreshInterval', 1000));
```

TO:
```js
pollIntervalMs = clampInterval(get('monitor.refreshInterval', 3000));
```

**Impact:** ~66% reduction in collector CPU. Same broadcast rate (was already 3s throttled).

---

### 7. Add ffmpeg concurrency limit
**File:** `backend/src/utils/playbackEngine.js`
**What:** No limit on concurrent ffmpeg processes. 10 simultaneous streams = 10 ffmpeg processes eating 200MB-1GB each.

Add after line 57 (`let lruMap = new Map();`):
```js
// --- FFmpeg concurrency limiter ---
const MAX_FFMPEG_CONCURRENT = 2;
let ffmpegActive = 0;
const ffmpegQueue = [];

function acquireFfmpegSlot() {
  return new Promise((resolve) => {
    if (ffmpegActive < MAX_FFMPEG_CONCURRENT) {
      ffmpegActive++;
      resolve();
    } else {
      ffmpegQueue.push(resolve);
    }
  });
}

function releaseFfmpegSlot() {
  if (ffmpegQueue.length > 0) {
    const next = ffmpegQueue.shift();
    next();
  } else {
    ffmpegActive--;
  }
}
```

Then wrap `remuxToMkv` call in `handleRemux` (line 305):
```js
// ADD before line 305 (await remuxToMkv):
await acquireFfmpegSlot();
try {
  await remuxToMkv(file.fullPath, tmpPath);
  // ... rest of existing code
} finally {
  releaseFfmpegSlot();
}
```

Same for `transcodeToH264Mp4` in `handleTranscode` (line 389):
```js
// ADD before line 389 (await transcodeToH264Mp4):
await acquireFfmpegSlot();
try {
  await transcodeToH264Mp4(file.fullPath, tmpPath);
  // ... rest of existing code
} finally {
  releaseFfmpegSlot();
}
```

**Impact:** Prevents OOM from transcoding storms. Max 2 concurrent ffmpeg processes.

---

### 8. Cap LRU cache entries
**File:** `backend/src/utils/playbackEngine.js`
**What:** `lruMap` grows without limit.

Add constant after `const MAX_FFMPEG_CONCURRENT = 2;`:
```js
const MAX_LRU_ENTRIES = 10000;
```

Modify `touchLRU` function (line 77-80) TO:
```js
function touchLRU(filePath, size) {
  if (!SETTINGS.lruEnabled) return;
  // Evict oldest if at capacity
  if (lruMap.size >= MAX_LRU_ENTRIES) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, val] of lruMap) {
      if (val.lastUsed < oldestTime) { oldestTime = val.lastUsed; oldestKey = key; }
    }
    if (oldestKey) lruMap.delete(oldestKey);
  }
  lruMap.set(filePath, { lastUsed: Date.now(), size, createdAt: lruMap.get(filePath)?.createdAt || Date.now() });
}
```

**Impact:** Prevents slow memory growth from unbounded LRU map.

---

## P1 — High Impact

### 9. Reduce orphan cleanup frequency
**File:** `backend/src/utils/maintenance.js`
**What:** Every 10 min, reads every file in DB (50K+) and does `fsPromises.access()` on each. Massive I/O.

Change line 148 FROM:
```js
}, 10 * 60 * 1000);
```

TO:
```js
}, 60 * 60 * 1000);  // Every 60 minutes instead of 10
```

**Impact:** 86% reduction in 50K+ stat calls per hour.

---

### 10. Reduce metadata enrichment frequency
**File:** `backend/src/utils/maintenance.js`
**What:** Spawns 40 ffprobe processes every 10 min.

Change line 158 FROM:
```js
}, 10 * 60 * 1000);
```

TO:
```js
}, 30 * 60 * 1000);  // Every 30 minutes instead of 10
```

**Impact:** 67% fewer ffprobe spawns.

---

### 11. WAL checkpoint: TRUNCATE → PASSIVE
**File:** `backend/src/utils/maintenance.js`
**What:** TRUNCATE forces full checkpoint + truncation, can cause write stalls.

Change line 74 FROM:
```js
db.pragma('wal_checkpoint(TRUNCATE)');
```

TO:
```js
db.pragma('wal_checkpoint(PASSIVE)');
```

**Impact:** Prevents brief write stalls during checkpoint.

---

## P2 — Medium Impact

### 12. Combine 5 DB queries in refreshMedia into 1
**File:** `backend/src/monitor/monitoringCache.js`
**What:** 5 separate COUNT queries every 15s.

Replace lines 126-130 FROM:
```js
const byType = stmts.countFilesByType.all();
const totalFiles = stmts.countTotalFiles.get().total;
const filesWithThumbs = dbModule.prepare('SELECT COUNT(*) as cnt FROM files WHERE has_thumb = 1').get().cnt;
const filesWithoutThumbs = dbModule.prepare('SELECT COUNT(*) as cnt FROM files WHERE has_thumb = 0 OR has_thumb IS NULL').get().cnt;
const filesSkipped = dbModule.prepare('SELECT COUNT(*) as cnt FROM files WHERE has_thumb = 2').get().cnt;
```

TO:
```js
const combined = dbModule.prepare(`
  SELECT
    type,
    COUNT(*) as count,
    SUM(CASE WHEN has_thumb = 1 THEN 1 ELSE 0 END) as with_thumbs,
    SUM(CASE WHEN has_thumb = 0 OR has_thumb IS NULL THEN 1 ELSE 0 END) as without_thumbs,
    SUM(CASE WHEN has_thumb = 2 THEN 1 ELSE 0 END) as skipped
  FROM files
  GROUP BY type
`).all();
const totalFiles = combined.reduce((sum, r) => sum + r.count, 0);
const filesWithThumbs = combined.reduce((sum, r) => sum + r.with_thumbs, 0);
const filesWithoutThumbs = combined.reduce((sum, r) => sum + r.without_thumbs, 0);
const filesSkipped = combined.reduce((sum, r) => sum + r.skipped, 0);
const byType = combined.map(r => ({ type: r.type, count: r.count }));
```

**Impact:** 80% fewer DB queries every 15s.

---

### 13. Move session cleanup to timed interval
**File:** `backend/src/utils/sessionTracker.js`
**What:** `cleanup()` runs on EVERY API request. Iterates entire sessions Map.

Remove `cleanup()` call from `trackRequest` (line 33):
```js
  // REMOVE: cleanup();
```

Add timed cleanup after `idCounter` declaration (line 2):
```js
let idCounter = 0;

// Clean stale sessions every 30s instead of per-request
setInterval(() => {
  const stale = Date.now() - 5 * 60 * 1000;
  for (const [key, session] of sessions) {
    if (session.lastSeen < stale) sessions.delete(key);
  }
}, 30000);
```

**Impact:** Eliminates per-request Map iteration overhead.

---

### 14. Increase system collector TTL
**File:** `backend/src/monitor/collectors/system.js`
**What:** 3 systemctl + 1 who commands every 15s.

Change line 10 FROM:
```js
const WHO_TTL = 10_000;
```

TO:
```js
const WHO_TTL = 60_000;
```

Change line 14 FROM:
```js
const SERVICES_TTL = 15_000;
```

TO:
```js
const SERVICES_TTL = 60_000;
```

**Impact:** 75% fewer child_process spawns for system info.

---

### 15. Skip nvidia-smi on AMD systems
**File:** `backend/src/monitor/collectors/gpu.js`
**What:** Attempts `nvidia-smi` every 3s even on AMD. Fails, falls through to sysfs. Wasteful child_process spawn.

Add after line 10 (`let refreshInFlight = false;`):
```js
const HAS_NVIDIA = fs.existsSync('/proc/driver/nvidia');
```

Change line 50 FROM:
```js
const nvidia = await refreshNvidia();
```

TO:
```js
const nvidia = HAS_NVIDIA ? await refreshNvidia() : null;
```

**Impact:** Eliminates failing child_process spawn every 3s on AMD systems.

---

### 16. Increase periodic rescan interval
**File:** `backend/src/utils/watcher.js`
**What:** Full incremental scan every 5 min even without changes.

Change line 105 FROM:
```js
}, 5 * 60 * 1000);
```

TO:
```js
}, 15 * 60 * 1000);  // Every 15 minutes instead of 5
```

**Impact:** 67% fewer full scans.

---

## Implementation Status

| # | Change | File | Status |
|---|--------|------|--------|
| 1 | Install compression | package.json | DONE |
| 2 | Compression middleware | server.js | DONE |
| 3 | Static asset caching | server.js | DONE |
| 4 | Remove Connection: close | server.js | DONE |
| 5 | SQLite cache_size | db.js | DONE |
| 6 | mmap_size | db.js | DONE |
| 7 | Poll interval 1s→3s | engine.js | DONE |
| 8 | FFmpeg concurrency limit | playbackEngine.js | DONE |
| 9 | LRU cache cap | playbackEngine.js | DONE |
| 10 | Orphan cleanup freq | maintenance.js | DONE |
| 11 | Metadata enrichment freq | maintenance.js | DONE |
| 12 | WAL PASSIVE | maintenance.js | DONE |
| 13 | Combine 5 DB queries | monitoringCache.js | DONE |
| 14 | Session cleanup interval | sessionTracker.js | DONE |
| 15 | System collector TTL | collectors/system.js | DONE |
| 16 | Skip nvidia-smi on AMD | collectors/gpu.js | DONE |
| 17 | Rescan interval | watcher.js | DONE |
| 18 | Rebuild frontend | frontend/ | DONE |

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Backend RSS | 147 MB | ~110-120 MB |
| SQLite cache | 200 MB | 80 MB |
| Monitoring CPU | ~5.4% | ~1.5-2% |
| API response size | Uncompressed | ~70-80% smaller |
| TCP connections/sec | New per request | Reused (keep-alive) |
| ffprobe spawns/hour | 240 | 80 |
| stat calls/hour | 300,000 | 50,000 |

## Post-Implementation

After all changes:
1. Rebuild frontend: `cd frontend && npx vite build`
2. Restart backend: `kill $(pgrep -f "node backend") && cd backend && node src/server.js`
3. Verify with: `ps aux | grep "node backend" | awk '{print $6/1024 " MB"}'`
4. Check monitoring dashboard still works at 3s interval
