# Media Vault — Production Architecture Reference

> **Document version:** Doc v3.1 — 2026-07-18
> **Codebase package versions:** backend `homelab-media-server` **v1.0.0**, frontend `homelab-media-frontend` **v1.0.0**, whatsapp-bot **v1.0.0**
> **Stack:** Node.js (ESM) + Express + SQLite (better-sqlite3) · React 18 + Vite 5 + TailwindCSS 3 · FFmpeg + FFprobe · hls.js

> **Single Source of Truth.** This document is the authoritative reference for the Media Vault system. It was verified against the actual codebase on **2026-07-18** (package manifests, `server.js`, `db.js`, `monitor/*`, `routes/*`, `config/paths.js`, and deployment files). Where a fact could not be confirmed it is marked as a **note** rather than asserted. Application logic versions are the package versions above — there is **no** application version "2.4.0"; that string was a documentation artifact in prior revisions.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [System Architecture](#3-system-architecture)
4. [Project Structure / Directory Layout](#4-project-structure--directory-layout)
5. [Backend — Server Lifecycle](#5-backend--server-lifecycle)
6. [Backend — Database](#6-backend--database)
7. [Backend — API Endpoints](#7-backend--api-endpoints)
8. [Backend — Subsystems](#8-backend--subsystems)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Flow Diagrams](#10-flow-diagrams)
11. [Configuration & Paths](#11-configuration--paths)
12. [Environment Variables](#12-environment-variables)
13. [Background Jobs / Scheduler](#13-background-jobs--scheduler)
14. [Performance, Memory, Disk, Concurrency](#14-performance-memory-disk-concurrency)
15. [Security & Production](#15-security--production)
16. [Deployment](#16-deployment)
17. [Error Handling & Failure Modes](#17-error-handling--failure-modes)
18. [Monitoring Dashboard Detail](#18-monitoring-dashboard-detail)
19. [Future Extensions / Roadmap](#19-future-extensions--roadmap)
20. [Development Notes](#20-development-notes)
21. [Debug / Operations Commands](#21-debug--operations-commands)
22. [Codebase Metrics](#22-codebase-metrics)
23. [Appendix: Version History](#23-appendix-version-history)

---

## 1. Project Overview

**Media Vault** is a self-hosted media server with comprehensive capabilities:

|  Capability          |  Status                   |  Description                                                                                  |
|--------------------|-------------------------|---------------------------------------------------------------------------------------------|
|  Media browser       |  Active                   |  File browsing, streaming, download via web interface                                         |
|  Library management  |  Active                   |  Auto scan, incremental FTS search, thumbnail generation                                      |
|  Playlists           |  Active                   |  XSPF import, CRUD, drag-reorder, audio queue, folder-based                                   |
|  Metadata editing    |  Active                   |  Audio tag read/write, MusicBrainz cover art, LRCLIB lyrics, synced LRC                       |
|  Playback            |  Active                   |  HTML5 video (range/HLS/transcode), HTML5 audio with waveform & lyrics                        |
|  Monitoring          |  Active                   |  Real-time CPU/RAM/GPU/Disk/Network via WebSocket + SSE fallback                              |
|  Downloader          |  Active                   |  yt-dlp/gallery-dl/aria2c — YouTube, TikTok, Instagram, Twitter, torrent                      |
|  ADB transfer        |  Active                   |  Push/pull files to Android via ADB with concurrent workers                                   |
|  WhatsApp bridge     |  **Integrated / Active**  |  `whatsapp-bot/` code is loaded by `server.js` via `initWhatsApp()` and `routes/whatsapp.js`  |
|  Telegram send       |  Optional                 |  Active only when `TELEGRAM_BOT_TOKEN` is configured                                          |

> **Note:** The WhatsApp integration is **embedded**, not a separate standalone process. `server.js` starts it 10 s after listen (up to 5 retries with backoff), and `routes/whatsapp.js` (which imports from `../../../whatsapp-bot/src/`) exposes `/api/whatsapp/*` REST endpoints plus an SSE log stream at `/api/whatsapp/logs/stream`. The `whatsapp-bot/` package can also run standalone (`npm start`), but in the documented deployment it is loaded by the backend.

---

## 2. Tech Stack & Dependencies

The repository is **not** a monorepo: there are no workspaces and no root scripts. `backend/`, `frontend/`, and `whatsapp-bot/` are three independent npm packages. The backend and frontend are **ESM** (`"type": "module"`); the root `package.json` is **CommonJS** (`"type": "commonjs"`) and only carries a minimal shared dependency set.

### 2.1 Backend — `backend/package.json`

- name: `homelab-media-server` · version: `1.0.0` · type: `module` (ESM)
- No `engines` field is declared (no pinned Node version).
- No `devDependencies`.
- Scripts:
  - `start`: `node --env-file-if-exists=.env src/server.js`
  - `dev`: `node --env-file-if-exists=.env --expose-gc --watch src/server.js`
  - `debug`: `node --env-file-if-exists=.env --inspect --expose-gc src/server.js`

|  Dependency             |  Version  |  Role                              |
|-----------------------|---------|----------------------------------|
|  better-sqlite3         |  ^12.9.0  |  Synchronous SQLite driver (WAL)   |
|  busboy                 |  ^1.6.0   |  Multipart upload parsing          |
|  compression            |  ^1.8.1   |  HTTP response gzip/deflate        |
|  cors                   |  ^2.8.5   |  CORS middleware                   |
|  dockerode              |  ^5.0.0   |  Docker container monitoring       |
|  express                |  ^4.21.0  |  HTTP framework                    |
|  fast-xml-parser        |  ^5.8.0   |  XSPF playlist parsing             |
|  mime-types             |  ^2.1.35  |  Content-type resolution           |
|  mpd2                   |  ^1.0.7   |  MPD/Strawberry player control     |
|  node-pty               |  ^1.1.0   |  Pseudo-terminal for scrcpy/shell  |
|  node-telegram-bot-api  |  ^1.1.0   |  Telegram bot client               |
|  qrcode                 |  ^1.5.4   |  QR generation (pairing / share)   |
|  uuid                   |  ^10.0.0  |  Job / transaction IDs             |
|  ws                     |  ^8.21.0  |  WebSocket server (`/ws/monitor`)  |

### 2.2 Frontend — `frontend/package.json`

- name: `homelab-media-frontend` · version: `1.0.0` · type: `module`

|  Dependency                    |  Version   |  Role                                                                |
|------------------------------|----------|--------------------------------------------------------------------|
|  framer-motion                 |  ^12.40.0  |  Animation primitives                                                |
|  hls.js                        |  ^1.5.17   |  Adaptive HLS video playback                                         |
|  lucide-react                  |  ^1.16.0   |  Icon set                                                            |
|  qrcode                        |  ^1.5.4    |  QR generation (share / pairing)                                     |
|  react                         |  ^18.3.1   |  UI framework                                                        |
|  react-dom                     |  ^18.3.1   |  DOM renderer                                                        |
|  react-intersection-observer   |  ^9.16.0   |  Scroll / lazy reveal                                                |
|  react-router-dom              |  ^7.15.1   |  Monitoring dashboard sub-routing (`MemoryRouter`/`Routes`/`Route`)  |
|  react-virtualized-auto-sizer  |  ^1.0.26   |  Virtual list sizing                                                 |
|  react-window                  |  ^1.8.11   |  Virtualized media grid                                              |
|  recharts                      |  ^3.8.1    |  Monitoring charts/gauges                                            |
|  source-map-js                 |  ^1.2.1    |  Source map handling (debug)                                         |
|  zustand                       |  ^5.0.13   |  State management (5 stores)                                       |

|  devDependency              |  Version   |  Role                   |
|---------------------------|----------|-----------------------|
|  @vitejs/plugin-react       |  ^4.3.2    |  React plugin for Vite  |
|  autoprefixer               |  ^10.4.20  |  CSS vendor prefixes    |
|  eslint-plugin-react-hooks  |  ^7.1.1    |  Lint hooks rules       |
|  postcss                    |  ^8.4.47   |  CSS pipeline           |
|  tailwindcss                |  ^3.4.13   |  Utility CSS            |
|  vite                       |  ^5.4.8    |  Dev server / bundler   |

- Scripts: `dev`: `vite --host 0.0.0.0` · `build`: `vite build` · `preview`: `vite preview --host 0.0.0.0`

### 2.3 Root — `package.json`

- type: `commonjs` · **no workspaces, no scripts**.
- Bare dependencies: `music-metadata ^11.13.0`, `ws ^8.21.0` (shared helpers).

### 2.4 WhatsApp bot — `whatsapp-bot/package.json`

- name: `whatsapp-bot` · version: `1.0.0` · type: `module`
- Scripts: `start`: `node src/index.js` · `dev`: `node --watch src/index.js`
- Dependencies: `whatsapp-web.js ^1.34.7`, `better-sqlite3 ^12.9.0`, `qrcode-terminal ^0.12.0`
- Source layout (`whatsapp-bot/src/`): `index.js`, `connection.js`, `listener.js`, `sender.js`, `db.js`, `utils.js`. (Uses `whatsapp-web.js`, **not** baileys.)

---

## 3. System Architecture

### 3.1 High-Level Component Diagram

| Component | Protocol | Port | Description |
|-----------|----------|------|-------------|
| Browser (React SPA) | HTTP / WebSocket / SSE | :3001 | Served static via Express |
| Backend | HTTP / WebSocket | :3001 | Express server routing to: |
|   |   |   | - `server.js` → `routes/*` → `utils/*` → `db.js` (SQLite) |
|   |   |   | - `fileScanner.js` — Incremental scan, mtime comparison |
|   |   |   | - `thumbnailQueue.js` — Concurrency-limited thumbnail generation |
|   |   |   | - `watcher.js` — fs.watch debounce → SSE broadcast |
|   |   |   | - `playbackEngine.js` — Remux/transcode/HLS, LRU cache |
|   |   |   | - `hlsGenerator.js` — FFmpeg HLS segment pipeline |
|   |   |   | - `downloader/manager.js` — yt-dlp/gallery-dl/aria2c |
|   |   |   | - `monitor/engine.js` — Poll loop (3000ms), collect→aggregate→WS |
|   |   |   | - `monitor/collectors/*` — cpu, memory, gpu, disk, network, system |
| Data Layer | — | — | |
|   |   |   | - `data/media.db` — SQLite (WAL, 80MB cache), FTS5 index |
|   |   |   | - `cache/` — playback/remux/, playback/transcode/, hls/, downloader/ |

### 3.2 External Dependencies

|  Binary      |  Used By                                                  |  Purpose                                       |
|------------|---------------------------------------------------------|----------------------------------------------|
|  ffmpeg      |  thumbnailUtils, stream.js, playbackEngine, hlsGenerator  |  Thumbnail, HLS, transcode, remux              |
|  ffprobe     |  fileScanner.js, metadataWriter.js, uploadManager.js      |  Codec probe, metadata extraction              |
|  yt-dlp      |  downloader/manager.js                                    |  Video/audio download (YouTube, Instagram)     |
|  gallery-dl  |  downloader/manager.js                                    |  TikTok, Twitter/X, Instagram image galleries  |
|  aria2c      |  downloader/manager.js                                    |  Torrent / parallel download                   |
|  adb         |  adbManager.js, adbTransaction.js                         |  Android file transfer                         |
|  nvidia-smi  |  monitor/collectors/gpu.js                                |  GPU metrics (cached 3s)                       |
|  smartctl    |  monitor/collectors/disk.js                               |  SMART health (cached 60s)                     |
|  journalctl  |  monitor/logs.js                                          |  Systemd journal                               |
|  systemctl   |  monitor/services.js                                      |  Service management                            |
|  python3     |  embed_cover.py, romaji_convert.py, pyjlyric_search.py    |  Helper scripts spawned by JS utils            |

> **Note:** The three Python helpers (`backend/src/utils/embed_cover.py`, `backend/src/utils/romaji_convert.py`, `backend/src/utils/pyjlyric_search.py`) are **spawned** as child processes by the JS utils, never imported.

---

## 4. Project Structure / Directory Layout

### 4.1 Root Level

| Directory | Description |
|-----------|-------------|
| `.env.example` | Environment variable template |
| `package.json` | Root package (CommonJS, shared deps only) |
| `package-lock.json` | Lockfile |

### 4.2 backend/

| Directory/File | Description |
|----------------|-------------|
| `src/server.js` | Entry point — Express, lifecycle, shutdown |
| `src/db.js` | Schema, prepared statements, FTS, settings |
| `src/config/paths.js` | Path resolution, SETTINGS constants |
| `src/routes/` | **19 route modules** — see §7 |
| `src/middleware/` | `serviceGuard.js` — requireService() guards |
| `src/services/` | `registry.js` — service health registry |
| `src/downloader/` | `manager.js` — yt-dlp/gallery-dl/aria2c wrapper |
| `src/monitor/` | Engine, collectors, historical metrics |
| `src/utils/` | **41 files** (38 .js + 3 .py) — see note below |
| `package.json` | Backend package |

**backend/src/routes/** (19 modules): `adb.js`, `downloader.js`, `file.js`, `files.js`, `jobs.js`, `metadata.js`, `monitoring.js`, `mpd.js`, `playback.js`, `scrcpy.js`, `send.js`, `services.js`, `settings.js`, `stream.js`, `thumbnails.js`, `upload.js`, `videoCache.js`, `whatsapp.js`

**backend/src/monitor/collectors/**: `cpu.js`, `memory.js`, `gpu.js`, `disk.js`, `network.js`, `system.js`

**backend/src/utils/** (41 files): `adbManager.js`, `adbMetadata.js`, `adbTransaction.js`, `adbWorkerPool.js`, `avSync.js`, `coverSources.js`, `embed_cover.py`, `fileResolver.js`, `fileScanner.js`, `genius.js`, `hlsGenerator.js`, `jobQueue.js`, `lyricsSources.js`, `logCapture.js`, `logger.js`, `lrclib.js`, `lrcParser.js`, `lrcmux.js`, `maintenance.js`, `metadataWriter.js`, `musicbrainz.js`, `netease.js`, `playbackEngine.js`, `playlistScanner.js`, `pyjlyric.js`, `pyjlyric_search.py`, `romaji.js`, `romaji_convert.py`, `runtimeSettings.js`, `sendCounter.js`, `sendRateLimit.js`, `sessionTracker.js`, `telegramBot.js`, `thumbnailQueue.js`, `thumbnailUtils.js`, `uploadManager.js`, `videoCache.js`, `watcher.js`, `xspfParser.js`, `youtube.js`, `ytdlp.js`

**Forked workers**: `fts-rebuild-worker.mjs`, `sensors-worker.mjs`

### 4.3 frontend/

| Directory/File | Description |
|----------------|-------------|
| `src/App.jsx` | Central orchestrator (hash routing, ErrorBoundary) |
| `src/main.jsx` | React entry point |
| `src/index.css` | Tailwind imports + global styles |
| `src/components/` | **54 component files** + `icons/` (6 icons) |
| `src/debug/` | Debug tools (22 files) |
| `src/hooks/` | **7 custom hooks** |
| `src/monitoring/` | Dashboard components (28 files) |
| `src/store/` | **5 zustand stores** |
| `src/utils/` | **11 utility files** |
| `package.json` | Frontend package |

**frontend/src/components/**: `AdbTransfer.jsx`, `AddMusicPanel.jsx`, `AudioPlayer.jsx.backup2`, `CachedVideoPlayer.jsx`, `CaptionEditorModal.jsx`, `Carousel.jsx`, `ConfirmModal.jsx`, `CoverArtSearch.jsx`, `CropTool.jsx`, `DuplicateConfirmModal.jsx`, `ErrorBoundary.jsx`, `FilterPanel.jsx`, `GaugeMeter.jsx`, `GroupDivider.jsx`, `HeaderComponents.jsx`, `ImageViewer.jsx`, `LyricsDisplay.jsx`, `LyricsEditor.jsx`, `LyricsScrollController.js`, `MediaControls.jsx`, `MediaControls.css`, `MediaGrid.jsx`, `MediaGrid.css`, `MediaLayout.jsx`, `MediaModal.jsx`, `MetadataEditor.jsx`, `MiniPlayer.jsx`, `MonitoringView.jsx`, `Music.jsx`, `NetworkImage.jsx`, `PlaylistGrid.jsx`, `PlaylistGridCard.jsx`, `PlaylistListItemRow.jsx`, `PlaylistListRow.jsx`, `PlaylistRow.jsx`, `PlaylistView.jsx`, `PlaylistView.css`, `QueueActionBar.jsx`, `QueuePanel.jsx`, `ScrcpyView.jsx`, `SendProgressPills.jsx`, `SendQueuePlayer.jsx`, `SendQueueView.jsx`, `SendQueueView.jsx.orig`, `ServiceStoppedBanner.jsx`, `SpeakerOutputButton.jsx`, `Toast.jsx`, `UploadsMonitor.jsx`, `VaultActionBar.jsx`, `VaultAudioPlayer.jsx`, `VaultBottomCluster.jsx`, `VideoPlayer.jsx`, `VideoPlayer.css`, `WhatsAppView.jsx`

**frontend/src/components/icons/**: `AudioIcon.jsx`, `FolderIcon.jsx`, `ImageIcon.jsx`, `TelegramLogo.jsx`, `VideoIcon.jsx`, `WaLogo.jsx`

**frontend/src/debug/**: DebugBadge.jsx, DebugOverlay.jsx, DebugProvider.jsx, DebugTooltip.jsx, index.js, inspectors/ (9 files), useDebugStore.js, useDebugTrack.js, utils/ (6 files)

**frontend/src/hooks/**: `useDocumentHidden.js`, `useSendProgress.js`, `useServiceControl.js`, `useUploadQueueLogic.jsx`, `useVaultMediaActions.js`, `useWaUnsupported.js`, `useWebSocket.js`

**frontend/src/monitoring/**: components/ (Charts/MetricChart.jsx, LogTerminal.jsx), layout/ (3 files), pages/ (24 files), shared/ (5 files), stores/monitoringStore.js, widgets/ (7 files)

**frontend/src/store/**: `favoritesStore.js`, `folderMetaSortStore.js`, `folderSortStore.js`, `playbackStore.js`, `playlistStore.js`

**frontend/src/utils/**: `adbApi.js`, `api.js`, `audioOutput.js`, `codec.js`, `filenameSearch.js`, `format.js`, `grouping.js`, `lrcParser.js`, `playlistApi.js`, `playlistWindow.js`, `thumbCache.js`

### 4.4 whatsapp-bot/

| Directory/File | Description |
|----------------|-------------|
| `src/index.js` | Entry point |
| `src/connection.js` | whatsapp-web.js client |
| `src/listener.js` | Message handler |
| `src/sender.js` | Outbound sender |
| `src/db.js` | SQLite state |
| `src/utils.js` | Logger / helpers |
| `config.js` | WhatsApp configuration |
| `sessions/` | `media_state.json` — Media state persistence |
| `logs/` | WhatsApp logs |
| `media/` | `processed/`, `raw/` — Media storage |
| `test-status.mjs` | Status check script |

### 4.5 Data Directories

| Directory | Description |
|-------------|-------------|
| `data/` | **Persistent runtime data** — `media.db` (SQLite WAL), `alerts.json`, `.last-scan-time`, `max-uptime.json`, `thumbnails/` |
| `backend/data/` | **Downloader-specific data** — `download-tasks.json`, `download-counter.json`, `downloaded-archive.json`, `downloader-config.json`, `download-cache.json`, `thumbnails/`, `uploads/` |

### 4.6 Ephemeral & Log Directories

| Directory | Description |
|-------------|-------------|
| `cache/` | **Ephemeral cache** — `downloader/`, `hls/`, `metadata/`, `playback/` (lru.json, remux/, transcode/), `temp/`, `videos/` |
| `logs/` | **Rotating logs** — `api/`, `backend/`, `downloader/`, `hls/`, `maintenance/`, `monitoring/`, `playback/`, `stream/`, `system/`, `upload/` |

### 4.7 Configuration & Deployment

| Directory | Description |
|-------------|-------------|
| `Docker/` | `docker-compose.yml`, `nginx-nvidia/nginx.conf`, `waha-data/webjs/`, `litellm-config.yaml` (orphaned), `README.md` |
| `credentials/` | **Gitignored** — `.env`, `.wwebjs_auth/`, `.wwebjs_cache/`, `cookies.txt`, `cookies.txt.bak.*`, `docs-debug/`, `gtw.txt`, `README.md` |
| `certs/` | Certificate generation (`README.md`) |
| `docs/` | Documentation — `archive/ideas/IDEAS.md` |

### 4.8 Notes

- `backend/src/utils/` contains **41 files**: 38 `.js` modules + 3 spawned `.py` helpers (`embed_cover.py`, `romaji_convert.py`, `pyjlyric_search.py`). The `.py` files are spawned as child processes, not imported.
- `registry.js` lives in `backend/src/services/`, **not** `utils/`.
- The two `*.mjs` files at `backend/src/` root (`fts-rebuild-worker.mjs`, `sensors-worker.mjs`) are forked child workers.

---

## 5. Backend — Server Lifecycle

**File:** `backend/src/server.js`

### 5.1 Middleware Order

`server.js` installs, in order: `cors` → `compression({ threshold: 1024 })` → `express.json` → `sessionMiddleware` (`utils/sessionTracker.js`) → inline request tracker (`monitor/webStats.js`).

### 5.2 Startup Sequence

`PORT = process.env.PORT || 3001`, binds `0.0.0.0`. On `EADDRINUSE` the port increments up to 5 retries (3002–3006).

|  Time    |  Action                                                                                                                                 |
|--------|---------------------------------------------------------------------------------------------------------------------------------------|
|  t=0ms   |  `validateStartup()` — SQLite, writable dirs (`cacheRoot`/`logsRoot`/`thumbnails`) as **critical**; `ffmpeg`/`ffprobe` as **warnings**  |
|  t=0ms   |  Express middleware — cors, compression, json, session, webStats                                                                        |
|  t=0ms   |  Mount **19** route modules + static frontend                                                                                           |
|  t=0ms   |  `createServer` → `listen(3001)` — up to 5 retries on `EADDRINUSE`                                                                      |
|  t=0ms   |  `registerAllServices()` — service registry                                                                                             |
|  t=0ms   |  `startWebSocketServer(server)` — WS on port 3001                                                                                       |
|  t=0ms   |  `startEngine(server)` — monitor engine (**3000ms poll**)                                                                               |
|  t=0ms   |  `startWatcher()` — `fs.watch` on `MEDIA_ROOT`                                                                                          |
|  t=0ms   |  `startMaintenanceScheduler()` — cleanup intervals                                                                                      |
|  t=0.5s  |  `initHistoricalTable()` — time-series schema                                                                                           |
|  t=1s    |  `deferredDbInit()` — seed 100+ settings, migrations, indexes                                                                           |
|  t=1.5s  |  `startMonitoringCache()` — background sensor reads (forked)                                                                            |
|  t=2s    |  `setupFTS()` — FTS5 rebuild via forked worker                                                                                          |
|  t=5s    |  `scanPlaylists()` — discover `.xspf` files                                                                                             |
|  t=10s   |  `initWhatsApp()` — WhatsApp bridge (up to 5 retries, backoff)                                                                          |
|  t=20s   |  `runIncrementalScan()` — initial scan (conditional; skips if DB fresh)                                                                 |

### 5.3 Shutdown Sequence

Graceful shutdown on `SIGINT`/`SIGTERM`/`SIGQUIT` via `handleShutdown`:

|  Step  |  Action                                                   |
|------|---------------------------------------------------------|
|  1     |  Stop watcher (`stopWatcher()`)                           |
|  2     |  Stop maintenance scheduler                               |
|  3     |  Stop monitor engine (`stopEngine()`)                     |
|  4     |  Stop WebSocket server                                    |
|  5     |  Reject new playback jobs (`playback.requestShutdown()`)  |
|  6     |  Drain active jobs (`waitForDrain()`, 30s timeout)        |
|  7     |  Persist playback LRU cache                               |
|  8     |  `server.close()` — allow in-flight to complete           |
|  9     |  Force exit after 15s if not already exited               |

### 5.4 Startup Lifecycle Diagram

| Phase | Time | Action | Description |
|-------|------|--------|-------------|
| 1 | t=0ms | `validateStartup()` | SQLite connectivity check (critical), writable directories (`cacheRoot`/`logsRoot`/`thumbnails`) check (critical), `ffmpeg`/`ffprobe` PATH check (warning) |
| 1 | t=0ms | Express middleware | `cors` → `compression` → `express.json` → `sessionMiddleware` → request tracker |
| 1 | t=0ms | Route mounting | Mount **19** route modules + static frontend |
| 1 | t=0ms | Server listen | `createServer` → `listen(3001)` (up to 5 retries on EADDRINUSE) |
| 1 | t=0ms | Service registry | `registerAllServices()` — service health registry |
| 1 | t=0ms | WebSocket | `startWebSocketServer(server)` — WS on port 3001 |
| 1 | t=0ms | Monitor engine | `startEngine(server)` — monitor engine (3000ms poll) |
| 1 | t=0ms | File watcher | `startWatcher()` — `fs.watch` on `MEDIA_ROOT` |
| 1 | t=0ms | Maintenance | `startMaintenanceScheduler()` — cleanup intervals |
| 2 | t=0.5s | Historical table | `initHistoricalTable()` — time-series schema |
| 2 | t=1s | DB init | `deferredDbInit()` — seed 100+ settings, migrations, indexes |
| 2 | t=1.5s | Monitoring cache | `startMonitoringCache()` — background sensor reads (forked) |
| 2 | t=2s | FTS setup | `setupFTS()` — FTS5 rebuild via forked worker |
| 3 | t=5s | Playlist scan | `scanPlaylists()` — discover `.xspf` files |
| 3 | t=10s | WhatsApp init | `initWhatsApp()` — WhatsApp bridge (up to 5 retries with backoff) |
| 3 | t=20s | Initial scan | `runIncrementalScan()` — walk `MEDIA_ROOT` if stale (< 24h with engine stats skipped) |

---

## 6. Backend — Database

**File:** `backend/src/db.js`

### 6.1 PRAGMA Configuration

|  Setting       |  Value       |  Purpose                         |
|--------------|------------|--------------------------------|
|  journal_mode  |  WAL         |  Concurrent reads during writes  |
|  cache_size    |  -80000      |  ~80MB page cache                |
|  mmap_size     |  4294967296  |  4GB memory-mapped I/O           |
|  page_size     |  32768       |  32KB pages for sequential I/O   |
|  synchronous   |  NORMAL      |  Balance safety/performance      |
|  temp_store    |  MEMORY      |  Temp data in memory             |

### 6.2 Core Tables

SQLite database schema is defined in `backend/src/db.js`. The schema includes:

**`folders` table**: Hierarchical folder structure with `id`, `path`, `parent_id`, `depth`, `file_count`, `total_size`, `last_scanned`, `last_updated`.

**`files` table**: Media file metadata with `id` (MD5 hash), `dir_id`, `name`, `type`, `ext`, `size`, `mtime`, `duration`, `has_thumb`, `thumb_cache_path`, `access_count`, `codec_info`, `is_stream_compatible`, `youtube_id`, `video_offset`, and metadata fields (title, artist, album, genre, lyrics, etc.).

**`files_fts` table**: Virtual FTS5 table for full-text search on file names with `unicode61 remove_diacritics` tokenizer. Rebuilt via the forked `src/fts-rebuild-worker.mjs`.

#### 6.2.1 FTS5 setup

`setupFTS()` forks `fts-rebuild-worker.mjs` (120s timeout); on failure it falls back to `deltaSyncFTS()`, which recreates the virtual table + triggers and reconciles missing/orphan rowids without wiping the index. 

## 7. Backend — API Endpoints

Reconstructed from the route handlers in `backend/src/routes/`. Every router is mounted in `server.js` under the prefix shown. Tables are grouped by subsystem. **This is a representative subset of the routes actually defined in code, not an exhaustive list.**

### 7.1 Files & Search (`/api/files`, `/api/search`)

|  Method  |  Path                        |  Handler                          |  Purpose                                                                               |
|--------|----------------------------|---------------------------------|--------------------------------------------------------------------------------------|
|  GET     |  `/api/files`                |  `router.get('/')`                |  Browse a folder with cursor pagination + multi-field sorting + lazy thumbnail pregen  |
|  GET     |  `/api/files/shuffle`        |  `router.get('/shuffle')`         |  Return all playable (video/audio) files in random order                               |
|  POST    |  `/api/files/refresh`        |  `router.post('/refresh')`        |  Run incremental scan + orphan cleanup                                                 |
|  POST    |  `/api/files/cleanup`        |  `router.post('/cleanup')`        |  Remove orphan DB entries                                                              |
|  GET     |  `/api/files/stats`          |  `router.get('/stats')`           |  Quick file-type counts                                                                |
|  GET     |  `/api/files/folders/:id`    |  `router.get('/folders/:id')`     |  Resolve folder id to path metadata                                                    |
|  GET     |  `/api/files/:id/previews`   |  `router.get('/:id/previews')`    |  Up to 4 preview file IDs for a folder                                                 |
|  GET     |  `/api/search`               |  `router.get('/search')`          |  FTS file search + LIKE folder search with scope/type/sort                             |
|  GET     |  `/api/search/suggest`       |  `router.get('/search/suggest')`  |  Autocomplete name suggestions                                                         |
|  PATCH   |  `/api/files/:id/favorite`   |  `router.patch('/:id/favorite')`  |  Toggle favorite flag                                                                  |
|  GET     |  `/api/files/:id`            |  `router.get('/:id')`             |  Single file record by id                                                              |
|  POST    |  `/api/files/resolve-batch`  |  `router.post('/resolve-batch')`  |  Batch map filenames → file ids                                                        |

### 7.2 Streaming & Playback (`/stream`)

|  Method  |  Path                                              |  Handler                                                   |  Purpose                                                     |
|--------|--------------------------------------------------|----------------------------------------------------------|------------------------------------------------------------|
|  GET     |  `/stream/video/:id/playback-info`                 |  `router.get('/video/:id/playback-info')`                  |  Report `getPlaybackDecision()` result + mobile/UA flags     |
|  GET     |  `/stream/video/:id`                               |  `router.get('/video/:id')`                                |  Stream video via direct/remux/transcode with range support  |
|  GET     |  `/stream/audio/:id`                               |  `router.get('/audio/:id')`                                |  Stream audio file with ranges                               |
|  GET     |  `/stream/video/:id/hls/playlist.m3u8`             |  `router.get('/video/:id/hls/playlist.m3u8')`              |  HLS playlist (rejects Opus audio)                           |
|  GET     |  `/stream/video/:id/hls/segment-:segment(\d+).ts`  |  `router.get('/video/:id/hls/segment-:segment(\\d+).ts')`  |  Serve a single HLS segment                                  |
|  GET     |  `/stream/video/:id/compatibility`                 |  `router.get('/video/:id/compatibility')`                  |  Compatibility/notes report (Firefox >2GB, etc.)             |
|  GET     |  `/stream/video/:id/webm`                          |  `router.get('/video/:id/webm')`                           |  VP9/WebM transcode for Firefox/large files                  |
|  GET     |  `/stream/video/:id/faststart`                     |  `router.get('/video/:id/faststart')`                      |  Re-mux with `+faststart` to fix moov atom                   |

### 7.3 Monitoring (`/api/monitoring`)

|  Method  |  Path                                         |  Handler                                      |  Purpose                                         |
|--------|---------------------------------------------|---------------------------------------------|------------------------------------------------|
|  GET     |  `/api/monitoring/media`                      |  `router.get('/media')`                       |  Media/file/DB/thumb/upload stats                |
|  POST    |  `/api/monitoring/media/thumbnails/generate`  |  `router.post('/media/thumbnails/generate')`  |  Trigger missing-thumbnail scan                  |
|  GET     |  `/api/monitoring/stats`                      |  `router.get('/stats')`                       |  Current system stats snapshot                   |
|  GET     |  `/api/monitoring/overview`                   |  `router.get('/overview')`                    |  Combined overview (web/docker/services/alerts)  |
|  GET     |  `/api/monitoring/history`                    |  `router.get('/history')`                     |  Aggregated historical metrics                   |
|  GET     |  `/api/monitoring/disk-io/daily`              |  `router.get('/disk-io/daily')`               |  Daily disk I/O summary                          |
|  GET     |  `/api/monitoring/disk-io/total`              |  `router.get('/disk-io/total')`               |  Total cumulative disk I/O                       |
|  GET     |  `/api/monitoring/metrics/stats`              |  `router.get('/metrics/stats')`               |  Metrics table stats                             |
|  POST    |  `/api/monitoring/metrics/cleanup`            |  `router.post('/metrics/cleanup')`            |  Delete old metrics rows                         |
|  POST    |  `/api/monitoring/metrics/optimize`           |  `router.post('/metrics/optimize')`           |  Optimize metrics table                          |
|  GET     |  `/api/monitoring/ws-status`                  |  `router.get('/ws-status')`                   |  WebSocket client count                          |
|  POST    |  `/api/monitoring/network/iperf/start`        |  `router.post('/network/iperf/start')`        |  Start iperf3 client benchmark                   |
|  GET     |  `/api/monitoring/network/iperf/stream/:id`   |  `router.get('/network/iperf/stream/:id')`    |  SSE stream of iperf3 output                     |
|  GET     |  `/api/monitoring/platform`                   |  `router.get('/platform')`                    |  Detected platform info                          |
|  GET     |  `/api/monitoring/processes`                  |  `router.get('/processes')`                   |  Top processes by cpu/mem                        |
|  GET     |  `/api/monitoring/services`                   |  `router.get('/services')`                    |  systemd-style service list                      |
|  POST    |  `/api/monitoring/services/:name/:action`     |  `router.post('/services/:name/:action')`     |  Start/stop/restart a service                    |
|  GET     |  `/api/monitoring/logs`                       |  `router.get('/logs')`                        |  Journald-style log entries                      |
|  GET     |  `/api/monitoring/alerts`                     |  `router.get('/alerts')`                      |  Alert history + thresholds                      |
|  POST    |  `/api/monitoring/alerts/threshold`           |  `router.post('/alerts/threshold')`           |  Set an alert threshold                          |
|  POST    |  `/api/monitoring/alerts/check`               |  `router.post('/alerts/check')`               |  Force alert evaluation                          |
|  GET     |  `/api/monitoring/web-stats`                  |  `router.get('/web-stats')`                   |  Web server stats                                |
|  GET     |  `/api/monitoring/docker`                     |  `router.get('/docker')`                      |  Docker container list + stats                   |
|  POST    |  `/api/monitoring/docker/:id/:action`         |  `router.post('/docker/:id/:action')`         |  Start/stop container                            |
|  GET     |  `/api/monitoring/docker/:id/logs`            |  `router.get('/docker/:id/logs')`             |  Container logs                                  |
|  GET     |  `/api/monitoring/docker/:id/inspect`         |  `router.get('/docker/:id/inspect')`          |  Container inspect JSON                          |
|  GET     |  `/api/monitoring/docker-images`              |  `router.get('/docker-images')`               |  List docker images                              |
|  GET     |  `/api/monitoring/docker-info`                |  `router.get('/docker-info')`                 |  Docker daemon info                              |
|  POST    |  `/api/monitoring/system/power`               |  `router.post('/system/power')`               |  shutdown/reboot host                            |
|  POST    |  `/api/monitoring/restart/backend`            |  `router.post('/restart/backend')`            |  SIGTERM backend                                 |
|  POST    |  `/api/monitoring/restart/frontend`           |  `router.post('/restart/frontend')`           |  Rebuild frontend                                |
|  GET     |  `/api/monitoring/queues`                     |  `router.get('/queues')`                      |  Thumbnail + scan queue status                   |
|  POST    |  `/api/monitoring/queues/:type/:action`       |  `router.post('/queues/:type/:action')`       |  Pause/resume/stop/clear queues                  |
|  GET     |  `/api/monitoring/sessions`                   |  `router.get('/sessions')`                    |  Active viewer sessions                          |
|  GET     |  `/api/monitoring/sessions/stream`            |  `router.get('/sessions/stream')`             |  SSE stream of sessions                          |
|  DELETE  |  `/api/monitoring/sessions/:id`               |  `router.delete('/sessions/:id')`             |  Disconnect a session                            |
|  GET     |  `/api/monitoring/hardware`                   |  `router.get('/hardware')`                    |  Sensors/fan/battery/disk (cached)               |
|  GET     |  `/api/monitoring/cpu-freq`                   |  `router.get('/cpu-freq')`                    |  Current CPU frequency                           |
|  POST    |  `/api/monitoring/cpu-freq`                   |  `router.post('/cpu-freq')`                   |  Set max CPU frequency                           |
|  POST    |  `/api/monitoring/hardware/fan`               |  `router.post('/hardware/fan')`               |  Set fan speed (auto/0-100)                      |

### 7.4 Downloader (`/api/download`)

|  Method  |  Path                          |  Handler                         |  Purpose                               |
|--------|------------------------------|--------------------------------|--------------------------------------|
|  GET     |  `/api/download/stream`        |  `router.get('/stream')`         |  SSE stream of task list (1s)          |
|  GET     |  `/api/download/config`        |  `router.get('/config')`         |  Current max concurrent                |
|  POST    |  `/api/download/config`        |  `router.post('/config')`        |  Set max concurrent (1-10)             |
|  POST    |  `/api/download/start`         |  `router.post('/start')`         |  Create single download task           |
|  POST    |  `/api/download/bulk`          |  `router.post('/bulk')`          |  Create many tasks (multi-line/array)  |
|  POST    |  `/api/download/formats`       |  `router.post('/formats')`       |  List YouTube formats                  |
|  POST    |  `/api/download/twitter-info`  |  `router.post('/twitter-info')`  |  Resolve Twitter media info            |
|  GET     |  `/api/download/list`          |  `router.get('/list')`           |  All tasks                             |
|  GET     |  `/api/download/:id`           |  `router.get('/:id')`            |  Single task                           |
|  POST    |  `/api/download/:id/cancel`    |  `router.post('/:id/cancel')`    |  Cancel task                           |
|  POST    |  `/api/download/:id/remove`    |  `router.post('/:id/remove')`    |  Remove task                           |
|  POST    |  `/api/download/:id/retry`     |  `router.post('/:id/retry')`     |  Retry failed task                     |

### 7.5 Playlists (`/api/playlists`)

|  Method  |  Path                                   |  Handler                                  |  Purpose                             |
|--------|---------------------------------------|-----------------------------------------|------------------------------------|
|  GET     |  `/api/playlists`                       |  `router.get('/')`                        |  All discovered playlists            |
|  GET     |  `/api/playlists/:id`                   |  `router.get('/:id')`                     |  Playlist details + resolved tracks  |
|  GET     |  `/api/playlists/:id/play`              |  `router.get('/:id/play')`                |  Playback-ready queue                |
|  POST    |  `/api/playlists/scan`                  |  `router.post('/scan')`                   |  Scan media roots for XSPF           |
|  POST    |  `/api/playlists/:id/refresh`           |  `router.post('/:id/refresh')`            |  Re-parse a playlist                 |
|  DELETE  |  `/api/playlists/:id`                   |  `router.delete('/:id')`                  |  Soft (or permanent) delete          |
|  POST    |  `/api/playlists/create/manual`         |  `router.post('/create/manual')`          |  Manual playlist from file ids       |
|  POST    |  `/api/playlists/create/empty`          |  `router.post('/create/empty')`           |  Empty titled playlist               |
|  POST    |  `/api/playlists/:id/tracks`            |  `router.post('/:id/tracks')`             |  Add tracks (dedup by path)          |
|  DELETE  |  `/api/playlists/:id/tracks/:trackId`   |  `router.delete('/:id/tracks/:trackId')`  |  Remove a track + renumber           |
|  POST    |  `/api/playlists/:id/tracks/delete`     |  `router.post('/:id/tracks/delete')`      |  Bulk delete tracks                  |
|  GET     |  `/api/playlists/:id/available-tracks`  |  `router.get('/:id/available-tracks')`    |  Search Music/ audio for adding      |
|  POST    |  `/api/playlists/create/folder`         |  `router.post('/create/folder')`          |  Playlist from folder scan           |
|  POST    |  `/api/playlists/import`                |  `router.post('/import')`                 |  Import uploaded XSPF (busboy)       |

### 7.6 Metadata (`/api/metadata`)

|  Method  |  Path                              |  Handler                            |  Purpose                          |
|--------|----------------------------------|-----------------------------------|---------------------------------|
|  GET     |  `/api/metadata/cover-art/search`  |  `router.get('/cover-art/search')`  |  Search cover art (multi-source)  |
|  GET     |  `/api/metadata/lyrics/search`     |  `router.get('/lyrics/search')`     |  Search lyrics (multi-source)     |
|  GET     |  `/api/metadata/:id`               |  `router.get('/:id')`               |  Read embedded + DB metadata      |
|  PUT     |  `/api/metadata/:id`               |  `router.put('/:id')`               |  Update tags (DB + file)          |
|  PUT     |  `/api/metadata/:id/cover`         |  `router.put('/:id/cover')`         |  Embed cover from URL/base64      |
|  PUT     |  `/api/metadata/:id/cover/upload`  |  `router.put('/:id/cover/upload')`  |  Embed cover via multipart        |
|  GET     |  `/api/metadata/:id/lyrics`        |  `router.get('/:id/lyrics')`        |  Get plain/synced/romaji lyrics   |
|  PUT     |  `/api/metadata/:id/lyrics`        |  `router.put('/:id/lyrics')`        |  Save lyrics (+ export `.lrc`)    |

### 7.7 Services (`/api/services`)

|  Method  |  Path                           |  Handler                          |  Purpose                          |
|--------|-------------------------------|---------------------------------|---------------------------------|
|  GET     |  `/api/services`                |  `router.get('/')`                |  All registered service statuses  |
|  GET     |  `/api/services/:name`          |  `router.get('/:name')`           |  Single service status            |
|  POST    |  `/api/services/:name/start`    |  `router.post('/:name/start')`    |  Start a service                  |
|  POST    |  `/api/services/:name/stop`     |  `router.post('/:name/stop')`     |  Stop a service                   |
|  POST    |  `/api/services/:name/restart`  |  `router.post('/:name/restart')`  |  Restart a service                |
|  POST    |  `/api/services/restart-all`    |  `router.post('/restart-all')`    |  Restart every service            |

### 7.8 ADB Transfer (`/api/adb`)

|  Method  |  Path                                 |  Handler                                     |  Purpose                         |
|--------|-------------------------------------|--------------------------------------------|--------------------------------|
|  GET     |  `/api/adb/devices`                   |  `router.get('/devices')`                    |  List connected ADB devices      |
|  POST    |  `/api/adb/ls`                        |  `router.post('/ls')`                        |  List device directory           |
|  POST    |  `/api/adb/stat`                      |  `router.post('/stat')`                      |  Stat device path                |
|  POST    |  `/api/adb/localls`                   |  `router.post('/localls')`                   |  List local directory            |
|  POST    |  `/api/adb/localstat`                 |  `router.post('/localstat')`                 |  Stat local path                 |
|  POST    |  `/api/adb/check-duplicates`          |  `router.post('/check-duplicates')`          |  Detect duplicate dest files     |
|  POST    |  `/api/adb/push`                      |  `router.post('/push')`                      |  Push files to device (workers)  |
|  POST    |  `/api/adb/pull`                      |  `router.post('/pull')`                      |  Pull files from device          |
|  GET     |  `/api/adb/jobs`                      |  `router.get('/jobs')`                       |  All transfer jobs               |
|  GET     |  `/api/adb/jobs/:id`                  |  `router.get('/jobs/:id')`                   |  Single job                      |
|  GET     |  `/api/adb/jobs/:id/progress`         |  `router.get('/jobs/:id/progress')`          |  SSE progress subscription       |
|  DELETE  |  `/api/adb/jobs/:id`                  |  `router.delete('/jobs/:id')`                |  Cancel job                      |
|  POST    |  `/api/adb/jobs/:id/pause`            |  `router.post('/jobs/:id/pause')`            |  Pause job                       |
|  POST    |  `/api/adb/jobs/:id/resume`           |  `router.post('/jobs/:id/resume')`           |  Resume job                      |
|  POST    |  `/api/adb/jobs/:id/reassign-device`  |  `router.post('/jobs/:id/reassign-device')`  |  Move job to another device      |
|  POST    |  `/api/adb/jobs/:id/retry-failed`     |  `router.post('/jobs/:id/retry-failed')`     |  Retry failed transactions       |
|  GET     |  `/api/adb/jobs/:id/transactions`     |  `router.get('/jobs/:id/transactions')`      |  Job transaction list            |
|  POST    |  `/api/adb/jobs/:id/conflict`         |  `router.post('/jobs/:id/conflict')`         |  Resolve a transfer conflict     |

### 7.9 Upload (`/api/upload`)

|  Method  |  Path                            |  Handler                             |  Purpose                                       |
|--------|--------------------------------|------------------------------------|----------------------------------------------|
|  POST    |  `/api/upload`                   |  `router.post('/')`                  |  Multipart upload (gated by `upload.enabled`)  |
|  GET     |  `/api/upload/status`            |  `router.get('/status')`             |  Active uploads + stats                        |
|  GET     |  `/api/upload/history`           |  `router.get('/history')`            |  Past uploads                                  |
|  DELETE  |  `/api/upload/:id`               |  `router.delete('/:id')`             |  Cancel active upload                          |
|  DELETE  |  `/api/upload/:id/file`          |  `router.delete('/:id/file')`        |  Delete file from disk + DB                    |
|  GET     |  `/api/upload/stats`             |  `router.get('/stats')`              |  Aggregate upload stats                        |
|  POST    |  `/api/upload/repair-metadata`   |  `router.post('/repair-metadata')`   |  Re-extract embedded timestamps                |
|  POST    |  `/api/upload/repair-durations`  |  `router.post('/repair-durations')`  |  Re-extract media durations                    |

### 7.10 Settings (`/api/settings`)

|  Method  |  Path                          |  Handler                         |  Purpose                              |
|--------|------------------------------|--------------------------------|-------------------------------------|
|  GET     |  `/api/settings`               |  `router.get('/')`               |  All settings grouped by category     |
|  GET     |  `/api/settings/history`       |  `router.get('/history')`        |  Setting change history               |
|  POST    |  `/api/settings/rollback/:id`  |  `router.post('/rollback/:id')`  |  Restore a prior value                |
|  GET     |  `/api/settings/:category`     |  `router.get('/:category')`      |  Settings in one category             |
|  PUT     |  `/api/settings/:key`          |  `router.put('/:key')`           |  Update a setting (history + reload)  |
|  POST    |  `/api/settings`               |  `router.post('/')`              |  Create/replace a setting             |
|  DELETE  |  `/api/settings/:key`          |  `router.delete('/:key')`        |  Delete a setting                     |

### 7.11 Jobs (`/api/monitoring/jobs`)

|  Method  |  Path                    |  Handler            |  Purpose                                |
|--------|------------------------|-------------------|---------------------------------------|
|  GET     |  `/api/monitoring/jobs`  |  `router.get('/')`  |  Engine poll interval + watcher status  |

### 7.12 Playback (`/api/playback`)

|  Method  |  Path                     |  Handler                    |  Purpose                                              |
|--------|-------------------------|---------------------------|-----------------------------------------------------|
|  GET     |  `/api/playback/stats`    |  `router.get('/stats')`     |  Cache hit-rate, remux/transcode counts, percentiles  |
|  GET     |  `/api/playback/config`   |  `router.get('/config')`    |  Cache dirs, limits, probe timeout                    |
|  GET     |  `/api/playback/health`   |  `router.get('/health')`    |  Probe ffmpeg/ffprobe/sqlite/disk + status            |
|  POST    |  `/api/playback/cleanup`  |  `router.post('/cleanup')`  |  Evict old/oversized cache entries                    |

### 7.13 MPD / Strawberry (`/api/strawberry`)

|  Method  |  Path                                      |  Handler                                   |  Purpose                    |
|--------|------------------------------------------|------------------------------------------|---------------------------|
|  GET     |  `/api/strawberry/player/status`           |  `router.get('/player/status')`            |  MPD status + current song  |
|  POST    |  `/api/strawberry/player/play`             |  `router.post('/player/play')`             |  Play                       |
|  POST    |  `/api/strawberry/player/pause`            |  `router.post('/player/pause')`            |  Pause                      |
|  POST    |  `/api/strawberry/player/playPause`        |  `router.post('/player/playPause')`        |  Toggle play/pause          |
|  POST    |  `/api/strawberry/player/stop`             |  `router.post('/player/stop')`             |  Stop                       |
|  POST    |  `/api/strawberry/player/next`             |  `router.post('/player/next')`             |  Next track                 |
|  POST    |  `/api/strawberry/player/previous`         |  `router.post('/player/previous')`         |  Previous track             |
|  POST    |  `/api/strawberry/player/seek`             |  `router.post('/player/seek')`             |  Seek relative              |
|  POST    |  `/api/strawberry/player/position`         |  `router.post('/player/position')`         |  Seek absolute              |
|  POST    |  `/api/strawberry/player/volume`           |  `router.post('/player/volume')`           |  Set volume 0-100           |
|  POST    |  `/api/strawberry/player/shuffle`          |  `router.post('/player/shuffle')`          |  Toggle random              |
|  POST    |  `/api/strawberry/player/loop`             |  `router.post('/player/loop')`             |  Set loop off/one/all       |
|  GET     |  `/api/strawberry/playlists`               |  `router.get('/playlists')`                |  List MPD playlists         |
|  POST    |  `/api/strawberry/playlists/activate`      |  `router.post('/playlists/activate')`      |  Load + play a playlist     |
|  POST    |  `/api/strawberry/playlists/create`        |  `router.post('/playlists/create')`        |  Save current queue         |
|  POST    |  `/api/strawberry/playlists/rename`        |  `router.post('/playlists/rename')`        |  Rename playlist            |
|  POST    |  `/api/strawberry/playlists/delete`        |  `router.post('/playlists/delete')`        |  Delete playlist            |
|  GET     |  `/api/strawberry/playlists/:name/tracks`  |  `router.get('/playlists/:name/tracks')`   |  Tracks in a playlist       |
|  POST    |  `/api/strawberry/playlists/:name/add`     |  `router.post('/playlists/:name/add')`     |  Add URI to playlist        |
|  POST    |  `/api/strawberry/playlists/:name/remove`  |  `router.post('/playlists/:name/remove')`  |  Remove pos from playlist   |
|  GET     |  `/api/strawberry/queue`                   |  `router.get('/queue')`                    |  Current queue              |
|  POST    |  `/api/strawberry/queue/add`               |  `router.post('/queue/add')`               |  Add URI to queue           |
|  POST    |  `/api/strawberry/queue/remove`            |  `router.post('/queue/remove')`            |  Remove pos                 |
|  POST    |  `/api/strawberry/queue/move`              |  `router.post('/queue/move')`              |  Move pos                   |
|  POST    |  `/api/strawberry/queue/clear`             |  `router.post('/queue/clear')`             |  Clear queue                |
|  POST    |  `/api/strawberry/queue/shuffle`           |  `router.post('/queue/shuffle')`           |  Shuffle queue              |
|  GET     |  `/api/strawberry/library/browse`          |  `router.get('/library/browse')`           |  Browse MPD library path    |
|  GET     |  `/api/strawberry/library/search`          |  `router.get('/library/search')`           |  Search library             |
|  GET     |  `/api/strawberry/library/songs`           |  `router.get('/library/songs')`            |  Filtered song list         |
|  GET     |  `/api/strawberry/library/all`             |  `router.get('/library/all')`              |  All songs                  |
|  POST    |  `/api/strawberry/library/update`          |  `router.post('/library/update')`          |  Rescan MPD library         |
|  GET     |  `/api/strawberry/library/artists`         |  `router.get('/library/artists')`          |  Artist list                |
|  GET     |  `/api/strawberry/library/albums`          |  `router.get('/library/albums')`           |  Album list                 |
|  GET     |  `/api/strawberry/library/genres`          |  `router.get('/library/genres')`           |  Genre list                 |
|  GET     |  `/api/strawberry/library/years`           |  `router.get('/library/years')`            |  Year list                  |
|  GET     |  `/api/strawberry/cover`                   |  `router.get('/cover')`                    |  Embedded cover art bytes   |

### 7.14 WhatsApp (`/api/whatsapp`)

|  Method  |  Path                           |  Handler                                    |  Purpose                           |
|--------|-------------------------------|-------------------------------------------|----------------------------------|
|  GET     |  `/api/whatsapp/status`         |  `app.get('/api/whatsapp/status')`          |  Connection + counters             |
|  GET     |  `/api/whatsapp/qr`             |  `app.get('/api/whatsapp/qr')`              |  Pairing QR payload                |
|  GET     |  `/api/whatsapp/qr-image`       |  `app.get('/api/whatsapp/qr-image')`        |  Rendered QR PNG                   |
|  POST    |  `/api/whatsapp/start`          |  `app.post('/api/whatsapp/start')`          |  Connect bot + listener            |
|  POST    |  `/api/whatsapp/stop`           |  `app.post('/api/whatsapp/stop')`           |  Disconnect bot                    |
|  POST    |  `/api/whatsapp/restart`        |  `app.post('/api/whatsapp/restart')`        |  Reset + reconnect                 |
|  GET     |  `/api/whatsapp/logs`           |  `app.get('/api/whatsapp/logs')`            |  Recent log buffer                 |
|  GET     |  `/api/whatsapp/logs/stream`    |  `app.get('/api/whatsapp/logs/stream')`     |  SSE log stream                    |
|  GET     |  `/api/whatsapp/stats`          |  `app.get('/api/whatsapp/stats')`           |  Upload/history counters           |
|  PUT     |  `/api/whatsapp/counter`        |  `app.put('/api/whatsapp/counter')`         |  Set counter value                 |
|  POST    |  `/api/whatsapp/counter/reset`  |  `app.post('/api/whatsapp/counter/reset')`  |  Reset counter (send dot)          |
|  GET     |  `/api/whatsapp/config`         |  `app.get('/api/whatsapp/config')`          |  target/keywords/hashtags          |
|  PUT     |  `/api/whatsapp/config`         |  `app.put('/api/whatsapp/config')`          |  Update config (restart to apply)  |

### 7.15 Send / Video-cache

|  Method  |  Path                                    |  Handler                                |  Purpose                                |
|--------|----------------------------------------|---------------------------------------|---------------------------------------|
|  POST    |  `/api/send/telegram`                    |  `router.post('/telegram')`             |  Send file to Telegram + dot separator  |
|  POST    |  `/api/send/all`                         |  `router.post('/all')`                  |  Send to Telegram + WA channel/status   |
|  GET     |  `/api/send/telegram/status`             |  `router.get('/telegram/status')`       |  Bot readiness                          |
|  POST    |  `/api/video-cache/search`               |  `router.post('/search')`               |  Search video by query                  |
|  POST    |  `/api/video-cache/auto-detect/:id`      |  `router.post('/auto-detect/:id')`      |  Suggest match from file title          |
|  POST    |  `/api/video-cache/save-id/:id`          |  `router.post('/save-id/:id')`          |  Store matched youtube id               |
|  POST    |  `/api/video-cache/download/:youtubeId`  |  `router.post('/download/:youtubeId')`  |  Background download                    |
|  GET     |  `/api/video-cache/progress/:youtubeId`  |  `router.get('/progress/:youtubeId')`   |  Download progress                      |
|  GET     |  `/api/video-cache/stream/:youtubeId`    |  `router.get('/stream/:youtubeId')`     |  Range-stream cached video              |
|  GET     |  `/api/video-cache/status`               |  `router.get('/status')`                |  Cache info                             |
|  POST    |  `/api/video-cache/clear`                |  `router.post('/clear')`                |  Clear cache                            |

### 7.16 Debug / Misc

|  Method  |  Path                          |  Handler                          |  Purpose                                       |
|--------|------------------------------|---------------------------------|----------------------------------------------|
|  GET     |  `/file/:id`                   |  `router.get('/:id')`             |  Serve raw file with ranges (immutable cache)  |
|  GET     |  `/thumbnails/:id.jpg`         |  `router.get('/:id.jpg')`         |  Serve or generate file thumbnail              |
|  GET     |  `/thumbnails/folder/:id.jpg`  |  `router.get('/folder/:id.jpg')`  |  Serve or generate folder preview              |

---

## 8. Backend — Subsystems

### 8.1 Playback Engine

#### 8.1.1 Playback decision (code)

`getPlaybackDecision()` probes the file (cached codec_info or live ffprobe), then walks a small decision tree: browser container + H.264/HEVC + no Opus → `direct`; browser container + Opus → `remux` (copy to MKV); otherwise → `transcode` to H.264/AAC. The cache key is an MD5 of `filePath:size:mtime`.

#### 8.1.2 FFmpeg concurrency limiter

FFmpeg processes are limited to 2 concurrent to prevent OOM. Tasks queue and execute in order.

#### 8.1.3 HLS (code)

`spawnFfmpeg()` wraps `ffmpeg` in a promise; HLS generation uses `-f hls -hls_time 3` with segment filenames, and falls back to a `+faststart` remux when the moov atom is missing.

#### 8.1.4 File Scanner & Thumbnails

##### 8.1.4.1 Scanner (code)

`computeContentHash()` samples the first and last 64 KB plus the file size to build a fast content fingerprint without reading the whole file. The incremental sync dedups on `size`+`mtime` first, and only re-checks the content hash when `scan.compareByHash` is enabled.

##### 8.1.4.2 Watcher (code)

`startWatcher()` uses `fs.watch` (recursive) per media root and routes changes through `debouncedRescan()`, which waits 2 s after the last event (and skips a 30 s startup grace) before running `incrementalSync()` and broadcasting an SSE `folder_updated` event.

##### 8.1.4.3 Thumbnails (code)

`extractFrameThumbnail()` seeks to 1 s and pulls one frame, scaled to width 200 via `scale=200:-1` using ffmpeg (no `sharp` dependency). `hasEmbeddedCover()`/`extractEmbeddedThumbnail()` detect and copy an embedded picture stream (`attached_pic`/mjpeg/png) instead of sampling a random frame.

### 8.2 Downloader (`downloader/manager.js`)

Supported sources (`SOURCE_ROUTES`): youtube, tiktok, twitter, instagram, torrent. Tools: yt-dlp, gallery-dl, aria2c, ffmpeg/ffprobe.

|  Source     |  Tool               |  Output Path                                                          |
|-----------|-------------------|----------------------------------------------------------------------|
|  YouTube    |  yt-dlp             |  /home/CATIAA/Videos/YouTube                                         |
|  TikTok     |  gallery-dl         |  /home/CATIAA/Videos/TikTok, /home/CATIAA/Pictures/TikTok            |
|  Twitter/X  |  gallery-dl         |  /home/CATIAA/Videos/Twitter, /home/CATIAA/Pictures/Twitter          |
|  Instagram  |  yt-dlp/gallery-dl  |  /home/CATIAA/Videos/Instander, /home/CATIAA/Pictures/Instander    |
|  Torrent    |  aria2c             |  /home/CATIAA/homelab                                                |

Instagram pipeline: 1 concurrent + 12s delay, SHA256 dedup, VP9/AV1 → H.264/AAC transcode, staging under `/home/CATIAA/homelab/DUMMY`.

### 8.3 ADB Transfer

Job lifecycle: `adbManager.push(device, sources, dest, { maxWorkers: 3, conflictStrategy })` → transactions progress `pending → running → [done|error|cancelled]`.

ADB database tables (`adb_jobs`, `adb_transactions`). Transaction states: PENDING, CONFLICT_CHECK, CONFLICT, TRANSFERRING, VERIFYING, DONE, CANCELLED, FAILED, SKIPPED. Conflict resolution: skip / overwrite / rename / cancel / applyAll.

**Concurrency-limited worker pool**: `AdbWorkerPool.processJob` spins up `min(maxWorkers, pending.length)` workers and a `_prepAhead` look-ahead that pre-stats remote dirs and resolves conflicts before transfer begins.

**Checksum / size verification after push**: Each file is re-stated on-device and compared to the expected size (and, post-metadata, mtime). A size mismatch throws and the transaction is retried (up to `max_attempts`).

**`push()` job creation**: Builds the job record carrying `maxWorkers` and `conflictStrategy` (`skip` | `overwrite` | `ask`), persists it, and enqueues on the per-device queue.

### 8.4 Upload (`utils/uploadManager.js`, `routes/upload.js`)

Busboy multipart upload. State: `MEDIA_ROOTS`, `activeUploads` Map, `uploadIdCounter`, `UPLOAD_TEMP`. Runtime settings: `upload.maxSizeGB` (100), `upload.concurrent` (4), `upload.duplicateStrategy` (rename), `upload.autoScan` (true), `upload.verifyIntegrity` (true), `upload.autoThumbnail` (true). `sanitizeFilename()` removes `..`, `/`, `\`, `\0`, max 255 chars.

### 8.5 MPD / Strawberry (`routes/mpd.js`)

Controls Strawberry MPD player via `mpd2` on `localhost:6600`. Player, playlist, and queue endpoints. Loop-mode mapping: `one` = repeat 1 + single 1; `all` = repeat 1 + single 0; `off` = repeat 0 + single 0.

### 8.6 Monitoring (`monitor/*`)

Engine poll interval is **3000ms** (`pollIntervalMs = 3000` in `engine.js`); WebSocket broadcast throttle **3000ms** (`BROADCAST_THROTTLE_MS`); historical snapshot every **30s**. The dashboard *setting* `monitor.refreshInterval` defaults to **1000ms** and is the **frontend polling fallback** interval — it does **not** change the backend engine poll. Backend uses a forked `monitor/monitoringCache.js` → `src/sensors-worker.mjs` for sensor reads; GPU collection is skippable via `MONITOR_DISABLE_GPU`.

**Alerts — `checkAlerts()` thresholds + 60 s dedupe**: CPU/RAM/disk/temp/gpuTemp each emit `warning`/`critical` events; identical type+severity is suppressed for 60 s.

### 8.7 WhatsApp / Send (`routes/whatsapp.js`, `routes/send.js`, `whatsapp-bot/`)

WhatsApp bridge is loaded by `server.js` via `initWhatsApp()` (10s after listen, up to 5 retries backoff). `routes/whatsapp.js` imports from `../../../whatsapp-bot/src/` and exposes `/api/whatsapp/*` plus SSE `/api/whatsapp/logs/stream`. Telegram send (`routes/send.js`) is optional — active only if `TELEGRAM_BOT_TOKEN` is set.

**Telegram guard — `TELEGRAM_BOT_TOKEN`**: The bot is only constructed when the token env var is set; otherwise `getBot()` returns `null` and every send throws `"TELEGRAM_BOT_TOKEN not configured"`.

**WhatsApp connection**: Uses `whatsapp-web.js` (LocalAuth + headless puppeteer), registers the `qr`/`ready`/`disconnected`/`auth_failure`/`message` handlers, and auto-reconnects with exponential backoff capped at 5 min.

**Keyword / hashtag trigger**: The listener fires only when a video is quoted (or sent) together with a configured keyword (e.g. `save`) or hashtag (e.g. `#upload`).

### 8.8 Video Cache (`routes/videoCache.js`)

Mounted at `/api/video-cache`. Provides video cache bookkeeping (the `videoCache.js` util tracks cached video segments/derivatives). Consult the live endpoints for the exact surface.

### 8.9 Metadata (`utils/metadataWriter.js`, `musicbrainz.js`, `lrclib.js`)

**Cover-art embedding**: Per-format `ffmpeg`/`python3` command strings. FLAC uses the spawned `embed_cover.py`; MP3/OGG/Opus/M4A/WebM use `ffmpeg` with appropriate disposition/container flags, writing to a `.tmp` then atomic-rename.

**MusicBrainz / Cover Art Archive**: `getCoverArt` hits the Cover Art Archive for a release MBID; `searchCoverArt` tries a recording search first, then falls back to artist+album, then artist-only.

**LRCLIB lyrics**: `getLyrics` does an exact track/artist/duration lookup (5 s `AbortController` timeout); `searchLyricsByMetadata` falls back to a free-text search.

---

## 9. Frontend Architecture

```javascript
// backend/src/utils/fileScanner.js — mtime/size/hash dedup loop (incrementalSync)
if (existing && existing.size === entry.size && existing.mtime === entry.mtime) {
  const useHashCheck = get('scan.compareByHash', false);
  if (useHashCheck && existing.checksum) {
    const currentHash = entry._currentHash;
    if (currentHash && currentHash === existing.checksum) {
      skipped++;
      existingIds.delete(entry.id);
      continue;
    }
  } else {
    skipped++;
    existingIds.delete(entry.id);
    continue;
  }
}
```

> **Apa kerjanya:** Melewati file yang ukuran dan mtime-nya sama dengan DB; kalau `compareByHash` aktif, baru cek hash konten.
> **Dampak:** Scan inkremental sangat cepat karena file tak berubah langsung dilewati (skip).
> **Alternatif serupa:** Selalu hitung hash penuh, tapi itu memakan I/O untuk file yang jarang berubah.
> **Kalau tidak pakai ini:** Tiap scan membandingkan ulang semua file sehingga lambat dan membebani disk.

#### 8.2.2 Watcher (code)

`startWatcher()` uses `fs.watch` (recursive) per media root and routes changes through `debouncedRescan()`, which waits 2 s after the last event (and skips a 30 s startup grace) before running `incrementalSync()` and broadcasting an SSE `folder_updated` event.

```javascript
// backend/src/utils/watcher.js
async function broadcastFolderUpdate(folderPath) {
  const msg = `data: ${JSON.stringify({
    type: 'folder_updated',
    path: folderPath || '',
    timestamp: Date.now()
  })}

`;
  sseClients = sseClients.filter((res) => {
    try { res.write(msg); return true; } catch { return false; }
  });
}

function debouncedRescan(folderPath) {
  if (Date.now() - watcherStartTime < STARTUP_GRACE_MS) return;
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(async () => {
    if (isScanning) { pendingRescan = true; return; }
    isScanning = true;
    try {
      await incrementalSync();
      if (folderPath) await broadcastFolderUpdate(folderPath);
    } finally {
      isScanning = false;
      if (pendingRescan) { pendingRescan = false; debouncedRescan(); }
    }
  }, 2000);
}

function startWatcher() {
  if (watcherRunning) return;
  watcherRunning = true;
  watcherStartTime = Date.now();
  for (const root of MEDIA_ROOTS) {
    try {
      const w = watch(root, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.startsWith('.')) {
          debouncedRescan();
        }
      });
      w.on('error', (err) => { /* log */ });
      watchers.push(w);
    } catch (err) { /* log */ }
  }
  periodicInterval = setInterval(async () => { await runIncrementalScan(); }, 15 * 60 * 1000);
  setTimeout(() => runIncrementalScan().catch(() => {}), 6 * 60 * 1000);
}
```

> **Apa kerjanya:** Memantau perubahan direktori via `fs.watch` lalu menunda 2 detik sebelum scan inkremental + kirim event SSE ke klien.
> **Dampak:** UI otomatis terrefresh saat file baru masuk, tanpa poll terus-menerus.
> **Alternatif serupa:** `chokidar` lebih portabel lintas OS, tapi `fs.watch` rekursif sudah cukup di Linux.
> **Kalau tidak pakai ini:** Pengguna harus refresh manual untuk melihat file baru.

#### 8.2.3 Thumbnails (code)

`extractFrameThumbnail()` seeks to 1 s and pulls one frame, scaled to width 200 via `scale=200:-1` using ffmpeg (no `sharp` dependency). `hasEmbeddedCover()`/`extractEmbeddedThumbnail()` detect and copy an embedded picture stream (`attached_pic`/mjpeg/png) instead of sampling a random frame.

```javascript
// backend/src/utils/thumbnailUtils.js
export async function extractFrameThumbnail(inputPath, outputPath, quality = 12) {
  return new Promise((resolve) => {
    const baseArgs = VAAPI_DEVICE
      ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE]
      : ['-skip_frame', 'nokey'];

    const args = [
      ...baseArgs,
      '-ss', '1.0',
      '-i', inputPath,
      '-vframes', '1',
      '-vf', 'scale=200:-1:flags=fast_bilinear',
      '-f', 'image2',
      '-c:v', 'mjpeg',
      '-q:v', String(quality),
      '-y',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', (code) => {
      if (code === 0) resolve(true);
      else if (VAAPI_DEVICE) { /* fallback software */ }
      else resolve(false);
    });
    proc.on('error', () => resolve(false));
  });
}

export async function hasEmbeddedCover(inputPath) {
  // ffprobe for a video stream with disposition.attached_pic === 1 or codec mjpeg/png
}

export async function extractEmbeddedThumbnail(inputPath, outputPath) {
  return new Promise((resolve) => {
    const args = ['-i', inputPath, '-map', '0:v:0', '-c', 'copy', '-frames:v', '1', '-y', outputPath];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
```

> **Apa kerjanya:** Menyalin satu frame video yang merupakan cover art tersemat (`attached_pic`/mjpeg/png) keluar sebagai file gambar via `-c copy -frames:v 1`.
> **Dampak:** Musik/video dengan cover art internal langsung punya thumbnail tanpa ekstraksi frame acak; lebih relevan secara visual.
> **Alternatif serupa:** Bisa pakai `music-metadata` untuk baca cover, tapi ffmpeg sudah menangani audio+video secara seragam; trade-off: ffmpeg cukup.
> **Kalau tidak pakai ini:** File dengan cover art tersemat akan tetap diambil frame acaknya, kurang estetis.

### 8.3 Downloader (`downloader/manager.js`)

Supported sources (`SOURCE_ROUTES`): youtube, tiktok, twitter, instagram, torrent. Tools: yt-dlp, gallery-dl, aria2c, ffmpeg/ffprobe.

|  Source     |  Tool               |  Output Path                                                     |
|-----------|-------------------|----------------------------------------------------------------|
|  YouTube    |  yt-dlp             |  /home/CATIAA/Videos/YouTube                                     |
|  TikTok     |  gallery-dl         |  /home/CATIAA/Videos/TikTok, /home/CATIAA/Pictures/TikTok        |
|  Twitter/X  |  gallery-dl         |  /home/CATIAA/Videos/Twitter, /home/CATIAA/Pictures/Twitter      |
|  Instagram  |  yt-dlp/gallery-dl  |  /home/CATIAA/Videos/Instander, /home/CATIAA/Pictures/Instander  |
|  Torrent    |  aria2c             |  /home/CATIAA/homelab                                            |

Instagram pipeline: 1 concurrent + 12s delay, SHA256 dedup, VP9/AV1 → H.264/AAC transcode, staging under `/home/CATIAA/homelab/DUMMY`.

#### 8.3.1 Downloader code (verbatim)

Excerpts from `backend/src/downloader/manager.js`.

**`SOURCE_ROUTES` + `QUALITY_MAP`** (`manager.js:20-72`). Maps each source to its output directories and allowed quality list; output dirs are `mkdirSync`-ed at load.

```javascript
// backend/src/downloader/manager.js:20
const SOURCE_ROUTES = {
  youtube: { label: 'YouTube', video: '/home/CATIAA/Videos/YouTube', audio: '/home/CATIAA/homelab/Music/YouTube' },
  tiktok: { label: 'TikTok', video: '/home/CATIAA/Videos/TikTok', image: '/home/CATIAA/Pictures/TikTok' },
  twitter: { label: 'Twitter', video: '/home/CATIAA/Videos/Twitter', image: '/home/CATIAA/Pictures/Twitter' },
  instagram: { label: 'Instagram', video: '/home/CATIAA/Videos/Instander', image: '/home/CATIAA/Pictures/Instander' },
  torrent: { label: 'Torrent', any: '/home/CATIAA/homelab' },
};

// backend/src/downloader/manager.js:66
const QUALITY_MAP = {
  youtube: ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p', 'audio'],
  tiktok: ['best', 'audio'],
  instagram: ['best', 'audio'],
  twitter: ['best', 'audio'],
  torrent: ['standard'],
};
```

> **Apa kerjanya:** Mendefinisikan pemetaan tiap sumber (youtube, tiktok, twitter, instagram, torrent) ke direktori output video/audio/gambar, serta daftar kualitas yang diizinkan per sumber; direktori output dibuat saat modul dimuat lewat `mkdirSync`.
> **Dampak:** Menjamin hasil unduhan tersimpan di lokasi konsisten dan terpisah per platform; validasi kategori/kualitas di `createTask` bergantung penuh pada map ini.
> **Alternatif serupa:** Bisa membaca pemetaan dari env/JSON; trade-off: map hardcoded lebih sederhana dan cukup untuk sumber yang tetap.
> **Kalau tidak pakai ini:** Path output tidak terdefinisi dan validasi kategori/kualitas gagal, sehingga task unduhan tidak bisa dibuat.

**`spawnYtdlp`** (`manager.js:1511-1549`). Builds the yt-dlp argument vector — `--concurrent-fragments 4`, format selectors per category (Instagram forces an H.264/AVC MP4 merge), audio extraction, and the output template.

```javascript
// backend/src/downloader/manager.js:1511
function spawnYtdlp(task) {
  const args = ['--newline', '--no-warnings', '--no-playlist', '--concurrent-fragments', '4'];
  const downloadDir = task.category === 'instagram' ? createDownloadWorkDir(task.outputDir, task) : task.outputDir;

  if (task.category === 'instagram') {
    task._downloadDir = downloadDir;
    task._requireExactPath = true;
    args.push('--no-mtime');
    args.push('--print', 'before_dl:__IG_USERNAME__%(channel)s');
    args.push('--print', 'after_move:__DOWNLOADED_FILE__%(filepath)s');
  }

  if (task.twitterCookiesPath) {
    args.push('--cookies', task.twitterCookiesPath);
  }

  if (task.formatId) {
    args.push('-f', task.formatId);
    args.push('--merge-output-format', 'mp4');
    args.push('-S', 'lang:original');
  } else if (task.audioExtract) {
    const bitrate = AUDIO_BITRATE_MAP[task.audioBitrate] || '0';
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
    args.push('-S', 'lang:original');
    args.push('--extract-audio', '--audio-format', task.audioFormat, '--audio-quality', bitrate);
  } else if (task.quality === 'audio') {
    args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
    args.push('-S', 'lang:original');
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (task.category === 'instagram') {
    args.push('-f', INSTAGRAM_FORMAT_SELECTOR);
    args.push('--merge-output-format', 'mp4');
    addLog(task, `Instagram format policy: ${INSTAGRAM_FORMAT_SELECTOR}`);
  } else {
    const srcPref = SOURCE_FORMAT_PREFERENCE[task.category];
    args.push('-f', srcPref || FORMAT_MAP[task.quality] || 'bestvideo[height<=2160]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]');
    args.push('--merge-output-format', 'mp4');
    args.push('-S', 'lang:original');
  }
  // ... -o outputTemplate, task.url, then spawn('yt-dlp', args, ...)
```

> **Apa kerjanya:** Menyusun vektor argumen `yt-dlp` berdasarkan kategori task — jumlah fragment konkuren, pemilihan format (Instagram memaksa merge MP4 H.264/AVC), ekstraksi audio, template output, dan cookies Twitter.
> **Dampak:** Menentukan kualitas, kompatibilitas browser, dan lokasi file akhir; Instagram selalu diarahkan ke format MP4 agar bisa diputar langsung di klien.
> **Alternatif serupa:** Bisa pakai pembungkus seperti `ytdl-core`; trade-off: memanggil binary langsung lebih fleksibel dan mengikuti rilis `yt-dlp` terbaru.
> **Kalau tidak pakai ini:** Unduhan tidak bisa dijalankan karena argumen tak terbentuk, atau menghasilkan format tidak kompatibel dengan player.

**Instagram VP9/AV1 → H.264/AAC transcode** (`manager.js:503-531`). Re-encodes non-browser-compatible Instagram video at `crf 18` / `preset medium` so it plays directly in the browser.

```javascript
// backend/src/downloader/manager.js:503
function transcodeInstagramVideoToH264(task, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const outputDir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const outputPath = path.join(outputDir, `${base}.h264.mp4`);
  if (fs.existsSync(outputPath)) return outputPath;

  addLog(task, `Transcoding ${path.basename(filePath)} to H.264/AAC MP4 (avoid VP9/AV1)`);
  const args = [
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];
  const result = spawnSync('ffmpeg', args, { encoding: 'utf-8', timeout: 0 });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const stderr = (result.stderr || '').slice(-500).trim();
    throw new Error(`H.264 transcode failed${stderr ? `: ${stderr}` : ''}`);
  }
  return outputPath;
}
```

> **Apa kerjanya:** Mengonversi ulang video Instagram yang tidak kompatibel (VP9/AV1) ke H.264/AAC MP4 via `ffmpeg` dengan `crf 18`/`preset medium`, lalu memeriksa keberadaan file hasil sebelum mengembalikannya.
> **Dampak:** Menjamin semua video Instagram bisa diputar langsung di browser tanpa kegagalan playback. Seperti dicatat pada catatan overkill, transcode ini berat/lambat, namun layak karena Instagram adalah jalur ingest utama dan menghindari playback error di klien.
> **Alternatif serupa:** Bisa melewatkan transcode bila sumber sudah `avc1`/`h264` lewat `probeVideoFile` + `isInstagramVideoCodecCompatible`; trade-off: lebih cepat tapi risiko gagal di sebagian browser.
> **Kalau tidak pakai ini:** Video VP9/AV1 tidak dapat diputar di banyak browser, menghasilkan playback error pada media Instagram.

**Instagram 1-concurrent + 12 s rate limit** (`manager.js:16-18`, `manager.js:1160-1186`). The queue scheduler serializes Instagram tasks and inserts a 12 s gap between them to stay under Instagram's rate limits.

```javascript
// backend/src/downloader/manager.js:16
const INSTAGRAM_CONCURRENT = 1;
const INSTAGRAM_DELAY_MS = 12000;
let lastInstagramTaskAt = 0;

// backend/src/downloader/manager.js:1167
    if (task.category === 'instagram') {
      const igRunning = Array.from(tasks.values()).filter(
        t => t.status === 'downloading' && t.category === 'instagram'
      ).length;
      if (igRunning >= INSTAGRAM_CONCURRENT) continue;

      const elapsed = Date.now() - lastInstagramTaskAt;
      if (lastInstagramTaskAt > 0 && elapsed < INSTAGRAM_DELAY_MS) {
        const wait = INSTAGRAM_DELAY_MS - elapsed;
        addLog(task, `Instagram rate limit: waiting ${(wait / 1000).toFixed(1)}s`);
        task.statusText = `Rate limit: waiting ${(wait / 1000).toFixed(1)}s...`;
        savePersistentTasks();
        setTimeout(() => processQueue(), wait + 200);
        continue;
      }
    }
```

> **Apa kerjanya:** Membatasi antrean Instagram ke 1 konkuren dan menyisipkan jeda minimal 12 detik antar task lewat `INSTAGRAM_CONCURRENT`/`INSTAGRAM_DELAY_MS` di `processQueue`.
> **Dampak:** Menghindari rate-limit/pemblokiran dari Instagram dengan tidak memicu terlalu banyak unduhan bersamaan.
> **Alternatif serupa:** Bisa pakai token bucket atau library rate-limiter; trade-off: counter + `setTimeout` sederhana tanpa dependensi sudah cukup.
> **Kalau tidak pakai ini:** Instagram dapat membatasi atau memblokir akun karena terlalu banyak request bersamaan dalam waktu singkat.

### 8.4 ADB Transfer (`utils/adbManager.js`, `adbTransaction.js`, `adbWorkerPool.js`, `routes/adb.js`)

Job lifecycle: `adbManager.push(device, sources, dest, { maxWorkers: 3, conflictStrategy })` → transactions progress `pending → running → [done|error|cancelled]`.

ADB database tables (`adb_jobs`, `adb_transactions`). Transaction states: PENDING, CONFLICT_CHECK, CONFLICT, TRANSFERRING, VERIFYING, DONE, CANCELLED, FAILED, SKIPPED. Conflict resolution: skip / overwrite / rename / cancel / applyAll.

#### 8.4.1 ADB code (verbatim)

**Transaction state machine** (`adbTransaction.js:6-30`). Explicit `TX_STATUS` enum + a `VALID_TRANSITIONS` map enforce legal progress (`pending → checking → transferring → verifying → metadata → committed`). Illegal transitions are rejected by `updateStatus`.

```javascript
// backend/src/utils/adbTransaction.js:6
export const TX_STATUS = {
  PENDING: 'pending',
  CONFLICT_CHECK: 'checking',
  TRANSFERRING: 'transferring',
  VERIFYING: 'verifying',
  METADATA: 'metadata',
  COMMITTED: 'committed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
  CONFLICT: 'conflict',
};

const VALID_TRANSITIONS = {
  [TX_STATUS.PENDING]: [TX_STATUS.CONFLICT_CHECK, TX_STATUS.CANCELLED, TX_STATUS.SKIPPED],
  [TX_STATUS.CONFLICT_CHECK]: [TX_STATUS.TRANSFERRING, TX_STATUS.CONFLICT, TX_STATUS.SKIPPED, TX_STATUS.CANCELLED],
  [TX_STATUS.CONFLICT]: [TX_STATUS.PENDING, TX_STATUS.SKIPPED, TX_STATUS.CANCELLED],
  [TX_STATUS.TRANSFERRING]: [TX_STATUS.VERIFYING, TX_STATUS.FAILED, TX_STATUS.CANCELLED],
  [TX_STATUS.VERIFYING]: [TX_STATUS.METADATA, TX_STATUS.FAILED],
  [TX_STATUS.METADATA]: [TX_STATUS.VERIFYING, TX_STATUS.COMMITTED, TX_STATUS.FAILED],
  [TX_STATUS.FAILED]: [TX_STATUS.PENDING],
  [TX_STATUS.COMMITTED]: [],
  [TX_STATUS.SKIPPED]: [],
  [TX_STATUS.CANCELLED]: [],
};
```

> **Apa kerjanya:** Mendefinisikan enum status transaksi ADB (PENDING, CONFLICT_CHECK, TRANSFERRING, VERIFYING, METADATA, COMMITTED, dst) beserta `VALID_TRANSITIONS` yang hanya mengizinkan transisi legal antar-status.
> **Dampak:** Mencegah korupsi state transaksi; `updateStatus` menolak transisi ilegal sehingga lifecycle transfer tetap konsisten dan bisa dipulihkan setelah crash.
> **Alternatif serupa:** Bisa pakai library state-machine (mis. `xstate`); trade-off: map eksplisit lebih ringan dan mudah diaudit.
> **Kalau tidak pakai ini:** Transaksi bisa melompat ke status tidak valid (mis. committed→transferring) sehingga verifikasi dan recovery tak dapat diandalkan.

**Concurrency-limited worker pool** (`adbWorkerPool.js:90-168`). `AdbWorkerPool.processJob` spins up `min(maxWorkers, pending.length)` workers and a `_prepAhead` look-ahead that pre-stats remote dirs and resolves conflicts before transfer begins.

```javascript
// backend/src/utils/adbWorkerPool.js:90
export class AdbWorkerPool {
  constructor(maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
  }

  async processJob(job, callbacks) {
    const pending = transactionEngine.getPendingTransactions(job.id);
    const results = [];
    let cursor = 0;
    let stopped = false;

    const shouldStop = () =>
      stopped || job.status === 'cancelled' || job.status === 'paused';

    // ... processOne() with retry / conflict resolution ...

    const worker = async () => {
      while (!shouldStop()) {
        if (cursor >= pending.length) {
          await new Promise(r => setTimeout(r, 100));
          if (cursor >= pending.length) break;
          continue;
        }
        const tx = pending[cursor++];
        if (!tx || tx.status !== TX_STATUS.PENDING) continue;
        const result = await processOne(tx);
        // ...
      }
    };

    const workerCount = Math.min(this.maxWorkers, Math.max(pending.length, 1));
    await Promise.all([
      ...Array.from({ length: workerCount }, () => worker()),
      this._prepAhead(job, pending, () => cursor, shouldStop),
    ]);

    while (!shouldStop() && cursor < pending.length) {
      const tx = pending[cursor++];
      if (tx?.status === TX_STATUS.PENDING) {
        await processOne(tx);
      }
    }

    return { results, stopped: shouldStop() };
  }
  // ...
}
```

> **Apa kerjanya:** Menjalankan transfer dengan pool pekerja sejumlah `min(maxWorkers, jumlah pending)`; tiap pekerja memproses satu transaksi, sementara `_prepAhead` melakukan stat remote dan resolusi konflik di awal.
> **Dampak:** Memungkinkan transfer paralel antar-file dengan batas konkuren aman; retry otomatis dan penanganan konflik terpusat di worker.
> **Alternatif serupa:** Bisa pakai `p-queue` atau `worker_threads`; trade-off: implementasi promise-based sendiri cukup untuk orchestration ADB.
> **Kalau tidak pakai ini:** Transfer berjalan serial atau tanpa batas konkuren, memperlambat job besar atau membanjiri perangkat target.

**Checksum / size verification after push** (`adbWorkerPool.js:418-426`). Each file is re-stated on-device and compared to the expected size (and, post-metadata, mtime). A size mismatch throws and the transaction is retried (up to `max_attempts`).

```javascript
// backend/src/utils/adbWorkerPool.js:418
    transactionEngine.updateStatus(tx.id, TX_STATUS.VERIFYING);
    let verify = await verifyFile(deviceId, tx.dst, tx.size);
    if (!verify.ok) {
      console.error(`[adb] VERIFY FAILED for ${tx.dst}: expected=${tx.size}, reason=${verify.reason}`);
      const err = new Error(`Verification failed: ${verify.reason}`);
      err.type = verify.reason === 'size_mismatch' ? ERROR_TYPES.SIZE_MISMATCH : ERROR_TYPES.FILE_MISSING;
      throw err;
    }
```

> **Apa kerjanya:** Setelah push, memanggil `verifyFile` di perangkat untuk membandingkan ukuran (dan mtime setelah metadata) file tujuan dengan ukuran yang diharapkan; bila gagal, lempar error bertipe `SIZE_MISMATCH`/`FILE_MISSING`.
> **Dampak:** Menjamin integritas file hasil transfer; kegagalan verifikasi memicu retry otomatis hingga `max_attempts` sebelum ditandai failed.
> **Alternatif serupa:** Bisa membandingkan checksum SHA256 alih-alih ukuran; trade-off: ukuran lebih cepat, SHA256 lebih robust tapi butuh baca ulang.
> **Kalau tidak pakai ini:** File rusak/terpotong bisa lolos sebagai sukses, merusak library di perangkat.

**`push()` job creation** (`adbManager.js:461-503`). Builds the job record carrying `maxWorkers` and `conflictStrategy` (`skip` | `overwrite` | `ask`), persists it, and enqueues on the per-device queue.

```javascript
// backend/src/utils/adbManager.js:461
  push(deviceId, sources, destDir, options = {}) {
    const jobId = `push_${++this.jobIdCounter}_${Date.now()}`;
    const ident = this._getDeviceIdentity(deviceId);
    const job = {
      id: jobId,
      type: 'push',
      device: deviceId,
      deviceSerial: ident.serial,
      deviceIp: ident.ip,
      sources: [...sources],
      dest: destDir,
      status: 'queued',
      progress: 0,
      totalBytes: 0,
      transferredBytes: 0,
      speed: 0,
      eta: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      process: null,
      sseClients: new Set(),
      engine: 'transactional',
      txOptions: options.txOptions || {},
      maxWorkers: options.maxWorkers || 3,
      conflictStrategy: options.conflictStrategy || 'ask', // 'skip' | 'overwrite' | 'ask'
      conflict: null,
      conflictLock: false,
      currentFile: null,
      activePushProcess: null,
      jobState: {
        applyAll: false,
        decision: null,   // 'skip' | 'overwrite' | 'rename'
        scope: 'none',    // 'none' | 'queue'
      },
    };

    this.jobs.set(jobId, job);
    transactionEngine.saveJob(job);
    this._enqueue(deviceId, jobId);
    return jobId;
  }
```

> **Apa kerjanya:** Membuat record job push berisi device, sources, dest, `maxWorkers`, dan `conflictStrategy` (`skip`|`overwrite`|`ask`), menyimpannya ke DB via `transactionEngine`, lalu memasukkannya ke antrean per-perangkat.
> **Dampak:** Menjadi titik masuk transfer; job tersimpan sehingga bisa dipulihkan setelah restart dan dijalankan berurutan per device.
> **Alternatif serupa:** Bisa langsung spawn tanpa job persistence; trade-off: job + DB memungkinkan resume, pause, dan progress SSE.
> **Kalau tidak pakai ini:** Tidak ada pelacakan job, sehingga tak ada progress, pause, atau recovery setelah crash.

### 8.5 Upload (`utils/uploadManager.js`, `routes/upload.js`)

Busboy multipart upload. State: `MEDIA_ROOTS`, `activeUploads` Map, `uploadIdCounter`, `UPLOAD_TEMP`. Runtime settings: `upload.maxSizeGB` (100), `upload.concurrent` (4), `upload.duplicateStrategy` (rename), `upload.autoScan` (true), `upload.verifyIntegrity` (true), `upload.autoThumbnail` (true). `sanitizeFilename()` removes `..`, `/`, `\`, `\0`, max 255 chars.

### 8.6 MPD / Strawberry (`routes/mpd.js`)

Controls Strawberry MPD player via `mpd2` on `localhost:6600`. Player, playlist, and queue endpoints. Loop-mode mapping: `one` = repeat 1 + single 1; `all` = repeat 1 + single 0; `off` = repeat 0 + single 0.

#### 8.6.1 MPD code (verbatim)

Excerpts from `backend/src/routes/mpd.js`.

**`mpdSend`** (`mpd.js:20-23`) — lazy-connecting wrapper around `mpd2`'s `sendCommand`. The connection is cached and reset on `close`.

```javascript
// backend/src/routes/mpd.js:20
async function mpdSend(cmd) {
  const c = await getClient();
  return c.sendCommand(cmd);
}
```

> **Apa kerjanya:** Mengirim perintah MPD ke client yang sudah terhubung lewat `getClient()` lalu `c.sendCommand(cmd)`.
> **Dampak:** Seluruh endpoint player/playlist/queue memanggil `mpdSend` sehingga kontrol Strawberry terpusat pada satu wrapper.
> **Alternatif serupa:** Bisa langsung memanggil `client.sendCommand` di tiap handler, tapi wrapper ini menambahkan lazy-connect dan reset on close.
> **Kalau tidak pakai ini:** Tiap handler perlu menangani koneksi sendiri sehingga rawan duplikasi dan putus koneksi tidak tertangani.
<!-- annot:mpd_send -->
**Loop-mode mapping** (`mpd.js:250-258`). The one/all/off UI maps to MPD's `repeat` + `single` flags.

```javascript
// backend/src/routes/mpd.js:250
router.post('/player/loop', async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'off').toLowerCase();
    if (mode === 'one') { await mpdSend('repeat 1'); await mpdSend('single 1'); }
    else if (mode === 'all') { await mpdSend('repeat 1'); await mpdSend('single 0'); }
    else { await mpdSend('repeat 0'); await mpdSend('single 0'); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

> **Apa kerjanya:** Memetakan mode UI one/all/off ke flag MPD `repeat` dan `single` (satu = repeat 1 + single 1, all = repeat 1 + single 0, off = keduanya 0).
> **Dampak:** Frontend cukup mengirim `mode` tunggal dan backend menerjemahkannya ke dua perintah MPD.
> **Alternatif serupa:** Bisa pakai satu perintah `repeat` saja, tapi MPD membedakan repeat vs single untuk mode one.
> **Kalau tidak pakai ini:** Mode loop satu lagu tidak bisa diwujudkan karena MPD memisahkan flag repeat dan single.
<!-- annot:mpd_loop -->
> The status→loopMode decode lives in `GET /player/status` (`mpd.js:148-150`): `repeat && single → 'one'`, `repeat → 'all'`, else `'off'`.

### 8.7 Monitoring (`monitor/*`)

Engine poll interval is **3000ms** (`pollIntervalMs = 3000` in `engine.js`); WebSocket broadcast throttle **3000ms** (`BROADCAST_THROTTLE_MS`); historical snapshot every **30s**. The dashboard *setting* `monitor.refreshInterval` defaults to **1000ms** and is the **frontend polling fallback** interval — it does **not** change the backend engine poll. Backend uses a forked `monitor/monitoringCache.js` → `src/sensors-worker.mjs` for sensor reads; GPU collection is skippable via `MONITOR_DISABLE_GPU`.

#### 8.7.1 Monitoring code (verbatim)

**`collectAll()` poll loop** (`engine.js:32-97`). All six collectors run concurrently with a 3 s per-collector `Promise.race` timeout; results are broadcast (throttled) and snapshotted every 30 s. `pollIntervalMs = 3000` is the constant at `engine.js:20`.

```javascript
// backend/src/monitor/engine.js:32
async function collectAll() {
  if (collecting) return;
  collecting = true;
  try {
    const collectors = {
      cpu: collectCpu, ram: collectMemory, gpu: collectGpu,
      disk: collectDisk, network: collectNetwork, system: collectSystem,
    };

    const results = [];
    for (const [key, fn] of Object.entries(collectors)) {
      try {
        const result = await Promise.race([
          Promise.resolve(fn()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), COLLECTOR_TIMEOUT)
          ),
        ]);
        results.push({ key, result });
      } catch {
        results.push({ key, result: null });
      }
      await new Promise(r => setImmediate(r));
    }

    const stats = { timestamp: Date.now() };
    for (const res of results) stats[res.key] = res.result;
    try { stats.thumbnails = getThumbQueueStatus(); } catch { stats.thumbnails = null; }
    currentStats = stats;

    let alerts = [];
    try { alerts = checkAlerts(currentStats); } catch (err) {
      console.error('[monitor] Alert check failed:', err.message);
    }

    const now = Date.now();
    if (now - lastBroadcastTime >= BROADCAST_THROTTLE_MS) {
      lastBroadcastTime = now;
      try { broadcast({ type: 'stats', data: currentStats, alerts }); } catch (err) {
        console.error('[monitor] Broadcast failed:', err.message);
      }
    }

    historyTick++;
    if (historyTick * pollIntervalMs >= HISTORY_INTERVAL) {
      try { recordSnapshot(currentStats); } catch (err) { console.error('[monitor] Snapshot failed:', err.message); }
      historyTick = 0;
    }
  } finally {
    collecting = false;
  }
}
```

> **Apa kerjanya:** Menjalankan keenam collector (cpu, ram, gpu, disk, network, system) berurutan dengan timeout 3 detik per collector via `Promise.race`, lalu menyiarkan stats (throttle 3s) dan menyimpan snapshot setiap 30s.
> **Dampak:** Dashboard mendapat metrik terbaru tiap poll 3000ms tanpa satu collector lambat memblokir loop (`collecting` guard mencegah overlap).
> **Alternatif serupa:** Bisa pakai `Promise.all` tanpa timeout, tapi timeout melindungi dari collector yang hang.
> **Kalau tidak pakai ini:** Collector yang macet dapat menghentikan pembaruan metrik seluruh sistem.
<!-- annot:engine_collectall -->
**Forked sensor reads — `monitoringCache.js` + `sensors-worker.mjs`** (`monitoringCache.js:69-77`, `165-184`). Hardware sensor reads (`/sys/class/hwmon`) are pushed into a **detached child process** so a kernel D-state hang on `hwmon` never blocks the main HTTP event loop. The parent reads the child's result JSON after a 1.5 s settle.



```javascript
// backend/src/monitor/monitoringCache.js:69
// ─── Sensor refresh (detached child process — sysfs D-safe) ───
function refreshSensors() {
  try {
    const child = spawn('node', [SENSORS_WORKER], { stdio: 'ignore', detached: true, timeout: 3000 });
    child.unref();
    setTimeout(() => {
      try { cache.sensors = JSON.parse(readFileSync(SENSORS_CACHE, 'utf8')); } catch {}
    }, 1500);
  } catch {}
}
```

> **Apa kerjanya:** Mem-fork proses Node terpisah (`sensors-worker.mjs`) yang membaca sysfs hwmon, lalu setelah 1,5 detik membaca hasil JSON-nya dari cache file; child di-`unref()` agar tak menahan proses.
> **Dampak:** Baca sensor yang bisa menggantung di D-state (uninterruptible sleep) tidak memblokir event loop HTTP utama, sehingga server tetap responsif saat hardware bermasalah.
> **Alternatif serupa:** Bisa membaca `/sys/class/hwmon` langsung di thread utama (lebih murah), tapi berisiko hang pada sensor flaky — proses terpisah adalah trade-off robustness/overkill yang disengaja.
> **Kalau tidak pakai ini:** Hang D-state pada sysfs dapat membekukan seluruh media server hingga tak bisa merespons request.
<!-- annot:cache_refreshsensors -->
```javascript
// backend/src/sensors-worker.mjs:1
// Worker script: reads hwmon sensors from sysfs and writes to cache file
// Runs in a separate process so D-state hangs don't block the main server
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE_FILE = '/tmp/homelab_sensors.json';

try {
  const sensors = {};
  const hwmonDir = '/sys/class/hwmon';
  let hwmons;
  try { hwmons = readdirSync(hwmonDir); } catch { process.exit(0); }

  for (const hwmon of hwmons) {
    const base = `${hwmonDir}/${hwmon}`;
    let name = '';
    try { name = readFileSync(`${base}/name`, 'utf8').trim(); } catch { continue; }
    let inputs;
    try { inputs = readdirSync(base).filter(f => f.endsWith('_input')); } catch { continue; }
    for (const input of inputs) {
      const label = input.replace('_input', '');
      const labelFile = `${base}/${label}_label`;
      let labelText = label;
      try { labelText = readFileSync(labelFile, 'utf8').trim(); } catch {}
      let raw;
      try { raw = readFileSync(`${base}/${input}`, 'utf8').trim(); } catch { continue; }
      const val = parseInt(raw);
      if (!isNaN(val)) {
        const path = `${name}.${labelText}`;
        const tempC = Math.round(val / 1000 * 100) / 100;
        let high = null, crit = null;
        try { high = Math.round(parseInt(readFileSync(`${base}/${label}_max`, 'utf8').trim()) / 1000 * 100) / 100; } catch {}
        try { crit = Math.round(parseInt(readFileSync(`${base}/${label}_crit`, 'utf8').trim()) / 1000 * 100) / 100; } catch {}
        sensors[path] = { chip: name, feature: labelText, label: labelText, value: tempC, high, crit };
      }
    }
  }
  writeFileSync(CACHE_FILE, JSON.stringify(sensors));
} catch {
  // If anything fails, just exit silently
}
```

> **Apa kerjanya:** Membaca semua `hwmon` dari sysfs, mengonversi nilai raw ke °C (dibagi 1000), mengambil `high`/`crit`, lalu menulis hasilnya ke `/tmp/homelab_sensors.json`.
> **Dampak:** Menyediakan data sensor yang diambil di luar proses utama sehingga parent bisa membacanya dengan aman.
> **Alternatif serupa:** Bisa mengembalikan lewat IPC, tapi menulis file cache lebih sederhana dan dipisahkan dari event loop.
> **Kalau tidak pakai ini:** Pembacaan sensor harus dilakukan di proses utama yang rentan D-state hang.
<!-- annot:sensors_worker -->
The background refresh loops (`monitoringCache.js:165-184`) re-run each reader on its own timer (sensors 30 s, cpu freq / fan / battery / media 15 s, uptime 10 s).

**GPU collector — `nvidia-smi` + `MONITOR_DISABLE_GPU` short-circuit** (`gpu.js:149-153`, `72-95`).

```javascript
// backend/src/monitor/collectors/gpu.js:149
export function collect() {
  if (process.env.MONITOR_DISABLE_GPU) return null;
  refreshGpu();
  return cachedGpu;
}
```

> **Apa kerjanya:** `collect()` langsung mengembalikan `null` bila `MONITOR_DISABLE_GPU` diset, jika tidak memanggil `refreshGpu()` dan mengembalikan `cachedGpu`.
> **Dampak:** Memungkinkan menonaktifkan kolektor GPU tanpa mengubah engine, berguna saat tak ada GPU NVIDIA.
> **Alternatif serupa:** Bisa mem-filter collector di `engine.js`, tapi guard env di sini lebih terlokalisasi.
> **Kalau tidak pakai ini:** Engine akan tetap memanggil `nvidia-smi` yang gagal terus-menerus pada host tanpa GPU.
<!-- annot:gpu_collect -->
```javascript
// backend/src/monitor/collectors/gpu.js:72
async function refreshNvidia() {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.current.graphics,clocks.current.memory,power.draw,driver_version --format=csv,noheader,nounits 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    );
    const parts = stdout.trim().split(',').map(s => s.trim());
    if (parts.length >= 5) {
      return {
        available: true,
        vendor: 'nvidia',
        usedPercent: Math.round(parseFloat(parts[0]) * 10) / 10,
        vramUsed: parseFloat(parts[1]) * 1024 * 1024,
        vramTotal: parseFloat(parts[2]) * 1024 * 1024,
        temperature: parseFloat(parts[3]),
        clockGraphics: parseInt(parts[4]),
        clockMemory: parseInt(parts[5] || 0),
        powerDraw: parseFloat((parts[6] || '').trim()) || 0,
        driver: parts[7]?.trim() || '',
      };
    }
  } catch {}
  return null;
}
```

> **Apa kerjanya:** Menjalankan `nvidia-smi --query-gpu=...` lalu mem-parse CSV-nya menjadi objek metrik (utilisasi, VRAM, suhu, clock, daya, driver).
> **Dampak:** Dashboard GPU terisi dari output `nvidia-smi` dengan timeout 5 detik; gagal -> kembalikan null dan pakai cache.
> **Alternatif serupa:** Bisa baca sysfs NVML langsung, tapi CLI `nvidia-smi` sudah cukup dan portabel.
> **Kalau tidak pakai ini:** Tidak ada metrik GPU NVIDIA yang ditampilkan di monitoring.
<!-- annot:gpu_refreshnvidia -->
**Disk collector — `statvfs` + `smartctl` with cache** (`disk.js:49-102`, `132-159`).

```javascript
// backend/src/monitor/collectors/disk.js:49
async function refreshSmart(partitions) {
  const physDisks = partitions.filter(isPhysicalDisk);
  if (physDisks.length === 0) return;

  let smartHealth = null;
  let diskTemp = null;

  const results = await Promise.allSettled(
    physDisks.map(async (disk) => {
      const device = `/dev/${disk.name}`;
      const [health, temp] = await Promise.allSettled([
        execAsync(['smartctl', '-H', device].join(' '), { timeout: 5000 })
          .then(({ stdout }) => {
            if (stdout.includes('PASSED')) return 'PASSED';
            if (stdout.includes('FAILED')) return 'FAILED';
            return 'Unknown';
          })
          .catch(() => null),
        execAsync(['smartctl', '-A', device].join(' '), { timeout: 5000 })
          .then(({ stdout }) => {
            const line = stdout.split('
').find(l => l.toLowerCase().includes('temperature'));
            if (line) {
              const m = line.match(/(\d+)/);
              if (m) return parseInt(m[1]);
            }
            return null;
          })
          .catch(() => null),
      ]);
      return { status: health.status === 'fulfilled' ? health.value : null, temp: temp.status === 'fulfilled' ? temp.value : null };
    })
  );
  // ... aggregate: FAILED wins, keep first non-null temp ...
  smartCache = { smart: smartHealth, temperature: diskTemp };
  smartCacheTime = Date.now();
}
```

> **Apa kerjanya:** Menjalankan `smartctl -H` dan `smartctl -A` paralel per disk fisik (`Promise.allSettled`), menentukan status PASSED/FAILED dan suhu, lalu menyimpannya ke `smartCache` (TTL 60s).
> **Dampak:** Kesehatan disk SMART tersedia untuk widget disk tanpa memanggil `smartctl` setiap poll.
> **Alternatif serupa:** Bisa pakai `libatasmart`/ioctl langsung, tapi `smartctl` CLI sudah ada dan mudah di-timeout.
> **Kalau tidak pakai ini:** Widget disk tak menampilkan status SMART/suhu dan pembaruan tiap poll akan lambat.
<!-- annot:disk_refreshsmart -->
```javascript
// backend/src/monitor/collectors/disk.js:132
function getFilesystems() {
  const fss = [];
  try {
    const data = fs.readFileSync('/proc/mounts', 'utf8');
    for (const line of data.split('
')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [, mountPoint, fstype] = parts;
      if (fstype === 'ext4' || fstype === 'btrfs' || fstype === 'xfs' || fstype === 'zfs' || mountPoint === '/') {
        try {
          const s = fs.statfsSync(mountPoint);
          const total = s.blocks * s.bsize;
          const free = s.bfree * s.bsize;
          const used = total - free;
          fss.push({
            mount: mountPoint, fstype, total, used, free,
            usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
          });
        } catch {}
      }
    }
  } catch {}
  return fss;
}
```

> **Apa kerjanya:** Membaca `/proc/mounts`, menyaring fstype ext4/btrfs/xfs/zfs atau mount `/`, lalu pakai `statfsSync` untuk menghitung total/used/free dan persen pemakaian.
> **Dampak:** Memberikan daftar partisi beserta pemakaian disk yang ditampilkan di dashboard.
> **Alternatif serupa:** Bisa pakai `df` CLI, tapi `statfsSync` sinkron lebih mudah dan tanpa spawn.
> **Kalau tidak pakai ini:** Tidak ada data pemakaian filesystem yang ditampilkan di monitoring disk.
<!-- annot:disk_getfilesystems -->
> SMART results are cached 60 s (`SMART_CACHE_TTL = 60_000`); partition list 30 s. `getDiskstats()` (from `/proc/diskstats`) computes per-device read/write byte deltas between polls for the I/O widget.

**Alerts — `checkAlerts()` thresholds + 60 s dedupe** (`alerts.js:59-129`). CPU/RAM/disk/temp/gpuTemp each emit `warning`/`critical` events; identical type+severity is suppressed for 60 s.

```javascript
// backend/src/monitor/alerts.js:59
export function checkAlerts(currentStats) {
  const alerts = loadAlerts();
  const now = new Date().toISOString();
  let triggered = [];

  const cpu = currentStats.cpu;
  const ram = currentStats.ram;
  const disk = currentStats.disk;
  const gpu = currentStats.gpu;

  if (alerts.thresholds.cpu?.enabled && cpu?.usedPercent != null) {
    const val = cpu.usedPercent;
    if (val >= alerts.thresholds.cpu.critical) {
      triggered.push({ type: 'cpu', severity: 'critical', value: val, threshold: alerts.thresholds.cpu.critical, message: `CPU usage at ${val}% (critical: ${alerts.thresholds.cpu.critical}%)`, timestamp: now });
    } else if (val >= alerts.thresholds.cpu.warning) {
      triggered.push({ type: 'cpu', severity: 'warning', value: val, threshold: alerts.thresholds.cpu.warning, message: `CPU usage at ${val}% (warning: ${alerts.thresholds.cpu.warning}%)`, timestamp: now });
    }
  }
  // ... memory / disk / cpuTemp / gpuTemp checks mirror the same pattern ...

  if (triggered.length > 0) {
    const newAlerts = triggered.filter(t => {
      const prev = alerts.history.find(e => e.type === t.type && e.severity === t.severity);
      if (!prev) return true;
      return (new Date(t.timestamp) - new Date(prev.timestamp)) > 60000;
    });
    if (newAlerts.length > 0) {
      alerts.history.unshift(...newAlerts);
      if (alerts.history.length > 200) alerts.history = alerts.history.slice(0, 200);
      alertsCache = alerts;
      debouncedSaveAlerts();
    }
  }

  return triggered;
}
```

> **Apa kerjanya:** Membandingkan metrik cpu/ram/disk/suhu/gpuTemp dengan ambang warning/critical, lalu menyaring duplikat berdasarkan type+severity dalam 60 detik terakhir.
> **Dampak:** Mencegah spam alert yang sama; riwayat disimpan (maks 200) dan di-debounce tulis ke disk 5 detik.
> **Alternatif serupa:** Bisa pakai library alerting eksternal, tapi dedupe manual cukup dan tanpa dependensi.
> **Kalau tidak pakai ini:** Alert yang sama bisa meluap setiap poll (3 detik) sehingga log/riwayat membanjiri.
<!-- annot:alerts_checkalerts -->
### 8.8 WhatsApp / Send (`routes/whatsapp.js`, `routes/send.js`, `whatsapp-bot/`)

WhatsApp bridge is loaded by `server.js` via `initWhatsApp()` (10s after listen, up to 5 retries backoff). `routes/whatsapp.js` imports from `../../../whatsapp-bot/src/` and exposes `/api/whatsapp/*` plus SSE `/api/whatsapp/logs/stream`. Telegram send (`routes/send.js`) is optional — active only if `TELEGRAM_BOT_TOKEN` is set.

#### 8.8.1 WhatsApp / Send code (verbatim)

**`setupWhatsAppRoutes(app)`** (`routes/whatsapp.js:34`). The backend route module imports directly from `../../../whatsapp-bot/src/` and mounts the `/api/whatsapp/*` REST + SSE endpoints onto the Express `app`.

```javascript
// backend/src/routes/whatsapp.js:34
export function setupWhatsAppRoutes(app) {
  app.get('/api/whatsapp/status', (req, res) => {
    try {
      const status = getConnectionStatus();
      res.json({ ...status, telegramCount: getTelegramCount(), whatsappCount: getWhatsAppCount() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/qr', (req, res) => { /* ... */ });
  app.get('/api/whatsapp/qr-image', (req, res) => { /* ... */ });
  // ... start/stop/restart/scan control endpoints ...
  app.get('/api/whatsapp/logs/stream', (req, res) => { /* SSE of pushLog() buffer */ });
}
```

> **Apa kerjanya:** Mendaftarkan endpoint REST+SSE `/api/whatsapp/*` ke Express `app`, mengimpor langsung dari `../../../whatsapp-bot/src/` dan menggabungkan status koneksi dengan counter Telegram/WhatsApp.
> **Dampak:** Backend bisa mengontrol dan memantau bridge WhatsApp dari satu rute tanpa proses terpisah.
> **Alternatif serupa:** Bisa menjalankan whatsapp-bot sebagai service mandiri, tapi import langsung menyatukan lifecycle dengan server.
> **Kalau tidak pakai ini:** Endpoint WhatsApp tak terpasang sehingga fitur bridge tak bisa diakses dari API.
<!-- annot:wa_setuproutes -->
**Telegram guard — `TELEGRAM_BOT_TOKEN`** (`utils/telegramBot.js:11-16`). The bot is only constructed when the token env var is set; otherwise `getBot()` returns `null` and every send throws `"TELEGRAM_BOT_TOKEN not configured"`.

```javascript
// backend/src/utils/telegramBot.js:11
export function getBot() {
  if (!bot && BOT_TOKEN) {
    bot = new TelegramBotApi(BOT_TOKEN, { polling: false });
  }
  return bot;
}
```

> **Apa kerjanya:** Menginisialisasi `TelegramBotApi` hanya bila `TELEGRAM_BOT_TOKEN` ada; jika tidak, `getBot()` mengembalikan `null` dan setiap kirim melempar error konfigurasi.
> **Dampak:** Fitur Telegram otomatis mati saat token tak diset tanpa merusak startup server.
> **Alternatif serupa:** Bisa membaca token dari file/secret manager, tapi env var sudah standar.
> **Kalau tidak pakai ini:** Server akan crash saat mencoba kirim Telegram tanpa token.
<!-- annot:tg_getbot -->
`routes/send.js` exposes `/api/send/telegram` and `/api/send/all`; the `/telegram/status` endpoint reports `configured: !!process.env.TELEGRAM_BOT_TOKEN`, so the UI can hide the action when unconfigured.

**WhatsApp connection** (`whatsapp-bot/src/connection.js:42-60`). Uses `whatsapp-web.js` (LocalAuth + headless puppeteer), registers the `qr`/`ready`/`disconnected`/`auth_failure`/`message` handlers, and auto-reconnects with exponential backoff capped at 5 min.

```javascript
// whatsapp-bot/src/connection.js:42
function createClient() {
  const c = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-bot-session', dataPath: AUTH_DIR }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  c.on('qr', (qr) => {
    lastQr = qr;
    connected = false;
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('           QR CODE - SCAN NOW           ');
    console.log('═══════════════════════════════════════════');
    console.log('');
    qrcode.generate(qr, { small: true });
    console.log('');
    log('warn', 'QR code rendered above. Scan with WhatsApp > Linked Devices');
    botEvents.emit('qr', qr);
  });
  // ... ready / disconnected / auth_failure handlers, knownEvents registration ...
  return c;
}
```

> **Apa kerjanya:** Membuat client `whatsapp-web.js` dengan `LocalAuth` + puppeteer headless, lalu mendaftarkan handler `qr`/`ready`/`disconnected`/`auth_failure`/dll dan auto-reconnect.
> **Dampak:** Koneksi WhatsApp persisten dengan sesi tersimpan dan QR untuk pairing; putus otomatis menyambung ulang.
> **Alternatif serupa:** Bisa pakai Baileys, tapi repo sudah memakai whatsapp-web.js.
> **Kalau tidak pakai ini:** Tidak ada koneksi/QR WhatsApp sehingga bridge tak berfungsi.
<!-- annot:wa_connection -->
**Keyword / hashtag trigger** (`whatsapp-bot/src/listener.js:123-131`). The listener fires only when a video is quoted (or sent) together with a configured keyword (e.g. `save`) or hashtag (e.g. `#upload`).

```javascript
// whatsapp-bot/src/listener.js:123
  const kwMatch = config.triggerKeywords.some(kw => text.includes(kw));
  const tagMatch = config.triggerHashtags.some(tag => text.includes(tag));

  log('info', `[5] kwMatch=${kwMatch} tagMatch=${tagMatch}`);

  const triggered =
    (isQuotedVideo && kwMatch) ||
    (isQuotedVideo && tagMatch) ||
    (isVideo(msg) && tagMatch);

  if (!triggered) {
    log('info', `[NO TRIGGER]`);
    return;
  }
```

> **Apa kerjanya:** Mengecek apakah pesan mengandung keyword atau hashtag trigger, dan memicu hanya bila video dikutip/dikirim bersama trigger tersebut.
> **Dampak:** Menyaring pesan agar hanya media + perintah tertentu yang diproses (mis. simpan video), mencegah aksi sembarangan.
> **Alternatif serupa:** Bisa pakai regex command global, tapi pemeriksaan keyword/hashtag per-pesan lebih terarah.
> **Kalau tidak pakai ini:** Semua pesan video akan diproses tanpa filter, memicu unggahan tak diinginkan.
<!-- annot:wa_listener -->
### 8.9 Video Cache (`routes/videoCache.js`)

Mounted at `/api/video-cache`. Provides video cache bookkeeping (the `videoCache.js` util tracks cached video segments/derivatives). Consult the live endpoints for the exact surface.

---

### 8.10 Metadata (`utils/metadataWriter.js`, `musicbrainz.js`, `lrclib.js`)

**Cover-art embedding** (`metadataWriter.js:74-111`). Per-format `ffmpeg`/`python3` command strings. FLAC uses the spawned `embed_cover.py`; MP3/OGG/Opus/M4A/WebM use `ffmpeg` with appropriate disposition/container flags, writing to a `.tmp` then atomic-rename.

```javascript
// backend/src/utils/metadataWriter.js:74
export async function embedCover(filePath, imageBuffer, mimeType) {
  const { execSync } = await import('node:child_process');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const ext = extname(filePath).toLowerCase();
  const tmpFile = join(tmpdir(), `cover_${Date.now()}${ext}`);

  try {
    writeFileSync(tmpFile, imageBuffer);

    if (ext === '.flac') {
      const pyScript = join(dirname(fileURLToPath(import.meta.url)), 'embed_cover.py');
      execSync(`python3 "${pyScript}" "${filePath}" "${tmpFile}" "${mimeType}"`, { stdio: 'pipe', timeout: 120000 });
    } else if (ext === '.mp3') {
      const ffmpegArgs = `-i "${filePath}" -i "${tmpFile}" -map 0:a -map 1:0 -c copy -id3v2_version 3 -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" "${filePath}.tmp"`;
      execSync(`ffmpeg -y ${ffmpegArgs}`, { stdio: 'pipe', timeout: 120000 });
      const { renameSync } = await import('node:fs');
      renameSync(`${filePath}.tmp`, filePath);
    } else if (ext === '.ogg' || ext === '.opus') {
      // ... -c copy -f ogg ...
    } else if (ext === '.m4a') {
      // ... -disposition:v:0 attached_pic -f mp4 ...
    } else if (ext === '.webm') {
      // ... -c:a copy -c:v libvpx-vp9 -deadline realtime -cpu-used 5 -f webm ...
    } else {
      throw new Error(`Unsupported format for cover embedding: ${ext}`);
    }
    return true;
  } catch (err) {
    // ... cleanup tmp files ...
  }
}
```

> **Apa kerjanya:** Menulis buffer gambar ke file temp lalu menyematkan cover lewat `embed_cover.py` (FLAC) atau `ffmpeg` per-format (mp3/ogg/opus/m4a/webm) ke `.tmp` lalu atomic-rename.
> **Dampak:** Cover art tersimpan di dalam file audio/video tanpa merusak file asli (rename atomik), mendukung banyak format.
> **Alternatif serupa:** Bisa pakai `music-metadata` untuk tulis tag, tapi ffmpeg/python menangani cover gambar lintas format.
> **Kalau tidak pakai ini:** Perubahan cover tak tersimpan ke file sehingga metadata cover hilang saat dibaca ulang.
<!-- annot:meta_embedcover -->
**MusicBrainz / Cover Art Archive** (`musicbrainz.js:43-56`, `72-93`). `getCoverArt` hits the Cover Art Archive for a release MBID; `searchCoverArt` tries a recording search first, then falls back to artist+album, then artist-only.

```javascript
// backend/src/utils/musicbrainz.js:43
export async function getCoverArt(mbid) {
  const url = `${CAA_BASE}/release/${mbid}`;
  const data = await mbFetch(url);
  if (!data?.images) return null;
  const front = data.images.find(i => i.front) || data.images[0];
  if (!front) return null;
  return {
    id: front.id,
    image: front.image,
    thumbnails: front.thumbnails || {},
    types: front.types || [],
    approved: front.approved,
  };
}
```

> **Apa kerjanya:** Menghitung URL Cover Art Archive dari release MBID lalu mengambil gambar depan (`front`) via `mbFetch`.
> **Dampak:** Menyediakan sumber cover art resmi dari MusicBrainz untuk pencarian metadata.
> **Alternatif serupa:** Bisa pakai penyedia cover lain (mis. iTunes), tapi CAA terikat MBID yang sudah diverifikasi.
> **Kalau tidak pakai ini:** Pencarian cover art tak memiliki sumber resmi berdasarkan MusicBrainz MBID.
<!-- annot:mb_getcoverart -->
**LRCLIB lyrics** (`lrclib.js:22-44`). `getLyrics` does an exact track/artist/duration lookup (5 s `AbortController` timeout); `searchLyricsByMetadata` falls back to a free-text search.

```javascript
// backend/src/utils/lrclib.js:22
export async function getLyrics(trackName, artistName, albumName, duration) {
  const params = new URLSearchParams({
    track_name: trackName,
    artist_name: artistName,
  });
  if (albumName) params.set('album_name', albumName);
  if (duration) params.set('duration', String(Math.round(duration)));

  const url = `${LRCLIB_BASE}/get?${params}`;
  const data = await lrclibFetch(url);
  if (!data) return null;

  return {
    id: data.id,
    trackName: data.trackName,
    artistName: data.artistName,
    albumName: data.albumName,
    duration: data.duration,
    plainLyrics: data.plainLyrics || null,
    syncedLyrics: data.syncedLyrics || null,
    instrumental: data.instrumental || false,
  };
}
```

> **Apa kerjanya:** Membangun query LRCLIB dari track/artist/album/durasi lalu mengambil lirik plaintext dan synced via `lrclibFetch`.
> **Dampak:** Mendapatkan lirik (biasa/sinkron) untuk ditampilkan di pemutar audio.
> **Alternatif serupa:** Bisa pakai Genius/NetEase, tapi LRCLIB fokus pada LRC terstruktur gratis.
> **Kalau tidak pakai ini:** Fitur lirik tak terisi dari sumber LRCLIB.
<!-- annot:lrclib_getlyrics -->
---

## 9. Frontend Architecture

The frontend is a React 18 SPA built with Vite 5, Tailwind 3.4, Zustand 5.0, hls.js 1.5, recharts 3.8, framer-motion 12.40, lucide-react 1.16, react-window 1.8.

### 9.1 Entry & Shell

- `src/main.jsx` mounts `<App/>` inside `<DebugProvider>`; renders `#root`.
- `src/App.jsx` (~2000+ lines) wraps everything in an **ErrorBoundary** (anti-blank-screen) and implements **hash-based routing** (see below).
- Notably, `react-router-dom` (v7) **is used** for the Monitoring dashboard sub-routing (`MemoryRouter`/`Routes`/`Route` in `components/MonitoringView.jsx` and `monitoring/layout/*`). Top-level app navigation (outside Monitoring) remains a custom hash state machine via `parseHash()` + `sessionStorage`.

### 9.2 Routing (Custom Hash State Machine)

`App.jsx` parses `location.hash` and persists the current view in `sessionStorage`. Example routes:

|  Hash                        |  Route Type               |
|----------------------------|-------------------------|
|  `#media`                    |  media grid (root)        |
|  `#media/v/{id}`             |  video from root          |
|  `#f/{folderId}`             |  folder                   |
|  `#f/{folderId}/v/{fileId}`  |  file (video in folder)   |
|  `#monitoring`               |  monitoring               |
|  `#monitoring/{subPath}`     |  monitoring with subpath  |
|  `#downloader`               |  downloader               |
|  `#adb`                      |  ADB transfer             |
|  `#playlists`                |  playlists list           |
|  `#playlist-detail`          |  playlist detail          |
|  `#audio`                    |  audio player             |
|  `#scrcpy`                   |  scrcpy mirror            |

### 9.3 Zustand Stores (6)

|  Store                  |  Path                                    |  Persistence               |
|-----------------------|----------------------------------------|--------------------------|
|  `monitoringStore`      |  `monitoring/stores/monitoringStore.js`  |  memory (partial)          |
|  `playbackStore`        |  `store/playbackStore.js`                |  memory                    |
|  `playlistStore`        |  `store/playlistStore.js`                |  localStorage (`persist`)  |
|  `folderSortStore`      |  `store/folderSortStore.js`              |  localStorage (`persist`)  |
|  `folderMetaSortStore`  |  `store/folderMetaSortStore.js`          |  localStorage (`persist`)  |
|  `useDebugStore`        |  `debug/useDebugStore.js`                |  memory                    |

### 9.4 Communication Model

- **REST:** central client `src/utils/api.js` with in-flight dedup + 2s cache; base URL `import.meta.env.VITE_API_URL || ''`.
- **WebSocket:** `ws://<host>/ws/monitor` (or `wss`) via `src/hooks/useWebSocket.js` — auto-reconnect with backoff, heartbeat, and a **fallback polling loop** `GET /api/monitoring/stats` (1s foreground / 15s background).
- **SSE:** for streaming logs/jobs/sessions — see §7.14.

### 9.5 Notable UI

- Multi-mode audio player (full / cover / lyrics / video-split), synced LRC lyrics.
- HLS adaptive video via hls.js; virtualized media grid via react-window.
- Android scrcpy mirror + ADB transfer UIs.
- Full monitoring dashboard (CPU/GPU/RAM/disk/network/system gauges + charts via recharts, processes, services, docker, sessions, jobs, queues, alerts, logs terminal).
- Built-in debug/inspection toolkit (`src/debug/`).

### 9.6 Vite Dev Proxy

`vite` dev server proxies to `http://127.0.0.1:3001`: `/api`, `/stream`, `/file`, `/thumbnails`, `/ws` (ws), and `/api/audio` → `/stream/audio`.

### 9.7 Frontend code (verbatim)

#### 9.7.1 `useWebSocket` — WS + heartbeat + fallback polling resilience

`frontend/src/hooks/useWebSocket.js`. This hook is the key "powerful" pattern: it uses **WebSocket** for live stats, a **heartbeat** watchdog that detects dead sockets, and a **fallback polling loop** (`GET /api/monitoring/stats`, 1 s foreground / 15 s background) that keeps the dashboard alive when WS drops.

```javascript
// frontend/src/hooks/useWebSocket.js:82
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
    connect();
  }, delay);
}, [log, cancelReconnect]);
```

> **Apa kerjanya:** Menjadwalkan ulang koneksi WS dengan exponential backoff (base = 1000*2^count, maks 30 s) plus jitter 20%, lalu memanggil connect() setelah delay.
> **Dampak:** Mencegah reconnect storm; setelah MAX_RETRIES (15) gagal, halaman di-reload paksa. Triple-fallback WS -> polling -> probe /health membuat dashboard tetap hidup saat backend restart, tab di-background, atau proxy memutus WS.
> **Alternatif serupa:** Exponential backoff + jitter adalah pola standar (mirip library p-retry/backo).
> **Kalau tidak pakai ini:** Tanpa backoff, reconnect membanjiri server; tanpa reload paksa, WS mati permanen saat gagal terus-menerus.

```javascript
// frontend/src/hooks/useWebSocket.js:50
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
        if (data && data.timestamp) setStats(data);
      }
    } catch (err) {
      clearTimeout(timer);
    }
  }, ms);
  log('POLL start', { interval: ms });
}, [setStats, log]);
```

> **Apa kerjanya:** Memulai polling interval ke GET /api/monitoring/stats: 1 s saat tab terlihat (foreground) atau 15 s saat tersembunyi (background), dengan AbortController timeout 5 s.
> **Dampak:** Menjaga gauge tetap segar saat WS terputus dan otomatis berhenti saat WS kembali OPEN (onopen memanggil stopPolling).
> **Alternatif serupa:** SSE atau long-polling; namun polling sederhana paling mudah dipakai sebagai fallback saat WS drop.
> **Kalau tidak pakai ini:** Dashboard menampilkan data usang/blank saat koneksi WS putus.

The `ws.onclose` handler (and the heartbeat watchdog at `useWebSocket.js:110-133`) both call `startPolling()` + `scheduleReconnect()`, so a dropped socket instantly downgrades to polling until WS recovers.

#### 9.7.2 `api.js` — in-flight dedup + 2 s response cache

`frontend/src/utils/api.js:7-35`. Repeated identical GETs share one in-flight promise; successful responses are cached for `CACHE_TTL = 2000` ms (evicting entries older than `2×ttl` once the map exceeds 100).

```javascript
// frontend/src/utils/api.js:7
function dedupFetch(url) {
  if (inFlight.has(url)) return inFlight.get(url);
  const promise = fetch(url).finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
}

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
    if (responseCache.size > 100) {
      for (const [key, val] of responseCache) {
        if (now - val.time > ttl * 2) responseCache.delete(key);
      }
    }
    return data;
  });
}
```

> **Apa kerjanya:** dedupFetch membagi satu promise in-flight untuk URL GET yang sama; cachedFetch menyimpan respons ke Map dengan TTL 2 s dan meng-evict entri > 2xTTL bila map melebihi 100 entri.
> **Dampak:** Mengurangi request berlebih dan mempercepat render ulang daftar folder yang sama dalam jendela 2 detik.
> **Alternatif serupa:** React Query/SWR yang punya dedupe + stale-while-revalidate bawaan.
> **Kalau tidak pakai ini:** Banyak request duplikat (mis. scroll cepat) membebani backend dan melambatkan UI.

#### 9.7.3 `parseHash()` — hash-router state machine

`frontend/src/App.jsx:90-142`. The entire SPA navigation is this pure function over `location.hash`, with `sessionStorage` view persistence and a typed route table.

```javascript
// frontend/src/App.jsx:90
function parseHash(hash) {
  const cleaned = (hash || '').replace(/^#+/, '').trim();

  if (!cleaned || cleaned === '/') {
    const savedView = sessionStorage.getItem('view') || 'media';
    if (savedView === 'monitoring') {
      const savedSub = sessionStorage.getItem('monitoringSubPath') || '';
      return { type: 'monitoring', subPath: savedSub };
    }
    if (savedView === 'downloader') return { type: 'downloader' };
    if (savedView === 'adb') return { type: 'adb' };
    if (savedView === 'playlists') return { type: 'playlists' };
    if (savedView === 'audio') return { type: 'audio' };
    if (savedView === 'scrcpy') return { type: 'scrcpy' };
    return { type: 'root', view: 'media' };
  }

  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'monitoring') return { type: 'monitoring', subPath: parts[1] || '' };
  if (parts[0] === 'downloader') return { type: 'downloader' };
  if (parts[0] === 'adb') return { type: 'adb' };
  if (parts[0] === 'scrcpy') return { type: 'scrcpy' };
  if (parts[0] === 'playlists') {
    if (parts[1]) return { type: 'playlist-detail', playlistId: parts[1] };
    return { type: 'playlists' };
  }
  if (parts[0] === 'audio') {
    if (parts[1] === 'playlist' && parts[2] && parts[3] === 'track' && parts[4] !== undefined) {
      return { type: 'audio', playlistId: parts[2], trackIdx: parseInt(parts[4], 10) || 0 };
    }
    if (parts[1] === 'single' && parts[2]) return { type: 'audio', fileId: parts[2] };
    const tab = parts[1] || 'nowplaying';
    return { type: 'audio', tab };
  }
  if (parts[0] === 'media' && parts[1] === 'v' && parts[2]) return { type: 'root-file', fileId: parts[2] };
  if (parts[0] === 'media') return { type: 'root', view: 'media' };
  if (parts[0] === 'f' && parts[1]) {
    const folderId = parts[1];
    if (parts[2] === 'v' && parts[3]) {
      if (folderId === 'root') return { type: 'root-file', fileId: parts[3] };
      return { type: 'file', folderId, fileId: parts[3] };
    }
    return { type: 'folder', folderId };
  }
  return { type: 'root', view: 'media' };
}
```

> **Apa kerjanya:** Fungsi murni yang mengubah location.hash menjadi objek rute terdefinisi; membaca view tersimpan dari sessionStorage bila hash kosong atau hanya '/'.
> **Dampak:** Menggantikan react-router; state navigasi persisten lintas reload tanpa library routing eksternal.
> **Alternatif serupa:** react-router-dom (terinstall tapi tidak dipakai) atau tinyrouter.
> **Kalau tidak pakai ini:** Tanpa ini, navigasi SPA butuh dependensi eksternal dan tidak ada pemulihan view saat reload.

#### 9.7.4 `monitoringStore` — shape, `applyRuntimeSetting`, persist middleware

`frontend/src/monitoring/stores/monitoringStore.js:7-53`. A Zustand store wrapped in `persist` (key `mediavault-monitoring`); `setStats` throttles to 1 s, and `applyRuntimeSetting` maps the `monitor.*` backend settings into local UI state.

```javascript
// frontend/src/monitoring/stores/monitoringStore.js:7
const useMonitoringStore = create(
  persist(
    (set) => ({
      stats: null,
      connected: false,
      lastUpdated: null,
      alertCount: 0,
      refreshIntervalMs: 1000,
      smoothEnabled: true,
      smoothMs: 900,
      setStats: (stats) => {
        const now = Date.now();
        if (now - lastStatsUpdate < STATS_THROTTLE_MS) return;
        lastStatsUpdate = now;
        set({ stats, lastUpdated: now });
      },
      setConnected: (connected) => set({ connected }),
      setAlertCount: (alertCount) => set({ alertCount }),
      applyRuntimeSetting: (key, value) => {
        if (key === 'monitor.refreshInterval') {
          const ms = Math.max(250, Math.min(Number(value) || 1000, 60000));
          set({ refreshIntervalMs: ms });
        }
        if (key === 'monitor.uiSmooth') set({ smoothEnabled: Boolean(value) });
        if (key === 'monitor.uiSmoothMs') {
          const ms = Math.max(0, Math.min(Number(value) || 0, 5000));
          set({ smoothMs: ms });
        }
      },
    }),
    {
      name: 'mediavault-monitoring',
      version: 1,
      partialize: (state) => ({
        stats: state.stats,
        refreshIntervalMs: state.refreshIntervalMs,
        smoothEnabled: state.smoothEnabled,
        smoothMs: state.smoothMs,
      }),
    }
  )
);
```

> **Apa kerjanya:** Store Zustand dibungkus persist (key 'mediavault-monitoring'); setStats di-throttle 1 s, dan applyRuntimeSetting memetakan setting backend monitor.* ke state UI (interval refresh, smoothing).
> **Dampak:** Membatasi update gauge berlebih tiap frame dan menyimpan preferensi UI di localStorage melalui partialize.
> **Alternatif serupa:** localStorage manual tanpa persist, atau lodash.throttle untuk throttling.
> **Kalau tidak pakai ini:** Gauge update setiap frame (berat) dan preferensi UI hilang saat reload.

#### 9.7.5 `VideoPlayer.jsx` — hls.js attach + adaptive + fallback

`frontend/src/components/VideoPlayer.jsx:110-144`. Loads the HLS playlist into an hls.js instance (worker on, bounded buffers), and on a **fatal** HLS error falls back to the direct `/stream/video/:id` range stream.

```javascript
// frontend/src/components/VideoPlayer.jsx:110
    if (useHLS) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 8,
          maxMaxBufferLength: 16,
          backbufferLength: 8,
          startLevel: -1,
          maxBandwidth: 2000000,
        });
        hlsRef.current = hls;
        hls.loadSource(`/stream/video/${file.id}/hls/playlist.m3u8`);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.currentTime = 0;
          setIsLoading(false);
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('[VideoPlayer] HLS fatal error, falling back to direct stream:', data);
            hls.destroy();
            hlsRef.current = null;
            video.currentTime = 0;
            video.src = `/stream/video/${file.id}`;
            video.load();
            // ... attach loadedmetadata fallback handler ...
          }
        });
        // ... media event listeners ...
        return () => { /* cleanup + hls.destroy() */ };
      } else {
        video.currentTime = 0;
        video.src = `/stream/video/${file.id}`;
        video.load();
      }
    } else {
      video.currentTime = 0;
      video.src = `/stream/video/${file.id}`;
      video.load();
    }
```

> **Apa kerjanya:** Membuat instance Hls (worker on, buffer terbatas), loadSource playlist.m3u8, lalu attachMedia ke elemen video; bila Hls.Events.ERROR fatal, hls.destroy() dan fallback ke stream langsung /stream/video/:id.
> **Dampak:** Adaptive bitrate otomatis plus jaminan pemutaran walau HLS gagal (termasuk kasus tanpa dukungan Hls.isSupported()).
> **Alternatif serupa:** Native HLS via <video> (Safari saja) atau dash.js untuk MPEG-DASH.
> **Kalau tidak pakai ini:** Video HLS tidak bisa diputar di Chrome/Firefox, atau berhenti total saat terjadi error fatal.

---

## 10. Flow Diagrams

### 10.1 Request Flow

| Step | Component | Description |
|------|-----------|-------------|
| 1 | HTTP Request | Client request to server |
| 2 | Express Router | server.js routing |
| 3 | Route Handler | routes/*.js handler |
| 4 | Utility Module | utils/*.js processing |
| 5 | Database | db.js → better-sqlite3 |
| 6 | Filesystem Cache | cache/, data/ |
| 7 | Response | Return to client |

### 10.2 File Scan Flow

| Step | Action | Description |
|------|--------|-------------|
| 1 | Trigger | fs.watch event OR manual trigger |
| 2 | Scan start | `incrementalSync()` in fileScanner.js |
| 3 | File check | `stat()` → compare mtime vs DB |
| 4 | Upsert | NEW/CHANGED: upsert into files + folders |
| 5 | Thumbnail | Queue thumbnail generation |
| 6 | Broadcast | SSE broadcast: scan_progress |

### 10.3 Playback Flow

| Step | Action | Description |
|------|--------|-------------|
| 1 | User input | Click video file in UI |
| 2 | Stream request | `stream.js` GET /stream/video/:id |
| 3 | Playback decision | `getPlaybackDecision()` in playbackEngine.js |
| 4 | Codec probe | `ffprobe` → codec_info (cached in DB) |
| 5 | Decision tree | H.264/AVC + MP4/MOV/M4V → direct HTTP range; H.264/HEVC + Opus audio → remux to MKV; Incompatible → transcode to H.264/AAC |
| 6 | Cache/serve | Check cache → generate if missing → serve |
| 7 | Output | Video stream to browser |

### 10.4 Download Flow

| Step | Action | Description |
|------|--------|-------------|
| 1 | Start request | POST /api/download/start {url, category} |
| 2 | Task creation | `createTask()` in downloader/manager.js |
| 3 | Route lookup | Category route → /home/CATIAA/Videos/YouTube (video) |
| 4 | Download | yt-dlp / gallery-dl / aria2c spawn |
| 5 | Post-process | Audio → /home/CATIAA/Music/YouTube; Image → /home/CATIAA/Pictures/TikTok; Video → /home/CATIAA/Videos/YouTube |
| 6 | Dedup check | SHA256 check against download-counter.json |
| 7 | Codec check | Transcode if needed |
| 8 | Final move | Atomic move to final directory |

### 10.5 Monitoring Flow

| Step | Action | Description |
|------|--------|-------------|
| 1 | Engine start | `startEngine()` → setInterval(collectAll, 3000) |
| 2 | Collection | `collectAll()` → CPU, Memory, GPU, Disk, Network, System collectors |
| 3 | Aggregation | Aggregate into stats object |
| 4 | Broadcast | WebSocket broadcast (throttled 3000ms) |
| 5 | Snapshot | `recordSnapshot()` every 30s → historical_metrics table |
| 6 | Alerting | `checkAlerts()` on every tick |

### 10.6 Monitoring Subsystem Call Graph

| Component | Path | Purpose |
|-----------|------|---------|
| Engine | monitor/engine.js | Poll loop coordinator |
| CPU collector | monitor/collectors/cpu.js | /proc/stat, /sys/devices/system/cpu/* |
| Memory collector | monitor/collectors/memory.js | /proc/meminfo |
| GPU collector | monitor/collectors/gpu.js | nvidia-smi (cached 3s) |
| Disk collector | monitor/collectors/disk.js | statvfs, smartctl (cached 60s) |
| Network collector | monitor/collectors/network.js | /sys/class/net/*, /proc/net/fib_trie |
| System collector | monitor/collectors/system.js | /proc/uptime, uname |
| WebSocket | monitor/websocket.js | broadcast() |
| Historical | monitor/historical.js | recordSnapshot() every 30s |
| Alerts | monitor/alerts.js | checkAlerts() |
| Web stats | monitor/webStats.js | HTTP/web stats |
| Cache sensor | monitor/monitoringCache.js | Forked child (sensors-worker.mjs) |

### 10.7 Playback Subsystem Call Graph

| Component | Path | Purpose |
|-----------|------|---------|
| Stream router | routes/stream.js | Entry point |
| Playback engine | utils/playbackEngine.js | Main playback logic |
| probeVideoFile() | utils/playbackEngine.js | ffprobe for codec info |
| remuxToMkv() | utils/playbackEngine.js | ffmpeg -c copy -f matroska |
| transcodeToH264Mp4() | utils/playbackEngine.js | ffmpeg libx264/aac |
| getPlaybackDecision() | utils/playbackEngine.js | Codec decision tree |
| cleanupCache() | utils/playbackEngine.js | LRU eviction |
| HLS generator | utils/hlsGenerator.js | HLS segment pipeline |
| spawnFfmpeg() | utils/hlsGenerator.js | ffmpeg -f hls |
| remuxFaststart() | utils/hlsGenerator.js | moov atom fix |
| File resolver | utils/fileResolver.js | Path resolution |

### 10.8 Scan Subsystem Call Graph

| Component | Path | Purpose |
|-----------|------|---------|
| File watcher | utils/watcher.js | fs.watch event handler |
| File scanner | utils/fileScanner.js | Main scan loop |
| incrementalSync() | utils/fileScanner.js | Incremental sync |
| getFileId() | utils/fileScanner.js | MD5 hash |
| computeContentHash() | utils/fileScanner.js | Partial file hash |
| getDuration() | utils/fileScanner.js | ffprobe duration |
| probeVideoMetadata() | utils/fileScanner.js | ffprobe format info |
| updateCodecInfo() | utils/fileScanner.js | DB codec_info update |
| Thumbnail queue | utils/thumbnailQueue.js | Thumbnail generation queue |
| addFile() | utils/thumbnailQueue.js | Queue thumbnail job |
| drainQueue() | utils/thumbnailQueue.js | Process with concurrency |
| Database | db.js | DB statements |
| upsertFile/upsertFolder() | db.js | DB write operations |
| syncFTSIndex() | db.js | FTS maintenance (fork worker) |

### 10.9 Download Subsystem Call Graph

| Component | Path | Purpose |
|-----------|------|---------|
| Download router | routes/downloader.js | Entry point |
| Manager | downloader/manager.js | Task management |
| createTask() | downloader/manager.js | Task creation |
| processTask() | downloader/manager.js | yt-dlp/gallery-dl/aria2c spawn |
| postProcessFile() | downloader/manager.js | Move/embed operations |
| SOURCE_ROUTES | downloader/manager.js | YouTube/TikTok/Instagram/Twitter/Torrent paths |

---

## 11. Configuration & Paths

**File:** `backend/src/config/paths.js`

`PROJECT_ROOT` is **4 levels up** from `config/`. All cache/log dirs under `cache/` and `logs/` are auto-created. `PATHS` getters:

|  Getter               |  Resolved To                            |
|---------------------|---------------------------------------|
|  `cacheRoot`          |  `<project>/cache/`                     |
|  `playbackRemux`      |  `<project>/cache/playback/remux/`      |
|  `playbackTranscode`  |  `<project>/cache/playback/transcode/`  |
|  `playbackLru`        |  `<project>/cache/playback/lru.json`    |
|  `hls`                |  `<project>/cache/hls/`                 |
|  `thumbnails`         |  `<project>/data/thumbnails/`           |
|  `downloader`         |  `<project>/cache/downloader/`          |
|  `metadata`           |  `<project>/cache/metadata/`            |
|  `temp`               |  `<project>/cache/temp/`                |
|  `logsRoot`           |  `<project>/logs/`                      |
|  `mediaRoot`          |  First `MEDIA_ROOT` path                |

`SETTINGS` getters with real defaults:

|  Constant              |  Default        |  Source                                 |
|----------------------|---------------|---------------------------------------|
|  `maxCacheSizeBytes`   |  10 GiB         |  `playback.maxCacheSizeGB ?? 10`        |
|  `maxCacheAgeMs`       |  30 days        |  `playback.maxCacheAgeDays ?? 30`       |
|  `cleanupIntervalMs`   |  24 hours       |  `playback.cleanupIntervalHours ?? 24`  |
|  `probeTimeoutMs`      |  15000 ms       |  `playback.probeTimeoutMs ?? 15000`     |
|  `lruEnabled`          |  true           |  `playback.lruEnabled ?? true`          |
|  `logLevel`            |  'info'         |  `playback.logLevel ?? 'info'`          |
|  `hlsSegmentDuration`  |  3 (hardcoded)  |  HLS segment length                     |
|  `shutdownTimeoutMs`   |  30000 ms       |  `playback.shutdownTimeoutMs ?? 30000`  |

---

## 12. Environment Variables

|  Variable                    |  Default                     |  Used By                                                 |  Notes                                            |
|----------------------------|----------------------------|--------------------------------------------------------|-------------------------------------------------|
|  `PORT`                      |  3001                        |  server.js                                               |  HTTP/WS port; retries 3002–3006 on `EADDRINUSE`  |
|  `MEDIA_ROOT`                |  `/home/CATIAA/homelab`      |  server.js, fileScanner.js, uploadManager.js, upload.js  |  Colon-separated list supported (split on `:`)    |
|  `MAX_CONCURRENT_DOWNLOADS`  |  3                           |  downloader/manager.js                                   |  yt-dlp/gallery-dl concurrency cap                |
|  `TELEGRAM_BOT_TOKEN`        |  (unset)                     |  telegramBot.js, routes/send.js                          |  If absent, Telegram send is disabled             |
|  `TELEGRAM_CHAT_ID`          |  `<your_telegram_chat_id>`   |  routes/send.js, telegramBot.js                          |  Default target chat (set via env)                |
|  `MONITOR_DISABLE_GPU`       |  (unset)                     |  monitor/collectors/gpu.js                               |  Any truthy → GPU collector returns null          |
|  `DISPLAY`                   |  `:0`                        |  routes/scrcpy.js                                        |  Passed to scrcpy child                           |
|  `TARGET_CHAT_JID`           |  `<your_whatsapp_chat_jid>`  |  whatsapp-bot/config.js                                  |  WhatsApp target chat                             |
|  `ALLOWED_GROUPS`            |  (unset)                     |  whatsapp-bot/config.js                                  |  Comma-separated allowed groups                   |

> **Note:** A `.env` file exists at the repo root (gitignored, contains secrets — never commit it). The backend uses `--env-file-if-exists=.env` (optional). `MEDIA_ROOT` default is a single path; when multiple are provided they are split on `:`.

---

## 13. Background Jobs / Scheduler

|  Job                  |  Interval                |  Function                             |
|---------------------|------------------------|-------------------------------------|
|  WAL checkpoint       |  60 min                  |  `PRAGMA wal_checkpoint(TRUNCATE)`    |
|  Orphan cleanup       |  10 min                  |  Remove DB records for missing files  |
|  Metadata enrichment  |  10 min                  |  ffprobe duration backfill            |
|  Analytics            |  24 h                    |  `PRAGMA ANALYZE`                     |
|  Metrics cleanup      |  24 h                    |  Remove old historical rows           |
|  Playback cleanup     |  24 h                    |  LRU eviction                         |
|  FS watcher           |  5s periodic + debounce  |  Incremental scan trigger             |

---

## 14. Performance, Memory, Disk, Concurrency

### 14.1 Key Optimizations (Implemented)

|  Layer       |  Optimization               |  Impact                       |
|------------|---------------------------|-----------------------------|
|  Database    |  Sync API (better-sqlite3)  |  Zero async overhead          |
|  Database    |  WAL mode                   |  Concurrent reads             |
|  Database    |  80MB cache + 4GB mmap      |  Large working set in memory  |
|  Monitoring  |  Async collectors + cached  |  Non-blocking sensor reads    |
|  Thumbnails  |  Concurrency-limited queue  |  Controlled parallelism       |

### 14.2 Known Bottlenecks

|  Component           |  Issue                         |  Mitigation                |
|--------------------|------------------------------|--------------------------|
|  Orphan cleanup      |  Full table scan + existsSync  |  Batched processing        |
|  Recursive counts    |  Full CTE every 5 min          |  Background async          |
|  Instagram download  |  Sequential workspace          |  1 concurrent + 12s delay  |

### 14.3 Threading & Async Model

|  Component              |  Threading Model                                                 |
|-----------------------|----------------------------------------------------------------|
|  Database               |  Single-process, sync API (better-sqlite3)                       |
|  HTTP server            |  Single Node.js event loop                                       |
|  Monitoring collectors  |  Synchronous reads with in-memory caching (sensor reads forked)  |
|  Thumbnail generation   |  Async queue, configurable concurrency (default: 32)             |
|  ADB transfers          |  Background workers via adbWorkerPool.js (parallel: 3)           |
|  Download tasks         |  Managed by downloader/manager.js (max concurrent: 3)            |

### 14.4 Memory Usage Patterns

|  Subsystem         |  Memory Profile                           |
|------------------|-----------------------------------------|
|  SQLite cache      |  ~80MB page cache + 4GB mmap virtual      |
|  Playback cache    |  LRU-managed, max 10GB default            |
|  Thumbnail cache   |  Flat directory, grows with library size  |
|  Monitoring store  |  ~500 rows time-series buffer             |

### 14.5 Disk Usage

|  Location            |  Usage Pattern                       |
|--------------------|------------------------------------|
|  `data/media.db`     |  SQLite WAL, grows with library      |
|  `cache/playback/`   |  Transient, cleaned by LRU           |
|  `cache/hls/`        |  TTL 60 min, cleaned by maintenance  |
|  `data/thumbnails/`  |  Permanent, never auto-evicted       |

### 14.6 Concurrency Limits

|  Subsystem    |  Limit               |  Source                       |
|-------------|--------------------|-----------------------------|
|  Downloads    |  3 concurrent        |  `MAX_CONCURRENT_DOWNLOADS`   |
|  Instagram    |  1 concurrent        |  Instagram pipeline           |
|  Thumbnails   |  32 concurrent       |  `thumb.concurrent` setting   |
|  ADB workers  |  3 concurrent / job  |  `max_workers` option         |
|  Uploads      |  4 concurrent        |  `upload.concurrent` setting  |

---

## 15. Security & Production

### 15.1 Authentication

|  Area         |  Status                      |
|-------------|----------------------------|
|  API          |  None (LAN/trusted network)  |
|  WebSocket    |  None (WS endpoint)          |
|  SSE          |  None                        |
|  File access  |  Restricted to `MEDIA_ROOT`  |

### 15.2 Recommended Reverse Proxy

For external access, place behind Caddy/Traefik with:
- OAuth or mTLS authentication
- Rate limiting for API endpoints
- TLS termination

### 15.3 File Access Protection

- All file paths resolved via `getRelPath()` + `resolveFullPath()`
- MD5 hash used as ID prevents path injection
- `MEDIA_ROOT` restriction enforced in scanner
- Filename sanitization: removes `..`, `/`, `\`, `\0`, max 255 chars

### 15.4 Docker Sidecars

Docker is **not** used to containerize the backend. It only hosts two optional sidecars (see §16). No auth layer exists by default — the API is open on the LAN; a reverse proxy is required for external exposure.

### 15.5 Orphaned / Unused Config

`Docker/litellm-config.yaml` **exists but is ORPHANED** — it is not mounted by `docker-compose.yml` and there is no litellm service. Do not assume an active LLM proxy.

---

## 16. Deployment

### 16.1 Backend (Native Node Process)

The media server backend is **not** containerized. Run it directly:

```bash
cd backend && npm install && npm start
# listens on 0.0.0.0:3001 (retries 3002–3006 on EADDRINUSE)
```

The frontend is a static SPA served by Express (built via `vite build`, or run with `vite --host 0.0.0.0` in dev).

### 16.2 Docker Sidecars Only

**File:** `Docker/docker-compose.yml`

```
waha:
  image: devlikeapro/waha
  ports: 3002:3000
  environment: WHATSAPP_DEFAULT_ENGINE=WEBJS
  volumes: ./waha-data:/app/.sessions

nginx-nvidia:
  image: nginx:alpine
  ports: 4000:4000
  volumes: ./nginx-nvidia/nginx.conf:/etc/nginx/nginx.conf:ro
```

- **waha** — WhatsApp API (devlikeapro/waha). Optional companion to the WhatsApp bridge.
- **nginx-nvidia** — a reverse proxy + rate limiter to `https://integrate.api.nvidia.com`: rate limit **39 req/min per IP**, burst 5, returns **429**; adds `X-RateLimit-Source: nginx` and `Retry-After: 5`; forwards `Authorization`/`Content-Type`/`Host`; `proxy_ssl_server_name on`.

> **Note:** `litellm-config.yaml` is present in `Docker/` but is **not** mounted and there is no litellm service — treat it as unused.

### 16.3 Ignored / Committable Paths (`.gitignore`)

Ignored: `.aider*`, `*.log`, `whatsapp-bot/.sessions`, `whatsapp-bot/media/raw/*`, `whatsapp-bot/media/processed/*`, `whatsapp-bot/logs/*`, `cache/`, `logs/`.

**Not** ignored (flag for awareness): `data/` (holds `media.db` + `thumbnails/`) and `Docker/waha-data/` are committable — the DB/thumbnails could be committed unintentionally.

### 16.4 Production Checklist

|  Task                     |  Description                                                                         |
|-------------------------|------------------------------------------------------------------------------------|
|  Environment variables    |  Set `PORT`, `MEDIA_ROOT`, `MAX_CONCURRENT_DOWNLOADS`                                |
|  Database initialization  |  Run first scan via `/api/refresh`                                                   |
|  Reverse proxy            |  Configure Caddy/Traefik for TLS termination + auth                                  |
|  Monitoring setup         |  Configure alert thresholds                                                          |
|  Backup strategy          |  Schedule SQLite WAL backups                                                         |
|  Secrets                  |  Ensure `data/` and `Docker/waha-data/` are excluded from VCS if they contain state  |

---

## 17. Error Handling & Failure Modes

### 17.1 Playback

|  Scenario                      |  Handling                                 |
|------------------------------|-----------------------------------------|
|  ffprobe failure               |  Fallback to transcode, cache miss        |
|  FFmpeg remux failure          |  Log error, return error state            |
|  Cache disk full               |  LRU evict oldest entries                 |
|  Corrupted cache entry         |  Skip on validateIntegrity(), regenerate  |
|  Concurrent same-file request  |  Dedup via activeJobs Map                 |

### 17.2 Scanner

|  Scenario               |  Handling                        |
|-----------------------|--------------------------------|
|  File access denied     |  Log warning, continue scan      |
|  fs.watch error         |  Log, keep other watchers alive  |
|  SQLite locked          |  busy_timeout=5000, retry        |
|  Invalid file metadata  |  Skip thumbnail for that file    |

### 17.3 Monitoring

|  Scenario                     |  Handling                               |
|-----------------------------|---------------------------------------|
|  nvidia-smi timeout           |  Return null, use cached value          |
|  smartctl not available       |  Disk widget shows partition info only  |
|  Collector timeout (3s)       |  Result set to null, continue           |
|  WebSocket client disconnect  |  Zombie cleanup every 30s               |

### 17.4 Downloader

|  Scenario                        |  Handling                              |
|--------------------------------|--------------------------------------|
|  Network error                   |  Retry max 3 with exponential backoff  |
|  Content error (age-restricted)  |  Fail immediately, no retry            |
|  Partial download                |  Resume via checksum                   |
|  Workspace cleanup failure       |  Orphan detection via scanner          |

---

## 18. Monitoring Dashboard Detail

### 18.1 Collector Architecture

|  Collector   |  Source                               |  Cache TTL                   |
|------------|-------------------------------------|----------------------------|
|  cpu.js      |  /proc/stat, /sys/devices/system/cpu  |  freq: 5s, temp: 3s          |
|  memory.js   |  /proc/meminfo                        |  None                        |
|  gpu.js      |  nvidia-smi                           |  3s                          |
|  disk.js     |  statvfs, smartctl                    |  SMART: 60s, partition: 30s  |
|  network.js  |  /sys/class/net, /proc/net/fib_trie   |  iface: 10s, fib: 30s        |
|  system.js   |  /proc/uptime, uname                  |  who: 10s, systemctl: 15s    |

**Engine poll interval:** **3000ms** (`pollIntervalMs` in `engine.js`). **Broadcast throttle:** **3000ms** (`BROADCAST_THROTTLE_MS`). **Snapshot interval:** **30000ms** (historical metrics every 30s). The dashboard *setting* `monitor.refreshInterval` (default 1000ms) is the **frontend polling fallback** interval, not the backend poll.

### 18.2 WebSocket Message Format

```json
{
  "type": "stats",
  "data": {
    "cpu": { "usedPercent": 45, "userPercent": 25, "sysPercent": 10, "iowaitPercent": 5, "temp": { "temp": 62, "sensors": [] }, "loadAvg": { "1min": 0.5, "5min": 0.4, "15min": 0.3 } },
    "ram": { "used": 8.2, "total": 16, "usedPercent": 51, "swap": { "used": 0, "total": 8 } },
    "gpu": { "usedPercent": 75, "vramUsed": 4.2, "vramTotal": 8, "temperature": 72 },
    "disk": { "used": 850, "total": 1000, "usedPercent": 85, "main": { "used": 850, "total": 1000, "usedPercent": 85 }, "io": { "readBytes": 1024000, "writeBytes": 512000 } },
    "network": { "total": { "rxSpeed": 1000000, "txSpeed": 500000 } },
    "thumbnails": { "onDisk": 15000, "inDb": 14800, "missing": 200, "skipped": 50 },
    "timestamp": 1718971200000
  },
  "alerts": []
}
```

### 18.3 Alert Threshold Logic (`monitor/alerts.js`)

```javascript
const defaultThresholds = {
  cpu: { enabled: true, warning: 80, critical: 95 },
  memory: { enabled: true, warning: 85, critical: 95 },
  disk: { enabled: true, warning: 85, critical: 95 },
  temperature: { enabled: true, warning: 75, critical: 85 },
  gpuTemp: { enabled: true, warning: 80, critical: 90 },
};

function checkAlerts(currentStats) {
  const alerts = loadAlerts();
  const triggered = [];
  // CPU / memory / disk / cpuTemp / gpuTemp checks (see §18.1 collectors)
  // Deduplication: only new alerts every 60s
  const newAlerts = triggered.filter(t => {
    const prev = alerts.history.find(e => e.type === t.type && e.severity === t.severity);
    if (!prev) return true;
    return (new Date(t.timestamp) - new Date(prev.timestamp)) > 60000;
  });
  if (newAlerts.length > 0) {
    alerts.history.unshift(...newAlerts);
    alerts.history = alerts.history.slice(0, 200);
    flushToDisk();
  }
  return triggered;
}
```

### 18.4 Dashboard Widgets

|  Widget         |  File                                    |  Data Source                    |
|---------------|----------------------------------------|-------------------------------|
|  CpuWidget      |  `monitoring/widgets/CpuWidget.jsx`      |  CPU collector + per-core freq  |
|  MemoryWidget   |  `monitoring/widgets/MemoryWidget.jsx`   |  RAM collector + swap           |
|  DiskWidget     |  `monitoring/widgets/DiskWidget.jsx`     |  Disk collector + SMART         |
|  GpuWidget      |  `monitoring/widgets/GpuWidget.jsx`      |  GPU collector (nvidia-smi)     |
|  NetworkWidget  |  `monitoring/widgets/NetworkWidget.jsx`  |  Network collector              |
|  SystemWidget   |  `monitoring/widgets/SystemWidget.jsx`   |  System collector               |
|  MiniGauge      |  `monitoring/widgets/MiniGauge.jsx`      |  Direct DOM, CSS transition     |

---

## 19. Future Extensions / Roadmap

### 19.1 Architecture Scaling Options

|  Option                |  Description                                              |  Effort  |
|----------------------|---------------------------------------------------------|--------|
|  Multi-process         |  Split monitoring/download/scanner to separate processes  |  High    |
|  Thumbnail sharding    |  256 subdirs for filesystem performance                   |  Medium  |
|  Hardware transcoding  |  NVENC/Intel QuickSync for H.264                          |  Medium  |
|  Remote DB             |  PostgreSQL/MySQL for network access                      |  High    |
|  WebSocket clusters    |  Multiple server instances with sticky sessions           |  High    |

### 19.2 Planned Features

|  Feature                  |  Status    |  Notes                         |
|-------------------------|----------|------------------------------|
|  AMD GPU monitoring       |  Reserved  |  Currently NVIDIA-only         |
|  Hardware encoder         |  Reserved  |  Requires NVENC/QSV detection  |
|  OAuth authentication     |  Reserved  |  For external access           |
|  Plugin download sources  |  Reserved  |  Abstract yt-dlp wrapper       |
|  Thumbnail sharding       |  Reserved  |  id % 256 for 256 subdirs      |

> **Note:** See `docs/archive/ideas/IDEAS.md` for the authoritative roadmap (Auth, Resume Playback, External Subtitles, etc.). Items above summarize the commonly referenced ideas.

---

## 20. Development Notes

### 20.1 Adding New API Endpoint

1. Add route handler in `backend/src/routes/*.js`
2. If needs DB: add prepared statement in `db.js`
3. Add settings key in `deferredDbInit()` if configurable
4. Test endpoint with curl/postman
5. Update ARCHITECTURE.md with endpoint spec

### 20.2 Adding New Downloader Source

1. Add entry to `SOURCE_ROUTES` in `manager.js`
2. Create output directory `mkdirSync` in init block
3. Add quality options to `QUALITY_MAP`
4. Add format selector if needed in `SOURCE_FORMAT_PREFERENCE`
5. Test with real URL

### 20.3 Adding New Playback Rule

1. Modify `getPlaybackDecision()` in `playbackEngine.js`
2. Add new constants (REGEX) at top of file
3. Add handling function (`handleNewRule`)
4. Update cleanup logic if needed
5. Add stat tracking for the new action

### 20.4 Adding New Monitoring Collector

1. Create `backend/src/monitor/collectors/<name>.js` exporting a `collect()` function
2. Register it in `monitor/engine.js` `collectAll()`
3. Add aggregation + WS field
4. Add dashboard widget in `frontend/src/monitoring/widgets/`

---

## 21. Debug / Operations Commands

### 21.1 Debugging Playback

```bash
# Check cache
ls -la cache/playback/remux/
ls -la cache/playback/transcode/

# View stats
curl http://localhost:3001/api/playback/stats

# Check codec
ffprobe -v quiet -show_streams -show_format /path/to/file
```

### 21.2 Debugging Scanner

```bash
# Run incremental scan
curl -X POST http://localhost:3001/api/refresh

# Check FTS
sqlite3 data/media.db "SELECT * FROM files_fts LIMIT 10;"

# Check orphans
curl http://localhost:3001/api/files/stats
```

### 21.3 Monitoring

```bash
# Check WebSocket connection
wscat -c ws://localhost:3001/ws/monitor

# Verify collector data
curl http://localhost:3001/api/monitoring/stats

# Test alert thresholds
curl -X POST http://localhost:3001/api/monitoring/alerts/check
```

### 21.4 Backend Logs

```bash
# Live log stream (SSE)
curl -N http://localhost:3001/api/logs/stream

# WhatsApp bridge logs (SSE)
curl -N http://localhost:3001/api/whatsapp/logs/stream
```

---

## 22. Appendix: Codebase Metrics

Counts measured from source on **2026-07-18** (recursive, `node_modules` excluded). Replaces the earlier estimated figures.

|  Module                      |  Files  |         LOC  |
|----------------------------|-------|------------|
|  `backend/src/server.js`     |      1  |         488  |
|  `backend/src/db.js`         |      1  |       1,091  |
|  `backend/src/routes/`       |     19  |       6,051  |
|  `backend/src/utils/`        |     41  |       9,440  |
|  `backend/src/monitor/`      |     17  |       2,403  |
|  `backend/src/downloader/`   |      1  |       1,936  |
|  `frontend/src/App.jsx`      |      1  |       2,385  |
|  `frontend/src/components/`  |      —  |      13,852  |
|  `frontend/src/monitoring/`  |     39  |       8,544  |
|  `frontend/src/store/`       |      5  |         268  |
|  `frontend/src/hooks/`       |      —  |         718  |
|  `frontend/src/utils/`       |     11  |       1,146  |
|  `frontend/src/debug/`       |      —  |       1,180  |
|  `whatsapp-bot/src/`         |      6  |         794  |
|  **Backend total**           |         |  **21,409**  |
|  **Frontend total**          |         |  **28,093**  |
|  **WhatsApp bot**            |         |     **794**  |
|  **Grand total**             |         |  **50,296**  |

---

## 23. Appendix: Version History

|  Version   |  Date        |  Changes                                                                                                                                                                                                                                                                                                                                                                                                             |
|----------|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|  Doc v3.1  |  2026-07-18  |  Documentation cleanup: removed 3 duplicate `ARCHITECTURE copy*.md` and `fix_architecture.py`; archived scratch/debug docs to `docs/archive/`. Corrected SoT vs code: added missing frontend deps (`qrcode`, `source-map-js`), fixed `react-router-dom` usage note, clarified `utils/` = 38 `.js` + 3 `.py`, fixed env-var section (`.env` exists; placeholder chat IDs), updated store count to 5, added accurate Codebase Metrics appendix, updated dates in header and metrics.  |
|  Doc v3.0  |  2026-07-08  |  Verified against codebase; corrected route count (19), monitor poll (3000ms), WhatsApp embedded status, `registry.js`/`downloader/manager.js` paths, added `webStats.js` + forked workers, `youtube_id`/`video_offset` columns, full index list, dependency tables, frontend architecture, env vars. Codebase versions: backend 1.0.0, frontend 1.0.0.                                                              |
|  Doc v2.4  |  2026-07-05  |  Prior doc revision (note: "2.4.0" referred to documentation only, not the application).                                                                                                                                                                                                                                                                                                                             |
|  Doc v2.3  |  2026-07-02  |  Initial comprehensive documentation.                                                                                                                                                                                                                                                                                                                                                                                |
