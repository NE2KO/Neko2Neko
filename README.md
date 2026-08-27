> ## 🚧 Project Status: In Progress
>
> - **Project started:** May 1, 2026
> - **Last updated:** August 27, 2026 — **P1 + P1.5 READ/RESOLUTION boundary complete**
> - **Media Engine:** `@homelab/media-engine@0.1.0` extracted (`file:../../media-engine`), `fileResolver.js` deleted, all media file resolution via `MediaEngine`
> - **Status:** Actively being worked on.
> - **Current focus:**
>   - Media Engine hardening (visibility, changeset, operations)
>   - Performance optimization
>   - UI polish / beautification
>   - Bug fixing

# Media Vault

![Node](https://img.shields.io/badge/Node-%3E%3D18-green)
![React](https://img.shields.io/badge/React-18.3.1-blue)
![SQLite](https://img.shields.io/badge/SQLite-WAL-orange)
![Media Engine](https://img.shields.io/badge/media--engine-0.1.0-purple)

Self-hosted media server — stream, download, manage, and monitor from one dashboard.

> ## ⚠️ IMPORTANT — Music Menu: DO NOT MODIFY THE SYNC ENGINE CARELESSLY
>
> Do not touch `frontend/src/components/Music.jsx` or its sync pipeline (`frontend/src/utils/decision/*`, `frontend/src/utils/memory/*`, `frontend/src/utils/syncCore.js`) unless you understand the whole control loop first.
>
> **Why it's dangerous.** The Music menu's MV/BG sync engine is a real-time control system that corrects millisecond-scale drift between two muted videos and the audio clock. It is *adaptive and stateful*: every ~30ms tick it reads smoothed drift (EMA, alpha 0.15), adaptive thresholds (soft = 2σ, clamp 8–40ms), confidence scores, and constraint gates, then issues `playbackRate` changes (target: keep |drift| < 10ms, landing/deadband 5ms) and hard-seeks only for gross errors (>1500ms).
>
> A careless edit **compiles cleanly but silently breaks A/V sync** — there is no build error or exception. Failures only appear at runtime:
> - Bang-bang / coarse rate switching (e.g. rate stuck at `0.850` / `1.150`),
> - Persistent drift or high sigma (sync sitting at 10ms+ forever),
> - Frame repeats / strobe loops from soft-seeks on sparse-keyframe videos.
>
> **Architecture (data → judge → action — deliberately clean & short, so the judge is never interrupted):**
> 1. **Memory layer** — per-engine drift EMA, bias, sigma, tick/decoder/scheduler telemetry (`DriftMemory`, `SchedulerMemory`, `PipelineMemory`, …).
> 2. **DerivedMetrics** — turns raw memory into facts the judge can trust: `driftMagnitude`, `driftConfidence`, `consistencyScore`, triangle MV↔BG↔Audio.
> 3. **ConstraintProvider** — hard gates that forbid actions unsafe right now (pipeline not ready, decoder unhealthy, futile seek).
> 4. **DecisionEngine (`decide`)** — picks exactly one action (HOLD / SET_RATE / SOFT_SEEK / HARD_SEEK) with a confidence value.
> 5. **ExecutionQueue** — serializes + coalesces (latest-wins per type, 100ms cooldown); the only place that calls `setRate()`/`seek()`.
> 6. **SyncCore + SyncOverlay (`SYNC DEBUG`)** — telemetry, spike recorder, decision counters, and the debug overlay used to audit judge behavior.
>
> **Before changing anything:** run `npm run build`, open the `SYNC DEBUG` overlay during playback, and verify — rate is proportional/smooth (never just two extreme values), Δ MV↔BG stays < 10ms, sigma stays low, and the judge's chosen action matches the actual drift. Never bump `rateGain`/thresholds blindly; the adaptive behavior depends on them.

> **Hardware Note:** This platform is specifically designed for AMD-based laptops. The Monitoring menu uses nbfc and ryzenadj which are hardware-specific and do not support Intel or NVIDIA systems. Other menus are hardware-agnostic.

| Information | Detail |
|-------------|--------|
| **Version** | backend v1.1.0 · frontend v1.0.0 · whatsapp-bot v1.0.0 · **@homelab/media-engine v0.1.0** |
| **Media Engine** | `file:../../media-engine` — see [`../media-engine/README.md`](../media-engine/README.md) and [`../media-engine/plan.md`](../media-engine/plan.md) |
| **Documentation** | See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical reference |

## Table of Contents

- [About](#about)
- [Media Engine](#media-engine)
- [Features](#features)
- [Menu Workflow](#menu-workflow)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Development](#development)
- [Codebase Metrics](#codebase-metrics)
- [Documentation](#documentation)
- [Contributing](#contributing)

## About

> **Story Behind the Menus:** This platform was built by various free AI models, with direct review by someone who is just bored and not particularly skilled at coding. Each menu was created to solve personal workflow problems.

Media Vault is a self-hosted media server born from the need to access media files without opening the laptop every time. Originally designed for personal use, it evolved into a comprehensive platform with integrated tools.

**Origin of Each Menu:**
- **Media Vault**: Created to avoid opening the laptop just to browse video, audio, and image files — access them directly from phone anywhere
- **Music Player**: Born from frustration with existing music players where previous navigation doesn't work properly (Strawberry player issue: when playing 1→5 then going back goes 5→1, but opening random track makes previous act as history, not list position — regardless of shuffle state)
- **Monitoring**: To control laptop from phone — fan speed via nbfc and clock via ryzenadj (still Linux-only, AMD-focused, under development)
- **Downloader**: Downloads from YouTube, TikTok, Instagram, Twitter/X, torrent, gallery-dl; send link to Telegram bot for auto-download to laptop with default settings (1080p, h264)
- **ADB Transfer**: Makes file transfer easier without slow file managers or memorizing terminal commands (under development)
- **Scrcpy Monitor**: Simple remote phone screen viewing (under development)
- **Send Queue**: Monitors sent/failed/cancelled files to Telegram and WA; tick-based queue system is dedicated for WA status
- **Git Integration**: Web-based Git operations without opening terminal (backend routes defined in `git.js` but **not yet mounted** in `server.js`; frontend `GitView.jsx` exists and calls `/api/git/*`, which currently returns 404)
- **WhatsApp**: WhatsApp Web pairing and bot controls, accessible from the sidebar

**Technology Stack:** Node.js, Express, SQLite, React, FFmpeg, HLS streaming, waveform visualization, **@homelab/media-engine** (media gateway + safety boundary).

## Media Engine

**`@homelab/media-engine@0.1.0`** is the single domain boundary for all media resources. The web layer never touches the filesystem or SQLite directly for media — it asks the engine.

```
HTTP Route → MediaEngine → MediaRepository → SQLite → Filesystem
                ↑ resolve()/getServeTarget()/listFiles()/searchFiles()
           Safety guards (pathGuard, visibilityGuard) + symlink-aware homelab/Music
```

**What the engine owns (P1 + P1.5 complete):**
- `MediaScanner` — incremental scan, `fs.watch` + 15-min periodic, `pause()`/`resume()` for `adaptiveController`, `enrichDurations`/`enrichMetadata`
- `MediaEngine` — `resolve`/`getServeTarget`/`stat`, `listFiles`/`searchFiles`/`searchFolders`/`getFileMetadata`/`getSearchSuggestions`/`getStats`/`getBatchFiles`/`resolveBatchFilenames`/`listFavorites`, visibility (`delete`/`restore` soft, `trash`/`purge` stubs), changesets (`beta → pre → release`)
- `MediaRepository` — 56-method interface; `SqliteMediaRepository` (backend) and `MockMediaRepository` (tests); visibility via `LEFT JOIN ... OR IS NULL` (missing row = `PRESENT`)
- `resolveFile` + `assertSafePath` — handles symlinked `homelab/Music → /home/CATIAA/Music`
- `OperationLock` + `OperationResult` + `EventBus`

**What stays in the backend:** HTTP (`res.sendFile`, `Range`, `Cache-Control`), SSE, multipart upload, FFmpeg (thumbnails, HLS, transcode), YouTube/video cache, playlists, send queue, ADB, Telegram, WhatsApp, AI.

**Legacy deleted:** `fileResolver.js`, `fileScanner.js`, `scannerWorker.js`, `scannerClient.js`, `watcher.js` — zero `grep` hits in `backend/src`. See [`../media-engine/README.md`](../media-engine/README.md) and [`../media-engine/plan.md`](../media-engine/plan.md) (13 phases, transaction strategy).

## Features

| Menu | Status | Description | Technology Used |
|------|--------|-------------|---------------|
| Media Vault | Active | Browse and stream offline video/audio/image files via MediaEngine (visibility-aware listing, FTS search, safe resolution) | **@homelab/media-engine**, hls.js, FFmpeg, better-sqlite3 FTS, recharts, framer-motion |
| Library Management | Active | Auto-scan via MediaScanner, full-text search, thumbnail generation | **MediaScanner** (watch + periodic), better-sqlite3 WAL |
| Playlists | Active | XSPF import, full CRUD, drag-reorder | XSPF parser, folder-based playlists |
| Metadata Editing | Active | Read/write audio tags, cover art, lyrics — via `MediaEngine.getFileMetadata`/`updateMetadata` | FFprobe, MusicBrainz, LRCLIB |
| Monitoring | Active | System stats, fan/clock control (Linux only, AMD-focused) + SSE stats via `engine.repository.countByType` | nbfc, ryzenadj, WebSocket (real-time) |
| Downloader | Active | Download from YouTube, TikTok, Instagram, Twitter/X, torrent, gallery-dl; send link to Telegram bot for auto-download | yt-dlp, gallery-dl, aria2c, Telegram bot |
| ADB Transfer | WIP | Push/pull files Android <-> laptop (concurrent workers) | ADB, concurrent workers |
| Scrcpy Monitor | WIP | Remote phone screen viewing via external scrcpy window | node-pty shell execution |
| Music Player | Active | Dual modes: cover mode and video mode with precision sync (fixes Strawberry navigation bug) | waveform, synced LRC, hls.js, precision sync engine |
| Send Queue | Active | Monitors sent/failed/cancelled to Telegram and WA; tick-based queue for WA status | Tick-based precision, SSE, WA/Telegram APIs |
| WhatsApp | Active | WhatsApp Web pairing (QR), connection status, bot controls — media path via `MediaEngine.resolve` | whatsapp-web.js, whatsapp-bot |
| Git Integration | API-only (not mounted) | Full Git operations without terminal; routes defined in `git.js` but not yet wired | Simple Git wrapper |

> **Note:** All menus are still actively worked on. `trash`/`purge`/`move`/`rename` in MediaEngine are stubs (Phase 5/7) — physical `unlinkSync` + `DELETE FROM files` remains backend until then.

## Menu Workflow

How each sidebar menu flows from the UI to the backend and external tools:

```mermaid
flowchart LR
    U([User / Phone]) -->|opens| DASH{{Media Vault Dashboard}}

    DASH -->|Media Vault| MV[Media Vault]
    MV --> ENG[MediaEngine<br/>resolve / listFiles / searchFiles]
    ENG --> REPO[(SqliteMediaRepository)]
    REPO --> DB[(media.db<br/>files, folders, FTS, visibility)]
    ENG --> FF[ffmpeg / HLS]

    DASH -->|Library Mgmt| LIB[Library Management]
    LIB --> SCAN[MediaScanner<br/>incremental watch]
    SCAN --> ENG

    DASH -->|Playlists| PL[Playlists]
    PL --> XSPF[XSPF / folder scan]
    PL --> DB

    DASH -->|Metadata| MD[Metadata Editing]
    MD --> ENG2[MediaEngine<br/>getFileMetadata / updateMetadata]
    MD --> FP[ffprobe · MusicBrainz · LRCLIB]

    DASH -->|Monitoring| MON[Monitoring]
    MON --> NB[nbfc · ryzenadj]
    MON --> DK[dockerode]
    MON --> WS[WebSocket / SSE<br/>via engine stats]

    DASH -->|Downloader| DL[Downloader]
    DL --> YT[yt-dlp · gallery-dl · aria2c]
    DL --> TG1[Telegram bot auto-download]

    DASH -->|Send Queue| SQ[Send Queue]
    SQ --> TG[Telegram<br/>engine.resolve]
    SQ --> WAQ[WhatsApp status<br/>tick queue]

    DASH -->|WhatsApp| WA[WhatsApp]
    WA --> WB[whatsapp-web.js<br/>engine.resolve]

    DASH -->|Music Player| MUS[Music Player]
    MUS --> SYNC[Precision Sync Engine]
    MUS --> HLSh[hls.js · waveform · LRC]

    DASH -->|Git| GIT[Git Integration]
    GIT --> GR[git.js - defined, not mounted]

    classDef wip fill:#fff0f0,stroke:#d11,stroke-width:2px,stroke-dasharray:6 4;
    DASH -->|Scrcpy| SCR["Scrcpy (WIP)"]
    SCR:::wip --> PTY[node-pty · scrcpy]
    DASH -->|ADB Transfer| ADB["ADB Transfer (WIP)"]
    ADB:::wip --> ADBT[adb push / pull]
```

> **Legend:** Red dashed — **Scrcpy** and **ADB Transfer** are WIP. Current effort: Media Vault, Music sync, Monitoring, Downloader, Send Queue, and **Media Engine hardening** (P1+P1.5 done, fileResolver deleted).

## Tech Stack

### Backend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **@homelab/media-engine** | `file:../../media-engine` **0.1.0** | Media gateway, scanner, safety boundary |
| better-sqlite3 | ^12.9.0 | SQLite driver (WAL mode) |
| busboy | ^1.6.0 | Multipart upload |
| compression | ^1.8.1 | Gzip/deflate |
| cors | ^2.8.5 | CORS middleware |
| dockerode | ^5.0.0 | Docker monitoring |
| express | ^4.21.0 | HTTP framework |
| fast-xml-parser | ^5.8.0 | XSPF parsing |
| mime-types | ^2.1.35 | Content-type |
| node-pty | ^1.1.0 | PTY shell |
| node-telegram-bot-api | ^1.1.0 | Telegram send + bot downloader |
| qrcode | ^1.5.4 | QR generation |
| uuid | ^10.0.0 | ID generation |
| ws | ^8.21.0 | WebSocket server |

### Frontend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| framer-motion | ^12.40.0 | Animations |
| hls.js | ^1.5.17 | HLS video player |
| lucide-react | ^1.16.0 | Icons |
| qrcode | ^1.5.4 | QR codes |
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | DOM renderer |
| react-intersection-observer | ^9.16.0 | Lazy loading |
| react-markdown | ^10.1.0 | Markdown rendering |
| react-router-dom | ^7.15.1 | Routing |
| react-virtualized-auto-sizer | ^1.0.26 | Virtual sizing |
| react-window | ^1.8.11 | Virtualized grid |
| recharts | ^3.8.1 | Charts |
| rehype-highlight | ^7.0.2 | Syntax highlighting |
| remark-gfm | ^4.0.1 | GitHub-flavored markdown |
| source-map-js | ^1.2.1 | Source maps |
| tailwindcss-animate | ^1.0.7 | Tailwind animations |
| zustand | ^5.0.13 | State management |

### WhatsApp Bot Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 | ^12.9.0 | SQLite wrapper |
| qrcode-terminal | ^0.12.0 | Terminal QR display |
| whatsapp-web.js | ^1.34.7 | WhatsApp Web API |

## External Tools

| Binary | Purpose |
|--------|---------|
| ffmpeg | Thumbnails, HLS, transcode, remux |
| ffprobe | Codec detection, metadata |
| yt-dlp | YouTube, Instagram download |
| gallery-dl | TikTok, Twitter/X, Instagram galleries |
| aria2c | Torrent download |
| adb | Android transfer |

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | >= 18 | Runtime |
| ffmpeg / ffprobe | any recent | Transcode, thumbnails, HLS |
| yt-dlp | latest | Video download |
| gallery-dl | latest | Gallery download |
| aria2c | latest | Torrent / parallel |
| adb | latest | Android transfer |
| nbfc / ryzenadj | — | AMD-only fan/clock control |

## Quick Start

```bash
# 1. Clone (includes sibling media-engine)
git clone <repo-url>
cd homelab-media-server

# 2. Media Engine (sibling, file:../../media-engine)
# No publish — backend uses file:../../media-engine
# After editing media-engine, re-sync:
cd backend && npm install --silent && cd ..

# 3. Backend
cd backend && npm install
cp ../.env.example ../credentials/.env   # edit as needed
npm start
# or dev (expose-gc + watch):
npm run dev

# 4. Frontend (dev only)
cd frontend && npm install && npm run dev
```

> **Note:** In production, the frontend is served statically by the backend. Vite is for development only. `MEDIA_ROOT` defaults to `/home/CATIAA/homelab` (supports `:`-separated multi-root; symlink `homelab/Music → /home/CATIAA/Music` handled).

## Project Structure

```
homelab-media-server/
├── backend/          # Express API + media processing (via MediaEngine)
│   ├── src/
│   │   ├── server.js          # Entry, Express, MediaScanner + MediaEngine wiring
│   │   ├── db.js              # SQLite, FTS, settings (stmts)
│   │   ├── repository/        # SqliteMediaRepository (MediaRepository impl)
│   │   ├── routes/            # 19 route modules (files.js via MediaEngine)
│   │   ├── monitor/           # System metrics
│   │   ├── services/          # Background services
│   │   ├── utils/             # Helpers (thumbnailQueue, maintenance, etc.)
│   │   └── middleware/        # Route guards
│   └── test/smoke-test-scanner.mjs  # 113k-file sync validation
├── frontend/         # React 18 SPA
├── whatsapp-bot/     # WhatsApp integration
├── data/             # media.db, download tasks, thumbnails
├── cache/            # HLS, remux, transcode cache
├── logs/             # Rotating logs
├── credentials/      # .env, auth files (gitignored)
└── docs/             # Documentation archives

../media-engine/      # Sibling package (file:../../media-engine)
├── src/
│   ├── MediaEngine.js         # Gateway (resolve, listFiles, search, visibility)
│   ├── MediaScanner.js        # Incremental scan, watch, enrich
│   ├── scanner/               # constants, fileUtils, walk, probe, sync
│   ├── resolver/resolveFile.js # realpath + assertSafePath (symlink-aware)
│   ├── safety/                # pathGuard, visibilityGuard
│   ├── visibility/            # visibility + changeset (beta→pre→release)
│   ├── operations/            # lock, result (trash/purge stubs)
│   ├── events/EventBus.js
│   └── repository/            # MediaRepository (interface) + MockMediaRepository
├── plan.md           # 13-phase production plan
└── README.md         # Engine docs
```

### Backend

| Path | Description |
|------|-------------|
| `backend/src/server.js` | Entry point, Express, MediaScanner + MediaEngine lifecycle |
| `backend/src/db.js` | SQLite database, FTS, settings (129 stmts) |
| `backend/src/repository/sqliteMediaRepository.js` | MediaRepository impl (visibility LEFT JOIN, 56 methods) |
| `backend/src/routes/` | 19 route modules (see below, all media reads via MediaEngine) |
| `backend/src/monitor/` | System metrics (WebSocket, historical) |
| `backend/src/services/` | Background service modules |
| `backend/src/utils/` | Helpers (thumbnailQueue, maintenance, uploadManager, etc. — fileResolver deleted) |
| `backend/src/middleware/` | Route guards |

| Route Module | Description |
|--------------|-------------|
| `adb.js` | Android transfer |
| `downloader.js` | Download management (yt-dlp, gallery-dl, aria2c) |
| `file.js` | Raw file serve via `MediaEngine.getServeTarget` |
| `files.js` | File listing, FTS search, pagination — **via `MediaEngine`** |
| `git.js` | Git operations (defined, NOT mounted) |
| `jobs.js` | Background job status (via `MediaScanner.getStatus`) |
| `metadata.js` | Audio tags, covers, lyrics — **via `MediaEngine.getFileMetadata`/`updateMetadata`** |
| `monitoring.js` | Stats, history, alerts |
| `playback.js` | Cache, health, config |
| `playlists.js` | XSPF import, CRUD (playlist domain, media resolve via `MediaEngine`) |
| `scrcpy.js` | Scrcpy control |
| `send.js` | Telegram/WhatsApp send — media resolve via `MediaEngine` |
| `services.js` | Service registry (scanner/monitor lifecycle) |
| `settings.js` | Config CRUD |
| `stream.js` | Video/audio streaming via `MediaEngine.resolve` + `playbackEngine` |
| `thumbnails.js` | Thumbnail generation — source via `MediaEngine.resolve` |
| `upload.js` | Multipart upload — DB via `MediaRepository` |
| `videoCache.js` | Video cache management |
| `whatsapp.js` | WhatsApp bridge — media resolve via `MediaEngine` |

### Frontend

| Path | Description |
|------|-------------|
| `frontend/src/App.jsx` | Main application |
| `frontend/src/main.jsx` | Vite entry |
| `frontend/src/components/` | 65 components |
| `frontend/src/store/` | Zustand stores |
| `frontend/src/hooks/` | Custom hooks |
| `frontend/src/utils/` | Utility functions |
| `frontend/src/monitoring/` | Monitoring dashboard pages |
| `frontend/src/debug/` | Debug utilities and inspectors |

### WhatsApp Bot

| Path | Description |
|------|-------------|
| `whatsapp-bot/src/index.js` | Entry point |
| `whatsapp-bot/src/connection.js` | WhatsApp connection |
| `whatsapp-bot/src/listener.js` | Message handler |
| `whatsapp-bot/src/sender.js` | Outbound sender |
| `whatsapp-bot/src/db.js` | SQLite wrapper |
| `whatsapp-bot/src/utils.js` | Utilities |

### Data Directories

| Path | Description |
|------|-------------|
| `data/` | `media.db`, download tasks, thumbnails |
| `cache/` | HLS, remux, transcode cache |
| `logs/` | Rotating logs |
| `credentials/` | `.env`, auth files, WhatsApp sessions |

## API Reference

**Files & Search** (`/api/files`, `/api/search`) — **via MediaEngine**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/files` | Browse folder via `engine.listFiles` + `engine.getFoldersByParent` |
| GET | `/api/files/shuffle` | Deterministic shuffle (via `engine.listFiles` + `getBatchFiles`) |
| POST | `/api/files/refresh` | `mediaScanner.scan()` + orphan cleanup |
| POST | `/api/files/cleanup` | Orphan cleanup |
| GET | `/api/files/stats` | `engine.getStats()` |
| GET | `/api/files/folders/:id` | `engine.getFolder()` |
| GET | `/api/files/:id/previews` | `engine.getPreviewFilesForFolder()` |
| GET | `/api/search` | `engine.searchFiles` + `engine.searchFolders` (FTS) |
| GET | `/api/search/suggest` | `engine.getSearchSuggestions()` |

**Streaming & Playback** (`/stream`, `/file`) — **via MediaEngine**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/file/:id` | `engine.getServeTarget()` → `res.sendFile` |
| GET | `/stream/video/:id/playback-info` | `engine.resolve()` + `getPlaybackDecision` |
| GET | `/stream/video/:id` | `engine.resolve()` → direct/remux/transcode |
| GET | `/stream/video/:id/hls/playlist.m3u8` | `engine.resolve()` → HLS |
| GET | `/stream/video/:id/hls/segment-:n.ts` | HLS segment |
| GET | `/stream/video/:id/faststart` | `engine.resolve()` → faststart |
| GET | `/stream/audio/:id` | `engine.resolve()` → audio stream |

**Monitoring** (`/api/monitoring`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/monitoring/stats` | Current system stats |
| GET | `/api/monitoring/overview` | Combined overview |
| GET | `/api/monitoring/history` | Historical metrics |
| GET | `/api/monitoring/disk-io/*` | Disk I/O stats |
| POST | `/api/monitoring/system/power` | Host power control |

**Downloader** (`/api/download`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/download/stream` | SSE task stream |
| POST | `/api/download/start` | Create download task |
| POST | `/api/download/bulk` | Create multiple tasks |
| GET | `/api/download/list` | All tasks |
| POST | `/api/download/:id/cancel` | Cancel task |
| POST | `/api/download/:id/retry` | Retry failed task |

**Playlists** (`/api/playlists`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/playlists` | All discovered playlists |
| GET | `/api/playlists/:id` | Playlist details |
| POST | `/api/playlists/create/manual` | Create from file IDs |
| POST | `/api/playlists/create/folder` | Create from folder |
| PUT | `/api/playlists/:id/tracks` | Add tracks |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Remove track |

**Metadata** (`/api/metadata`) — **via MediaEngine**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/metadata/:id` | `engine.getFileMetadata()` + embedded `ffprobe` |
| PUT | `/api/metadata/:id` | `engine.updateMetadata()` (whitelist: title, artist, album, genre, youtube_id, video_offset) |
| PUT | `/api/metadata/:id/cover/upload` | `engine.resolve()` + `embedCover` → `engine.updateMetadata({cover_source})` |
| GET | `/api/metadata/:id/lyrics` | `engine.getFileMetadata()` |

**Services** (`/api/services`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/services` | All service statuses |
| POST | `/api/services/:name/start` | Start service |
| POST | `/api/services/:name/stop` | Stop service |

**ADB Transfer** (`/api/adb`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/adb/devices` | Connected devices |
| POST | `/api/adb/push` | Push files (workers) |
| POST | `/api/adb/pull` | Pull files from device |
| GET | `/api/adb/jobs` | Transfer jobs |
| GET | `/api/adb/jobs/:id/progress` | SSE progress |

**Git** (NOT MOUNTED — `backend/src/routes/git.js`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| G | `/status` | Working tree status |
| G | `/diff` | Unstaged diff |
| G | `/diff-commit` | Commit diff |
| G | `/unpushed` | Unpushed commits |
| G | `/log` | Commit log |
| G | `/branches` | Branches |
| G | `/tags` | Tags |
| G | `/stash-list` | Stash list |
| G | `/tree` | File tree |
| G | `/file` | Read file |
| P | `/file` | Write file |
| G | `/gitignore` | Show .gitignore |
| P | `/gitignore` | Update .gitignore |
| P | `/stage` | Stage changes |
| P | `/commit` | Commit |
| P | `/push` | Push |
| P | `/pull` | Pull |
| P | `/checkout` | Checkout branch/ref |
| P | `/merge` | Merge |
| P | `/stash` | Stash |
| P | `/tag` | Create tag |

> **Note:** Git routes are defined in `backend/src/routes/git.js` but **never registered** in `backend/src/server.js`. Calls to `/api/git/*` return 404 until they are mounted. The frontend `GitView.jsx` component already calls these endpoints.

> For the complete API specification, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

| Package | Command | Description |
|---------|---------|-------------|
| backend | `npm start` | Start server |
| backend | `npm run dev` | Auto-reload mode (`--watch`, `--expose-gc`) |
| backend | `npm run debug` | Debug mode |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | Production build |
| whatsapp-bot | `npm start` | Start bot |
| whatsapp-bot | `npm run dev` | Auto-reload mode |
| media-engine | `npm test` | `node --test src/**/*.test.js` |

> **Note:** `backend/`, `frontend/`, and `whatsapp-bot/` are independent packages (not a monorepo). `media-engine` is a sibling (`file:../../media-engine`) — after editing it, run `cd backend && npm install --silent` to re-sync `backend/node_modules/@homelab/media-engine`.

## Codebase Metrics

| Directory | Files | Lines of Code |
|-----------|-------|---------------|
| `backend/src/` | 91 | ~26,042 |
| `frontend/src/` | 193 | ~46,858 |
| `whatsapp-bot/src/` | 6 | ~921 |
| `../media-engine/src/` | 18 | ~1,800 |
| **Total** | **308** | **~75,600** |

> Note: Lines of code approximate. Does not include `node_modules`, `cache/`, `logs/`, or `data/`.

## Recent Changes

- **2026-08-27 — P1 + P1.5:** Media file READ/RESOLUTION boundary complete. `MediaEngine` is now canonical for `resolve`/`getServeTarget`/`listFiles`/`searchFiles`/`getFileMetadata`/`updateMetadata`/`getStats`/etc. `fileResolver.js` deleted, `fileScanner`/`watcher` deleted, `MediaScanner` is sole scanner. Visibility via `LEFT JOIN` (missing row = `PRESENT`), symlink `homelab/Music` handled.
- **2026-08-27 — Phase 3:** `MediaRepository` 56-method interface, `SqliteMediaRepository` + `MockMediaRepository`, `MediaEngine` no longer holds `db`/`stmts`.
- **2026-08-27 — Scanner migration:** `MediaScanner` wired in `server.js` (`SqliteMediaRepository` + `MEDIA_ROOT`), `adaptiveController` via `pause()`/`resume()`, SSE via `EventBus`.

## Future Ideas

- **Authentication System**: The auth design is still under consideration — ranging from user login and multi-user support to account recovery in case a user loses their password.
- **Web Stream-based Remote Control (GSR-inspired)**: Direct frame copying from the GPU block encoder for zero-overhead screen capture.
- **Modular Web / Menu Splitting**: Break the web app into independent modules so a deployment does not need the full repo or every menu. Users could pick only 1–2 menus (e.g. just Media Vault + Music, or just Downloader) and run a lighter build with only the selected backend routes, frontend bundles, and dependencies loaded.
- **Media Engine Operations:** Implement `trash()`/`purge()`/`move()`/`rename()` (Phase 5/7) — currently stubs, physical `unlinkSync` remains backend.

## Documentation

| File | Description |
|------|-------------|
| [README.md](README.md) | This file — project overview and quick start |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full technical reference (system architecture, DB schema, API routes, subsystems, monitoring, deployment) |
| [`../media-engine/README.md`](../media-engine/README.md) | Media Engine docs (scanner, repository, safety, visibility) |
| [`../media-engine/plan.md`](../media-engine/plan.md) | 13-phase production plan + transaction strategy |
| `docs/` | Notes, ideas, and archived documentation |

## Contributing

- Read [ARCHITECTURE.md](ARCHITECTURE.md) and [`../media-engine/README.md`](../media-engine/README.md) for technical details
- Use `npm run dev` in each directory
- After editing `media-engine`, run `cd backend && npm install --silent`
- Report issues on GitHub
