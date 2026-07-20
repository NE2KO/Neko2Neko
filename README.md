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
| Codebase Metrics | [9](#9-codebase-metrics) |
| Future Ideas | [10](#10-future-ideas) |
| Architecture Diagrams | [11](#11-architecture-diagrams) |
| Contributing | [12](#12-contributing) |
|-------------|--------|

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

## 9. Codebase Metrics

| Directory | Files | Lines of Code |
|-----------|-------|---------------|
| `backend/src/` | 82 | ~3,300 |
| `frontend/src/` | 141 | ~18,000 |
| `whatsapp-bot/src/` | 6 | ~900 |
| **Total** | **228** | **~22,000** |

> Note: Lines of code approximate. Does not include `node_modules`, `cache/`, `logs/`, or `data/`.

---

## 10. Future Ideas

- **Authentication System**: User accounts with login/registration, API token management, role-based permissions

- **GPU Screen Recording (GSR-inspired)**: Reinspired from GSR app which uses direct frame copying from GPU block encoder. This approach copies encoded frames instead of re-rendering each frame, resulting in zero-overhead screen capture. Ideal for smooth streaming even on low-end iGPU systems (e.g., 2CU).

---

## 11. Architecture Diagrams

### 11.1 High-Level System Architecture

<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto; background:#f8fafc; border-radius:8px; padding:16px;">
  <defs>
    <linearGradient id="gradClient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#3b82f6"/><stop offset="100%" style="stop-color:#1d4ed8"/></linearGradient>
    <linearGradient id="gradBackend" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#10b981"/><stop offset="100%" style="stop-color:#059669"/></linearGradient>
    <linearGradient id="gradExt" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#8b5cf6"/><stop offset="100%" style="stop-color:#7c3aed"/></linearGradient>
    <linearGradient id="gradMon" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#f59e0b"/><stop offset="100%" style="stop-color:#d97706"/></linearGradient>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Client Layer -->
  <rect x="20" y="20" width="760" height="60" rx="8" fill="url(#gradClient)" stroke="#e2e8f0" stroke-width="1"/>
  <text x="400" y="50" text-anchor="middle" fill="white" font-size="16" font-weight="bold">Browser (React SPA)</text>

  <!-- Backend Layer -->
  <rect x="20" y="100" width="760" height="80" rx="8" fill="url(#gradBackend)" stroke="#e2e8f0" stroke-width="1"/>
  <text x="400" y="130" text-anchor="middle" fill="white" font-size="14" font-weight="bold">Express.js Server :3001</text>
  <text x="400" y="150" text-anchor="middle" fill="white" font-size="11">SQLite (WAL) • REST API • WebSocket</text>

  <!-- Monitoring Layer -->
  <rect x="20" y="190" width="760" height="60" rx="8" fill="url(#gradMon)" stroke="#e2e8f0" stroke-width="1"/>
  <text x="400" y="220" text-anchor="middle" fill="white" font-size="14" font-weight="bold">Monitoring Engine (3s Poll)</text>

  <!-- External Tools Layer -->
  <rect x="20" y="260" width="760" height="100" rx="8" fill="url(#gradExt)" stroke="#e2e8f0" stroke-width="1"/>
  <text x="400" y="285" text-anchor="middle" fill="white" font-size="14" font-weight="bold">External Tools</text>
  <text x="140" y="310" text-anchor="middle" fill="white" font-size="11">FFmpeg • FFprobe</text>
  <text x="280" y="310" text-anchor="middle" fill="white" font-size="11">yt-dlp</text>
  <text x="420" y="310" text-anchor="middle" fill="white" font-size="11">gallery-dl</text>
  <text x="560" y="310" text-anchor="middle" fill="white" font-size="11">aria2c • ADB</text>
  <text x="700" y="310" text-anchor="middle" fill="white" font-size="11">nvidia-smi • smartctl</text>

  <!-- Connections -->
  <line x1="400" y1="80" x2="400" y2="100" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="400" y1="180" x2="400" y2="190" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="400" y1="260" x2="400" y2="250" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>
</svg>

### 11.2 Codebase Statistics

<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <circle cx="200" cy="100" r="80" fill="#3b82f6" stroke="#1e40af" stroke-width="2"/>
  <text x="200" y="95" text-anchor="middle" fill="white" font-size="28" font-weight="bold">22K</text>
  <text x="200" y="115" text-anchor="middle" fill="white" font-size="12">lines of code</text>

  <!-- Legend -->
  <rect x="50" y="160" width="20" height="12" fill="#3b82f6"/>
  <text x="60" y="170" fill="#1e293b" font-size="11">Frontend (~18K)</text>
  <rect x="180" y="160" width="20" height="12" fill="#10b981"/>
  <text x="190" y="170" fill="#1e293b" font-size="11">Backend (~3.3K)</text>
  <rect x="290" y="160" width="20" height="12" fill="#8b5cf6"/>
  <text x="300" y="170" fill="#1e293b" font-size="11">WhatsApp Bot (~900)</text>
</svg>

### 11.3 Download Flow

<svg viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow2" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Start -->
  <rect x="20" y="120" width="80" height="40" rx="6" fill="#3b82f6" stroke="#1e40af"/>
  <text x="60" y="145" text-anchor="middle" fill="white" font-size="12">Start</text>

  <!-- Source Selection -->
  <rect x="120" y="20" width="100" height="60" rx="6" fill="#10b981" stroke="#059669"/>
  <text x="170" y="50" text-anchor="middle" fill="white" font-size="12">YouTube / TikTok / IG / Twitter / Torrent</text>

  <!-- Tools -->
  <rect x="260" y="20" width="140" height="140" rx="6" fill="#8b5cf6" stroke="#6d28d9"/>
  <text x="330" y="40" text-anchor="middle" fill="white" font-size="12">yt-dlp / gallery-dl / aria2c</text>
  <text x="330" y="90" text-anchor="middle" fill="#e0e7ff" font-size="11">Download &amp; Extract</text>

  <!-- Instagram Process -->
  <rect x="440" y="20" width="120" height="70" rx="6" fill="#f59e0b" stroke="#d97706"/>
  <text x="500" y="40" text-anchor="middle" fill="white" font-size="11">Instagram?</text>
  <text x="500" y="55" text-anchor="middle" fill="white" font-size="11">VP9/AV1 →</text>
  <text x="500" y="70" text-anchor="middle" fill="white" font-size="11">H.264/AAC Transcode</text>

  <!-- Output -->
  <rect x="440" y="110" width="120" height="50" rx="6" fill="#06b6d4" stroke="#0891b2"/>
  <text x="500" y="135" text-anchor="middle" fill="white" font-size="12">Output File</text>

  <!-- DB Update -->
  <rect x="590" y="50" width="100" height="40" rx="6" fill="#14b8a6" stroke="#0d9488"/>
  <text x="640" y="75" text-anchor="middle" fill="white" font-size="12">Update DB</text>

  <!-- End -->
  <rect x="720" y="50" width="60" height="40" rx="6" fill="#6b7280" stroke="#4b5563"/>
  <text x="750" y="75" text-anchor="middle" fill="white" font-size="12">Done</text>

  <!-- Arrows -->
  <line x1="60" y1="140" x2="170" y2="50" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="170" y1="50" x2="330" y2="50" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="330" y1="50" x2="500" y2="50" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="500" y1="50" x2="500" y2="110" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="500" y1="90" x2="500" y2="110" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="560" y1="90" x2="640" y2="70" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
  <line x1="640" y1="70" x2="750" y2="70" stroke="#64748b" stroke-width="2" marker-end="url(#arrow2)"/>
</svg>

### 11.4 Playback Decision Flow

<svg viewBox="0 0 700 350" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow3" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Start -->
  <rect x="280" y="20" width="140" height="40" rx="6" fill="#3b82f6" stroke="#1e40af"/>
  <text x="350" y="45" text-anchor="middle" fill="white" font-size="12">Stream Request</text>

  <!-- Probe -->
  <rect x="280" y="80" width="140" height="40" rx="6" fill="#8b5cf6" stroke="#6d28d9"/>
  <text x="350" y="105" text-anchor="middle" fill="white" font-size="12">FFprobe Codec Check</text>

  <!-- Decision -->
  <polygon points="350,160 200,220 280,220 280,280 350,280 420,280 420,220 350,220" fill="#fbbf24" stroke="#d97706"/>
  <text x="350" y="210" text-anchor="middle" fill="#1e293b" font-size="11">Compatible?</text>
  <text x="240" y="250" text-anchor="middle" fill="#1e293b" font-size="10">H.264/HEVC +</text>
  <text x="240" y="265" text-anchor="middle" fill="#1e293b" font-size="10">No Opus</text>
  <text x="350" y="250" text-anchor="middle" fill="#1e293b" font-size="10">Opus Audio</text>
  <text x="460" y="250" text-anchor="middle" fill="#1e293b" font-size="10">Other Codecs</text>

  <!-- Direct -->
  <rect x="180" y="300" width="100" height="40" rx="6" fill="#10b981" stroke="#059669"/>
  <text x="230" y="325" text-anchor="middle" fill="white" font-size="12">Direct Stream</text>

  <!-- Remux -->
  <rect x="320" y="300" width="100" height="40" rx="6" fill="#f59e0b" stroke="#d97706"/>
  <text x="370" y="325" text-anchor="middle" fill="white" font-size="12">Remux to MKV</text>

  <!-- Transcode -->
  <rect x="460" y="300" width="120" height="40" rx="6" fill="#ef4444" stroke="#dc2626"/>
  <text x="520" y="325" text-anchor="middle" fill="white" font-size="12">Transcode H.264/AAC</text>

  <!-- Arrows -->
  <line x1="350" y1="60" x2="350" y2="80" stroke="#64748b" stroke-width="2" marker-end="url(#arrow3)"/>
  <line x1="350" y1="120" x2="230" y2="220" stroke="#64748b" stroke-width="2" marker-end="url(#arrow3)"/>
  <line x1="350" y1="120" x2="370" y2="220" stroke="#64748b" stroke-width="2" marker-end="url(#arrow3)"/>
  <line x1="350" y1="120" x2="520" y2="220" stroke="#64748b" stroke-width="2" marker-end="url(#arrow3)"/>
</svg>

### 11.5 ADB Transfer State Machine

<svg viewBox="0 0 800 180" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow4" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- States -->
  <g font-size="10" font-weight="bold">
    <rect x="20" y="60" width="70" height="25" rx="4" fill="#e0f2fe" stroke="#0284c7"/>
    <text x="55" y="77" text-anchor="middle" fill="#0c4a6e">PENDING</text>

    <rect x="110" y="60" width="90" height="25" rx="4" fill="#fef3c7" stroke="#f59e0b"/>
    <text x="155" y="77" text-anchor="middle" fill="#78350f">CONFLICT_CHECK</text>

    <rect x="220" y="60" width="90" height="25" rx="4" fill="#fed7aa" stroke="#ea580c"/>
    <text x="265" y="77" text-anchor="middle" fill="#78350f">CONFLICT</text>

    <rect x="330" y="60" width="100" height="25" rx="4" fill="#dcfce7" stroke="#16a34a"/>
    <text x="380" y="77" text-anchor="middle" fill="#14532d">TRANSFERRING</text>

    <rect x="450" y="60" width="90" height="25" rx="4" fill="#bae6fd" stroke="#0284c7"/>
    <text x="495" y="77" text-anchor="middle" fill="#0c4a6e">VERIFYING</text>

    <rect x="560" y="60" width="90" height="25" rx="4" fill="#f3e8ff" stroke="#8b5cf6"/>
    <text x="605" y="77" text-anchor="middle" fill="#581440">METADATA</text>

    <rect x="670" y="60" width="80" height="25" rx="4" fill="#dcfce7" stroke="#16a34a"/>
    <text x="710" y="77" text-anchor="middle" fill="#14532d">COMMITTED</text>
  </g>

  <!-- Failed state -->
  <rect x="330" y="110" width="60" height="25" rx="4" fill="#fee2e2" stroke="#dc2626"/>
  <text x="360" y="127" text-anchor="middle" fill="#7f1d1d" font-size="10" font-weight="bold">FAILED</text>

  <!-- Cancelled -->
  <rect x="20" y="110" width="80" height="25" rx="4" fill="#e2e8f0" stroke="#64748b"/>
  <text x="60" y="127" text-anchor="middle" fill="#1e293b" font-size="10" font-weight="bold">CANCELLED</text>

  <!-- Arrows -->
  <line x1="95" y1="72" x2="110" y2="72" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="320" y1="50" x2="265" y2="50" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="265" y1="90" x2="265" y2="72" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="400" y1="72" x2="380" y2="72" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="495" y1="72" x2="560" y2="72" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="605" y1="72" x2="670" y2="72" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>

  <!-- To failed -->
  <line x1="380" y1="90" x2="360" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
  <line x1="445" y1="90" x2="445" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>

  <!-- To cancelled -->
  <line x1="55" y1="90" x2="55" y2="110" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow4)"/>
</svg>

### 11.6 Main Features Architecture

<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow5" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Media Vault -->
  <rect x="30" y="20" width="180" height="60" rx="8" fill="#3b82f6" stroke="#1e40af"/>
  <text x="120" y="40" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Media Vault</text>
  <text x="120" y="58" text-anchor="middle" fill="#bfdbfe" font-size="10">Browse &amp; Stream</text>
  <text x="120" y="70" text-anchor="middle" fill="#bfdbfe" font-size="10">hls.js • FFmpeg • SQLite FTS</text>

  <!-- Music Player -->
  <rect x="250" y="20" width="180" height="60" rx="8" fill="#8b5cf6" stroke="#6d28d9"/>
  <text x="340" y="40" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Music Player</text>
  <text x="340" y="58" text-anchor="middle" fill="#ddd6fe" font-size="10">Waveform + LRC Sync</text>
  <text x="340" y="70" text-anchor="middle" fill="#ddd6fe" font-size="10">hls.js • waveform</text>

  <!-- Monitoring -->
  <rect x="470" y="20" width="180" height="60" rx="8" fill="#f59e0b" stroke="#d97706"/>
  <text x="560" y="40" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Monitoring</text>
  <text x="560" y="58" text-anchor="middle" fill="#fef3c7" font-size="10">System Stats</text>
  <text x="560" y="70" text-anchor="middle" fill="#fef3c7" font-size="10">WebSocket • recharts</text>

  <!-- Downloader -->
  <rect x="30" y="100" width="180" height="60" rx="8" fill="#10b981" stroke="#059669"/>
  <text x="120" y="120" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Downloader</text>
  <text x="120" y="138" text-anchor="middle" fill="#d1fae5" font-size="10">YT/TikTok/IG/Twitter</text>
  <text x="120" y="150" text-anchor="middle" fill="#d1fae5" font-size="10">yt-dlp • gallery-dl • aria2c</text>

  <!-- ADB Transfer -->
  <rect x="250" y="100" width="180" height="60" rx="8" fill="#06b6d4" stroke="#0891b2"/>
  <text x="340" y="120" text-anchor="middle" fill="white" font-size="12" font-weight="bold">ADB Transfer</text>
  <text x="340" y="138" text-anchor="middle" fill="#cffafe" font-size="10">Android ↔ Laptop</text>
  <text x="340" y="150" text-anchor="middle" fill="#cffafe" font-size="10">ADB • Concurrent Workers</text>

  <!-- Send Queue -->
  <rect x="470" y="100" width="180" height="60" rx="8" fill="#ec4899" stroke="#db2777"/>
  <text x="560" y="120" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Send Queue</text>
  <text x="560" y="138" text-anchor="middle" fill="#fce7f3" font-size="10">Telegram &amp; WA</text>
  <text x="560" y="150" text-anchor="middle" fill="#fce7f3" font-size="10">SSE • Tick-based</text>

  <!-- Git Integration -->
  <rect x="30" y="180" width="180" height="50" rx="8" fill="#6b7280" stroke="#4b5563"/>
  <text x="120" y="200" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Git Integration</text>
  <text x="120" y="215" text-anchor="middle" fill="#e2e8f0" font-size="10">Web Git Operations</text>

  <!-- Scrcpy Monitor -->
  <rect x="250" y="180" width="180" height="50" rx="8" fill="#6b7280" stroke="#4b5563"/>
  <text x="340" y="200" text-anchor="middle" fill="white" font-size="12" font-weight="bold">Scrcpy Monitor</text>
  <text x="340" y="215" text-anchor="middle" fill="#e2e8f0" font-size="10">Remote Screen View</text>

  <!-- Shared Database -->
  <rect x="680" y="60" width="100" height="60" rx="8" fill="#1e293b" stroke="#0f172a"/>
  <text x="730" y="85" text-anchor="middle" fill="#cbd5e1" font-size="11" font-weight="bold">SQLite</text>
  <text x="730" y="100" text-anchor="middle" fill="#94a3b8" font-size="10">media.db</text>

  <!-- Connections to DB -->
  <line x1="210" y1="50" x2="680" y2="80" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#arrow5)"/>
  <line x1="430" y1="50" x2="680" y2="80" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#arrow5)"/>
  <line x1="650" y1="50" x2="730" y2="80" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5,3"/>

  <!-- Downloads to Media Vault -->
  <line x1="120" y1="160" x2="120" y2="80" stroke="#64748b" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#arrow5)"/>
</svg>

### 11.7 Monitoring Real-time Flow

<svg viewBox="0 0 700 250" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow6" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Engine -->
  <rect x="20" y="50" width="80" height="40" rx="6" fill="#f59e0b" stroke="#d97706"/>
  <text x="60" y="75" text-anchor="middle" fill="white" font-size="11">Engine</text>
  <text x="60" y="87" text-anchor="middle" fill="#fef3c7" font-size="9">(3s poll)</text>

  <!-- Collectors -->
  <g font-size="9">
    <rect x="120" y="20" width="70" height="25" rx="4" fill="#3b82f6" stroke="#1e40af"/>
    <text x="155" y="37" text-anchor="middle" fill="white">CPU</text>

    <rect x="200" y="20" width="70" height="25" rx="4" fill="#10b981" stroke="#059669"/>
    <text x="235" y="37" text-anchor="middle" fill="white">Memory</text>

    <rect x="280" y="20" width="70" height="25" rx="4" fill="#8b5cf6" stroke="#6d28d9"/>
    <text x="315" y="37" text-anchor="middle" fill="white">GPU</text>

    <rect x="360" y="20" width="70" height="25" rx="4" fill="#f59e0b" stroke="#d97706"/>
    <text x="395" y="37" text-anchor="middle" fill="white">Disk</text>

    <rect x="440" y="20" width="70" height="25" rx="4" fill="#06b6d4" stroke="#0891b2"/>
    <text x="475" y="37" text-anchor="middle" fill="white">Network</text>

    <rect x="520" y="20" width="70" height="25" rx="4" fill="#ec4899" stroke="#db2777"/>
    <text x="555" y="37" text-anchor="middle" fill="white">System</text>
  </g>

  <!-- WebSocket -->
  <rect x="120" y="100" width="90" height="30" rx="6" fill="#10b981" stroke="#059669"/>
  <text x="165" y="120" text-anchor="middle" fill="white" font-size="11">WebSocket</text>

  <!-- History DB -->
  <rect x="250" y="100" width="90" height="30" rx="6" fill="#6366f1" stroke="#4f46e5"/>
  <text x="295" y="120" text-anchor="middle" fill="white" font-size="11">History DB</text>
  <text x="295" y="113" text-anchor="middle" fill="#e0e7ff" font-size="8">(30s snap)</text>

  <!-- Frontend -->
  <rect x="380" y="100" width="90" height="30" rx="6" fill="#06b6d4" stroke="#0891b2"/>
  <text x="425" y="120" text-anchor="middle" fill="white" font-size="11">Frontend</text>
  <text x="425" y="113" text-anchor="middle" fill="#cffafe" font-size="8">(recharts)</text>

  <!-- Arrows from engine -->
  <line x1="60" y1="50" x2="155" y2="20" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
  <line x1="60" y1="50" x2="235" y2="20" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
  <line x1="60" y1="70" x2="315" y2="20" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>

  <!-- Collector to WS/History -->
  <line x1="155" y1="45" x2="165" y2="100" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
  <line x1="235" y1="45" x2="295" y2="100" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
  <line x1="315" y1="45" x2="425" y2="100" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>

  <!-- WS to Frontend -->
  <line x1="210" y1="115" x2="380" y2="115" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
  <line x1="340" y1="115" x2="425" y2="115" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow6)"/>
</svg>

### 11.8 Project Structure Layers

<svg viewBox="0 0 800 300" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
  <defs>
    <marker id="arrow7" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Legend -->
  <rect x="20" y="20" width="120" height="25" rx="4" fill="#3b82f6" stroke="#1e40af"/>
  <text x="80" y="37" text-anchor="middle" fill="white" font-size="10">Frontend</text>

  <rect x="160" y="20" width="120" height="25" rx="4" fill="#10b981" stroke="#059669"/>
  <text x="220" y="37" text-anchor="middle" fill="white" font-size="10">Backend</text>

  <rect x="300" y="20" width="130" height="25" rx="4" fill="#8b5cf6" stroke="#6d28d9"/>
  <text x="365" y="37" text-anchor="middle" fill="white" font-size="10">WhatsApp Bot</text>

  <rect x="450" y="20" width="120" height="25" rx="4" fill="#f59e0b" stroke="#d97706"/>
  <text x="510" y="37" text-anchor="middle" fill="white" font-size="10">Monitor</text>

  <!-- Frontend Layer -->
  <rect x="20" y="60" width="160" height="220" rx="8" fill="#eff6ff" stroke="#bfdbfe"/>
  <text x="100" y="80" text-anchor="middle" fill="#1e40af" font-size="11" font-weight="bold">frontend/src/</text>
  <text x="30" y="100" fill="#1e293b" font-size="9">• components/ (54 files)</text>
  <text x="30" y="115" fill="#1e293b" font-size="9">• store/ (5 zustand)</text>
  <text x="30" y="130" fill="#1e293b" font-size="9">• hooks/ (7 hooks)</text>
  <text x="30" y="145" fill="#1e293b" font-size="9">• monitoring/ (28 files)</text>
  <text x="30" y="160" fill="#1e293b" font-size="9">• utils/ (11 files)</text>

  <!-- Backend Layer -->
  <rect x="220" y="60" width="160" height="220" rx="8" fill="#ecfdf5" stroke="#bbf7d0"/>
  <text x="300" y="80" text-anchor="middle" fill="#14532d" font-size="11" font-weight="bold">backend/src/</text>
  <text x="240" y="100" fill="#1e293b" font-size="9">• server.js (entry)</text>
  <text x="240" y="115" fill="#1e293b" font-size="9">• db.js (SQLite)</text>
  <text x="240" y="130" fill="#1e293b" font-size="9">• routes/ (18 modules)</text>
  <text x="240" y="145" fill="#1e293b" font-size="9">• utils/ (41 files)</text>
  <text x="240" y="160" fill="#1e293b" font-size="9">• monitor/ (engine + collectors)</text>
  <text x="240" y="175" fill="#1e293b" font-size="9">• downloader/manager.js</text>
  <text x="240" y="190" fill="#1e293b" font-size="9">• adb/*.js (worker pool)</text>

  <!-- WhatsApp Bot Layer -->
  <rect x="420" y="60" width="120" height="160" rx="8" fill="#f5f3ff" stroke="#ddd6fe"/>
  <text x="480" y="80" text-anchor="middle" fill="#581440" font-size="11" font-weight="bold">whatsapp-bot/</text>
  <text x="440" y="100" fill="#1e293b" font-size="9">• index.js (entry)</text>
  <text x="440" y="115" fill="#1e293b" font-size="9">• connection.js</text>
  <text x="440" y="130" fill="#1e293b" font-size="9">• listener.js</text>
  <text x="440" y="145" fill="#1e293b" font-size="9">• sender.js</text>
  <text x="440" y="160" fill="#1e293b" font-size="9">• db.js</text>
  <text x="440" y="175" fill="#1e293b" font-size="9">• utils.js</text>

  <!-- Data Layer -->
  <rect x="580" y="60" width="180" height="80" rx="8" fill="#fffbeb" stroke="#fef3c7"/>
  <text x="670" y="80" text-anchor="middle" fill="#78350f" font-size="11" font-weight="bold">Data Directories</text>
  <text x="600" y="100" fill="#1e293b" font-size="9">• data/ (media.db, tasks)</text>
  <text x="600" y="115" fill="#1e293b" font-size="9">• cache/ (HLS, remux, transcode)</text>
  <text x="600" y="130" fill="#1e293b" font-size="9">• credentials/ (.env, sessions)</text>
  <text x="600" y="145" fill="#1e293b" font-size="9">• logs/ (rotating logs)</text>

  <!-- Connections -->
  <line x1="100" y1="280" x2="100" y2="320" stroke="#64748b" stroke-width="1.5"/>
  <line x1="300" y1="280" x2="300" y2="320" stroke="#64748b" stroke-width="1.5"/>
  <line x1="480" y1="280" x2="480" y2="320" stroke="#64748b" stroke-width="1.5"/>
  <line x1="670" y1="280" x2="670" y2="320" stroke="#64748b" stroke-width="1.5"/>

  <line x1="100" y1="330" x2="670" y2="330" stroke="#64748b" stroke-width="2"/>
  <rect x="320" y="340" width="120" height="25" rx="4" fill="#1e293b" stroke="#0f172a"/>
  <text x="380" y="357" text-anchor="middle" fill="#cbd5e1" font-size="11">SQLite (WAL Mode)</text>
</svg>

---

## 12. Contributing

- See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- Use `npm run dev` in each directory
- Report issues on GitHub