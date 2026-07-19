# Media Vault

> **Hardware Note:** This platform is specifically designed for AMD-based laptops. The Monitoring menu uses nbfc and ryzenadj which are hardware-specific and do not support Intel or NVIDIA systems. Other menus are hardware-agnostic.

## Tech Stack Overview

| Layer | Technology | Version | Description |
|-------|------------|---------|-------------|
| **Runtime** | Node.js | >=18 | Backend runtime (ESM) |
| **Framework** | Express | ^4.21.0 | HTTP framework |
| **Database** | SQLite | (WAL) | better-sqlite3 driver, 80MB cache, mmap 4GB |
| **Frontend** | React | ^18.3.1 | UI framework |
| **Bundler** | Vite | ^5.4.8 | Development server & bundler |
| **Styling** | TailwindCSS | ^3.4.13 | Utility CSS + tailwindcss-animate |
| **State** | Zustand | ^5.0.13 | State management |
| **Video Playback** | hls.js | ^1.5.17 | Adaptive HLS player |
| **Charts** | Recharts | ^3.8.1 | Monitoring charts & gauges |
| **Icons** | Lucide React | ^1.16.0 | Icon set |
| **Animation** | Framer Motion | ^12.40.0 | UI animations |
| **Media Processing** | FFmpeg | - | Thumbnail, HLS, transcode, remux |
| **Codec Probing** | FFprobe | - | Metadata & codec detection |
| **Messaging - WhatsApp** | whatsapp-web.js | ^1.34.7 | WhatsApp Web API |
| **Messaging - Telegram** | node-telegram-bot-api | ^1.1.0 | Telegram send + bot downloader |
| **Downloader - Video** | yt-dlp | - | YouTube, Instagram download |
| **Downloader - Images** | gallery-dl | - | TikTok, Twitter/X, Instagram galleries |
| **Downloader - Torrent** | aria2c | - | Torrent & parallel download |
| **Mobile Transfer** | ADB | - | Android file transfer |

---

| Information | Detail |
|-------------|--------|
| **Version** | backend v1.0.0 · frontend v1.0.0 · whatsapp-bot v1.0.0 |
| **Documentation** | See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical reference |

---

## Table of Contents

