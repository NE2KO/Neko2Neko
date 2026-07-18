# Media Vault — Documentation & Architecture

> 🇬🇧 **English** · 🇮🇩 [Bahasa Indonesia](READMEID.md)

> **Document version:** Doc v3.0 — 2026-07-08
> **Codebase package versions:** backend `homelab-media-server` **v1.0.0**, frontend `homelab-media-frontend` **v1.0.0**, whatsapp-bot **v1.0.0**
> **Stack:** Node.js (ESM) + Express + SQLite (better-sqlite3) · React 18 + Vite 5 + TailwindCSS 3 · FFmpeg + FFprobe · hls.js

> **Single Source of Truth.** This document is the authoritative reference for the Media Vault system. It was verified against the actual codebase on **2026-07-08** (package manifests, `server.js`, `db.js`, `monitor/*`, `routes/*`, `config/paths.js`, and deployment files). Where a fact could not be confirmed it is marked as a **note** rather than asserted. Application logic versions are the package versions above — there is **no** application version "2.4.0"; that string was a documentation artifact in prior revisions.

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
  - `start`: `node --env-file=../credentials/.env src/server.js`
  - `dev`: `node --env-file=../credentials/.env --expose-gc --watch src/server.js`
  - `debug`: `node --env-file=../credentials/.env --inspect --expose-gc src/server.js`

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
|  zustand                       |  ^5.0.13   |  State management (6 stores)                                         |

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
- Scripts: `start`: `node --env-file=../credentials/.env src/index.js` · `dev`: `node --env-file=../credentials/.env --watch src/index.js`
- Dependencies: `whatsapp-web.js ^1.34.7`, `better-sqlite3 ^12.9.0`, `qrcode-terminal ^0.12.0`
- Source layout (`whatsapp-bot/src/`): `index.js`, `connection.js`, `listener.js`, `sender.js`, `db.js`, `utils.js`. (Uses `whatsapp-web.js`, **not** baileys.)
- Note: `connection.js` reads WhatsApp auth from `credentials/.wwebjs_auth/` via `WA_AUTH_DIR` env var or default path.

---

## 3. System Architecture

### 3.1 High-Level Component Diagram

| Component | Description | Protocols |
|-----------|-------------|-----------|
| **Browser** | React SPA served static via Express | HTTP, WS, SSE |
| **Backend** | Express server on port 3001 | - |
| **Core Modules** | `server.js` -> `routes/*` -> `utils/*` -> `db.js` (SQLite) | - |
| `fileScanner.js` | Incremental scan, mtime comparison | - |
| `thumbnailQueue.js` | Concurrency-limited thumbnail generation | - |
| `watcher.js` | `fs.watch` debounce -> SSE broadcast | SSE |
| `playbackEngine.js` | Remux/transcode/HLS, LRU cache | - |
| `hlsGenerator.js` | FFmpeg HLS segment pipeline | - |
| `downloader/manager.js` | yt-dlp/gallery-dl/aria2c | - |
| `monitor/engine.js` | Poll loop (3000ms), collect->aggregate->WS | WS |
| `monitor/collectors/*` | cpu, memory, gpu, disk, network, system | - |
| **Data Stores** | - | - |
| `data/media.db` | SQLite (WAL, 80MB cache, FTS5 index) | - |
| `cache/` | `playback/remux/`, `playback/transcode/`, `hls/`, `downloader/` | - |

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

