# Media Vault

> **English** · [Bahasa Indonesia](READMEID.md)

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
| **Messaging - Telegram** | node-telegram-bot-api | ^1.1.0 | Telegram bot |
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
| API Endpoints | [6](#6-api-endpoints) |
| Installation | [7](#7-installation) |
| Development | [8](#8-development) |

---

## 1. Overview

Media Vault is a self-hosted media server for browsing, streaming, downloading, and managing personal media libraries. It combines media playback, library management, and system monitoring into a single web interface.

---

## 2. Main Features

| Feature | Description |
|---------|-------------|
| Media Browser | Browse, stream, and download media via web interface |
| Library Management | Auto-scan, incremental full-text search, thumbnail generation |
| Playlists | XSPF import, full CRUD, drag-reorder, audio queue, folder-based |
| Metadata Editing | Audio tag read/write, MusicBrainz covers, LRCLIB lyrics, synced LRC |
| Playback | HTML5 video (direct/remux/transcode/HLS), HTML5 audio with waveform & lyrics |
| Monitoring | Real-time CPU/RAM/GPU/Disk/Network via WebSocket + SSE |
| Downloader | YouTube, TikTok, Instagram, Twitter/X, torrent |
| ADB Transfer | Push/pull files to Android with concurrent workers |
| WhatsApp Bridge | Integrated bot with keyword/hashtag triggers |
| Telegram Send | Optional — active when `TELEGRAM_BOT_TOKEN` is configured |

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
| mpd2 | ^1.0.7 | MPD control |
| node-pty | ^1.1.0 | PTY shell |
| node-telegram-bot-api | ^1.1.0 | Telegram bot |
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

| Directory | Description |
|-----------|-------------|
| `backend/` | Express API, SQLite, media processing |
| `frontend/` | React 18 SPA (Vite) |
| `whatsapp-bot/` | WhatsApp integration |
| `data/` | `media.db`, download tasks, thumbnails |
| `cache/` | HLS, remux, transcode cache |
| `logs/` | Rotating logs |
| `credentials/` | `.env`, auth files (gitignored) |

### Optional Components

| Directory | Description |
|-----------|-------------|
| `Docker/` | `docker-compose.yml`, configs (optional deployment) |

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
| `backend/src/` | 83 | ~3,300 |
| `frontend/src/` | 141 | ~18,000 |
| `whatsapp-bot/src/` | 6 | ~900 |
| **Total** | **228** | **~22,000** |

> Note: Lines of code approximate. Does not include `node_modules` or gitignored directories (`cache/`, `logs/`, `data/`).

---

## Contributing

- See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details
- Use `npm run dev` in each directory
- Report issues on GitHub