| Section | Link |
|---------|------|
| Overview | [1](#1-overview) |
| Main Features | [2](#2-main-features) |
| Tech Stack | [3](#3-tech-stack) |
| External Tools | [4](#4-external-tools) |
| Project Structure | [5](#5-project-structure) |
| Git Ignore | [5.5](#55-git-ignore) |
| API Endpoints | [6](#6-api-endpoints) |
| Installation | [7](#7-installation) |
| Development | [8](#8-development) |
| Future Ideas | [9](#9-future-ideas) |
| Contributing | [10](#10-contributing) |

---

## 1. Overview

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
- **Git Integration**: Web-based Git operations without opening terminal

**Technology Stack:** Node.js, Express, SQLite, React, FFmpeg, HLS streaming, waveform visualization.

---

## 2. Main Features

| Menu | Status | Description | Technology Used |
|------|--------|-------------|---------------|
| Media Vault | Optional | Browse and stream offline video/audio/image files seamlessly with adaptive HLS streaming, waveform visualization, and instant search | hls.js, FFmpeg, better-sqlite3 FTS, recharts, framer-motion |
| Library Management | Optional | Auto-scan, full-text search, thumbnail generation | better-sqlite3 WAL, incremental scanning |
| Playlists | Optional | XSPF import, full CRUD, drag-reorder | XSPF parser, folder-based playlists |
| Metadata Editing | Optional | Read/write audio tags, cover art, lyrics | FFprobe, MusicBrainz, LRCLIB |
| Monitoring | Optional | System stats, fan/clock control (Linux only, AMD-focused, under development) | dockerode, nbfc, ryzenadj, WebSocket (real-time) |
| Downloader | Optional | Download from YouTube, TikTok, Instagram, Twitter/X, torrent, gallery-dl; send link to Telegram bot for auto-download with default settings (1080p, h264) or custom parameters | yt-dlp, gallery-dl, aria2c, Telegram bot |
| ADB Transfer | Optional | Push/pull files Android <-> laptop (concurrent workers, no overhead from file managers) | ADB, concurrent workers |
| Scrcpy Monitor | Optional | Remote phone screen viewing via external scrcpy window (zero overhead) | node-pty shell execution |
| Music Player | Optional | Dual modes: cover mode (audio only) and video mode (separate audio/video with precision sync); fixes Strawberry player navigation bug | waveform, synced LRC, hls.js, precision sync engine |
| Send Queue | Optional | Monitors sent/failed/cancelled files to Telegram and WA; tick-based queue for WA status (1-6 posts per day in 24h format) | Tick-based precision, SSE, WA/Telegram APIs |
| Git Integration | Optional | Full Git operations without terminal (status, branches, tags, stash, commit, push, pull, diff, file editor, tree browser) | Simple Git wrapper |

> **Note:** All menus are still actively worked on and under development. New menus may be added in the future.

---

## 3. Tech Stack

### 3.1 Backend Dependencies

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

### 3.2 Frontend Dependencies

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

---

## 4. External Tools

| Binary | Purpose |
|--------|---------|
| ffmpeg | Thumbnails, HLS, transcode, remux |
| ffprobe | Codec detection, metadata |
| yt-dlp | YouTube, Instagram download |
| gallery-dl | TikTok, Twitter/X, Instagram galleries |
| aria2c | Torrent download |
| adb | Android transfer |

---

## 5. Project Structure

### 5.1 Backend

| Path | Description |
|------|-------------|
| `backend/` | Express API, SQLite, media processing |
| `backend/src/server.js` | Entry point, Express, lifecycle |
| `backend/src/db.js` | SQLite database, FTS, settings |
| `backend/src/routes/` | (18 route modules) |

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

| Path | Description |
|------|-------------|
| `backend/src/monitor/` | System metrics |
| `backend/src/utils/` | Helpers (watcher, downloader, upload) |
| `backend/src/middleware/` | Route guards |

### 5.2 Frontend

| Path | Description |
|------|-------------|
| `frontend/` | React 18 SPA (Vite + TailwindCSS) |
| `frontend/src/App.jsx` | Main application |
| `frontend/src/main.jsx` | Vite entry |
| `frontend/src/components/` | (40+ components) |
| `frontend/src/store/` | Zustand stores (6 files) |
| `frontend/src/hooks/` | Custom hooks (5 files) |
| `frontend/src/utils/` | Utility functions |

### 5.3 WhatsApp Bot

| Path | Description |
|------|-------------|
| `whatsapp-bot/` | WhatsApp integration |
| `whatsapp-bot/src/index.js` | Entry point |
| `whatsapp-bot/src/connection.js` | WhatsApp connection |
| `whatsapp-bot/src/listener.js` | Message handler |
| `whatsapp-bot/src/sender.js` | Outbound sender |
| `whatsapp-bot/src/db.js` | SQLite wrapper |
| `whatsapp-bot/src/utils.js` | Utilities |

### 5.4 Data Directories

| Path | Description |
|------|-------------|
| `data/` | `media.db`, download tasks, thumbnails |
| `cache/` | HLS, remux, transcode cache |
| `logs/` | Rotating logs |
| `credentials/` | `.env`, auth files, WhatsApp sessions |
| `Docker/` | docker-compose.yml for monitoring (optional) |

### 5.5 Git Ignore

The `.gitignore` excludes sensitive and generated files:
- `credentials/.env`, cookies.txt, wwebjs_auth/cache - authentication & sessions
- `logs/`, `cache/`, `backup/` - runtime data
- Database files (`*.db`, `media.db`)
- `node_modules/` - dependencies
- `*.log`, `*.tmp` - logs and temp files
- `*.local`, `.vscode/` - editor/IDE files

---

## 6. API Endpoints

### Files & Search (`/api/files`, `/api/search`)

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

### Streaming & Playback (`/stream`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stream/video/:id/playback-info` | Playback decision + mobile flags |
| GET | `/stream/video/:id` | Stream video (direct/remux/transcode) |
| GET | `/stream/video/:id/hls/playlist.m3u8` | HLS playlist |
| GET | `/stream/video/:id/hls/segment-:n.ts` | HLS segment |
| GET | `/stream/video/:id/faststart` | Re-mux with +faststart |
| GET | `/stream/audio/:id` | Audio stream with ranges |

### Monitoring (`/api/monitoring`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/monitoring/stats` | Current system stats |
| GET | `/api/monitoring/overview` | Combined overview |
| GET | `/api/monitoring/history` | Historical metrics |
| GET | `/api/monitoring/disk-io/*` | Disk I/O stats |
| POST | `/api/monitoring/docker/*` | Container control |
| POST | `/api/monitoring/system/power` | Host power control |

### Downloader (`/api/download`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/download/stream` | SSE task stream |
| POST | `/api/download/start` | Create download task |
| POST | `/api/download/bulk` | Create multiple tasks |
| GET | `/api/download/list` | All tasks |
| POST | `/api/download/:id/cancel` | Cancel task |
| POST | `/api/download/:id/retry` | Retry failed task |

### Playlists (`/api/playlists`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/playlists` | All discovered playlists |
| GET | `/api/playlists/:id` | Playlist details |
| POST | `/api/playlists/create/manual` | Create from file IDs |
| POST | `/api/playlists/create/folder` | Create from folder |
| PUT | `/api/playlists/:id/tracks` | Add tracks |
| DELETE | `/api/playlists/:id/tracks/:trackId` | Remove track |

### Metadata (`/api/metadata`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/metadata/:id` | Read metadata |
| PUT | `/api/metadata/:id` | Update tags |
| PUT | `/api/metadata/:id/cover/upload` | Embed cover art |
| GET | `/api/metadata/:id/lyrics` | Get lyrics |

### Services (`/api/services`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/services` | All service statuses |
| POST | `/api/services/:name/start` | Start service |
| POST | `/api/services/:name/stop` | Stop service |

### ADB Transfer (`/api/adb`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/adb/devices` | Connected devices |
| POST | `/api/adb/push` | Push files (workers) |
| POST | `/api/adb/pull` | Pull files from device |
| GET | `/api/adb/jobs` | Transfer jobs |
| GET | `/api/adb/jobs/:id/progress` | SSE progress |

---

## 7. Installation

| Step | Command | Description |
|------|---------|-------------|
| 1 | `git clone <repo-url>` | Clone repo |
| 2 | `cd backend && npm install && npm start` | Run backend |
| 3 | `cd frontend && npm install && npm run dev` | Run frontend |

---

## 8. Development

| Command | Description |
|---------|-------------|
| `npm run dev` (backend) | Auto-reload mode |
| `npm run dev` (frontend) | Vite dev server |
| `npm run debug` (backend) | Debug mode |
| `npm run build` (frontend) | Production build |

---

## Codebase Metrics

| Directory | Files | Lines of Code |
|-----------|-------|---------------|
| `backend/src/` | 82 | ~3,300 |
| `frontend/src/` | 141 | ~18,000 |
| `whatsapp-bot/src/` | 6 | ~900 |
| **Total** | **228** | **~22,000** |

> Note: Lines of code approximate. Does not include `node_modules`, `cache/`, `logs/`, or `data/`.

---

## 9. Future Ideas

- **Authentication System**: User accounts with login/registration, API token management, role-based permissions

- **GPU Screen Recording (GSR-inspired)**: Reinspired from GSR app which uses direct frame copying from GPU block encoder. This approach copies encoded frames instead of re-rendering each frame, resulting in zero-overhead screen capture. Ideal for smooth streaming even on low-end iGPU systems (e.g., 2CU).

---

## Contributing

- See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- Use `npm run dev` in each directory
- Report issues on GitHub