```
homelab-media-server/
├── backend/
│   ├── src/
│   │   ├── server.js           Entry point — Express, lifecycle, shutdown
│   │   ├── db.js               Schema, prepared statements, FTS, settings
│   │   ├── config/
│   │   │   └── paths.js        Path resolution, SETTINGS constants
│   │   ├── routes/             (19 modules — see §7)
│   │   │   ├── adb.js          ADB device list, transfer jobs
│   │   │   ├── downloader.js   Download task management (yt-dlp etc.)
│   │   │   ├── file.js         Raw file serve (cache headers, range)
│   │   │   ├── files.js        File listing, FTS search, cursor pagination
│   │   │   ├── jobs.js         Background job status
│   │   │   ├── metadata.js     Audio metadata, cover art, lyrics
│   │   │   ├── monitoring.js   Stats, history, alerts, processes
│   │   │   ├── mpd.js          MPD/Strawberry player control
│   │   │   ├── playback.js     Playback cache, LRU, health, config
│   │   │   ├── scrcpy.js       Scrcpy control endpoint
│   │   │   ├── send.js         Mounted at /api/send (Telegram / broadcast)
│   │   │   ├── services.js     Service health registry API
│   │   │   ├── settings.js     Runtime config CRUD
│   │   │   ├── stream.js       Video/audio streaming, HLS, transcode
│   │   │   ├── thumbnails.js   Thumbnail generate-if-missing + serve
│   │   │   ├── upload.js       Multipart upload (Busboy)
│   │   │   ├── videoCache.js   Mounted at /api/video-cache
│   │   │   └── whatsapp.js     WhatsApp bridge (embedded via initWhatsApp)
│   │   ├── middleware/
│   │   │   └── serviceGuard.js requireService() route protection
│   │   ├── services/
│   │   │   └── registry.js     Service health registry (NOT utils/registry.js)
│   │   ├── downloader/
│   │   │   └── manager.js      yt-dlp/gallery-dl/aria2c wrapper, task queue
│   │   ├── monitor/
│   │   │   ├── alerts.js           Threshold checking, dedupe 60s
│   │   │   ├── docker.js           Docker container monitoring
│   │   │   ├── collectors/
│   │   │   │   ├── cpu.js          CPU usage, per-core, temp
│   │   │   │   ├── disk.js         Disk usage, SMART (cached)
│   │   │   │   ├── gpu.js          NVIDIA GPU (cached)
│   │   │   │   ├── memory.js       RAM, swap
│   │   │   │   ├── network.js      Interface throughput
│   │   │   │   └── system.js       Uptime, platform, hostname
│   │   │   ├── docker.js           Docker container monitoring
│   │   │   ├── engine.js           Poll loop (3000ms), collect→aggregate→WS
│   │   │   ├── historical.js       Time-series (historical_metrics), 30s snapshot, 7d retention
│   │   │   ├── logs.js             journalctl reader
│   │   │   ├── monitoringCache.js  Forked child for sensor reads
│   │   │   ├── platdetect.js       Platform detection
│   │   │   ├── processes.js        Process enumeration
│   │   │   ├── services.js         Systemd service manager
│   │   │   ├── webStats.js         Web/HTTP stats + log integration
│   │   │   └── websocket.js        WS server (/ws/monitor), zombie cleanup (30s)
│   │   ├── utils/                  (41 files — see note below)
│   │   │   ├── adbManager.js        ADB device management
│   │   │   ├── adbMetadata.js     Permission/timestamp sync
│   │   │   ├── adbTransaction.js    ADB transfer engine
│   │   │   ├── adbWorkerPool.js     Concurrent ADB workers
│   │   │   ├── avSync.js            Audio/video sync utilities
│   │   │   ├── coverSources.js      Cover art provider aggregation
│   │   │   ├── fileResolver.js      Path resolution from DB
│   │   │   ├── fileScanner.js       Recursive walk, incremental sync
│   │   │   ├── genius.js            Genius lyrics source
│   │   │   ├── hlsGenerator.js      FFmpeg HLS segments
│   │   │   ├── jobQueue.js          Generic job queue (reserved/deprecated)
│   │   │   ├── lyricsSources.js     Lyrics provider aggregation
│   │   │   ├── logCapture.js        Log ring buffer + SSE
│   │   │   ├── logger.js            Category-based file logger
│   │   │   ├── lrclib.js            LRCLIB lyrics API
│   │   │   ├── lrcParser.js         LRC format parser
│   │   │   ├── lrcmux.js            LRC muxing
│   │   │   ├── maintenance.js       Cleanup (orphan, WAL, HLS, ANALYZE)
│   │   │   ├── metadataWriter.js    music-metadata read, ffmpeg embed
│   │   │   ├── musicbrainz.js       Cover Art Archive API
│   │   │   ├── netease.js           NetEase lyrics source
│   │   │   ├── playbackEngine.js    Remux/transcode decisions, cache
│   │   │   ├── playlistScanner.js   XSPF discovery from filesystem
│   │   │   ├── pyjlyric.js          PyJLyric bridge
│   │   │   ├── romaji.js            Romaji transliteration
│   │   │   ├── runtimeSettings.js   In-memory settings cache, type casting
│   │   │   ├── sendCounter.js       Send/queue counters
│   │   │   ├── sendRateLimit.js     Rate limiting utilities
│   │   │   ├── sessionTracker.js    WS/session tracking
│   │   │   ├── telegramBot.js       Telegram client (optional)
│   │   │   ├── thumbnailQueue.js    Async queue, concurrency control
│   │   │   ├── thumbnailUtils.js    FFmpeg frame extract + scale resize (no sharp dep)
│   │   │   ├── uploadManager.js     Busboy multipart, SHA256 verify
│   │   │   ├── videoCache.js        Video cache bookkeeping
│   │   │   ├── watcher.js           fs.watch debounce, SSE broadcast
│   │   │   ├── xspfParser.js        XSPF playlist parser
│   │   │   ├── youtube.js           YouTube helpers
│   │   │   ├── ytdlp.js             yt-dlp wrapper
│   │   │   ├── embed_cover.py       Python: cover embed fallback
│   │   │   ├── romaji_convert.py    Python: romaji conversion
│   │   │   └── pyjlyric_search.py   Python: PyJLyric search
│   │   ├── fts-rebuild-worker.mjs   Forked worker — FTS5 rebuild
│   │   └── sensors-worker.mjs       Forked worker — sensor reads
│   └── (node_modules/, package.json)
│
├── backend/
│   ├── certs/                    SSL certificates
│   ├── scripts/
│   │   └── ig_download.py        Instagram download helper
│   ├── check_paths.cjs           Path validation script
│   ├── cache/                    Cache directory
│   ├── data/                     Persistent runtime data
│   │   ├── media.db              SQLite (WAL mode)
│   │   ├── download-tasks.json   Task persistence
│   │   ├── download-counter.json Instagram SHA256 counters
│   │   └── thumbnails/           Generated thumbnails
│   ├── metadata_cache/           Metadata cache
│   ├── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx               Central orchestrator (hash routing, ErrorBoundary)
│   │   ├── main.jsx              React entry (mounts <App/> in <DebugProvider>)
│   │   ├── index.css             Tailwind imports + global styles
│   │   ├── components/
│   │   │   ├── AdbTransfer.jsx
│   │   │   ├── AddMusicPanel.jsx
│   │   │   ├── AudioPlayer.jsx.backup2
│   │   │   ├── CachedVideoPlayer.jsx
│   │   │   ├── CaptionEditorModal.jsx
│   │   │   ├── Carousel.jsx
│   │   │   ├── ConfirmModal.jsx
│   │   │   ├── CoverArtSearch.jsx
│   │   │   ├── CropTool.jsx
│   │   │   ├── DuplicateConfirmModal.jsx
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── FilterPanel.jsx
│   │   │   ├── GaugeMeter.jsx
│   │   │   ├── GroupDivider.jsx
│   │   │   ├── HeaderComponents.jsx
│   │   │   ├── ImageViewer.jsx
│   │   │   ├── LyricsDisplay.jsx
│   │   │   ├── LyricsEditor.jsx
│   │   │   ├── LyricsScrollController.js
│   │   │   ├── MediaControls.jsx
│   │   │   ├── MediaControls.css
│   │   │   ├── MediaGrid.jsx
│   │   │   ├── MediaGrid.css
│   │   │   ├── MediaLayout.jsx
│   │   │   ├── MediaModal.jsx
│   │   │   ├── MetadataEditor.jsx
│   │   │   ├── MiniPlayer.jsx
│   │   │   ├── MonitoringView.jsx
│   │   │   ├── Music.jsx
│   │   │   ├── NetworkImage.jsx
│   │   │   ├── PlaylistGrid.jsx
│   │   │   ├── PlaylistGridCard.jsx
│   │   │   ├── PlaylistListItemRow.jsx
│   │   │   ├── PlaylistListRow.jsx
│   │   │   ├── PlaylistRow.jsx
│   │   │   ├── PlaylistView.jsx
│   │   │   ├── PlaylistView.css
│   │   │   ├── QueueActionBar.jsx
│   │   │   ├── QueuePanel.jsx
│   │   │   ├── ScrcpyView.jsx
│   │   │   ├── SendProgressPills.jsx
│   │   │   ├── SendQueuePlayer.jsx
│   │   │   ├── SendQueueView.jsx
│   │   │   ├── SendQueueView.jsx.orig
│   │   │   ├── ServiceStoppedBanner.jsx
│   │   │   ├── SpeakerOutputButton.jsx
│   │   │   ├── Toast.jsx
│   │   │   ├── UploadsMonitor.jsx
│   │   │   ├── VaultActionBar.jsx
│   │   │   ├── VaultAudioPlayer.jsx
│   │   │   ├── VaultBottomCluster.jsx
│   │   │   ├── VideoPlayer.jsx
│   │   │   ├── VideoPlayer.css
│   │   │   ├── WhatsAppView.jsx
│   │   │   └── icons/
│   │   │       ├── AudioIcon.jsx
│   │   │       ├── FolderIcon.jsx
│   │   │       ├── ImageIcon.jsx
│   │   │       ├── TelegramLogo.jsx
│   │   │       ├── VideoIcon.jsx
│   │   │       └── WaLogo.jsx
│   │   ├── debug/
│   │   │   ├── DebugBadge.jsx
│   │   │   ├── DebugOverlay.jsx
│   │   │   ├── DebugProvider.jsx
│   │   │   ├── DebugTooltip.jsx
│   │   │   ├── index.js
│   │   │   ├── inspectors/
│   │   │   │   ├── EventInspector.jsx
│   │   │   │   ├── HierarchyInspector.jsx
│   │   │   │   ├── LayoutInspector.jsx
│   │   │   │   ├── MemoryInspector.jsx
│   │   │   │   ├── PerformanceInspector.jsx
│   │   │   │   ├── RealtimeInspector.jsx
│   │   │   │   ├── StateInspector.jsx
│   │   │   │   ├── WebSocketInspector.jsx
│   │   │   │   └── ZIndexInspector.jsx
│   │   │   ├── useDebugStore.js
│   │   │   ├── useDebugTrack.js
│   │   │   └── utils/
│   │   │       ├── css.js
│   │   │       ├── dom.js
│   │   │       ├── memory.js
│   │   │       ├── route.js
│   │   │       ├── virtualization.js
│   │   │       └── websocket.js
│   │   ├── hooks/
│   │   │   ├── useDocumentHidden.js
│   │   │   ├── useSendProgress.js
│   │   │   ├── useServiceControl.js
│   │   │   ├── useUploadQueueLogic.jsx
│   │   │   ├── useVaultMediaActions.js
│   │   │   ├── useWaUnsupported.js
│   │   │   └── useWebSocket.js
│   │   ├── monitoring/
│   │   │   ├── components/
│   │   │   │   └── Charts/
│   │   │   │       └── MetricChart.jsx
│   │   │   │   └── LogTerminal.jsx
│   │   │   ├── layout/
│   │   │   │   ├── MonitoringLayout.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   └── TopBar.jsx
│   │   │   ├── pages/
│   │   │   │   ├── AlertsPage.jsx
│   │   │   │   ├── AudioPlayerPage.jsx
│   │   │   │   ├── ChartsPage.jsx
│   │   │   │   ├── DockerPage.jsx
│   │   │   │   ├── DownloaderPage.jsx
│   │   │   │   ├── JobsPage.jsx
│   │   │   │   ├── LogsPage.jsx
│   │   │   │   ├── MediaStatsPage.jsx
│   │   │   │   ├── MetricsTable.jsx
│   │   │   │   ├── NetworkPage.jsx
│   │   │   │   ├── Overview.jsx
│   │   │   │   ├── ProcessesPage.jsx
│   │   │   │   ├── QueuePage.jsx
│   │   │   │   ├── ServiceControlPage.jsx
│   │   │   │   ├── ServicesPage.jsx
│   │   │   │   ├── SessionsPage.jsx
│   │   │   │   ├── SettingsPage.jsx
│   │   │   │   ├── StatusPage.jsx
│   │   │   │   ├── StoragePage.jsx
│   │   │   │   ├── TasksPage.jsx
│   │   │   │   └── WhatsAppPage.jsx
│   │   │   ├── shared/
│   │   │   │   ├── DiskIoGauge.jsx
│   │   │   │   ├── GlassCard.jsx
│   │   │   │   ├── GradientBar.jsx
│   │   │   │   ├── Skeleton.jsx
│   │   │   │   └── StatusBadge.jsx
│   │   │   ├── stores/
│   │   │   │   └── monitoringStore.js
│   │   │   └── widgets/
│   │   │       ├── CpuWidget.jsx
│   │   │       ├── DiskWidget.jsx
│   │   │       ├── GpuWidget.jsx
│   │   │       ├── MemoryWidget.jsx
│   │   │       ├── MiniGauge.jsx
│   │   │       ├── NetworkWidget.jsx
│   │       └── SystemWidget.jsx
│   │   ├── store/
│   │   │   ├── favoritesStore.js
│   │   │   ├── folderMetaSortStore.js
│   │   │   ├── folderSortStore.js
│   │   │   ├── playbackStore.js
│   │   │   └── playlistStore.js
│   │   └── utils/
│   │       ├── adbApi.js
│   │       ├── api.js
│   │       ├── audioOutput.js
│   │       ├── codec.js
│   │       ├── filenameSearch.js
│   │       ├── format.js
│   │       ├── grouping.js
│   │       ├── lrcParser.js
│   │       ├── playlistApi.js
│   │       ├── playlistWindow.js
│   │       └── thumbCache.js
│   └── package.json
│
├── whatsapp-bot/
│   ├── src/
│   │   ├── connection.js         whatsapp-web.js client
│   │   ├── db.js                 SQLite state
│   │   ├── index.js              Entry
│   │   ├── listener.js           Message handler
│   │   ├── sender.js             Outbound sender
│   │   └── utils.js              Logger / helpers
│   └── package.json
│
├── data/                           Persistent runtime data
│   ├── media.db                  SQLite (WAL mode)
│   ├── download-tasks.json       Task persistence
│   ├── download-counter.json     Instagram SHA256 counters
│   └── thumbnails/               Generated thumbnails
│
├── cache/                          Ephemeral cache
│   ├── downloader/               Workspace
│   ├── hls/                      HLS segments
│   ├── playback/
│   │   ├── lru.json             LRU eviction state
│   │   ├── remux/               Cached MKV remux
│   │   └── transcode/           Cached H.264/AAC MP4
│
├── logs/                           Rotating logs
│   ├── api/
│   ├── downloader/
│   ├── maintenance/
│   ├── monitoring/
│   ├── playback/
│   ├── stream/
│   ├── system/
│   ├── upload/
│   └── web/
│
├── Docker/
│   ├── docker-compose.yml        WAHA + nginx-nvidia (optional sidecars)
│   ├── nginx-nvidia/
│   │   └── nginx.conf            Rate-limited proxy
│   ├── waha-data/
│   │   └── webjs/
│   └── litellm-config.yaml       ORPHANED — not mounted, no litellm service
│
├── credentials/                    Sensitive files (gitignored)
│   ├── .env                      Environment variables (secrets)
│   ├── .wwebjs_auth/             WhatsApp authentication
│   ├── cookies.txt               WhatsApp session cookies
│   ├── docs-debug/               Debug documentation
│   └── gtw.txt                   WhatsApp chat logs
│
├── certs/                          Certificate generation scripts
│   └── README.md
│
├── scripts/
│   └── README.md
│
├── docs/                           Documentation (gitignored)
│   └── archive/
│       └── ideas/
│           └── IDEAS.md
│
├── .env.example                    Environment template
├── package.json                    Root package.json (CommonJS, shared deps)
└── package-lock.json
```

