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
| **State** | Zustand | ^5.0.13 | State management (5 stores) |
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
| **MPD Control** | mpd2 | ^1.0.7 | Strawberry/MPD player control |

---

| Information | Detail |
|-------------|--------|
| **Version** | backend v1.0.0 · frontend v1.0.0 · whatsapp-bot v1.0.0 |
| **Documentation** | See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical reference |

---

## Table of Contents

| Section | Link |
|---------|------|
| Tech Stack Overview | [§1](#tech-stack-overview) |
| Overview | [§2](#2-overview) |
| Main Features | [§3](#3-main-features) |
| Tech Stack Details | [§4](#4-tech-stack-details) |
| External Tools | [§5](#5-external-tools) |
| Media & Playback Features | [§6](#6-media--playback-features) |
| Library Management Features | [§7](#7-library-management-features) |
| Monitoring & System Features | [§8](#8-monitoring--system-features) |
| Integration Features | [§9](#9-integration-features) |
| Project Structure | [§10](#10-project-structure) |
| API Endpoints | [§11](#11-api-endpoints-summary) |
| Environment Variables | [§12](#12-environment-variables) |
| Installation | [§13](#13-installation--quick-start) |
| Development Usage | [§14](#14-development-usage) |
| Documentation | [§15](#15-additional-documentation) |
| Notes | [§16](#16-important-notes) |

---

## 2. Overview

Media Vault is a self-hosted media server for browsing, streaming, downloading, and managing personal media libraries. It combines media playback, library management, and system monitoring into a single web interface.

> **Target Users:** Homelab, personal use as a Plex alternative, media browser, or central hub for managing video, audio, and image collections.

---

## 3. Main Features

| No | Feature | Status | Description |
|----|---------|--------|-------------|
| 1 | Media Browser | Active | Browse, stream, and download media via web interface |
| 2 | Library Management | Active | Auto-scan, incremental full-text search, thumbnail generation |
| 3 | Playlists | Active | XSPF import, CRUD, drag-reorder, audio queue, folder-based |
| 4 | Metadata Editing | Active | Audio tag read/write, MusicBrainz covers, LRCLIB lyrics, synced LRC |
| 5 | Playback | Active | HTML5 video (direct/remux/transcode/HLS), HTML5 audio with waveform & lyrics |
| 6 | Monitoring | Active | Real-time CPU/RAM/GPU/Disk/Network via WebSocket + SSE fallback |
| 7 | Downloader | Active | yt-dlp/gallery-dl/aria2c — YouTube, TikTok, Instagram, Twitter, torrent |
| 8 | ADB Transfer | Active | Push/pull files to Android with concurrent workers |
| 9 | WhatsApp Bridge | Active | Integrated bot with keyword/hashtag triggers |
| 10 | Telegram Send | Optional | Active when `TELEGRAM_BOT_TOKEN` is configured |
| 11 | MPD / Strawberry | Active | Control external MPD player (play, pause, queue, volume) |

---

## 4. Tech Stack Details

### 4.1 Backend (Node.js)

| Package | Version | Description |
|---------|---------|-------------|
| better-sqlite3 | ^12.9.0 | SQLite driver synchronous with WAL mode |
| busboy | ^1.6.0 | Multipart upload parsing |
| compression | ^1.8.1 | HTTP response gzip/deflate |
| cors | ^2.8.5 | CORS middleware |
| dockerode | ^5.0.0 | Docker container monitoring |
| express | ^4.21.0 | HTTP framework |
| fast-xml-parser | ^5.8.0 | XSPF playlist parsing |
| mime-types | ^2.1.35 | Content-type resolution |
| mpd2 | ^1.0.7 | Strawberry/MPD player control |
| node-pty | ^1.1.0 | Pseudo-terminal for scrcpy/shell |
| node-telegram-bot-api | ^1.1.0 | Telegram bot client |
| qrcode | ^1.5.4 | QR code generation (pairing/share) |
| uuid | ^10.0.0 | Job/transaction ID generator |
| ws | ^8.21.0 | WebSocket server for monitoring |

### 4.2 Frontend (React)

| Package | Version | Description |
|---------|---------|-------------|
| framer-motion | ^12.40.0 | UI animation primitives |
| hls.js | ^1.5.17 | Adaptive HLS video playback |
| lucide-react | ^1.16.0 | Icon set |
| qrcode | ^1.5.4 | QR code for share/pairing |
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | DOM renderer |
| react-intersection-observer | ^9.16.0 | Lazy reveal/scroll detection |
| react-router-dom | ^7.15.1 | Monitoring dashboard sub-routing |
| react-virtualized-auto-sizer | ^1.0.26 | Virtual list sizing |
| react-window | ^1.8.11 | Virtualized media grid |
| recharts | ^3.8.1 | Monitoring charts/gauges |
| source-map-js | ^1.2.1 | Source map handling (debug) |
| tailwindcss-animate | ^1.0.7 | TailwindCSS animation utilities |
| zustand | ^5.0.13 | State management (5 stores) |

### 4.3 WhatsApp Bot

| Package | Version | Description |
|---------|---------|-------------|
| better-sqlite3 | ^12.9.0 | SQLite state persistence |
| qrcode-terminal | ^0.12.0 | QR terminal output for pairing |
| whatsapp-web.js | ^1.34.7 | WhatsApp Web API client |

---

## 5. External Tools

| Binary | Usage | Output Path / Default |
|--------|-------|----------------------|
| `ffmpeg` | Thumbnail, HLS segment, remux, transcode | System-wide (`PATH`) |
| `ffprobe` | Codec probing, metadata extraction | System-wide (`PATH`) |
| `yt-dlp` | Download YouTube, Instagram | Media library auto-sort |
| `gallery-dl` | Download TikTok, Twitter/X, Instagram galleries | Media library auto-sort |
| `aria2c` | Torrent & parallel download | Media library auto-sort |
| `adb` | Android file transfer | USB/debug bridge |
| `nvidia-smi` | GPU metrics (cached 3s) | `/usr/bin/nvidia-smi` |
| `smartctl` | Disk SMART health (cached 60s) | `/usr/sbin/smartctl` |
| `python3` | Helper scripts: cover embed, romaji, lyrics | `/usr/bin/python3` |
| `systemctl` | Service management | Systemd |
| `journalctl` | Log entries | Systemd journal |

---

## 6. Media & Playback Features

| Feature | Detail |
|---------|--------|
| Video Streaming | Direct playback, remux, transcode, HLS with range request support |
| Audio Streaming | Waveform visualization, synced/plain lyrics, queue |
| Thumbnails | Auto-generated per file/folder; embedded cover art extraction |
| Search | Incremental full-text search (FTS5) across file names |
| Playlist | XSPF import, full CRUD, drag-reorder, folder-based playlists |
| Video Compatibility | Automatic browser compatibility detection → direct/remux/transcode |
| HLS Generation | 3 seconds per segment, fallback faststart remux |
| Audio Tags | Read/write metadata, embed cover art, lyrics sync |

---

## 7. Library Management Features

| Feature | Detail |
|---------|--------|
| Auto-Scan | Incremental via file mtime and size; optional content-hash dedup |
| Audio Metadata | Tag read/write, MusicBrainz cover art, LRCLIB lyrics |
| Upload | Multipart via Busboy, SHA256 integrity check, auto-scan & thumbnail |
| ADB Transfer | Push/pull to Android, concurrency-limited worker pool, checksum verify |
| File Scanner | `computeContentHash()` sampling first & last 64KB |
| Watcher | `fs.watch` recursive + 2s debounce + SSE broadcast |
| Thumbnail Queue | Concurrency-limited generation with LRU cache |

---

## 8. Monitoring & System Features

| Feature | Detail |
|---------|--------|
| Dashboard | CPU, RAM, GPU, disk, network, Docker containers, systemd services |
| Real-time Updates | WebSocket broadcast every 3 seconds + SSE fallback |
| Historical Metrics | Snapshot every 30 seconds, chart via Recharts |
| Alerts | Threshold-based CPU/RAM/disk/temp; 60s deduplication |
| System Control | Start/stop/restart services, power control, iperf3 benchmark |
| Container Management | Docker start/stop/restart via dockerode |
| Log Viewer | Journald-style log entries with filters |
| Web Stats | Request statistics & session tracking |

---

## 9. Integration Features

| Feature | Detail |
|---------|--------|
| WhatsApp Bridge | Embedded bot; trigger via quoted video + keyword/hashtag |
| Telegram Send | Optional; send media to groups via bot token |
| Downloader | yt-dlp (YouTube/Instagram), gallery-dl (TikTok/Twitter), aria2c (torrent) |
| MPD / Strawberry | Control external MPD player via protocol |
| Video Cache | YouTube video cache with auto-detect & download |

---

## 10. Project Structure

| Directory | Description | Key Files |
|-----------|-------------|-----------|
| `backend/` | Express API server, SQLite database, media processing | `server.js`, `db.js`, `routes/*` (19 modules) |
| `frontend/` | React SPA (Vite) — media browser, monitoring, player | `App.jsx`, `main.jsx`, `components/*` (54 files) |
| `whatsapp-bot/` | WhatsApp Web client — integrated by backend | `index.js`, `connection.js`, `listener.js` |
| `data/` | Persistent runtime data | `media.db`, `alerts.json`, thumbnails/ |
| `cache/` | Temporary cache | `hls/`, `playback/remux/`, `playback/transcode/` |
| `logs/` | Rotating logs per subsystem | `backend/`, `monitoring/`, `downloader/` |
| `credentials/` | Sensitive files (gitignored) | `.env`, `.wwebjs_auth/`, cookies |
| `Docker/` | Sidecar configurations | `docker-compose.yml`, `nginx-nvidia/` |
| `docs/` | Additional documentation | `archive/ideas/IDEAS.md` |

---

## 11. API Endpoints Summary

### 11.1 Files & Search

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/files` | Browse folder with pagination & sorting |
| GET | `/api/files/shuffle` | Random playable files |
| POST | `/api/files/refresh` | Incremental scan & orphan cleanup |
| GET | `/api/search` | FTS file search + LIKE folder search |
| PATCH | `/api/files/:id/favorite` | Toggle favorite flag |

### 11.2 Streaming

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/stream/video/:id` | Stream video (direct/remux/transcode) |
| GET | `/stream/audio/:id` | Stream audio with range support |
| GET | `/stream/video/:id/hls/playlist.m3u8` | HLS playlist |
| GET | `/stream/video/:id/hls/segment-N.ts` | HLS segment |

### 11.3 Monitoring

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/monitoring/stats` | Current system stats snapshot |
| GET | `/api/monitoring/overview` | Combined overview (web/docker/services) |
| POST | `/api/monitoring/services/:name/:action` | Start/stop/restart service |
| POST | `/api/monitoring/alerts/threshold` | Set alert threshold |

### 11.4 Downloader

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/download/stream` | SSE stream task list |
| POST | `/api/download/start` | Create download task |
| POST | `/api/download/bulk` | Create multiple tasks |

### 11.5 Playback Control

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/playback/stats` | Cache hit-rate & transcode counts |
| POST | `/api/playback/cleanup` | Evict old cache entries |

### 11.6 WhatsApp

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/whatsapp/status` | Connection status & counters |
| GET | `/api/whatsapp/qr` | Pairing QR payload |
| POST | `/api/whatsapp/start` | Connect bot |
| POST | `/api/whatsapp/stop` | Disconnect bot |

---

## 12. Environment Variables

| Variable | Default | Description | Required |
|----------|---------|-------------|----------|
| `PORT` | 3001 | Express server port | ❌ |
| `MEDIA_ROOT` | - | Path to media directory | ✅ |
| `TELEGRAM_BOT_TOKEN` | - | Telegram bot token | ❌ |
| `TELEGRAM_CHAT_ID` | - | Target chat ID for Telegram | ❌ |
| `TELEGRAM_ALLOWED_CHAT_IDS` | - | Allowed chat IDs | ❌ |
| `TARGET_CHAT_JID` | - | Target WhatsApp chat JID | ❌ |
| `ALLOWED_GROUPS` | - | Allowed WhatsApp groups | ❌ |
| `SEND_DAILY_CAP` | 0 | Daily send limit | ❌ |
| `TLS_KEY` | - | TLS private key (HTTPS) | ❌ |
| `TLS_CERT` | - | TLS certificate (HTTPS) | ❌ |
| `MONITOR_DISABLE_GPU` | - | Disable GPU monitoring | ❌ |
| `DISPLAY` | :0 | Display for scrcpy | ❌ |

---

## 13. Installation & Quick Start

| Step | Command | Description |
|------|---------|-------------|
| 1. Clone | `git clone <repo-url> && cd homelab-media-server` | Clone repository |
| 2. Backend | `cd backend && npm install && npm start` | Install & run backend |
| 3. Frontend | `cd frontend && npm install && npm run dev` | Install & run frontend (dev mode) |

> **Note:** Backend serves frontend statically, so only backend is needed in production.

### Environment Setup

| File | Description |
|------|-------------|
| `.env.example` | Environment variable template |
| `credentials/.env` | Actual environment file (copy from template) |

---

## 14. Development Usage

| Command | Description |
|---------|-------------|
| `npm run dev` (backend) | Auto-reload with `--watch` flag |
| `npm run dev` (frontend) | Vite dev server on all interfaces |
| `npm run debug` (backend) | Debug mode with `--inspect` |
| `npm run build` (frontend) | Production build |
| `npm run preview` (frontend) | Preview production build |

### Development URLs

| Platform | Mode | Port | URL |
|----------|------|------|-----|
| Frontend | Development | 5173 | `http://localhost:5173` |
| Backend | Development | 3001 | `http://localhost:3001` |

---

## 15. Additional Documentation

| File | Description |
|------|-------------|
| `README.md` | Project overview (this file) |
| `ARCHITECTURE.md` | Full technical reference — architecture, database, API, monitoring |
| `READMEID.md` | Indonesian version (to be created) |
| `.env.example` | Environment variable template |
| `docs/` | Notes & development ideas |

---

## 16. Important Notes

| Topic | Information |
|-------|-------------|
| Repository Type | Not a monorepo; no workspaces |
| Module Type | Backend & frontend ESM, root CommonJS |
| Database | SQLite WAL mode, 80MB cache, mmap 4GB |
| WebSocket | Same port as HTTP (3001) |
| FFmpeg Limit | Maximum 2 concurrent processes |
| ADB Workers | Default 3 concurrent workers |
| Upload Limit | Maximum 100GB, 4 concurrent |

---

## Contributing

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for full technical details
- Use `npm run dev` in each directory for development
- Report issues at GitHub repository

---

> **Document Version:** v1.0.0 — Created 2026-07-18