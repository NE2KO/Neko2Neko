# Production Checklist

## Startup
- [ ] `ffmpeg` available in PATH (warning if missing)
- [ ] `ffprobe` available in PATH (warning if missing)
- [ ] SQLite database reachable at startup (critical — fail if missing)
- [ ] Cache directory writable at startup (critical — fail if missing)
- [ ] Logs directory writable at startup (critical — fail if missing)
- [ ] `/health` returns `status: "healthy"` or `"degraded"` — never `"ok"`
- [ ] `/api/ready` returns `state: "ready"` after warm-up

## Playback
- [ ] H264 + AAC in MP4 → direct stream (no cache on first play, cache hit on second)
- [ ] H264 + Opus in MP4 → automatic remux to MKV (no re-encode)
- [ ] MKV + Opus → direct playback
- [ ] WebM → direct playback
- [ ] HLS generates playlist and segments
- [ ] Fallback to direct stream when HLS unavailable
- [ ] Cache survives server restart (`cache/playback/lru.json` persists)

## Logs
- [ ] `logs/playback/` → structured JSON-lines, one file per day
- [ ] `logs/maintenance/` → structured entries for WAL, orphan, enrichment
- [ ] `logs/hls/` → HLS generation events
- [ ] `logs/api/` → request errors
- [ ] Rotation at 50 MB / 30 files per category
- [ ] Log levels applied: `debug` suppressed unless configured

## Cache
- [ ] `/api/playback/stats` returns expanded cache fields (`evictions`, `cleanupCount`, `oldestCacheEntry`, `newestCacheEntry`, `largestCachedFile`, `smallestCachedFile`, `avgCachedFileSize`)
- [ ] LRU eviction works: active jobs never evicted
- [ ] Integrity check (size > 0, readable) before serving cached file
- [ ] `POST /api/playback/cleanup` completes within configured interval

## Shutdown
- [ ] `SIGINT` / `SIGTERM` → server stops accepting new playback jobs immediately
- [ ] Existing remux/transcode jobs complete within `SETTINGS.shutdownTimeoutMs` (default 30s)
- [ ] LRU metadata persisted to `lru.json` on exit
- [ ] No orphan ffmpeg/ffprobe processes after exit
- [ ] HTTP server closes cleanly (no `EADDRINUSE` on next start)

## Monitoring
- [ ] `/health` returns `status: "healthy" | "degraded" | "critical"`
- [ ] Health probe cache refreshes every 5 seconds (no fork-per-request)
- [ ] Disk free space probe returns accurate value or `available: false`
- [ ] Version matches running `package.json`