> **Utils note:** `backend/src/utils/` contains **41 files**: 38 `.js` modules + 3 spawned `.py` helpers (`embed_cover.py`, `romaji_convert.py`, `pyjlyric_search.py`). The `.py` files are spawned as child processes, not imported; `registry.js` lives in `backend/src/services/`. The two `*.mjs` files at `backend/src/` root (`fts-rebuild-worker.mjs`, `sensors-worker.mjs`) are forked child workers.

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

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Boot                          │
└─────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────┴───────────────────────────────────────┐
│  Phase 1: Validation & Express Setup (t=0ms)               │
├─────────────────────────────────────────────────────────────┤
│ validateStartup()                                           │
│   ├── SQLite connectivity check (critical)                  │
│   ├── Writable directory check (cacheRoot, logsRoot, ...)   │
│   └── ffmpeg/ffprobe in PATH check (warning)               │
└─────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────┴───────────────────────────────────────┐
│  Phase 2: Listening & Immediate Init (t=0ms)               │
├─────────────────────────────────────────────────────────────┤
│ createServer → listen(3001)                                 │
│ registerAllServices()                                       │
│ startWebSocketServer(server)  → WS on /ws/monitor          │
│ startEngine(server)         → monitor engine (3000ms poll) │
│ startWatcher()              → fs.watch (debounce)          │
│ startMaintenanceScheduler()  → cleanup intervals            │
└─────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────┴───────────────────────────────────────┐
│  Phase 3: Deferred Init (t=0.5s–2s)                        │
├─────────────────────────────────────────────────────────────┤
│ initHistoricalTable()      (0.5s)                           │
│ deferredDbInit()           (1s)  seed 100+ settings, indexes│
│ startMonitoringCache()     (1.5s) forked sensor reads       │
│ setupFTS()                 (2s)  FTS5 rebuild worker        │
└─────────────────────┬───────────────────────────────────────┘
                       ▼
