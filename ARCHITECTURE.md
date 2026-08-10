> ## 🚧 Project Status: In Progress
>
> - **Project started:** May 1, 2026
> - **Status:** Actively being worked on.
> - **Current focus (as fast as possible):**
>   - Performance optimization
>   - UI polish / beautification
>   - Bug fixing
>   - Making the logic more proper and robust
>   - Improving the menus and making them better

# Media Vault

![Node](https://img.shields.io/badge/Node-%3E%3D18-green)
![React](https://img.shields.io/badge/React-18.3.1-blue)
![SQLite](https://img.shields.io/badge/SQLite-WAL-orange)

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
| **Version** | backend v1.0.0 · frontend v1.0.0 · whatsapp-bot v1.0.0 |
| **Documentation** | This file (ARCHITECTURE.md) is the full technical reference |

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Development](#development)
- [Codebase Metrics](#codebase-metrics)
- [Future Ideas](#future-ideas)
- [Technical Reference](#technical-reference)
  - [System Architecture](#system-architecture)
  - [Database Schema](#database-schema)
  - [Complete API Reference](#complete-api-reference)
  - [Subsystems](#subsystems)
  - [Deployment](#deployment)
  - [Security Notes](#security-notes)

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
- **Git Integration**: Web-based Git operations without opening terminal (API defined in `git.js`, but **not yet mounted** — see [Git (not mounted)](#git-not-mounted))
- **WhatsApp**: WhatsApp Web pairing and bot controls, accessible from the sidebar
- **AI Chat**: Conversational AI assistant for help, context-aware answers, and tasks

**Technology Stack:** Node.js, Express, SQLite, React, FFmpeg, HLS streaming, waveform visualization.

## Features

| Menu | Status | Description | Technology Used |
|------|--------|-------------|---------------|
| Media Vault | Optional | Browse and stream offline video/audio/image files seamlessly with adaptive HLS streaming, waveform visualization, and instant search | hls.js, FFmpeg, better-sqlite3 FTS, recharts, framer-motion |
| Library Management | Optional | Auto-scan, full-text search, thumbnail generation | better-sqlite3 WAL, incremental scanning |
| Playlists | Optional | XSPF import, full CRUD, drag-reorder | XSPF parser, folder-based playlists |
| Metadata Editing | Optional | Read/write audio tags, cover art, lyrics | FFprobe, MusicBrainz, LRCLIB |
| Monitoring | Optional | System stats, fan/clock control (Linux only, AMD-focused, under development) | nbfc, ryzenadj, WebSocket (real-time) |
| Downloader | Optional | Download from YouTube, TikTok, Instagram, Twitter/X, torrent, gallery-dl; send link to Telegram bot for auto-download with default settings (1080p, h264) or custom parameters | yt-dlp, gallery-dl, aria2c, Telegram bot |
| ADB Transfer | Optional | Push/pull files Android <-> laptop (concurrent workers, no overhead from file managers) | ADB, concurrent workers |
| Scrcpy Monitor | Optional | Remote phone screen viewing via external scrcpy window (zero overhead) | node-pty shell execution |
| Music Player | Optional | Dual modes: cover mode (audio only) and video mode (separate audio/video with precision sync); fixes Strawberry player navigation bug | waveform, synced LRC, hls.js, precision sync engine |
| Send Queue | Optional | Monitors sent/failed/cancelled files to Telegram and WA; tick-based queue for WA status (1-6 posts per day in 24h format) | Tick-based precision, SSE, WA/Telegram APIs |
| WhatsApp | Optional | WhatsApp Web pairing (QR), connection status, and bot/message controls | whatsapp-web.js, whatsapp-bot, /api/whatsapp |
| AI Chat | Optional | Conversational AI assistant with provider-based models, context awareness, and a settings UI | ai.js, ai-providers.js, ai-context.js, AIChat.jsx, AISettings.jsx |
| Git Integration | API-only (not mounted) | Full Git operations without terminal (status, branches, tags, stash, commit, push, pull, diff, file editor, tree browser); web UI menu under development | Simple Git wrapper |

> **Note:** All menus are still actively worked on and under development. New menus may be added in the future.

## Tech Stack

### Backend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
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
| react-router-dom | ^7.15.1 | Routing |
| react-virtualized-auto-sizer | ^1.0.26 | Virtual sizing |
| react-window | ^1.8.11 | Virtualized grid |
| recharts | ^3.8.1 | Charts |
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
# 1. Clone
git clone <repo-url>
cd homelab-media-server

# 2. Backend
cd backend && npm install
cp ../.env.example ../credentials/.env   # edit as needed
npm start

# 3. Frontend (dev only)
cd frontend && npm install && npm run dev
```

> **Note:** In production, the frontend is served statically by the backend. Vite is for development only.

## Project Structure

```
homelab-media-server/
├── backend/          # Express API + media processing
├── frontend/         # React 18 SPA
├── whatsapp-bot/     # WhatsApp integration
├── data/             # media.db, download tasks, thumbnails
├── cache/            # HLS, remux, transcode cache
├── logs/             # Rotating logs
├── credentials/      # .env, auth files (gitignored)
└── docs/             # Documentation archives
```

### Backend

| Path | Description |
|------|-------------|
| `backend/src/server.js` | Entry point, Express, lifecycle |
| `backend/src/db.js` | SQLite database, FTS, settings |
| `backend/src/routes/` | 22 route modules |
| `backend/src/ai/` | AI chat engine (providers, context, chat) |
| `backend/src/monitor/` | System metrics |
| `backend/src/services/` | Background service modules |
| `backend/src/utils/` | Helpers (watcher, downloader, upload) |
| `backend/src/middleware/` | Route guards |

| Route Module | Description |
|--------------|-------------|
| `adb.js` | Android transfer |
| `downloader.js` | Download management (yt-dlp, gallery-dl, aria2c) |
| `file.js` | Raw file serve (range, cache headers) |
| `files.js` | File listing, FTS search, pagination |
| `jobs.js` | Background job status |
| `metadata.js` | Audio tags, covers, lyrics |
| `monitoring.js` | Stats, history, alerts |
| `playback.js` | Cache, health, config |
| `playlists.js` | XSPF import, CRUD |
| `scrcpy.js` | Scrcpy control |
| `send.js` | Telegram send |
| `services.js` | Service registry |
| `settings.js` | Config CRUD |
| `stream.js` | Video/audio streaming |
| `thumbnails.js` | Thumbnail generation |
| `upload.js` | Multipart upload |
| `videoCache.js` | Video cache management |
| `whatsapp.js` | WhatsApp bridge |
| `ai.js` | AI chat API (providers, context, chat) |
| `ai-context.js` | AI context building |
| `ai-providers.js` | AI provider configuration |
| `git.js` | Git operations (defined, NOT mounted — see Subsystems) |

### Frontend

| Path | Description |
|------|-------------|
| `frontend/src/App.jsx` | Main application |
| `frontend/src/main.jsx` | Vite entry |
| `frontend/src/components/` | 70+ components |
| `frontend/src/store/` | Zustand stores |
| `frontend/src/hooks/` | Custom hooks |
| `frontend/src/utils/` | Utility functions |

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

**Files & Search** (`/api/files`, `/api/search`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/files` | Browse a folder with cursor pagination |
| GET | `/api/files/shuffle` | Return all playable files in random order |
| POST | `/api/files/refresh` | Run incremental scan + orphan cleanup |
| POST | `/api/files/cleanup` | Remove orphan DB entries |
| GET | `/api/files/stats` | Quick file-type counts |
| GET | `/api/files/folders/:id` | Resolve folder id to path metadata |
| GET | `/api/files/:id/previews` | Up to 4 preview file IDs for a folder |
| GET | `/api/search` | FTS file search + folder search |
| GET | `/api/search/suggest` | Autocomplete name suggestions |

**Streaming & Playback** (`/stream`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stream/video/:id/playback-info` | Playback decision + mobile flags |
| GET | `/stream/video/:id` | Stream video (direct/remux/transcode) |
| GET | `/stream/video/:id/hls/playlist.m3u8` | HLS playlist |
| GET | `/stream/video/:id/hls/segment-:n.ts` | HLS segment |
| GET | `/stream/video/:id/faststart` | Re-mux with +faststart |
| GET | `/stream/audio/:id` | Audio stream with ranges |

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

**Metadata** (`/api/metadata`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/metadata/:id` | Read metadata |
| PUT | `/api/metadata/:id` | Update tags |
| PUT | `/api/metadata/:id/cover/upload` | Embed cover art |
| GET | `/api/metadata/:id/lyrics` | Get lyrics |

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

> The full endpoint list (every route across all 22 modules) is in the [Complete API Reference](#complete-api-reference) section below.

## Development

| Package | Command | Description |
|---------|---------|-------------|
| backend | `npm start` | Start server |
| backend | `npm run dev` | Auto-reload mode |
| backend | `npm run debug` | Debug mode |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | Production build |
| whatsapp-bot | `npm start` | Start bot |
| whatsapp-bot | `npm run dev` | Auto-reload mode |

> **Note:** `backend/`, `frontend/`, and `whatsapp-bot/` are independent packages (not a monorepo).

## Codebase Metrics

| Directory | Files | Lines of Code |
|-----------|-------|---------------|
| `backend/src/` | ~110 | ~26,500 |
| `frontend/src/` | ~198 | ~52,500 |
| `whatsapp-bot/src/` | 6 | ~900 |
| **Total** | **~314** | **~80,000** |

> Note: Lines of code approximate. Does not include `node_modules`, `cache/`, `logs/`, or `data/`.

## Future Ideas

- **Authentication System**: The auth design is still under consideration — ranging from user login and multi-user support to account recovery in case a user loses their password.
- **Web Stream-based Remote Control (GSR-inspired)**: Direct frame copying from the GPU block encoder for zero-overhead screen capture.

## Documentation

| File | Description |
|------|-------------|
| [README.md](README.md) | Project overview and quick start |
| [ARCHITECTURE.md](ARCHITECTURE.md) | This file — full technical reference (system architecture, DB schema, complete API routes, subsystems, monitoring, deployment) |
| `docs/` | Notes, ideas, and archived documentation |

## Contributing

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- Use `npm run dev` in each directory
- Report issues on GitHub

---

# Technical Reference

This section is the authoritative technical reference. It is generated from the actual source and kept in sync with the running backend. Where the codebase and this document disagree, treat the code as correct and update this file.

## System Architecture

### Process Model

Media Vault runs as a **single Node.js process** (the backend) that imports the WhatsApp bot as an in-process module. There is no separate bot process: `backend/src/routes/whatsapp.js` imports `whatsapp-bot/src/connection.js`, `listener.js`, `sender.js`, and `utils.js` directly. The frontend is a static React build served by the backend in production.

```
┌───────────────┐      HTTP / WebSocket / SSE      ┌──────────────────────────┐
│  Browser /    │ ───────────────────────────────▶ │  backend (Node + Express) │
│  Mobile Web   │ ◀─────────────────────────────── │  • API routes (22 modules)│
└───────────────┘                                   │  • serves frontend/dist   │
                                                    │  • in-process WA bot      │
                                                    └───────────┬──────────────┘
                                                                │ spawns / shells out
                          ┌─────────────────────────────────────┼──────────────────────────┐
                          ▼                                     ▼                          ▼
                    ffmpeg / ffprobe                     yt-dlp / gallery-dl /        adb / scrcpy
                    (transcode, thumb, HLS)              aria2c (downloads)           (Android, PTY)
```

### Request Lifecycle

1. `cors()` → `compression()` → `express.json()` → `sessionMiddleware`.
2. A request counter middleware (`trackRequest`) records method + path for the live metrics view.
3. Routes are mounted at fixed prefixes in `server.js`. Many are wrapped with `requireService('<name>')`, which returns **503** if the named service is stopped (see Service Registry).
4. Static asset serving and the SPA fallback (`*`) are mounted **last**, so API routes take precedence.

### Service Registry & Gating

`backend/src/middleware/serviceGuard.js` exports `requireService(name)`. Each guarded route prefix checks a service's enabled flag; if disabled, the request is rejected with `503 { error: 'Service ... is not running' }`.

Services (registry in `backend/src/routes/services.js`):
- `mediaVault` — file browse, stream, thumbnails, metadata (guards `/api/files`, `/file`, `/thumbnails`, `/stream`, `/api/metadata`)
- `downloader` — guards `/api/download`
- `adbTransfer` — guards `/api/adb`
- `playlists` — guards `/api/playlists/scan` and `/api/playlists/:id/refresh`
- `monitoring` — not gated (always available)
- `whatsapp` — managed by the in-process bot; status via `/api/whatsapp/*`
- `sendQueue` — managed by `startSendScheduler()` at startup

Service lifecycle endpoints:
- `GET /api/services` — all statuses
- `GET /api/services/:name` — single status
- `POST /api/services/:name/start` / `stop` / `restart`
- `POST /api/services/restart-all`

### Real-time Channels

- **WebSocket** (`backend/src/monitor/websocket.js`): live monitoring metrics pushed to dashboards.
- **SSE streams**:
  - `GET /api/updates` — generic server-sent event bus (frontend subscribes for cross-tab/backend events).
  - `GET /api/logs/stream` — streaming backend logs.
  - `GET /api/monitoring/jobs` — background job status stream (reuses `jobsRouter` mounted at `/api/monitoring/jobs`).
  - `GET /api/monitoring/sessions/stream` — active session stream.
  - `GET /api/download/stream` — download task progress.
  - `GET /api/adb/jobs/:id/progress` — ADB transfer progress.
  - `GET /api/whatsapp/logs/stream` — WhatsApp bot logs.

### Media Roots & Storage

- `MEDIA_ROOT` is read from `process.env.MEDIA_ROOT` and supports **multiple colon-separated roots** (`MEDIA_ROOT=/a:/b`). Default: `/home/CATIAA/homelab`.
- The DB stores folder/file **metadata** (path, mtime, size, hash, type) but media bytes live on disk; streaming reads files by resolved absolute path with range support.
- `data/` holds `media.db` (SQLite, WAL), downloaded tasks, and generated thumbnails. `cache/` holds HLS/remux/transcode outputs.

### Startup Sequence (server.js)

1. Global error handlers (`unhandledRejection`).
2. Express app + middleware.
3. Mount all API routers (order matters; static/SPA last).
4. `setupWhatsAppRoutes(app)` — registers `/api/whatsapp/*`.
5. Init inbound Telegram bots (`initTelegramInbound`, `initTelegramAudioBot`) — non-fatal on failure.
6. `startSendScheduler()` — starts the tick-based WA send queue — non-fatal on failure.
7. Start the WebSocket server for monitoring.
8. Listen on `PORT` (default `3001`).

## Database Schema

The SQLite database (`data/media.db`, WAL mode) is initialized in `backend/src/db.js`. All tables use `IF NOT EXISTS`. Primary tables:

| Table | Purpose |
|-------|---------|
| `folders` | Directory tree (path, parent_id, depth, file_count, total_size) |
| `files` | File records (name, dir_id, size, mtime, type, hash, favorite, locked, durations) |
| `folder_generation` | Incremental scan generation counter |
| `files_fts` | FTS5 virtual table over `files(name)` (unicode61, diacritics removed) for search |
| `settings` | Key/value config (JSON-capable) |
| `settings_history` | Rolling history of setting changes (for rollback) |
| `send_counters` | WhatsApp status send counters |
| `send_rate_limit` | Rate-limit tracking |
| `send_queue` | Outbound send jobs (telegram / whatsapp / channel), status, schedule, captions |
| `send_settings` | Single-row (id=1) WA tick settings (tick_enabled, per_day) |
| `telegram_allowed_chats` / `telegram_bot_tasks` / `telegram_task_link` / `telegram_ephemeral` / `telegram_processed` | Inbound Telegram downloader bot state |
| `telegram_audio_bot_tasks` / `telegram_audio_task_link` / `telegram_audio_ephemeral` / `telegram_audio_processed` | Audio-only Telegram bot state |
| `playlists` | Playlist header (XSPF import, folder-based, name, type, deleted_at) |
| `playlist_tracks` | Track membership (playlist_id, file_id, track_index) |
| `uploads` | Upload session state + metadata repair tracking |
| `adb_transactions` | Per-file ADB transfer transactions (status, conflict info) |
| `adb_jobs` | ADB transfer jobs (device, direction, status, progress) |
| `conversations` | AI chat conversations (local_id, title, pinned, updated_at) |
| `messages` | AI chat messages (conversation_id, role, content, tool calls) |
| `ai_provider_status` | Per-provider connectivity/health |
| `ai_conversation_settings` | Per-conversation AI configuration overrides |
| `ai_memories` | Extracted long-term memories (enabled, pinned, conversation_id) |
| `ai_context_summaries` | Compacted conversation context summaries |
| `ai_pinned_messages` | Pinned messages within a conversation |
| `ai_model_preferences` | Preferred models per provider |

Indexes exist for common access paths (favorite, locked, cursor pagination on `dir_id`, folder parent/path, send_queue status, adb job/tx status, conversation indexes, memory enabled/pinned).

The WhatsApp bot uses its **own** SQLite database (`whatsapp-bot` package) — it is not the same `media.db`.

## Complete API Reference

Every route across all mounted modules. Paths are shown **relative to the mount prefix**. Methods: G=GET, P=POST, U=PUT, D=DELETE, H=PATCH.

> ⚠️ **Git routes are NOT mounted.** `git.js` defines the routes below but is never registered in `server.js`. They are listed for reference only; calling them returns 404 until mounted.

### `/api/files` and `/api/search` (alias) — `files.js` (requires `mediaVault`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | Browse a folder with cursor pagination |
| G | `/shuffle` | All playable files in random order |
| P | `/refresh` | Incremental scan + orphan cleanup |
| P | `/cleanup` | Remove orphan DB entries |
| G | `/stats` | Quick file-type counts |
| G | `/folders/:id` | Resolve folder id → path metadata |
| G | `/folders/:id/index` | Folder's file index (positions) |
| P | `/batch` | Batch resolve multiple file ids |
| G | `/:id/previews` | Up to 4 preview file IDs for a folder |
| G | `/search` | FTS file search + folder search |
| G | `/search/suggest` | Autocomplete suggestions |
| H | `/:id/lock` | Toggle/set lock |
| G | `/:id/lock` | Get lock state |
| H | `/:id/favorite` | Toggle favorite |
| G | `/:id` | File metadata |
| P | `/resolve-batch` | Resolve many ids (alt batch) |

### `/file` — `file.js` (requires `mediaVault`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/:id` | Serve raw file (range + cache headers) |

### `/thumbnails` — `thumbnails.js` (requires `mediaVault`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/:id.jpg` | Generated thumbnail for file |
| G | `/folder/:id.jpg` | Folder thumbnail |

### `/stream` — `stream.js` (requires `mediaVault`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/video/:id/playback-info` | Playback decision + mobile flags |
| G | `/video/:id` | Stream video (direct/remux/transcode) |
| G | `/audio/:id` | Audio stream with ranges |
| G | `/video/:id/hls/playlist.m3u8` | HLS playlist |
| G | `/video/:id/hls/segment-:segment(\d+).ts` | HLS segment |
| G | `/video/:id/compatibility` | Compatibility-mode transcode |
| G | `/video/:id/webm` | WebM transcode |
| G | `/video/:id/faststart` | Re-mux with +faststart |

### `/api/monitoring` — `monitoring.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/media` | Media library stats |
| P | `/media/thumbnails/generate` | Regenerate thumbnails |
| G | `/stats` | Current system stats |
| G | `/overview` | Combined overview |
| G | `/history` | Historical metrics |
| G | `/disk-io/daily` | Daily disk I/O |
| G | `/disk-io/total` | Total disk I/O |
| G | `/metrics/stats` | Metrics DB stats |
| P | `/metrics/cleanup` | Clean old metrics |
| P | `/metrics/optimize` | Optimize metrics DB |
| G | `/ws-status` | WebSocket connection status |
| P | `/network/iperf/start` | Start iperf test |
| G | `/network/iperf/stream/:id` | iperf result stream |
| G | `/platform` | Platform info |
| G | `/processes` | Running processes |
| G | `/services` | Monitored services |
| P | `/services/:name/:action` | Service action (start/stop/restart) |
| G | `/logs` | Monitoring logs |
| G | `/alerts` | Active alerts |
| P | `/alerts/threshold` | Set alert threshold |
| P | `/alerts/check` | Force alert check |
| G | `/web-stats` | Web request stats |
| G | `/docker` | Docker containers |
| P | `/docker/:id/:action` | Container action (start/stop) |
| G | `/docker/:id/logs` | Container logs |
| G | `/docker/:id/inspect` | Container inspect |
| G | `/docker-images` | Docker images |
| G | `/docker-info` | Docker daemon info |
| P | `/system/power` | Host power control (shutdown/suspend) |
| P | `/restart/backend` | Restart backend process |
| P | `/restart/frontend` | Signal frontend reload |
| G | `/queues` | Background queue stats |
| P | `/queues/:type/:action` | Queue control |
| G | `/sessions` | Active sessions |
| G | `/sessions/stream` | Session SSE stream |
| D | `/sessions/:id` | Kill a session |
| G | `/hardware` | Hardware info |
| G | `/cpu-freq` | CPU frequency |
| P | `/cpu-freq` | Set CPU frequency (ryzenadj) |
| P | `/hardware/fan` | Set fan speed (nbfc) |

### `/api/monitoring/jobs` — `jobs.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | Background job statuses |

### `/api/services` — `services.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | All service statuses |
| G | `/:name` | Single service status |
| P | `/:name/start` | Start service |
| P | `/:name/stop` | Stop service |
| P | `/:name/restart` | Restart service |
| P | `/restart-all` | Restart all services |

### `/api/settings` — `settings.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | All settings |
| G | `/history` | Setting change history |
| P | `/rollback/:id` | Rollback to a history entry |
| G | `/:category` | Settings in a category |
| U | `/:key` | Update a setting |
| P | `/` | Create/set a setting |
| D | `/:key` | Delete a setting |

### `/api/ai` — `ai.js` (conversations, providers, tools)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | AI status / capabilities |
| G | `/settings` | AI settings |
| U | `/settings/:key` | Update AI setting |
| G | `/providers` | Configured providers |
| P | `/providers` | Add a provider |
| D | `/providers/:id` | Remove a provider |
| G | `/models/:providerId` | Models for a provider |
| G | `/conversations` | List conversations |
| P | `/conversations` | Create conversation |
| G | `/conversations/:id` | Get conversation |
| H | `/conversations/:id` | Patch conversation (title, etc.) |
| D | `/conversations/:id` | Delete conversation |
| G | `/conversations/:id/export` | Export conversation |
| G | `/conversations/:id/search` | Search in conversation |
| G | `/tools` | Available tools |
| P | `/conversations/:id/message` | Send a message (streaming) |
| P | `/tools/:name` | Invoke a tool |

### `/api/ai/providers` — `ai-providers.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/status` | Provider connectivity status |
| P | `/:id/verify` | Verify provider credentials |
| G | `/:id/models` | Provider models |
| P | `/:id/models/refresh` | Refresh model list |
| G | `/` | List providers (preferences) |
| P | `/preferences` | Save provider preferences |
| P | `/mark-used` | Mark provider used |
| G | `/favorites` | Favorite models |
| G | `/presets` | Provider presets |

### `/api/ai` (context) — `ai-context.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/memories` | List memories |
| G | `/memories/count` | Memory count |
| P | `/memories` | Create memory |
| U | `/memories/:id` | Update memory |
| D | `/memories/:id` | Delete memory |
| P | `/memories/:id/toggle-pin` | Pin/unpin memory |
| P | `/memories/:id/toggle-enabled` | Enable/disable memory |
| P | `/memories/extract/:conversationId` | Extract memories from conversation |
| G | `/memories/export` | Export memories |
| G | `/conversations/:id/settings` | Per-conversation AI settings |
| U | `/conversations/:id/settings` | Update per-conversation settings |
| G | `/conversations/:id/context` | Built context for a conversation |
| P | `/conversations/:id/context/compact` | Compact context |
| P | `/conversations/:id/pin/:messageId` | Pin a message |
| D | `/conversations/:id/pin/:messageId` | Unpin a message |
| G | `/conversations/:id/pinned` | List pinned messages |

### `/api/playback` — `playback.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/stats` | Playback cache stats |
| G | `/config` | Playback config |
| G | `/health` | Playback health |
| P | `/cleanup` | Clean playback cache |

### Server-level logs

| Method | Path | Purpose |
|--------|------|---------|
| G | `/api/logs` | Recent logs (limit query) |
| G | `/api/logs/stream` | Live log SSE |
| G | `/api/folders/:id` | Resolve folder id (used by frontend) |
| G | `/api/updates` | Generic SSE event bus |
| G | `/health` | Liveness probe |
| G | `/api/ready` | Readiness probe |
| G | `/api/debug` | Debug snapshot |
| G | `/api/debug/resources` | Resource snapshot |
| G | `/api/debug/stress/scanner` | Trigger incremental scan |
| G | `/api/debug/stress/folders` | Folder count probe |

### `/api/download` — `downloader.js` (requires `downloader`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/stream` | SSE task stream |
| G | `/config` | Downloader config |
| P | `/config` | Update config |
| P | `/start` | Create download task |
| P | `/bulk` | Create multiple tasks |
| P | `/formats` | Query available formats |
| P | `/playlist` | Download a playlist |
| P | `/twitter-info` | Fetch Twitter/X info |
| G | `/list` | All tasks |
| G | `/:id` | Single task |
| P | `/:id/cancel` | Cancel task |
| P | `/:id/remove` | Remove task |
| P | `/:id/retry` | Retry failed task |

### `/api/upload` — `upload.js`

| Method | Path | Purpose |
|--------|------|---------|
| P | `/` | Multipart upload |
| G | `/status` | Upload status |
| G | `/history` | Upload history |
| D | `/:id` | Delete upload record |
| D | `/:id/file` | Delete uploaded file |
| G | `/stats` | Upload stats |
| P | `/repair-metadata` | Repair file metadata |
| P | `/repair-durations` | Repair durations |

### `/api/adb` — `adb.js` (requires `adbTransfer`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/devices` | Connected devices |
| P | `/ls` | List device directory |
| P | `/stat` | Stat device path |
| P | `/localls` | List local directory |
| P | `/localstat` | Stat local path |
| P | `/check-duplicates` | Check for duplicates |
| P | `/push` | Push files (workers) |
| P | `/pull` | Pull files from device |
| G | `/jobs` | Transfer jobs |
| G | `/jobs/:id` | Single job |
| G | `/jobs/:id/progress` | SSE progress |
| D | `/jobs/:id` | Delete job |
| P | `/jobs/:id/pause` | Pause job |
| P | `/jobs/:id/resume` | Resume job |
| P | `/jobs/:id/reassign-device` | Reassign device |
| P | `/jobs/:id/retry-failed` | Retry failed transfers |
| G | `/jobs/:id/transactions` | Job transactions |
| P | `/jobs/:id/conflict` | Resolve conflict |

### `/api/playlists` — `playlists.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/` | All discovered playlists |
| G | `/:id` | Playlist details |
| G | `/:id/play` | Playlist play view |
| P | `/scan` | Scan for playlists (requires `playlists`) |
| P | `/:id/refresh` | Refresh playlist (requires `playlists`) |
| D | `/:id` | Delete playlist |
| P | `/create/manual` | Create from file IDs |
| P | `/create/empty` | Create empty playlist |
| P | `/:id/tracks` | Add tracks |
| D | `/:id/tracks/:trackId` | Remove a track |
| P | `/:id/tracks/delete` | Bulk-delete tracks |
| G | `/:id/available-tracks` | Tracks available to add |
| P | `/create/folder` | Create from folder |
| P | `/import` | Import (XSPF) |

### `/api/metadata` — `metadata.js` (requires `mediaVault`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/cover-art/search` | Search cover art |
| G | `/lyrics/search` | Search lyrics |
| G | `/:id` | Read metadata |
| U | `/:id` | Update tags |
| U | `/:id/cover` | Set cover art |
| U | `/:id/cover/upload` | Upload + embed cover art |
| G | `/:id/lyrics` | Get lyrics |
| U | `/:id/lyrics` | Set lyrics |

### `/api/scrcpy` — `scrcpy.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/devices` | Scrcpy-capable devices |
| G | `/status` | Scrcpy status |
| P | `/start` | Start scrcpy session |
| P | `/stop` | Stop session |
| P | `/stop-all` | Stop all sessions |
| P | `/input` | Send input event |

### `/api/send` — `send.js`

| Method | Path | Purpose |
|--------|------|---------|
| G | `/health/internet` | Internet connectivity check |
| P | `/telegram` | Send via Telegram |
| P | `/all` | Send to all channels |
| P | `/whatsapp` | Send via WhatsApp status |
| P | `/channel` | Send to a channel |
| P | `/status` | Send status update |
| G | `/telegram/status` | Telegram send status |
| G | `/settings` | Send settings |
| P | `/settings` | Update send settings |
| G | `/queue/statuses` | Queue status summary |
| G | `/queue` | Queue list |
| G | `/progress` | Send progress |
| P | `/queue/:id/cancel` | Cancel queued send |
| P | `/queue/:id/retry` | Retry queued send |
| D | `/queue/:id` | Delete queue item |
| P | `/queue/clear-history` | Clear history |
| U | `/queue/:id/caption` | Edit caption |
| U | `/queue/:id/reorder` | Reorder queue |
| U | `/queue/:id/schedule` | Schedule send (tick) |
| P | `/queue/:id/resend` | Resend |
| P | `/_testsend/:id` | Test-send (debug) |

### `/api/video-cache` — `videoCache.js`

| Method | Path | Purpose |
|--------|------|---------|
| P | `/search` | Search cached video |
| P | `/auto-detect/:id` | Auto-detect YouTube id |
| P | `/save-id/:id` | Save mapping |
| P | `/download/:youtubeId` | Download to cache |
| D | `/:youtubeId` | Delete cache |
| G | `/progress/:youtubeId` | Download progress |
| G | `/stream/:youtubeId` | Stream cached video |
| G | `/status` | Cache status |
| P | `/clear` | Clear cache |

### `/api/whatsapp/*` — `whatsapp.js` (in-process bot via `setupWhatsAppRoutes`)

| Method | Path | Purpose |
|--------|------|---------|
| G | `/api/whatsapp/status` | Connection status |
| G | `/api/whatsapp/qr` | QR (text) for pairing |
| G | `/api/whatsapp/qr-image` | QR image (PNG) |
| P | `/api/whatsapp/start` | Start client |
| P | `/api/whatsapp/stop` | Stop client |
| P | `/api/whatsapp/restart` | Restart client |
| P | `/api/whatsapp/logout` | Logout / clear session |
| P | `/api/whatsapp/generate-qr` | Regenerate QR |
| G | `/api/whatsapp/logs` | Bot logs |
| G | `/api/whatsapp/logs/stream` | Bot log SSE |
| G | `/api/whatsapp/stats` | Bot stats |
| U | `/api/whatsapp/counter` | Update send counter |
| P | `/api/whatsapp/counter/reset` | Reset counter |
| G | `/api/whatsapp/config` | Bot config |
| U | `/api/whatsapp/config` | Update bot config |
| P | `/api/whatsapp/test-status` | Test status send |
| P | `/api/whatsapp/debug-lid` | Debug LID |
| P | `/api/whatsapp/debug-statuscoll` | Debug status collection |
| P | `/api/whatsapp/_mylist` | List my status |
| P | `/api/whatsapp/_delstatus` | Delete a status |
| P | `/api/whatsapp/_delallmystatus` | Delete all my status |
| P | `/api/whatsapp/_statusdiag` | Status diagnostics |
| P | `/api/whatsapp/debug-statusprivacy` | Debug status privacy |
| P | `/api/whatsapp/_setprivacy` | Set status privacy |
| P | `/api/whatsapp/debug-msg` | Debug message |

> Endpoints prefixed with `_` are debug/diagnostic helpers.

### Git (NOT MOUNTED) — `git.js` (reference only)

These routes exist in `backend/src/routes/git.js` but are **never registered** in `server.js`, so `/api/git/*` returns 404. Listed for future wiring:

| Method | Path | Purpose |
|--------|------|---------|
| G | `/status` | Working tree status |
| G | `/diff` | Unstaged diff |
| G | `/diff-commit` | Commit diff |
| G | `/unpushed` | Unpushed commits |
| G | `/log` | Commit log |
| G | `/branches` | Branches |
| G | `/tags` | Tags |
| G | `/stash-list` | Stash list |
| G | `/tree` | File tree |
| G | `/file` | Read file (G) / write file (P) |
| G | `/gitignore` | Show .gitignore (G) / update (P) |
| P | `/stage` | Stage changes |
| P | `/commit` | Commit |
| P | `/push` | Push |
| P | `/pull` | Pull |
| P | `/checkout` | Checkout branch/ref |
| P | `/merge` | Merge |
| P | `/stash` | Stash |
| P | `/tag` | Create tag |

## Subsystems

### Music Sync Engine

Documented in the warning block at the top of this file. Key files:
- `frontend/src/components/Music.jsx` — UI + control loop.
- `frontend/src/utils/decision/*` — `DecisionEngine`, `DerivedMetrics`, `ConstraintProvider`.
- `frontend/src/utils/memory/*` — `DriftMemory`, `SchedulerMemory`, `PipelineMemory`.
- `frontend/src/utils/syncCore.js` — `SyncCore` + `SYNC DEBUG` overlay.

It is a closed-loop adaptive controller (EMA drift, 2σ soft threshold clamped 8–40ms, HOLD/SET_RATE/SOFT_SEEK/HARD_SEEK actions, 100ms ExecutionQueue coalescing). Treat as fragile; verify with the `SYNC DEBUG` overlay after any change.

### Monitoring

- Real-time via **WebSocket** (`monitor/websocket.js`) plus SSE fallbacks.
- Collects: CPU, memory, disk I/O, temperatures, processes, Docker containers, network (iperf), fan/clock (nbfc/ryzenadj — AMD/Linux only).
- Persists metrics to SQLite for history; `/metrics/cleanup` and `/metrics/optimize` manage retention.
- Alerts with configurable thresholds (`/alerts/threshold`, `/alerts/check`).

### Downloader

- Backed by `yt-dlp`, `gallery-dl`, `aria2c`.
- Tasks tracked in DB; progress streamed via `GET /api/download/stream` (SSE).
- Telegram inbound bots (`initTelegramInbound`, `initTelegramAudioBot`) watch for links and auto-create tasks using configured defaults (1080p, h264) or custom params.

### Send Queue

- `send.js` + `startSendScheduler()` (started at boot).
- Supports Telegram, WhatsApp status, and channels.
- WhatsApp status uses a **tick-based** scheduler (`send_settings.per_day`, default 3 posts/day, 24h format) — see `/api/send/queue/:id/schedule`.
- Queue item lifecycle: pending → sending → sent/failed/cancelled; supports cancel, retry, resend, reorder, caption edit, clear-history.

### WhatsApp

- In-process bot (`whatsapp-bot` package) imported by `routes/whatsapp.js`.
- Pairing via QR (`/api/whatsapp/qr`, `/qr-image`).
- Uses `whatsapp-web.js` + `qrcode-terminal`; stores session in `credentials/`.
- Owns its own SQLite DB for message/bot state.

### AI Chat

- Provider-agnostic: OpenAI, Anthropic, Google, Ollama, OpenRouter, Groq, DeepSeek, custom (presets in `ai-providers.js`).
- Pipeline: `ai.js` (chat/conversations/tools) + `ai-providers.js` (provider config/health) + `ai-context.js` (memories/context compaction/pinning).
- Supports streaming messages, tool use, per-conversation settings, and long-term memory extraction (`/memories/extract/:conversationId`).
- Settings persisted in `settings` table under `ai.*` keys.

## Deployment

- **Production**: build the frontend (`frontend && npm run build` → `frontend/dist`), then run only the backend (`backend && npm start`). The backend serves `frontend/dist` statically and handles SPA fallback. Vite dev server is unnecessary in production.
- **Single process**: backend process also hosts the WhatsApp bot in-process. No extra daemons required beyond external CLI tools (ffmpeg, yt-dlp, adb, aria2c, nbfc/ryzenadj).
- **Env**: backend reads `.env` from `credentials/.env` (example at `.env.example`). `MEDIA_ROOT` accepts colon-separated multiple roots.
- **Port**: `PORT` (default `3001`).
- **Process managers**: any Node process manager (pm2/systemd) can supervise `backend`. Restart endpoints also exist (`/api/monitoring/restart/backend`, `/restart/frontend`).

## Security Notes

- No authentication is implemented yet (see Future Ideas). The server is intended for **trusted local networks only**.
- Service gating (`requireService`) prevents using disabled features but is **not** an auth boundary.
- External tool invocation (ffmpeg, yt-dlp, adb, shell via node-pty for scrcpy) should be treated as privileged; restrict network exposure.
- WhatsApp session and Telegram bot tokens live in `credentials/` (gitignored). Never commit them.

---

*This document is the technical reference. When the code and this file disagree, the code is correct — update this file.*