┌─────────────────────┴───────────────────────────────────────┐
│  Phase 4: Long-Running Tasks (t=5s, 10s, 20s)             │
├─────────────────────────────────────────────────────────────┤
│ scanPlaylists()      → discover .xspf files   (5s)          │
│ initWhatsApp()       → WhatsApp bridge        (10s, retries)│
│ runIncrementalScan() → walk MEDIA_ROOT if stale (20s)       │
└──────────────────────────────────────────────────────────────┘
```

---

### 5.5 Startup & Lifecycle Code (summary)

> The full verbatim source was removed for readability. Key startup/lifecycle behavior (see `backend/src/server.js`):

- **Prerequisite validation** — checks SQLite connectivity, writable `cache/`/`logs/`/`thumbnails` dirs (critical → `exit(1)`), and `ffmpeg`/`ffprobe` on PATH (warning only).
- **Middleware + routes** — mounts `cors`, `compression`, `express.json`, session tracking, and all `/api/*` routes behind per-service `requireService` guards (`mediaVault`, `downloader`, `adbTransfer`, `playlists`), then the static frontend and WhatsApp routes.
- **Deferred heavy init** — DB seed, FTS rebuild, historical table, monitoring cache, playlist scan, and the initial media scan (20 s after `listen()`) are staggered with `setTimeout` so the first HTTP response is not blocked. The initial scan is skipped when the DB is fresh (<24 h).
- **Graceful shutdown** — on `SIGINT`/`SIGTERM`/`SIGQUIT`: stop watcher → maintenance → monitor → WebSocket, drain active playback jobs (`waitForDrain`), persist the LRU cache, then `server.close()` with a forced exit after 15 s.

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

`db.js:14-20`. The tuning is applied once, synchronously, at module load.

> **What it does:** Applies the SQLite PRAGMA tuning once at module load: WAL (write-ahead log), `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-80000` (~80MB), `mmap_size=4GB`, `page_size=32768`.

`db.js:23-55`. Folders are created first (parent/child via `parent_id`); files reference `dir_id` and carry the codec/stream-compatibility columns.

> **What it does:** Creates the `folders` table (parent/child via `parent_id`, depth, counters) and the `files` table (media metadata + the `codec_info`, `is_stream_compatible`, `youtube_id`, `video_offset` columns) if they do not exist.

#### `files` Table

|  Column                       |  Type              |  Purpose                                            |
|-----------------------------|------------------|---------------------------------------------------|
|  id                           |  TEXT PRIMARY KEY  |  MD5 hash of file path                              |
|  dir_id                       |  INTEGER           |  Foreign key to folders                             |
|  name                         |  TEXT              |  Filename                                           |
|  type                         |  TEXT              |  'video', 'audio', 'image'                          |
|  ext                          |  TEXT              |  File extension                                     |
|  size                         |  INTEGER           |  File size in bytes                                 |
|  mtime                        |  INTEGER           |  Last modified timestamp                            |
|  duration                     |  REAL              |  Media duration in seconds                          |
|  has_thumb                    |  INTEGER           |  0/1/2 (no/yes/generating)                          |
|  thumb_cache_path             |  TEXT              |  Path to thumbnail file                             |
|  last_accessed                |  INTEGER           |  Last playback access                               |
|  access_count                 |  INTEGER           |  Playback count                                     |
|  last_verified                |  INTEGER           |  Last integrity check                               |
|  created_at                   |  INTEGER           |  Entry creation timestamp                           |
|  created_at_embedded          |  INTEGER           |  Embedded metadata timestamp                        |
|  modified_at_fs               |  INTEGER           |  Filesystem mtime                                   |
|  uploaded_at                  |  INTEGER           |  Upload timestamp                                   |
|  metadata_source              |  TEXT              |  'embedded', 'scan', 'upload'                       |
|  checksum                     |  TEXT              |  SHA256 hash for dedup                              |
|  codec_info                   |  TEXT              |  JSON ffprobe output                                |
|  is_stream_compatible         |  INTEGER           |  0/1 for playback decision                          |
|  title, artist, album, genre  |  TEXT              |  Media metadata                                     |
|  lyrics, lyrics_synced        |  TEXT              |  Lyrics content                                     |
|  cover_source                 |  TEXT              |  Cover art source                                   |
|  is_favorite                  |  INTEGER           |  0/1 favorite flag                                  |
|  youtube_id                   |  TEXT              |  Associated YouTube ID (for YouTube-sourced media)  |
|  video_offset                 |  REAL DEFAULT 0    |  Start offset (seconds) into source video           |

#### `folders` Table

|  Column                |  Type                 |  Purpose                  |
|----------------------|---------------------|-------------------------|
|  id                    |  INTEGER PRIMARY KEY  |  Auto-increment           |
|  path                  |  TEXT UNIQUE          |  Full folder path         |
|  parent_id             |  INTEGER              |  Parent folder reference  |
|  depth                 |  INTEGER              |  Nesting level            |
|  file_count            |  INTEGER              |  Direct file count        |
|  total_size            |  INTEGER              |  Direct file size         |
|  recursive_file_count  |  INTEGER              |  All descendant files     |
|  recursive_total_size  |  INTEGER              |  All descendant size      |
|  last_scanned          |  INTEGER              |  Last scan timestamp      |
|  last_updated          |  INTEGER              |  Last modification        |

#### `files_fts` Table

Virtual FTS5 table for full-text search on file names:
`files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1')` with triggers. Rebuilt via the forked `src/fts-rebuild-worker.mjs`.

`db.js:60-146`. `setupFTS()` forks `fts-rebuild-worker.mjs` (120s timeout); on failure it falls back to `deltaSyncFTS()`, which recreates the virtual table + the three `AFTER INSERT/DELETE/UPDATE` triggers and reconciles missing/orphan rowids without wiping the index.

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

#### 8.1.1 Playback decision

`getPlaybackDecision()` probes the file (cached codec_info or live ffprobe), then walks a small decision tree: browser container + H.264/HEVC + no Opus -> `direct`; browser container + Opus -> `remux` (copy to MKV); otherwise -> `transcode` to H.264/AAC.

> **What it does:** Picks the playback method (direct/remux/transcode) from the codec probe result, then computes the MD5 cache key `filePath:size:mtime`.
> **Impact:** Browser-compatible files play directly with no processing; Opus-in-MP4 is remuxed quickly; everything else is transcoded — so startup is faster and CPU is saved.

#### 8.1.2 HLS

`spawnFfmpeg()` wraps `ffmpeg` in a promise; HLS generation uses `-f hls -hls_time 3` with segment filenames, and falls back to a `+faststart` remux when the moov atom is missing.

> **What it does:** `spawnFfmpeg` wraps the ffmpeg call in a promise; the HLS args slice the video into 3-second `.ts` segments via `-f hls -hls_time 3`.
> **Impact:** Enables segment-based adaptive streaming without transcoding (copy), keeping latency low.

### 8.2 File Scanner & Thumbnails

#### 8.2.1 Scanner

`computeContentHash()` samples the first and last 64 KB plus the file size to build a fast content fingerprint without reading the whole file.

> **What it does:** Builds an MD5 hash from the size + first 64 KB + last 64 KB of the file as a fast content fingerprint.

> **What it does:** Skips files whose size and mtime match the DB; only when `compareByHash` is enabled is the content hash checked.

#### 8.2.2 Watcher

`startWatcher()` uses `fs.watch` (recursive) per media root and routes changes through `debouncedRescan()`, which waits 2 s after the last event (and skips a 30 s startup grace) before running `incrementalSync()` and broadcasting an SSE `folder_updated` event.

> **What it does:** Watches directory changes via `fs.watch`, then waits 2 seconds before an incremental scan + SSE event broadcast to clients.

#### 8.2.3 Thumbnails

`extractFrameThumbnail()` seeks to 1 s and pulls one frame, scaled to width 200 via `scale=200:-1` using ffmpeg (no `sharp` dependency). `hasEmbeddedCover()`/`extractEmbeddedThumbnail()` detect and copy an embedded picture stream (`attached_pic`/mjpeg/png) instead of sampling a random frame.

> **What it does:** Copies a single video frame that is an embedded cover art (`attached_pic`/mjpeg/png) out to an image file via `-c copy -frames:v 1`.

### 8.3 Downloader (`downloader/manager.js`)

Supported sources (`SOURCE_ROUTES`): youtube, tiktok, twitter, instagram, torrent. Tools: yt-dlp, gallery-dl, aria2c, ffmpeg/ffprobe.

| Source | Tool | Output Path |
|-----------|-------------------|----------------------------------------------------------------|
| YouTube | yt-dlp | /home/CATIAA/Videos/YouTube |
| TikTok | gallery-dl | /home/CATIAA/Videos/TikTok, /home/CATIAA/Pictures/TikTok |
| Twitter/X | gallery-dl | /home/CATIAA/Videos/Twitter, /home/CATIAA/Pictures/Twitter |
| Instagram | yt-dlp/gallery-dl | /home/CATIAA/Videos/Instander, /home/CATIAA/Pictures/Instander |
| Torrent | aria2c | /home/CATIAA/homelab |

Instagram pipeline: 1 concurrent + 12s delay, SHA256 dedup, VP9/AV1 → H.264/AAC transcode, staging under `/home/CATIAA/homelab/DUMMY`.

**`SOURCE_ROUTES` + `QUALITY_MAP`**: Maps each source to its output directories and allowed quality list; output dirs are created at module load via `mkdirSync`.

> **What it does:** Defines the mapping of each source (youtube, tiktok, twitter, instagram, torrent) to its video/audio/image output directories, plus the allowed quality list per source.
> **Impact:** Guarantees downloads land in consistent, per-platform locations; the category/quality validation in `createTask` relies entirely on this map.

**`spawnYtdlp`**: Builds the yt-dlp argument vector — `--concurrent-fragments 4`, format selectors per category (Instagram forces an H.264/AVC MP4 merge), audio extraction, and the output template.

> **What it does:** Builds the `yt-dlp` argument vector based on task category — concurrent fragment count, format selection (Instagram forces an MP4 H.264/AVC merge), audio extraction, output template, and Twitter cookies.

**Instagram VP9/AV1 → H.264/AAC transcode**: Re-encodes non-browser-compatible Instagram video at `crf 18` / `preset medium` so it plays directly in the browser.

> **What it does:** Re-encodes incompatible Instagram videos (VP9/AV1) to H.264/AAC MP4 via `ffmpeg` with `crf 18`/`preset medium`.

**Instagram 1-concurrent + 12 s rate limit**: The queue scheduler serializes Instagram tasks and inserts a 12 s gap between them to stay under Instagram's rate limits.

### 8.4 ADB Transfer (`utils/adbManager.js`, `adbTransaction.js`, `adbWorkerPool.js`, `routes/adb.js`)

Job lifecycle: `adbManager.push(device, sources, dest, { maxWorkers: 3, conflictStrategy })` → transactions progress `pending → running → [done|error|cancelled]`.

ADB database tables (`adb_jobs`, `adb_transactions`). Transaction states: PENDING, CONFLICT_CHECK, CONFLICT, TRANSFERRING, VERIFYING, DONE, CANCELLED, FAILED, SKIPPED. Conflict resolution: skip / overwrite / rename / cancel / applyAll.

**Transaction state machine**: Explicit `TX_STATUS` enum + a `VALID_TRANSITIONS` map enforce legal progress (`pending → checking → transferring → verifying → metadata → committed`). Illegal transitions are rejected by `updateStatus`.

> **What it does:** Defines the ADB transaction status enum (PENDING, CONFLICT_CHECK, TRANSFERRING, VERIFYING, METADATA, COMMITTED, etc.) along with `VALID_TRANSITIONS`, which only permits legal transitions between statuses.
> **Impact:** Prevents transaction-state corruption; `updateStatus` rejects illegal transitions so the transfer lifecycle stays consistent and recoverable after a crash.
> **Similar alternatives:** A state-machine library (e.g. `xstate`) could be used; trade-off: an explicit map is lighter and easier to audit.
> **If this were omitted:** Transactions could jump to invalid statuses (e.g. committed→transferring), making verification and recovery unreliable.

**Concurrency-limited worker pool**: `AdbWorkerPool.processJob` spins up `min(maxWorkers, pending.length)` workers and a `_prepAhead` look-ahead that pre-stats remote dirs and resolves conflicts before transfer begins.

> **What it does:** Runs transfers with a worker pool sized `min(maxWorkers, pending count)`; each worker processes one transaction while `_prepAhead` does remote stat and conflict resolution up front.

**Checksum / size verification after push**: Each file is re-stated on-device and compared to the expected size (and, post-metadata, mtime). A size mismatch throws and the transaction is retried (up to `max_attempts`).

> **What it does:** After a push, calls `verifyFile` on the device to compare the destination file's size (and mtime after metadata) with the expected size; on failure it throws a `SIZE_MISMATCH`/`FILE_MISSING` error.

**`push()` job creation**: Builds the job record carrying `maxWorkers` and `conflictStrategy` (`skip` | `overwrite` | `ask`), persists it, and enqueues on the per-device queue.
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

> **What it does:** Creates a push job record holding device, sources, dest, `maxWorkers`, and `conflictStrategy` (`skip`|`overwrite`|`ask`), persists it to the DB via `transactionEngine`, then enqueues it per device.
> **Impact:** Serves as the transfer entry point; the job is stored so it can be recovered after restart and runs sequentially per device.
> **Similar alternatives:** Could spawn directly without job persistence; trade-off: a job + DB enables resume, pause, and SSE progress.
> **If this were omitted:** There would be no job tracking, hence no progress, pause, or recovery after a crash.

### 8.5 Upload (`utils/uploadManager.js`, `routes/upload.js`)

Busboy multipart upload. State: `MEDIA_ROOTS`, `activeUploads` Map, `uploadIdCounter`, `UPLOAD_TEMP`. Runtime settings: `upload.maxSizeGB` (100), `upload.concurrent` (4), `upload.duplicateStrategy` (rename), `upload.autoScan` (true), `upload.verifyIntegrity` (true), `upload.autoThumbnail` (true). `sanitizeFilename()` removes `..`, `/`, `\`, `\0`, max 255 chars.

### 8.6 MPD / Strawberry (`routes/mpd.js`)

Controls Strawberry MPD player via `mpd2` on `localhost:6600`. Player, playlist, and queue endpoints. Loop-mode mapping: `one` = repeat 1 + single 1; `all` = repeat 1 + single 0; `off` = repeat 0 + single 0.

#### 8.6.1 MPD code (verbatim)

Excerpts from `backend/src/routes/mpd.js`.

**`mpdSend`**: lazy-connecting wrapper around `mpd2`'s `sendCommand`. The connection is cached and reset on `close`.

> **What it does:** Sends an MPD command to the already-connected client via `getClient()` then `c.sendCommand(cmd)`.

**Loop-mode mapping**: The one/all/off UI maps to MPD's `repeat` + `single` flags.

> **What it does:** Maps the UI loop mode one/all/off to the MPD `repeat` and `single` flags (one = repeat 1 + single 1, all = repeat 1 + single 0, off = both 0).

### 8.7 Monitoring (`monitor/*`)

Engine poll interval is **3000ms**; WebSocket broadcast throttle **3000ms**; historical snapshot every **30s**.

**`collectAll()` poll loop**: All six collectors run concurrently with a 3 s per-collector `Promise.race` timeout; results are broadcast (throttled) and snapshotted every 30 s.
  }
}
```

> **What it does:** Runs all six collectors (cpu, ram, gpu, disk, network, system) sequentially with a 3-second per-collector timeout via `Promise.race`, then broadcasts stats (3s throttle) and stores a snapshot every 30s.
> **Impact:** The dashboard gets fresh metrics every 3000ms poll without a slow collector blocking the loop (the `collecting` guard prevents overlap).
> **Similar alternatives:** `Promise.all` without a timeout could be used, but the timeout protects against a hung collector.
> **If this were omitted:** A stuck collector could halt metric updates across the whole system.
<!-- annot:engine_collectall -->
**Forked sensor reads — `monitoringCache.js` + `sensors-worker.mjs`** (`monitoringCache.js:69-77`, `165-184`). Hardware sensor reads (`/sys/class/hwmon`) are pushed into a **detached child process** so a kernel D-state hang on `hwmon` never blocks the main HTTP event loop. The parent reads the child's result JSON after a 1.5 s settle.




> **What it does:** Forks a separate Node process (`sensors-worker.mjs`) that reads sysfs hwmon, then after 1.5s reads its JSON result from a cache file; the child is `unref()`-ed so it does not hold the process alive.
> **Impact:** Sensor reads that can hang in D-state (uninterruptible sleep) no longer block the main HTTP event loop, so the server stays responsive when hardware misbehaves.
> **Similar alternatives:** Could read `/sys/class/hwmon` directly on the main thread (cheaper), but that risks a hang on flaky sensors — a separate process is a deliberate robustness/overkill trade-off.
> **If this were omitted:** A sysfs D-state hang could freeze the entire media server so it cannot respond to requests.
<!-- annot:cache_refreshsensors -->

> **What it does:** Reads all `hwmon` entries from sysfs, converts raw values to °C (divide by 1000), grabs `high`/`crit`, then writes the result to `/tmp/homelab_sensors.json`.
> **Impact:** Provides sensor data gathered outside the main process so the parent can read it safely.
> **Similar alternatives:** Could return it via IPC, but writing a cache file is simpler and decoupled from the event loop.
> **If this were omitted:** Sensor reading would have to happen on the main process, which is vulnerable to D-state hangs.
<!-- annot:sensors_worker -->
The background refresh loops (`monitoringCache.js:165-184`) re-run each reader on its own timer (sensors 30 s, cpu freq / fan / battery / media 15 s, uptime 10 s).

**GPU collector — `nvidia-smi` + `MONITOR_DISABLE_GPU` short-circuit** (`gpu.js:149-153`, `72-95`).


> **What it does:** `collect()` immediately returns `null` if `MONITOR_DISABLE_GPU` is set, otherwise calls `refreshGpu()` and returns `cachedGpu`.
> **Impact:** Allows disabling the GPU collector without changing the engine — useful when no NVIDIA GPU is present.
> **Similar alternatives:** The collector could be filtered in `engine.js`, but the env guard here is more localized.
> **If this were omitted:** The engine would keep calling `nvidia-smi`, which would fail continuously on a host without a GPU.
<!-- annot:gpu_collect -->

> **What it does:** Runs `nvidia-smi --query-gpu=...` then parses its CSV into a metrics object (utilization, VRAM, temperature, clock, power, driver).
> **Impact:** The GPU dashboard is populated from `nvidia-smi` output with a 5-second timeout; on failure it returns null and uses the cache.
> **Similar alternatives:** NVML sysfs could be read directly, but the `nvidia-smi` CLI is sufficient and portable.
> **If this were omitted:** No NVIDIA GPU metrics would be shown in monitoring.
<!-- annot:gpu_refreshnvidia -->
**Disk collector — `statvfs` + `smartctl` with cache** (`disk.js:49-102`, `132-159`).


> **What it does:** Runs `smartctl -H` and `smartctl -A` in parallel per physical disk (`Promise.allSettled`), determines PASSED/FAILED status and temperature, then stores it in `smartCache` (60s TTL).
> **Impact:** SMART disk health is available to the disk widget without calling `smartctl` on every poll.
> **Similar alternatives:** `libatasmart`/direct ioctl could be used, but the `smartctl` CLI is already present and easy to time out.
> **If this were omitted:** The disk widget would not show SMART status/temperature and per-poll updates would be slow.
<!-- annot:disk_refreshsmart -->

> **What it does:** Reads `/proc/mounts`, filters to fstype ext4/btrfs/xfs/zfs or the `/` mount, then uses `statfsSync` to compute total/used/free and the usage percentage.
> **Impact:** Provides the partition list with disk usage shown on the dashboard.
> **Similar alternatives:** The `df` CLI could be used, but synchronous `statfsSync` is simpler and avoids spawning.
> **If this were omitted:** No filesystem usage data would be shown in disk monitoring.
<!-- annot:disk_getfilesystems -->
> SMART results are cached 60 s (`SMART_CACHE_TTL = 60_000`); partition list 30 s. `getDiskstats()` (from `/proc/diskstats`) computes per-device read/write byte deltas between polls for the I/O widget.

**Alerts — `checkAlerts()` thresholds + 60 s dedupe** (`alerts.js:59-129`). CPU/RAM/disk/temp/gpuTemp each emit `warning`/`critical` events; identical type+severity is suppressed for 60 s.


> **What it does:** Compares cpu/ram/disk/temperature/gpuTemp metrics against warning/critical thresholds, then filters duplicates by type+severity within the last 60 seconds.
> **Impact:** Prevents the same alert from spamming; history is stored (max 200) and disk writes are debounced by 5 seconds.
> **Similar alternatives:** An external alerting library could be used, but manual dedupe is sufficient and dependency-free.
> **If this were omitted:** The same alert could flood every poll (3 seconds), overwhelming the log/history.
<!-- annot:alerts_checkalerts -->
### 8.8 WhatsApp / Send (`routes/whatsapp.js`, `routes/send.js`, `whatsapp-bot/`)

WhatsApp bridge is loaded by `server.js` via `initWhatsApp()` (10s after listen, up to 5 retries backoff). `routes/whatsapp.js` imports from `../../../whatsapp-bot/src/` and exposes `/api/whatsapp/*` plus SSE `/api/whatsapp/logs/stream`. Telegram send (`routes/send.js`) is optional — active only if `TELEGRAM_BOT_TOKEN` is set.

#### 8.8.1 WhatsApp / Send code (verbatim)

**`setupWhatsAppRoutes(app)`** (`routes/whatsapp.js:34`). The backend route module imports directly from `../../../whatsapp-bot/src/` and mounts the `/api/whatsapp/*` REST + SSE endpoints onto the Express `app`.


> **What it does:** Registers the REST+SSE endpoints `/api/whatsapp/*` on the Express `app`, importing directly from `../../../whatsapp-bot/src/` and merging the connection status with the Telegram/WhatsApp counters.
> **Impact:** The backend can control and monitor the WhatsApp bridge from a single route without a separate process.
> **Similar alternatives:** The whatsapp-bot could run as a standalone service, but direct import unifies its lifecycle with the server.
> **If this were omitted:** The WhatsApp endpoints would not be mounted, so the bridge feature could not be reached via the API.
<!-- annot:wa_setuproutes -->
**Telegram guard — `TELEGRAM_BOT_TOKEN`** (`utils/telegramBot.js:11-16`). The bot is only constructed when the token env var is set; otherwise `getBot()` returns `null` and every send throws `"TELEGRAM_BOT_TOKEN not configured"`.


> **What it does:** Initializes `TelegramBotApi` only when `TELEGRAM_BOT_TOKEN` is present; otherwise `getBot()` returns `null` and every send throws a configuration error.
> **Impact:** The Telegram feature auto-disables when the token is unset, without breaking server startup.
> **Similar alternatives:** The token could be read from a file/secret manager, but an env var is standard.
> **If this were omitted:** The server would crash when trying to send Telegram messages without a token.
<!-- annot:tg_getbot -->
`routes/send.js` exposes `/api/send/telegram` and `/api/send/all`; the `/telegram/status` endpoint reports `configured: !!process.env.TELEGRAM_BOT_TOKEN`, so the UI can hide the action when unconfigured.

**WhatsApp connection** (`whatsapp-bot/src/connection.js:42-60`). Uses `whatsapp-web.js` (LocalAuth + headless puppeteer), registers the `qr`/`ready`/`disconnected`/`auth_failure`/`message` handlers, and auto-reconnects with exponential backoff capped at 5 min.


> **What it does:** Initializes the `whatsapp-web.js` client with `LocalAuth` + headless puppeteer, then registers the `qr`/`ready`/`disconnected`/`auth_failure`/etc. handlers and auto-reconnect.
> **Impact:** A persistent WhatsApp connection with a saved session and a QR for pairing; on disconnect it auto-reconnects.
> **Similar alternatives:** Baileys could be used, but the repo already uses whatsapp-web.js.
> **If this were omitted:** There would be no WhatsApp connection/QR, so the bridge would not function.
<!-- annot:wa_connection -->
**Keyword / hashtag trigger** (`whatsapp-bot/src/listener.js:123-131`). The listener fires only when a video is quoted (or sent) together with a configured keyword (e.g. `save`) or hashtag (e.g. `#upload`).


> **What it does:** Checks whether a message contains a keyword or hashtag trigger, and only fires when a video is quoted/sent together with that trigger.
> **Impact:** Filters messages so only specific media + commands are processed (e.g. save a video), preventing arbitrary actions.
> **Similar alternatives:** A global regex command could be used, but per-message keyword/hashtag checks are more targeted.
> **If this were omitted:** All video messages would be processed without filtering, triggering unwanted uploads.
<!-- annot:wa_listener -->
### 8.9 Video Cache (`routes/videoCache.js`)

Mounted at `/api/video-cache`. Provides video cache bookkeeping (the `videoCache.js` util tracks cached video segments/derivatives). Consult the live endpoints for the exact surface.

---

### 8.10 Metadata (`utils/metadataWriter.js`, `musicbrainz.js`, `lrclib.js`)

**Cover-art embedding** (`metadataWriter.js:74-111`). Per-format `ffmpeg`/`python3` command strings. FLAC uses the spawned `embed_cover.py`; MP3/OGG/Opus/M4A/WebM use `ffmpeg` with appropriate disposition/container flags, writing to a `.tmp` then atomic-rename.


> **What it does:** Writes the image buffer to a temp file then embeds the cover via `embed_cover.py` (FLAC) or `ffmpeg` per-format (mp3/ogg/opus/m4a/webm) into a `.tmp` file, then atomic-rename.
> **Impact:** Cover art is stored inside the audio/video file without corrupting the original (atomic rename), supporting many formats.
> **Similar alternatives:** `music-metadata` could be used to write tags, but ffmpeg/python handle image covers across formats.
> **If this were omitted:** Cover changes would not be saved to the file, so cover metadata would be lost on re-read.
<!-- annot:meta_embedcover -->
**MusicBrainz / Cover Art Archive** (`musicbrainz.js:43-56`, `72-93`). `getCoverArt` hits the Cover Art Archive for a release MBID; `searchCoverArt` tries a recording search first, then falls back to artist+album, then artist-only.


> **What it does:** Builds the Cover Art Archive URL from the release MBID then fetches the front image via `mbFetch`.
> **Impact:** Provides an official MusicBrainz cover art source for metadata search.
> **Similar alternatives:** Other cover providers (e.g. iTunes) could be used, but CAA is tied to an already-verified MBID.
> **If this were omitted:** Cover art search would have no official source based on the MusicBrainz MBID.
<!-- annot:mb_getcoverart -->
**LRCLIB lyrics** (`lrclib.js:22-44`). `getLyrics` does an exact track/artist/duration lookup (5 s `AbortController` timeout); `searchLyricsByMetadata` falls back to a free-text search.


> **What it does:** Builds an LRCLIB query from track/artist/album/duration then fetches plain and synced lyrics via `lrclibFetch`.
> **Impact:** Retrieves lyrics (plain/synced) to display in the audio player.
> **Similar alternatives:** Genius/NetEase could be used, but LRCLIB focuses on free, structured LRC.
> **If this were omitted:** The lyrics feature would not be populated from the LRCLIB source.
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
|------------------------|----------------------------------------|--------------------------|
|  `favoritesStore`        |  `store/favoritesStore.js`              |  localStorage (`persist`)  |
|  `monitoringStore`       |  `monitoring/stores/monitoringStore.js`  |  memory (partial)          |
|  `playbackStore`         |  `store/playbackStore.js`                |  memory                    |
|  `playlistStore`         |  `store/playlistStore.js`                |  localStorage (`persist`)  |
|  `folderSortStore`       |  `store/folderSortStore.js`              |  localStorage (`persist`)  |
|  `folderMetaSortStore`   |  `store/folderMetaSortStore.js`          |  localStorage (`persist`)  |
|  `useDebugStore`         |  `debug/useDebugStore.js`                |  memory                    |

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

### 9.7 Frontend code (summary)

> The full verbatim source was removed for readability. The frontend is a React 18 + Vite 5 SPA (see `frontend/src/App.jsx`, `frontend/src/main.jsx`, `frontend/vite.config.js`):

- **Entry / shell** — `main.jsx` mounts `<App/>`; `App.jsx` implements a custom hash-based router and the top-level layout (sidebar, media grid, player, monitoring).
- **State** — six Zustand stores (`useLibraryStore`, `usePlayerStore`, `useSettingsStore`, `useMonitoringStore`, `useUiStore`, `useSendStore`).
- **Comms** — REST via `fetch` to `/api/*`, plus WebSocket (`/ws`) and SSE (`/api/logs/stream`, `/api/whatsapp/logs/stream`) for live updates.
- **Playback** — HTML5 video with range/HLS (`hls.js`) and HTML5 audio with waveform + synced LRC lyrics.
- **Dev proxy** — `vite.config.js` proxies `/api`, `/stream`, `/file`, `/thumbnails`, `/ws` to `https://127.0.0.1:3001`.

## 10. Flow Diagrams

### 10.1 Request Flow

```
HTTP Request
     ↓
Express Router (server.js)
     ↓
Route Handler (routes/*.js)
     ↓
Utility Module (utils/*.js)
     ↓
Database (db.js → better-sqlite3)
     ↓
Filesystem Cache (cache/, data/)
     ↓
Response → Client
```

### 10.2 File Scan Flow

```
fs.watch event OR manual trigger
     ↓
incrementalSync() - fileScanner.js
     ↓
stat() → compare mtime vs DB
     ↓
NEW/CHANGED: upsert into files + folders
     ↓
Queue thumbnail generation
     ↓
SSE broadcast: scan_progress
```

### 10.3 Playback Flow

```
User clicks video file
     ↓
stream.js GET /stream/video/:id
     ↓
getPlaybackDecision() - playbackEngine.js
     ↓
ffprobe → codec_info (cached in DB)
     ↓
Decision Tree:
     ├── H.264/AVC + MP4/MOV/M4V → direct HTTP range
     ├── H.264/HEVC + Opus audio → remux to MKV
     └── Incompatible → transcode to H.264/AAC
     ↓
Cache check → generate if missing → serve
```

### 10.4 Download Flow

```
POST /api/download/start {url, category}
     ↓
createTask() - downloader/manager.js
     ↓
Category route lookup → /home/CATIAA/Videos/YouTube (video)
     ↓
yt-dlp / gallery-dl / aria2c spawn → download
     ↓
Post-process:
     ├── Audio → /home/CATIAA/Music/YouTube
     ├── Image → /home/CATIAA/Pictures/TikTok
     └── Video → /home/CATIAA/Videos/YouTube
     ↓
SHA256 dedup check against download-counter.json
     ↓
Codec check → transcode if needed
     ↓
Atomic move to final directory
```

### 10.5 Monitoring Flow

```
startEngine() → setInterval(collectAll, 3000)   // pollIntervalMs = 3000
     ↓
collectAll() → CPU, Memory, GPU, Disk, Network, System collectors
     ↓
Aggregate into stats object
     ↓
Broadcast via WebSocket (throttled 3000ms, BROADCAST_THROTTLE_MS)
     ↓
recordSnapshot() every 30s (HISTORY_INTERVAL) → historical_metrics table
     ↓
checkAlerts() on every tick
```

### 10.6 Monitoring Subsystem Call Graph

```
monitor/engine.js
├── monitor/collectors/cpu.js      → /proc/stat, /sys/devices/system/cpu/*
├── monitor/collectors/memory.js   → /proc/meminfo
├── monitor/collectors/gpu.js      → nvidia-smi (cached 3s)
├── monitor/collectors/disk.js     → statvfs, smartctl (cached 60s SMART)
├── monitor/collectors/network.js  → /sys/class/net/*, /proc/net/fib_trie
├── monitor/collectors/system.js   → /proc/uptime, uname
├── monitor/websocket.js           → broadcast()
├── monitor/historical.js          → recordSnapshot() every 30s
├── monitor/alerts.js              → checkAlerts()
├── monitor/webStats.js            → HTTP/web stats
└── monitor/monitoringCache.js     → forked child (src/sensors-worker.mjs)
```

### 10.7 Playback Subsystem Call Graph

```
routes/stream.js
├── utils/playbackEngine.js
│   ├── probeVideoFile()           → ffprobe
│   ├── remuxToMkv()              → ffmpeg -c copy -f matroska
│   ├── transcodeToH264Mp4()      → ffmpeg libx264/aac
│   ├── getPlaybackDecision()       → codec decision tree
│   └── cleanupCache()              → LRU eviction
├── utils/hlsGenerator.js
│   ├── spawnFfmpeg()              → ffmpeg -f hls
│   └── remuxFaststart()           → moov atom fix
└── utils/fileResolver.js          → path resolution
```

### 10.8 Scan Subsystem Call Graph

```
utils/watcher.js
├── utils/fileScanner.js
│   ├── incrementalSync()          → main scan loop
│   ├── getFileId()                → MD5 hash
│   ├── computeContentHash()       → partial file hash
│   ├── getDuration()              → ffprobe
│   ├── probeVideoMetadata()       → ffprobe format info
│   └── updateCodecInfo()          → DB codec_info
├── utils/thumbnailQueue.js
│   ├── addFile()                  → queue thumbnail
│   └── drainQueue()               → process with concurrency
└── db.js (stmts)
    ├── upsertFile/upsertFolder    → DB write
    └── syncFTSIndex()             → FTS maintenance (fork worker)
```

### 10.9 Download Subsystem Call Graph

```
routes/downloader.js
└── downloader/manager.js
    ├── createTask()               → task creation
    ├── processTask()              → yt-dlp/gallery-dl/aria2c spawn
    ├── postProcessFile()          → move/embed
    └── SOURCE_ROUTES map          → YouTube/TikTok/Instagram/Twitter/Torrent paths
```

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
5. Update README.md (and READMEID.md) with the endpoint spec

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

Counts measured from source on **2026-07-14** (recursive, `node_modules` excluded). Replaces the earlier estimated figures.

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
|  `frontend/src/store/`       |      4  |         268  |
|  `frontend/src/hooks/`       |      —  |         718  |
|  `frontend/src/utils/`       |     10  |       1,146  |
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
|  Doc v3.1  |  2026-07-14  |  Documentation cleanup: removed 3 duplicate `ARCHITECTURE copy*.md` and `fix_architecture.py`; archived scratch/debug docs to `docs/archive/`. Corrected SoT vs code: added missing frontend deps (`qrcode`, `source-map-js`), fixed `react-router-dom` usage note, clarified `utils/` = 38 `.js` + 3 `.py`, fixed env-var section (`.env` exists; placeholder chat IDs), added accurate Codebase Metrics appendix.  |
|  Doc v3.0  |  2026-07-08  |  Verified against codebase; corrected route count (19), monitor poll (3000ms), WhatsApp embedded status, `registry.js`/`downloader/manager.js` paths, added `webStats.js` + forked workers, `youtube_id`/`video_offset` columns, full index list, dependency tables, frontend architecture, env vars. Codebase versions: backend 1.0.0, frontend 1.0.0.                                                              |
|  2.4.0     |  2026-07-05  |  Prior doc revision (note: "2.4.0" referred to documentation only, not the application).                                                                                                                                                                                                                                                                                                                             |
|  2.3.0     |  2026-07-02  |  Initial comprehensive documentation.                                                                                                                                                                                                                                                                                                                                                                                |
