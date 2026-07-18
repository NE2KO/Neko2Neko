# Media Vault — Dokumentasi & Arsitektur

> **Versi dokumen:** Doc v3.0 — 2026-07-08
> **Versi paket basis kode:** backend `homelab-media-server` **v1.0.0**, frontend `homelab-media-frontend` **v1.0.0**, whatsapp-bot **v1.0.0**
> **Tumpukan:** Node.js (ESM) + Express + SQLite (better-sqlite3) · React 18 + Vite 5 + TailwindCSS 3 · FFmpeg + FFprobe · hls.js

> **Satu-satunya Sumber Kebenaran.** Dokumen ini adalah referensi berwibawa untuk sistem Media Vault. Dokumen ini diverifikasi terhadap basis kode yang sebenarnya pada **2026-07-08** (manifest paket, `server.js`, `db.js`, `monitor/*`, `routes/*`, `config/paths.js`, dan berkas penyebaran). Di mana sebuah fakta tidak dapat dikonfirmasi, ia ditandai sebagai **catatan** bukan ditegaskan. Versi logika aplikasi adalah versi paket di atas — **tidak ada** versi aplikasi "2.4.0"; string tersebut adalah artefak dokumentasi pada revisi sebelumnya.

---

## Daftar Isi

1. [Ikhtisar Proyek](#1-ikhtisar-proyek)
2. [Tumpukan Teknologi & Dependensi](#2-tumpukan-teknologi--dependensi)
3. [Arsitektur Sistem](#3-arsitektur-sistem)
4. [Struktur Proyek / Tata Letak Direktori](#4-struktur-proyek--tata-letak-direktori)
5. [Backend — Siklus Hidup Server](#5-backend--siklus-hidup-server)
6. [Backend — Basis Data](#6-backend--basis-data)
7. [Backend — Endpoint API](#7-backend--endpoint-api)
8. [Backend — Subsistem](#8-backend--subsistem)
9. [Arsitektur Frontend](#9-arsitektur-frontend)
10. [Diagram Alur](#10-diagram-alur)
11. [Konfigurasi & Jalur](#11-konfigurasi--jalur)
12. [Variabel Lingkungan](#12-variabel-lingkungan)
13. [Pekerjaan Latar Belakang / Penjadwal](#13-pekerjaan-latar-belakang--penjadwal)
14. [Kinerja, Memori, Disk, Konkurensi](#14-kinerja-memori-disk-konkurensi)
15. [Keamanan & Produksi](#15-keamanan--produksi)
16. [Penyebaran](#16-penyebaran)
17. [Penanganan Kesalahan & Mode Kegagalan](#17-penanganan-kesalahan--mode-kegagalan)
18. [Detail Dasbor Pemantauan](#18-detail-dasbor-pemantauan)
19. [Ekstensi Masa Depan / Peta Jalan](#19-ekstensi-masa-depan--peta-jalan)
20. [Catatan Pengembangan](#20-catatan-pengembangan)
21. [Perintah Debug / Operasi](#21-perintah-debug--operasi)
22. [Metrik Basis Kode](#22-metrik-basis-kode)
23. [Lampiran: Riwayat Versi](#23-lampiran-riwayat-versi)

---

## 1. Ikhtisar Proyek

**Media Vault** adalah server media yang dihosting sendiri (self-hosted) dengan kemampuan menyeluruh:

|  Kemampuan           |  Status                    |  Deskripsi                                                                                     |
|--------------------|--------------------------|----------------------------------------------------------------------------------------------|
|  Peramban media      |  Aktif                    |  Penjelajahan, streaming, unduhan berkas via antarmuka web                                     |
|  Manajemen pustaka   |  Aktif                    |  Pemindaian otomatis, pencarian FTS inkremental, pembuatan thumbnail                           |
|  Daftar putar        |  Aktif                    |  Impor XSPF, CRUD, susun ulang seret, antrean audio, berbasis folder                           |
|  Penyuntingan metadata |  Aktif                 |  Baca/tulis tag audio, cover art MusicBrainz, lirik LRCLIB, LRC tersinkron                      |
|  Pemutaran           |  Aktif                    |  Video HTML5 (range/HLS/transcode), audio HTML5 dengan waveform & lirik                        |
|  Pemantauan          |  Aktif                    |  CPU/RAM/GPU/Disk/Jaringan real-time via WebSocket + fallback SSE                               |
|  Pengunduh           |  Aktif                    |  yt-dlp/gallery-dl/aria2c — YouTube, TikTok, Instagram, Twitter, torrent                       |
|  Transfer ADB        |  Aktif                    |  Dorong/tarik berkas ke Android via ADB dengan pekerja konkuren                                |
|  Jembatan WhatsApp   |  **Terintegrasi / Aktif**  |  kode `whatsapp-bot/` dimuat oleh `server.js` via `initWhatsApp()` dan `routes/whatsapp.js`    |
|  Kirim Telegram      |  Opsional                 |  Aktif hanya saat `TELEGRAM_BOT_TOKEN` dikonfigurasi                                          |

> **Catatan:** Integrasi WhatsApp **disematkan (embedded)**, bukan proses terpisah yang berdiri sendiri. `server.js` memulainya 10 dtk setelah listen (hingga 5 percobaan ulang dengan backoff), dan `routes/whatsapp.js` (yang mengimpor dari `../../../whatsapp-bot/src/`) mengekspos endpoint REST `/api/whatsapp/*` plus aliran SSE log di `/api/whatsapp/logs/stream`. Paket `whatsapp-bot/` juga dapat berjalan mandiri (`npm start`), tetapi dalam penyebaran yang didokumentasikan ia dimuat oleh backend.

---

## 2. Tumpukan Teknologi & Dependensi

Repositori ini **bukan** sebuah monorepo: tidak ada workspace dan tidak ada skrip root. `backend/`, `frontend/`, dan `whatsapp-bot/` adalah tiga paket npm yang independen. Backend dan frontend adalah **ESM** (`"type": "module"`); `package.json` root adalah **CommonJS** (`"type": "commonjs"`) dan hanya membawa seperangkat dependensi bersama yang minimal.

### 2.1 Backend — `backend/package.json`

- name: `homelab-media-server` · version: `1.0.0` · type: `module` (ESM)
- Tidak ada field `engines` yang dideklarasikan (tidak ada versi Node yang dipatok).
- Tidak ada `devDependencies`.
- Skrip:
  - `start`: `node --env-file=../credentials/.env src/server.js`
  - `dev`: `node --env-file=../credentials/.env --expose-gc --watch src/server.js`
  - `debug`: `node --env-file=../credentials/.env --inspect --expose-gc src/server.js`

|  Dependensi             |  Versi    |  Peran                              |
|-----------------------|---------|-----------------------------------|
|  better-sqlite3         |  ^12.9.0  |  Driver SQLite sinkron (WAL)        |
|  busboy                 |  ^1.6.0   |  Pemrosesan unggahan multipart      |
|  compression            |  ^1.8.1   |  gzip/deflate respons HTTP          |
|  cors                   |  ^2.8.5   |  Middleware CORS                    |
|  dockerode              |  ^5.0.0   |  Pemantauan kontainer Docker        |
|  express                |  ^4.21.0  |  Framework HTTP                     |
|  fast-xml-parser        |  ^5.8.0   |  Pemrosesan daftar putar XSPF        |
|  mime-types             |  ^2.1.35  |  Resolusi tipe konten               |
|  node-pty               |  ^1.1.0   |  Pseudo-terminal untuk scrcpy/shell  |
|  node-telegram-bot-api  |  ^1.1.0   |  Klien bot Telegram                 |
|  qrcode                 |  ^1.5.4   |  Pembuatan QR (pairing / bagikan)   |
|  uuid                   |  ^10.0.0  |  ID pekerjaan / transaksi           |
|  ws                     |  ^8.21.0  |  Server WebSocket (`/ws/monitor`)   |

### 2.2 Frontend — `frontend/package.json`

- name: `homelab-media-frontend` · version: `1.0.0` · type: `module`

|  Dependensi                    |  Versi    |  Peran                                                                |
|------------------------------|---------|---------------------------------------------------------------------|
|  framer-motion                 |  ^12.40.0 |  Primitif animasi                                                     |
|  hls.js                        |  ^1.5.17  |  Pemutaran video HLS adaptif                                          |
|  lucide-react                  |  ^1.16.0  |  Set ikon                                                             |
|  qrcode                        |  ^1.5.4   |  Pembuatan QR (bagikan / pairing)                                     |
|  react                         |  ^18.3.1  |  Framework UI                                                         |
|  react-dom                     |  ^18.3.1  |  Renderer DOM                                                         |
|  react-intersection-observer   |  ^9.16.0  |  Scroll / reveal malas (lazy)                                         |
|  react-router-dom              |  ^7.15.1  |  Sub-routing dasbor pemantauan (`MemoryRouter`/`Routes`/`Route`)      |
|  react-virtualized-auto-sizer  |  ^1.0.26  |  Penentuan ukuran daftar virtual                                      |
|  react-window                  |  ^1.8.11  |  Grid media ter-virtualisasi                                          |
|  recharts                      |  ^3.8.1   |  Bagan/pengukur pemantauan                                            |
|  source-map-js                 |  ^1.2.1   |  Penanganan source map (debug)                                        |
|  zustand                       |  ^5.0.13  |  Manajemen state (6 store)                                            |

|  devDependency              |  Versi    |  Peran                    |
|---------------------------|---------|------------------------|
|  @vitejs/plugin-react       |  ^4.3.2   |  Plugin React untuk Vite |
|  autoprefixer               |  ^10.4.20 |  Prefiks vendor CSS      |
|  eslint-plugin-react-hooks  |  ^7.1.1   |  Aturan lint hook        |
|  postcss                    |  ^8.4.47  |  Pipeline CSS            |
|  tailwindcss                |  ^3.4.13  |  CSS utilitas            |
|  vite                       |  ^5.4.8   |  Dev server / bundler    |

- Skrip: `dev`: `vite --host 0.0.0.0` · `build`: `vite build` · `preview`: `vite preview --host 0.0.0.0`

### 2.3 Root — `package.json`

- type: `commonjs` · **tidak ada workspace, tidak ada skrip**.
- Dependensi telanjang: `music-metadata ^11.13.0`, `ws ^8.21.0` (helper bersama).

### 2.4 Bot WhatsApp — `whatsapp-bot/package.json`

- name: `whatsapp-bot` · version: `1.0.0` · type: `module`
- Skrip: `start`: `node --env-file=../credentials/.env src/index.js` · `dev`: `node --env-file=../credentials/.env --watch src/index.js`
- Dependensi: `whatsapp-web.js ^1.34.7`, `better-sqlite3 ^12.9.0`, `qrcode-terminal ^0.12.0`
- Tata letak sumber (`whatsapp-bot/src/`): `index.js`, `connection.js`, `listener.js`, `sender.js`, `db.js`, `utils.js`. (Menggunakan `whatsapp-web.js`, **bukan** baileys.)
- Catatan: `connection.js` membaca autentikasi WhatsApp dari `credentials/.wwebjs_auth/` via variabel env `WA_AUTH_DIR` atau jalur default.

---

## 3. Arsitektur Sistem

### 3.1 Diagram Komponen Tingkat Tinggi

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React SPA)                           │
│                   (served static via Express)                         │
└───────────────────────┬─────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────────────────────────────────┐
          │ HTTP           WS              SSE                        │
          ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend — Express :3001                            │
│                                                                     │
│  server.js → routes/* → utils/* → db.js (SQLite)                   │
│      │                                                                │
│      ├── fileScanner.js    Incremental scan, mtime comparison        │
│      ├── thumbnailQueue.js Concurrency-limited thumbnail generation  │
│      ├── watcher.js        fs.watch debounce → SSE broadcast         │
│      ├── playbackEngine.js Remux/transcode/HLS, LRU cache            │
│      ├── hlsGenerator.js   FFmpeg HLS segment pipeline               │
│      ├── downloader/manager.js yt-dlp/gallery-dl/aria2c             │
│      ├── monitor/engine.js Poll loop (3000ms), collect→aggregate→WS  │
│      └── monitor/collectors/* cpu, memory, gpu, disk, network, system│
└───────────────┬─────────────────────────────────────┬───────────────┘
                  │                                     │
                  ▼                                     ▼
      ┌──────────────────┐                ┌─────────────────────┐
      │  data/media.db    │                │  cache/             │
      │  (WAL, 80MB cache)│                │  playback/remux/    │
      │  FTS5 index       │                │  playback/transcode/│
      └──────────────────┘                │  hls/               │
                                          │  downloader/        │
                                          └─────────────────────┘
```

### 3.2 Dependensi Eksternal

|  Biner      |  Digunakan Oleh                                             |  Tujuan                                       |
|------------|-----------------------------------------------------------|----------------------------------------------|
|  ffmpeg      |  thumbnailUtils, stream.js, playbackEngine, hlsGenerator  |  Thumbnail, HLS, transcode, remux              |
|  ffprobe     |  fileScanner.js, metadataWriter.js, uploadManager.js      |  Probe codec, ekstraksi metadata              |
|  yt-dlp      |  downloader/manager.js                                    |  Unduh video/audio (YouTube, Instagram)       |
|  gallery-dl  |  downloader/manager.js                                    |  Galeri gambar TikTok, Twitter/X, Instagram   |
|  aria2c      |  downloader/manager.js                                    |  Torrent / unduhan paralel                    |
|  adb         |  adbManager.js, adbTransaction.js                         |  Transfer berkas Android                      |
|  nvidia-smi  |  monitor/collectors/gpu.js                                |  Metrik GPU (cache 3 dtk)                     |
|  smartctl    |  monitor/collectors/disk.js                               |  Kesehatan SMART (cache 60 dtk)               |
|  journalctl  |  monitor/logs.js                                          |  Journal systemd                             |
|  systemctl   |  monitor/services.js                                      |  Manajemen layanan                            |
|  python3     |  embed_cover.py, romaji_convert.py, pyjlyric_search.py    |  Skrip helper yang di-spawn oleh utilitas JS  |

> **Catatan:** Ketiga helper Python (`backend/src/utils/embed_cover.py`, `backend/src/utils/romaji_convert.py`, `backend/src/utils/pyjlyric_search.py`) **di-spawn** sebagai proses anak oleh utilitas JS, tidak pernah diimpor.

---

## 4. Struktur Proyek / Tata Letak Direktori

```
homelab-media-server/
├── backend/
│   ├── src/
│   │   ├── server.js           Entry point — Express, lifecycle, shutdown
│   │   ├── db.js               Schema, prepared statements, FTS, settings
│   │   ├── config/
│   │   │   └── paths.js        Path resolution, SETTINGS constants
│   │   ├── routes/             (18 modules — see §7)
│   │   │   ├── adb.js          ADB device list, transfer jobs
│   │   │   ├── downloader.js   Download task management (yt-dlp etc.)
│   │   │   ├── file.js         Raw file serve (cache headers, range)
│   │   │   ├── files.js        File listing, FTS search, cursor pagination
│   │   │   ├── jobs.js         Background job status
│   │   │   ├── metadata.js     Audio metadata, cover art, lyrics
│   │   │   ├── monitoring.js   Stats, history, alerts, processes
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
│   │   │   ├── send_counter.js       Send/queue counters
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
│   │   │       └── SystemWidget.jsx
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
├── credentials/                    Sensitive files
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
├── docs/                           Documentation
│   └── archive/
│       └── ideas/
│           └── IDEAS.md
│
├── .env.example                    Environment template
├── package.json                    Root package.json (CommonJS, shared deps)
└── package-lock.json
```

> **Catatan utils:** `backend/src/utils/` berisi **41 berkas**: 38 modul `.js` + 3 helper `.py` yang di-spawn (`embed_cover.py`, `romaji_convert.py`, `pyjlyric_search.py`). Berkas `.py` di-spawn sebagai proses anak, tidak diimpor; `registry.js` berada di `backend/src/services/`. Dua berkas `*.mjs` di root `backend/src/` (`fts-rebuild-worker.mjs`, `sensors-worker.mjs`) adalah worker anak yang di-fork.

---
## 5. Backend — Siklus Hidup Server

**Berkas:** `backend/src/server.js`

### 5.1 Urutan Middleware

`server.js` memasang, berurutan: `cors` → `compression({ threshold: 1024 })` → `express.json` → `sessionMiddleware` (`utils/sessionTracker.js`) → pelacak permintaan inline (`monitor/webStats.js`).

### 5.2 Urutan Startup

`PORT = process.env.PORT || 3001`, mengikat `0.0.0.0`. Pada `EADDRINUSE` port naik hingga 5 percobaan ulang (3002–3006).

|  Waktu   |  Tindakan                                                                                                                                 |
|--------|---------------------------------------------------------------------------------------------------------------------------------------|
|  t=0ms   |  `validateStartup()` — SQLite, direktori dapat-tulis (`cacheRoot`/`logsRoot`/`thumbnails`) sebagai **kritis**; `ffmpeg`/`ffprobe` sebagai **peringatan**  |
|  t=0ms   |  Middleware Express — cors, compression, json, session, webStats                                                                        |
|  t=0ms   |  Pasang **19** modul rute + frontend statis                                                                                             |
|  t=0ms   |  `createServer` → `listen(3001)` — hingga 5 percobaan ulang pada `EADDRINUSE`                                                          |
|  t=0ms   |  `registerAllServices()` — registri layanan                                                                                             |
|  t=0ms   |  `startWebSocketServer(server)` — WS pada port 3001                                                                                     |
|  t=0ms   |  `startEngine(server)` — engine pemantauan (**poll 3000ms**)                                                                            |
|  t=0ms   |  `startWatcher()` — `fs.watch` pada `MEDIA_ROOT`                                                                                        |
|  t=0ms   |  `startMaintenanceScheduler()` — interval pembersihan                                                                                   |
|  t=0.5s  |  `initHistoricalTable()` — skema deret waktu                                                                                            |
|  t=1s    |  `deferredDbInit()` — seeding 100+ setelan, migrasi, indeks                                                                             |
|  t=1.5s  |  `startMonitoringCache()` — pembacaan sensor latar belakang (forked)                                                                     |
|  t=2s    |  `setupFTS()` — rebuild FTS5 via worker forked                                                                                          |
|  t=5s    |  `scanPlaylists()` — menemukan berkas `.xspf`                                                                                           |
|  t=10s   |  `initWhatsApp()` — jembatan WhatsApp (hingga 5 percobaan ulang, backoff)                                                              |
|  t=20s   |  `runIncrementalScan()` — pemindaian awal (bersyarat; dilewati bila DB baru)                                                            |

### 5.3 Urutan Shutdown

Shutdown teratur pada `SIGINT`/`SIGTERM`/`SIGQUIT` via `handleShutdown`:

|  Langkah  |  Tindakan                                                   |
|------|---------------------------------------------------------|
|  1     |  Hentikan watcher (`stopWatcher()`)                       |
|  2     |  Hentikan penjadwal pemeliharaan                           |
|  3     |  Hentikan engine pemantauan (`stopEngine()`)              |
|  4     |  Hentikan server WebSocket                                |
|  5     |  Tolak pekerjaan pemutaran baru (`playback.requestShutdown()`)  |
|  6     |  Tiriskan pekerjaan aktif (`waitForDrain()`, timeout 30 dtk) |
|  7     |  Simpan cache LRU pemutaran                                |
|  8     |  `server.close()` — izinkan yang sedang berjalan selesai  |
|  9     |  Paksa keluar setelah 15 dtk bila belum keluar            |

### 5.4 Diagram Siklus Hidup Startup

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
└──────────────────────────────────────────────────────────────────┘
```

---

### 5.5 Kode Startup & Siklus Hidup (ringkasan)

> Source lengkap verbatim dihapus demi keterbacaan. Perilaku startup/siklus hidup utama (lihat `backend/src/server.js`):

- **Validasi prasyarat** — memeriksa konektivitas SQLite, direktori dapat-tulis `cache/`/`logs/`/`thumbnails` (kritis → `exit(1)`), dan `ffmpeg`/`ffprobe` di PATH (hanya peringatan).
- **Middleware + rute** — memasang `cors`, `compression`, `express.json`, pelacakan sesi, dan semua rute `/api/*` di balik guard per-layanan `requireService` (`mediaVault`, `downloader`, `adbTransfer`, `playlists`), lalu frontend statis dan rute WhatsApp.
- **Inisialisasi berat tertunda** — seeding DB, rebuild FTS, tabel historis, cache pemantauan, pemindaian daftar putar, dan pemindaian media awal (20 dtk setelah `listen()`) diberi jeda dengan `setTimeout` agar respons HTTP pertama tidak terblokir. Pemindaian awal dilewati bila DB baru (<24 j).
- **Shutdown teratur** — pada `SIGINT`/`SIGTERM`/`SIGQUIT`: hentikan watcher → pemeliharaan → pemantauan → WebSocket, tiriskan pekerjaan pemutaran aktif (`waitForDrain`), simpan cache LRU, lalu `server.close()` dengan paksa keluar setelah 15 dtk.

## 6. Backend — Basis Data

**Berkas:** `backend/src/db.js`

### 6.1 Konfigurasi PRAGMA

|  Pengaturan    |  Nilai      |  Tujuan                          |
|--------------|-----------|--------------------------------|
|  journal_mode  |  WAL        |  Baca konkuren saat tulis        |
|  cache_size    |  -80000     |  ~80MB page cache                |
|  mmap_size     |  4294967296 |  4GB I/O memory-mapped           |
|  page_size     |  32768      |  Halaman 32KB untuk I/O sekuensial |
|  synchronous   |  NORMAL     |  Seimbangkan keamanan/kinerja    |
|  temp_store    |  MEMORY     |  Data temp di memori             |

### 6.2 Tabel Inti

#### Blok PRAGMA (verbatim)

`db.js:14-20`. Penyetelan diterapkan sekali, secara sinkron, saat pemuatan modul.

```javascript
// backend/src/db.js:14
// Performance Pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -80000'); // ~80MB cache — sufficient for 112K files
db.pragma('mmap_size = 4294967296'); // 4GB — prevents kernel over-mapping
db.pragma('page_size = 32768'); // Larger page size for better sequential I/O
```

> **Apa kerjanya:** Menerapkan penyetelan SQLite PRAGMA sekali saat pemuatan modul: WAL (write-ahead log), `synchronous=NORMAL`, `temp_store=MEMORY`, `cache_size=-80000` (~80MB), `mmap_size=4GB`, `page_size=32768`.
> **Dampak:** WAL memungkinkan pembacaan konkuren saat penulisan; halaman 32KB + mmap besar mempercepat I/O sekuensial untuk ratusan ribu baris; `NORMAL` menyeimbangkan keamanan vs. kinerja.
> **Alternatif serupa:** `journal_mode=DELETE` (default) lebih aman tetapi mengunci seluruh DB saat penulisan; `synchronous=FULL` lebih aman tetapi lebih lambat. Trade-off: WAL+NORMAL cepat dengan risiko kehilangan transaksi terakhir saat crash.
> **Kalau tidak pakai ini:** Kueri pemindaian pada 100K+ berkas akan lambat dan penulisan akan memblokir pembacaan, menurunkan responsivitas API.

#### Pernyataan CREATE `files` dan `folders` (verbatim)

`db.js:23-55`. Folder dibuat lebih dulu (induk/anak via `parent_id`); berkas merujuk `dir_id` dan membawa kolom kompatibilitas codec/stream.

```javascript
// backend/src/db.js:23
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    parent_id INTEGER,
    depth INTEGER DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    last_scanned INTEGER,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    dir_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ext TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    duration REAL DEFAULT 0,
    has_thumb INTEGER DEFAULT 0,
    thumb_cache_path TEXT,
    last_accessed INTEGER DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    last_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    codec_info TEXT,
    is_stream_compatible INTEGER DEFAULT 0,
    youtube_id TEXT,
    video_offset REAL DEFAULT 0
  );
`);
```

> **Apa kerjanya:** Membuat tabel `folders` (induk/anak via `parent_id`, depth, pencacah) dan tabel `files` (metadata media + kolom `codec_info`, `is_stream_compatible`, `youtube_id`, `video_offset`) bila belum ada.
> **Dampak:** Skema deterministik ini mendasari semua fitur katalog, pencarian, dan keputusan streaming; kolom kompat-stream menyimpan hasil probe ffprobe.
> **Alternatif serupa:** Dapat menggunakan ORM (Prisma/Sequelize) atau migrasi terpisah; trade-off: `db.exec` mentah sederhana dan transparan, tanpa alat migrasi.
> **Kalau tidak pakai ini:** Tanpa skema ini tidak ada penyimpanan persisten untuk pustaka media, thumbnail, atau progres pemutaran.

#### Tabel `files`

|  Kolom                       |  Tipe              |  Tujuan                                            |
|-----------------------------|------------------|---------------------------------------------------|
|  id                           |  TEXT PRIMARY KEY  |  Hash MD5 dari jalur berkas                        |
|  dir_id                       |  INTEGER           |  Kunci asing ke folders                            |
|  name                         |  TEXT              |  Nama berkas                                       |
|  type                         |  TEXT              |  'video', 'audio', 'image'                         |
|  ext                          |  TEXT              |  Ekstensi berkas                                   |
|  size                         |  INTEGER           |  Ukuran berkas dalam byte                          |
|  mtime                        |  INTEGER           |  Stempel waktu terakhir diubah                     |
|  duration                     |  REAL              |  Durasi media dalam detik                          |
|  has_thumb                    |  INTEGER           |  0/1/2 (tidak/ya/generating)                       |
|  thumb_cache_path             |  TEXT              |  Jalur ke berkas thumbnail                         |
|  last_accessed                |  INTEGER           |  Akses pemutaran terakhir                          |
|  access_count                 |  INTEGER           |  Jumlah pemutaran                                  |
|  last_verified                |  INTEGER           |  Pemeriksaan integritas terakhir                   |
|  created_at                   |  INTEGER           |  Stempel waktu pembuatan entri                     |
|  created_at_embedded          |  INTEGER           |  Stempel waktu metadata tertanam                   |
|  modified_at_fs               |  INTEGER           |  mtime sistem berkas                               |
|  uploaded_at                  |  INTEGER           |  Stempel waktu unggahan                            |
|  metadata_source              |  TEXT              |  'embedded', 'scan', 'upload'                      |
|  checksum                     |  TEXT              |  Hash SHA256 untuk dedup                           |
|  codec_info                   |  TEXT              |  Output ffprobe JSON                               |
|  is_stream_compatible         |  INTEGER           |  0/1 untuk keputusan pemutaran                     |
|  title, artist, album, genre  |  TEXT              |  Metadata media                                    |
|  lyrics, lyrics_synced        |  TEXT              |  Isi lirik                                         |
|  cover_source                 |  TEXT              |  Sumber cover art                                  |
|  is_favorite                  |  INTEGER           |  Flag favorit 0/1                                  |
|  youtube_id                   |  TEXT              |  ID YouTube terkait (untuk media bersumber YouTube) |
|  video_offset                 |  REAL DEFAULT 0    |  Offset awal (detik) ke dalam video sumber         |

#### Tabel `folders`

|  Kolom                |  Tipe                 |  Tujuan                  |
|----------------------|---------------------|-------------------------|
|  id                    |  INTEGER PRIMARY KEY  |  Auto-increment          |
|  path                  |  TEXT UNIQUE          |  Jalur folder lengkap    |
|  parent_id             |  INTEGER              |  Referensi folder induk  |
|  depth                 |  INTEGER              |  Level bersarang         |
|  file_count            |  INTEGER              |  Jumlah berkas langsung  |
|  total_size            |  INTEGER              |  Ukuran berkas langsung  |
|  recursive_file_count  |  INTEGER              |  Semua berkas turunan    |
|  recursive_total_size  |  INTEGER              |  Semua ukuran turunan    |
|  last_scanned          |  INTEGER              |  Stempel waktu pindai terakhir |
|  last_updated          |  INTEGER              |  Modifikasi terakhir     |

#### Tabel `files_fts`

Tabel virtual FTS5 untuk pencarian teks penuh pada nama berkas:
`files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1')` dengan trigger. Dibangun ulang via `src/fts-rebuild-worker.mjs` yang di-fork.

#### 6.2.1 Penyiapan FTS5, trigger & worker forked (verbatim)

`db.js:60-146`. `setupFTS()` mem-fork `fts-rebuild-worker.mjs` (timeout 120 dtk); bila gagal, fallback ke `deltaSyncFTS()`, yang membuat ulang tabel virtual + tiga trigger `AFTER INSERT/DELETE/UPDATE` dan mendamaikan rowid yang hilang/yatim tanpa menghapus indeks.

```javascript
// backend/src/db.js:60
export function setupFTS() {
  if (ftsReady) return Promise.resolve();
  return new Promise((resolve) => {
    const workerPath = join(__dirname, 'fts-rebuild-worker.mjs');
    const child = fork(workerPath, [DB_PATH], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 120000 });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d; });
  child.on('message', (msg) => {
    if (msg.type === 'progress') {
      console.log(`[db] FTS rebuild: ${msg.done}/${msg.total}`);
    } else if (msg.type === 'done') {
      if (msg.ok) {
        ftsReady = true;
        console.log(`[db] FTS setup complete via worker (${msg.reason || msg.count + ' entries'})`);
      } else {
        console.error('[db] FTS worker failed:', msg.error || stderr);
        deltaSyncFTS();
      }
      resolve();
    }
  });
  child.on('error', (e) => {
    console.error('[db] FTS worker spawn error:', e.message);
    deltaSyncFTS();
    resolve();
  });
  child.on('exit', (code) => {
    if (!ftsReady) {
      console.error('[db] FTS worker exited with code', code, stderr.slice(0, 200));
      deltaSyncFTS();
      resolve();
    }
  });
  });
}

``` 

## 7. Backend — Endpoint API

Direkonstruksi dari penangan rute di `backend/src/routes/`. Setiap router dipasang di `server.js` di bawah prefiks yang ditampilkan. Tabel dikelompokkan per subsistem. **Ini adalah subset representatif dari rute yang sebenarnya didefinisikan dalam kode, bukan daftar lengkap.**

### 7.1 Berkas & Pencarian (`/api/files`, `/api/search`)

|  Metode  |  Jalur                        |  Penangan                       |  Tujuan                                                                                |
|--------|----------------------------|--------------------------------|--------------------------------------------------------------------------------------|
|  GET     |  `/api/files`                |  `router.get('/')`              |  Jelajahi folder dengan paginasi kursor + pengurutan multi-kolom + pregen thumbnail malas  |
|  GET     |  `/api/files/shuffle`        |  `router.get('/shuffle')`       |  Kembalikan semua berkas yang dapat diputar (video/audio) dalam urutan acak            |
|  POST    |  `/api/files/refresh`        |  `router.post('/refresh')`      |  Jalankan pemindaian inkremental + pembersihan yatim                                  |
|  POST    |  `/api/files/cleanup`        |  `router.post('/cleanup')`      |  Hapus entri DB yatim                                                 |
|  GET     |  `/api/files/stats`          |  `router.get('/stats')`         |  Hitungan tipe berkas cepat                                            |
|  GET     |  `/api/files/folders/:id`    |  `router.get('/folders/:id')`   |  Resolusi id folder ke metadata jalur                                     |
|  GET     |  `/api/files/:id/previews`   |  `router.get('/:id/previews')`  |  Hingga 4 ID berkas pratinjau untuk sebuah folder                          |
|  GET     |  `/api/search`               |  `router.get('/search')`        |  Pencarian berkas FTS + pencarian folder LIKE dengan scope/tipe/urut         |
|  GET     |  `/api/search/suggest`       |  `router.get('/search/suggest')`|  Saran nama autocomplete                                              |
|  PATCH   |  `/api/files/:id/favorite`   |  `router.patch('/:id/favorite')`|  Alihkan flag favorit                                                 |
|  GET     |  `/api/files/:id`            |  `router.get('/:id')`           |  Satu rekam berkas berdasarkan id                                       |
|  POST    |  `/api/files/resolve-batch`  |  `router.post('/resolve-batch')`|  Petakan massal nama berkas → id berkas                                 |

### 7.2 Streaming & Pemutaran (`/stream`)

|  Metode  |  Jalur                                              |  Penangan                                                    |  Tujuan                                                     |
|--------|--------------------------------------------------|------------------------------------------------------------|------------------------------------------------------------|
|  GET     |  `/stream/video/:id/playback-info`                 |  `router.get('/video/:id/playback-info')`                   |  Laporkan hasil `getPlaybackDecision()` + flag seluler/UA     |
|  GET     |  `/stream/video/:id`                               |  `router.get('/video/:id')`                                 |  Stream video via direct/remux/transcode dengan dukungan range |
|  GET     |  `/stream/audio/:id`                               |  `router.get('/audio/:id')`                                 |  Stream berkas audio dengan range                               |
|  GET     |  `/stream/video/:id/hls/playlist.m3u8`             |  `router.get('/video/:id/hls/playlist.m3u8')`               |  Playlist HLS (menolak audio Opus)                             |
|  GET     |  `/stream/video/:id/hls/segment-:segment(\d+).ts`  |  `router.get('/video/:id/hls/segment-:segment(\\d+).ts')`   |  Sajikan satu segmen HLS                                      |
|  GET     |  `/stream/video/:id/compatibility`                 |  `router.get('/video/:id/compatibility')`                   |  Laporan kompatibilitas/catatan (Firefox >2GB, dll.)          |
|  GET     |  `/stream/video/:id/webm`                          |  `router.get('/video/:id/webm')`                            |  Transcode VP9/WebM untuk Firefox/berkas besar                |
|  GET     |  `/stream/video/:id/faststart`                     |  `router.get('/video/:id/faststart')`                       |  Re-mux dengan `+faststart` untuk memperbaiki atom moov       |

### 7.3 Pemantauan (`/api/monitoring`)

|  Metode  |  Jalur                                         |  Penangan                                       |  Tujuan                                         |
|--------|---------------------------------------------|-----------------------------------------------|------------------------------------------------|
|  GET     |  `/api/monitoring/media`                      |  `router.get('/media')`                        |  Statistik media/berkas/DB/thumb/unggah          |
|  POST    |  `/api/monitoring/media/thumbnails/generate`  |  `router.post('/media/thumbnails/generate')`   |  Picu pemindaian thumbnail yang hilang           |
|  GET     |  `/api/monitoring/stats`                      |  `router.get('/stats')`                        |  Snapshot status sistem saat ini                 |
|  GET     |  `/api/monitoring/overview`                   |  `router.get('/overview')`                     |  Ikhtisar gabungan (web/docker/layanan/alert)    |
|  GET     |  `/api/monitoring/history`                    |  `router.get('/history')`                      |  Metrik historis teragregasi                     |
|  GET     |  `/api/monitoring/disk-io/daily`              |  `router.get('/disk-io/daily')`                |  Ringkasan I/O disk harian                        |
|  GET     |  `/api/monitoring/disk-io/total`              |  `router.get('/disk-io/total')`                |  Total kumulatif I/O disk                         |
|  GET     |  `/api/monitoring/metrics/stats`              |  `router.get('/metrics/stats')`                |  Statistik tabel metrik                           |
|  POST    |  `/api/monitoring/metrics/cleanup`            |  `router.post('/metrics/cleanup')`             |  Hapus baris metrik lama                          |
|  POST    |  `/api/monitoring/metrics/optimize`           |  `router.post('/metrics/optimize')`            |  Optimasi tabel metrik                            |
|  GET     |  `/api/monitoring/ws-status`                  |  `router.get('/ws-status')`                    |  Jumlah klien WebSocket                           |
|  POST    |  `/api/monitoring/network/iperf/start`        |  `router.post('/network/iperf/start')`         |  Mulai benchmark klien iperf3                     |
|  GET     |  `/api/monitoring/network/iperf/stream/:id`   |  `router.get('/network/iperf/stream/:id')`     |  Aliran SSE output iperf3                         |
|  GET     |  `/api/monitoring/platform`                   |  `router.get('/platform')`                     |  Info platform yang terdeteksi                    |
|  GET     |  `/api/monitoring/processes`                  |  `router.get('/processes')`                    |  Proses teratas berdasarkan cpu/mem               |
|  GET     |  `/api/monitoring/services`                   |  `router.get('/services')`                     |  Daftar layanan gaya systemd                      |
|  POST    |  `/api/monitoring/services/:name/:action`     |  `router.post('/services/:name/:action')`      |  Mulai/henti/restart layanan                      |
|  GET     |  `/api/monitoring/logs`                       |  `router.get('/logs')`                         |  Entri log gaya journald                          |
|  GET     |  `/api/monitoring/alerts`                     |  `router.get('/alerts')`                       |  Riwayat alert + ambang batas                     |
|  POST    |  `/api/monitoring/alerts/threshold`           |  `router.post('/alerts/threshold')`            |  Atur ambang batas alert                          |
|  POST    |  `/api/monitoring/alerts/check`               |  `router.post('/alerts/check')`                |  Paksa evaluasi alert                             |
|  GET     |  `/api/monitoring/web-stats`                  |  `router.get('/web-stats')`                    |  Statistik server web                            |
|  GET     |  `/api/monitoring/docker`                     |  `router.get('/docker')`                       |  Daftar + stat kontainer Docker                   |
|  POST    |  `/api/monitoring/docker/:id/:action`         |  `router.post('/docker/:id/:action')`          |  Mulai/henti kontainer                            |
|  GET     |  `/api/monitoring/docker/:id/logs`            |  `router.get('/docker/:id/logs')`              |  Log kontainer                                   |
|  GET     |  `/api/monitoring/docker/:id/inspect`         |  `router.get('/docker/:id/inspect')`           |  Inspeksi kontainer JSON                          |
|  GET     |  `/api/monitoring/docker-images`              |  `router.get('/docker-images')`                |  Daftar image Docker                              |
|  GET     |  `/api/monitoring/docker-info`                |  `router.get('/docker-info')`                  |  Info daemon Docker                               |
|  POST    |  `/api/monitoring/system/power`               |  `router.post('/system/power')`                |  shutdown/reboot host                             |
|  POST    |  `/api/monitoring/restart/backend`            |  `router.post('/restart/backend')`             |  SIGTERM backend                                  |
|  POST    |  `/api/monitoring/restart/frontend`           |  `router.post('/restart/frontend')`            |  Build ulang frontend                             |
|  GET     |  `/api/monitoring/queues`                     |  `router.get('/queues')`                       |  Status antrean thumbnail + pindai                |
|  POST    |  `/api/monitoring/queues/:type/:action`       |  `router.post('/queues/:type/:action')`        |  Jeda/lanjutkan/henti/bersihkan antrean           |
|  GET     |  `/api/monitoring/sessions`                   |  `router.get('/sessions')`                     |  Sesi penonton aktif                              |
|  GET     |  `/api/monitoring/sessions/stream`            |  `router.get('/sessions/stream')`              |  Aliran SSE sesi                                  |
|  DELETE  |  `/api/monitoring/sessions/:id`               |  `router.delete('/sessions/:id')`              |  Putuskan sesi                                    |
|  GET     |  `/api/monitoring/hardware`                   |  `router.get('/hardware')`                     |  Sensor/kipas/baterai/disk (cache)                |
|  GET     |  `/api/monitoring/cpu-freq`                   |  `router.get('/cpu-freq')`                     |  Frekuensi CPU saat ini                            |
|  POST    |  `/api/monitoring/cpu-freq`                   |  `router.post('/cpu-freq')`                    |  Atur frekuensi CPU maks                           |
|  POST    |  `/api/monitoring/hardware/fan`               |  `router.post('/hardware/fan')`                |  Atur kecepatan kipas (auto/0-100)                |

### 7.4 Pengunduh (`/api/download`)

|  Metode  |  Jalur                          |  Penangan                          |  Tujuan                               |
|--------|------------------------------|----------------------------------|--------------------------------------|
|  GET     |  `/api/download/stream`        |  `router.get('/stream')`          |  Aliran SSE daftar tugas (1 dtk)      |
|  GET     |  `/api/download/config`        |  `router.get('/config')`          |  Maks konkuren saat ini               |
|  POST    |  `/api/download/config`        |  `router.post('/config')`         |  Atur maks konkuren (1-10)            |
|  POST    |  `/api/download/start`         |  `router.post('/start')`          |  Buat satu tugas unduh                |
|  POST    |  `/api/download/bulk`          |  `router.post('/bulk')`           |  Buat banyak tugas (multi-baris/array)|
|  POST    |  `/api/download/formats`       |  `router.post('/formats')`        |  Daftar format YouTube                |
|  POST    |  `/api/download/twitter-info`  |  `router.post('/twitter-info')`   |  Resolusi info media Twitter          |
|  GET     |  `/api/download/list`          |  `router.get('/list')`            |  Semua tugas                          |
|  GET     |  `/api/download/:id`           |  `router.get('/:id')`             |  Satu tugas                           |
|  POST    |  `/api/download/:id/cancel`    |  `router.post('/:id/cancel')`     |  Batalkan tugas                       |
|  POST    |  `/api/download/:id/remove`    |  `router.post('/:id/remove')`     |  Hapus tugas                          |
|  POST    |  `/api/download/:id/retry`     |  `router.post('/:id/retry')`      |  Ulangi tugas gagal                    |

### 7.5 Daftar Putar (`/api/playlists`)

|  Metode  |  Jalur                                   |  Penangan                                   |  Tujuan                             |
|--------|---------------------------------------|------------------------------------------|------------------------------------|
|  GET     |  `/api/playlists`                       |  `router.get('/')`                         |  Semua daftar putar yang ditemukan   |
|  GET     |  `/api/playlists/:id`                   |  `router.get('/:id')`                      |  Detail daftar putar + trek terurai  |
|  GET     |  `/api/playlists/:id/play`              |  `router.get('/:id/play')`                 |  Antrean siap diputar               |
|  POST    |  `/api/playlists/scan`                  |  `router.post('/scan')`                    |  Pindai akar media untuk XSPF        |
|  POST    |  `/api/playlists/:id/refresh`           |  `router.post('/:id/refresh')`             |  Parse ulang daftar putar            |
|  DELETE  |  `/api/playlists/:id`                   |  `router.delete('/:id')`                   |  Hapus lunak (atau permanen)         |
|  POST    |  `/api/playlists/create/manual`         |  `router.post('/create/manual')`           |  Daftar putar manual dari id berkas  |
|  POST    |  `/api/playlists/create/empty`          |  `router.post('/create/empty')`            |  Daftar putar berjudul kosong        |
|  POST    |  `/api/playlists/:id/tracks`            |  `router.post('/:id/tracks')`              |  Tambah trek (dedup by path)         |
|  DELETE  |  `/api/playlists/:id/tracks/:trackId`   |  `router.delete('/:id/tracks/:trackId')`   |  Hapus trek + renomor                |
|  POST    |  `/api/playlists/:id/tracks/delete`     |  `router.post('/:id/tracks/delete')`       |  Hapus massal trek                   |
|  GET     |  `/api/playlists/:id/available-tracks`  |  `router.get('/:id/available-tracks')`     |  Cari audio Musik/ untuk ditambah     |
|  POST    |  `/api/playlists/create/folder`         |  `router.post('/create/folder')`           |  Daftar putar dari pindai folder     |
|  POST    |  `/api/playlists/import`                |  `router.post('/import')`                  |  Impor XSPF terunggah (busboy)       |

### 7.6 Metadata (`/api/metadata`)

|  Metode  |  Jalur                              |  Penangan                             |  Tujuan                          |
|--------|----------------------------------|------------------------------------|---------------------------------|
|  GET     |  `/api/metadata/cover-art/search`  |  `router.get('/cover-art/search')`   |  Cari cover art (multi-sumber)   |
|  GET     |  `/api/metadata/lyrics/search`     |  `router.get('/lyrics/search')`      |  Cari lirik (multi-sumber)       |
|  GET     |  `/api/metadata/:id`               |  `router.get('/:id')`                |  Baca metadata tertanam + DB     |
|  PUT     |  `/api/metadata/:id`               |  `router.put('/:id')`                |  Perbarui tag (DB + berkas)      |
|  PUT     |  `/api/metadata/:id/cover`         |  `router.put('/:id/cover')`          |  Tanam cover dari URL/base64     |
|  PUT     |  `/api/metadata/:id/cover/upload`  |  `router.put('/:id/cover/upload')`   |  Tanam cover via multipart       |
|  GET     |  `/api/metadata/:id/lyrics`        |  `router.get('/:id/lyrics')`         |  Ambil lirik polos/tersinkron/romaji |
|  PUT     |  `/api/metadata/:id/lyrics`        |  `router.put('/:id/lyrics')`         |  Simpan lirik (+ ekspor `.lrc`)   |

### 7.7 Layanan (`/api/services`)

|  Metode  |  Jalur                           |  Penangan                           |  Tujuan                          |
|--------|-------------------------------|----------------------------------|---------------------------------|
|  GET     |  `/api/services`                |  `router.get('/')`                 |  Semua status layanan terdaftar  |
|  GET     |  `/api/services/:name`          |  `router.get('/:name')`            |  Status satu layanan             |
|  POST    |  `/api/services/:name/start`    |  `router.post('/:name/start')`     |  Mulai layanan                   |
|  POST    |  `/api/services/:name/stop`     |  `router.post('/:name/stop')`      |  Hentikan layanan                |
|  POST    |  `/api/services/:name/restart`  |  `router.post('/:name/restart')`   |  Restart layanan                 |
|  POST    |  `/api/services/restart-all`    |  `router.post('/restart-all')`     |  Restart semua layanan           |

### 7.8 Transfer ADB (`/api/adb`)

|  Metode  |  Jalur                                 |  Penangan                                      |  Tujuan                         |
|--------|-------------------------------------|---------------------------------------------|-------------------------------|
|  GET     |  `/api/adb/devices`                   |  `router.get('/devices')`                     |  Daftar perangkat ADB terhubung |
|  POST    |  `/api/adb/ls`                        |  `router.post('/ls')`                         |  Daftar direktori perangkat     |
|  POST    |  `/api/adb/stat`                      |  `router.post('/stat')`                       |  Stat jalur perangkat           |
|  POST    |  `/api/adb/localls`                   |  `router.post('/localls')`                    |  Daftar direktori lokal         |
|  POST    |  `/api/adb/localstat`                 |  `router.post('/localstat')`                  |  Stat jalur lokal               |
|  POST    |  `/api/adb/check-duplicates`          |  `router.post('/check-duplicates')`           |  Deteksi berkas tujuan ganda    |
|  POST    |  `/api/adb/push`                      |  `router.post('/push')`                       |  Dorong berkas ke perangkat (worker) |
|  POST    |  `/api/adb/pull`                      |  `router.post('/pull')`                       |  Tarik berkas dari perangkat    |
|  GET     |  `/api/adb/jobs`                      |  `router.get('/jobs')`                        |  Semua tugas transfer           |
|  GET     |  `/api/adb/jobs/:id`                  |  `router.get('/jobs/:id')`                    |  Satu tugas                     |
|  GET     |  `/api/adb/jobs/:id/progress`         |  `router.get('/jobs/:id/progress')`           |  Langganan progres SSE          |
|  DELETE  |  `/api/adb/jobs/:id`                  |  `router.delete('/jobs/:id')`                 |  Batalkan tugas                 |
|  POST    |  `/api/adb/jobs/:id/pause`            |  `router.post('/jobs/:id/pause')`             |  Jeda tugas                     |
|  POST    |  `/api/adb/jobs/:id/resume`           |  `router.post('/jobs/:id/resume')`            |  Lanjutkan tugas                |
|  POST    |  `/api/adb/jobs/:id/reassign-device`  |  `router.post('/jobs/:id/reassign-device')`   |  Pindahkan tugas ke perangkat lain |
|  POST    |  `/api/adb/jobs/:id/retry-failed`     |  `router.post('/jobs/:id/retry-failed')`      |  Ulangi transaksi gagal         |
|  GET     |  `/api/adb/jobs/:id/transactions`     |  `router.get('/jobs/:id/transactions')`       |  Daftar transaksi tugas         |
|  POST    |  `/api/adb/jobs/:id/conflict`         |  `router.post('/jobs/:id/conflict')`          |  Selesaikan konflik transfer    |

### 7.9 Unggah (`/api/upload`)

|  Metode  |  Jalur                            |  Penangan                              |  Tujuan                                       |
|--------|--------------------------------|-------------------------------------|----------------------------------------------|
|  POST    |  `/api/upload`                   |  `router.post('/')`                   |  Unggah multipart (di-gate oleh `upload.enabled`) |
|  GET     |  `/api/upload/status`            |  `router.get('/status')`              |  Unggah aktif + statistik                     |
|  GET     |  `/api/upload/history`           |  `router.get('/history')`             |  Unggah lampau                               |
|  DELETE  |  `/api/upload/:id`               |  `router.delete('/:id')`              |  Batalkan unggah aktif                        |
|  DELETE  |  `/api/upload/:id/file`          |  `router.delete('/:id/file')`         |  Hapus berkas dari disk + DB                  |
|  GET     |  `/api/upload/stats`             |  `router.get('/stats')`              |  Statistik unggah agregat                     |
|  POST    |  `/api/upload/repair-metadata`   |  `router.post('/repair-metadata')`    |  Ekstrak ulang stempel waktu tertanam         |
|  POST    |  `/api/upload/repair-durations`  |  `router.post('/repair-durations')`   |  Ekstrak ulang durasi media                   |

### 7.10 Setelan (`/api/settings`)

|  Metode  |  Jalur                          |  Penangan                          |  Tujuan                              |
|--------|------------------------------|---------------------------------|-------------------------------------|
|  GET     |  `/api/settings`               |  `router.get('/')`                |  Semua setelan berkelompok per kategori |
|  GET     |  `/api/settings/history`       |  `router.get('/history')`         |  Riwayat perubahan setelan           |
|  POST    |  `/api/settings/rollback/:id`  |  `router.post('/rollback/:id')`   |  Pulihkan nilai sebelumnya           |
|  GET     |  `/api/settings/:category`     |  `router.get('/:category')`       |  Setelan dalam satu kategori         |
|  PUT     |  `/api/settings/:key`          |  `router.put('/:key')`            |  Perbarui setelan (riwayat + reload) |
|  POST    |  `/api/settings`               |  `router.post('/')`               |  Buat/ganti setelan                  |
|  DELETE  |  `/api/settings/:key`          |  `router.delete('/:key')`         |  Hapus setelan                       |

### 7.11 Pekerjaan (`/api/monitoring/jobs`)

|  Metode  |  Jalur                    |  Penangan            |  Tujuan                                |
|--------|------------------------|-------------------|---------------------------------------|
|  GET     |  `/api/monitoring/jobs`  |  `router.get('/')`  |  Interval poll engine + status watcher |

### 7.12 Pemutaran (`/api/playback`)

|  Metode  |  Jalur                     |  Penangan                     |  Tujuan                                              |
|--------|-------------------------|----------------------------|-----------------------------------------------------|
|  GET     |  `/api/playback/stats`    |  `router.get('/stats')`      |  Hit-rate cache, hitungan remux/transcode, persentil |
|  GET     |  `/api/playback/config`   |  `router.get('/config')`     |  Direktori cache, batas, timeout probe              |
|  GET     |  `/api/playback/health`   |  `router.get('/health')`     |  Probe ffmpeg/ffprobe/sqlite/disk + status          |
|  POST    |  `/api/playback/cleanup`  |  `router.post('/cleanup')`   |  Usir entri cache lama/kebesaran                    |

### 7.14 WhatsApp (`/api/whatsapp`)

|  Metode  |  Jalur                           |  Penangan                                     |  Tujuan                           |
|--------|-------------------------------|--------------------------------------------|----------------------------------|
|  GET     |  `/api/whatsapp/status`         |  `app.get('/api/whatsapp/status')`           |  Koneksi + pencacah               |
|  GET     |  `/api/whatsapp/qr`             |  `app.get('/api/whatsapp/qr')`               |  Payload QR pairing              |
|  GET     |  `/api/whatsapp/qr-image`       |  `app.get('/api/whatsapp/qr-image')`         |  QR PNG yang dirender             |
|  POST    |  `/api/whatsapp/start`          |  `app.post('/api/whatsapp/start')`           |  Hubungkan bot + listener         |
|  POST    |  `/api/whatsapp/stop`           |  `app.post('/api/whatsapp/stop')`            |  Putuskan bot                    |
|  POST    |  `/api/whatsapp/restart`        |  `app.post('/api/whatsapp/restart')`         |  Reset + sambung ulang           |
|  GET     |  `/api/whatsapp/logs`           |  `app.get('/api/whatsapp/logs')`             |  Buffer log terkini              |
|  GET     |  `/api/whatsapp/logs/stream`    |  `app.get('/api/whatsapp/logs/stream')`      |  Aliran SSE log                  |
|  GET     |  `/api/whatsapp/stats`          |  `app.get('/api/whatsapp/stats')`            |  Pencacah unggah/riwayat         |
|  PUT     |  `/api/whatsapp/counter`        |  `app.put('/api/whatsapp/counter')`          |  Atur nilai pencacah             |
|  POST    |  `/api/whatsapp/counter/reset`  |  `app.post('/api/whatsapp/counter/reset')`   |  Reset pencacah (kirim titik)    |
|  GET     |  `/api/whatsapp/config`         |  `app.get('/api/whatsapp/config')`           |  target/kata kunci/hastag        |
|  PUT     |  `/api/whatsapp/config`         |  `app.put('/api/whatsapp/config')`           |  Perbarui config (restart utk terapkan) |

### 7.15 Kirim / Cache Video

|  Metode  |  Jalur                                    |  Penangan                                 |  Tujuan                                |
|--------|----------------------------------------|----------------------------------------|---------------------------------------|
|  POST    |  `/api/send/telegram`                    |  `router.post('/telegram')`              |  Kirim berkas ke Telegram + pemisah titik |
|  POST    |  `/api/send/all`                         |  `router.post('/all')`                   |  Kirim ke Telegram + saluran/status WA   |
|  GET     |  `/api/send/telegram/status`             |  `router.get('/telegram/status')`        |  Kesiapan bot                          |
|  POST    |  `/api/video-cache/search`               |  `router.post('/search')`                |  Cari video by query                   |
|  POST    |  `/api/video-cache/auto-detect/:id`      |  `router.post('/auto-detect/:id')`       |  Saran kecocokan dari judul berkas     |
|  POST    |  `/api/video-cache/save-id/:id`          |  `router.post('/save-id/:id')`           |  Simpan youtube id yang cocok          |
|  POST    |  `/api/video-cache/download/:youtubeId`  |  `router.post('/download/:youtubeId')`   |  Unduh latar belakang                  |
|  GET     |  `/api/video-cache/progress/:youtubeId`  |  `router.get('/progress/:youtubeId')`    |  Progres unduh                         |
|  GET     |  `/api/video-cache/stream/:youtubeId`    |  `router.get('/stream/:youtubeId')`      |  Stream range video cache              |
|  GET     |  `/api/video-cache/status`               |  `router.get('/status')`                 |  Info cache                            |
|  POST    |  `/api/video-cache/clear`                |  `router.post('/clear')`                 |  Bersihkan cache                       |

### 7.16 Debug / Lain-lain

|  Metode  |  Jalur                          |  Penangan                           |  Tujuan                                       |
|--------|------------------------------|----------------------------------|----------------------------------------------|
|  GET     |  `/file/:id`                   |  `router.get('/:id')`              |  Sajikan berkas mentah dengan range (cache immutable) |
|  GET     |  `/thumbnails/:id.jpg`         |  `router.get('/:id.jpg')`          |  Sajikan atau buat thumbnail berkas          |
|  GET     |  `/thumbnails/folder/:id.jpg`  |  `router.get('/folder/:id.jpg')`   |  Sajikan atau buat pratinjau folder          |

---
## 8. Backend — Subsistem

### 8.1 Engine Pemutaran

#### 8.1.1 Keputusan pemutaran (kode)

`getPlaybackDecision()` mem-probe berkas (codec_info cache atau ffprobe langsung), lalu menelusuri pohon keputusan kecil: container browser + H.264/HEVC + tanpa Opus → `direct`; container browser + Opus → `remux` (copy ke MKV); lainnya → `transcode` ke H.264/AAC. Kunci cache adalah MD5 dari `filePath:size:mtime`.

```javascript
// backend/src/utils/playbackEngine.js
export async function getPlaybackDecision(file) {
  const t0 = Date.now();
  const ext = file.ext?.toLowerCase();

  const cachedProbe = parseCodecInfo(file);
  const liveProbe = cachedProbe ? null : await probeVideoFile(file.fullPath);
  const probe = cachedProbe || liveProbe;
  // ... probeMs accounting ...
  const codec = `${probe.video_codec || ''} ${probe.video_codec_tag || ''}`.toLowerCase();
  const audioCodec = `${probe.audio_codec || ''} ${probe.audio_codec_tag || ''}`.toLowerCase();
  const isBrowserContainer = BROWSER_CONTAINERS.includes(ext);
  const isH264 = H264_RE.test(codec);
  const isHevc = HEVC_RE.test(codec);
  const hasOpus = OPUS_RE.test(audioCodec);
  const videoCompatible = isBrowserContainer && (isH264 || isHevc);

  if (videoCompatible && !hasOpus) {
    return { action: 'direct', path: file.fullPath, contentType: MIME_MAP[ext] || 'video/mp4', reason: 'browser_compatible', /* ... */ };
  }
  if (videoCompatible && hasOpus) {
    return await handleRemux(file, probe, t0, probeMs);
  }
  return await handleTranscode(file, probe, t0, probeMs);
}

function computeCacheHash(filePath, size, mtime) {
  return createHash('md5').update(`${filePath}:${size}:${mtime}`).digest('hex').slice(0, 16);
}
```

> **Apa kerjanya:** Memilih metode pemutaran (direct/remux/transcode) dari hasil probe codec, lalu menghitung kunci cache MD5 `filePath:size:mtime`.
> **Dampak:** Berkas yang kompatibel browser diputar langsung tanpa pemrosesan; Opus-dalam-MP4 di-remux dengan cepat; lainnya di-transcode — sehingga startup lebih cepat dan CPU dihemat.
> **Alternatif serupa:** Dapat menggunakan profil statis per-ekstensi, tetapi probing dinamis menangani variasi codec dunia nyata.
> **Kalau tidak pakai ini:** Format tidak didukung akan gagal diputar atau memaksa transcode pada setiap permintaan (memboroskan CPU/IO).

```javascript
// backend/src/utils/playbackEngine.js
function remuxToMkv(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath, '-c', 'copy', '-f', 'matroska', '-y', outputPath,
    ]);
    // ... on close: resolve(outputPath) / reject ...
  });
}

function transcodeToH264Mp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      '-f', 'mp4', '-y', outputPath,
    ]);
    // ... on close: resolve(outputPath) / reject ...
  });
}
```

> **Apa kerjanya:** `remuxToMkv` menyalin stream ke MKV tanpa encode ulang; `transcodeToH264Mp4` mengonversi video ke H.264/yuv420p dan audio ke AAC dengan `+faststart`.
> **Dampak:** Opus-dalam-MP4 menjadi dapat diputar (remux) dan codec lain menjadi H.264/AAC universal (transcode) dengan atom moov di depan untuk streaming.
> **Alternatif serupa:** Gunakan `ffmpeg` dengan `-c copy` ke MP4 untuk kasus tanpa Opus, tetapi MKV lebih aman untuk remux generik.
> **Kalau tidak pakai ini:** Video Opus/HEVC tidak dapat digunakan di browser dan, tanpa fallback transcode, akan gagal diputar.

```javascript
// backend/src/utils/playbackEngine.js — FFmpeg concurrency limiter (prevents OOM storms)
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

> **Apa kerjanya:** Membatasi ffmpeg paling banyak 2 proses konkuren via slot; sisanya antre hingga satu selesai.
> **Dampak:** Menghindari lonjakan transcode yang membanjiri RAM/CPU saat banyak permintaan tiba bersamaan.
> **Alternatif serupa:** Dapat menggunakan worker pool (mis. `p-queue`), tetapi variabel penghitung plus antrean cukup dan tanpa dependensi.
> **Kalau tidak pakai ini:** Beban transcode konkuren dapat memicu kill OOM di server.

#### 8.1.2 HLS (kode)

`spawnFfmpeg()` membungkus `ffmpeg` dalam sebuah promise; pembuatan HLS menggunakan `-f hls -hls_time 3` dengan nama berkas segmen, dan fallback ke remux `+faststart` bila atom moov hilang.

```javascript
// backend/src/utils/hlsGenerator.js
function spawnFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    ff.stderr.on('data', d => { stderr += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.slice(-300)));
    });
    ff.on('error', reject);
  });
}

// inside startHLSGeneration():
const ffmpegArgs = [
  '-i', filePath, '-c', 'copy', '-f', 'hls',
  '-hls_time', String(SEGMENT_DURATION), '-hls_list_size', '0',
  '-hls_segment_filename', join(workDir, 'segment-%d.ts'),
  playlistPath,
];
await spawnFfmpeg(ffmpegArgs);
```

> **Apa kerjanya:** `spawnFfmpeg` membungkus panggilan ffmpeg dalam sebuah promise; arg HLS memotong video menjadi segmen `.ts` 3-detik via `-f hls -hls_time 3`.
> **Dampak:** Memungkinkan streaming adaptif berbasis segmen tanpa transcode (copy), menjaga latensi rendah.
> **Alternatif serupa:** DASH atau transcode per-segmen dapat digunakan, tetapi HLS copy-copy cukup untuk pemutaran progresif.
> **Kalau tidak pakai ini:** Video besar harus diunduh penuh sebelum diputar (tanpa streaming progresif).

### 8.2 Pemindai Berkas & Thumbnail

#### 8.2.1 Pemindai (kode)

`computeContentHash()` mengambil sampel 64 KB pertama dan terakhir plus ukuran berkas untuk membangun sidik jari konten cepat tanpa membaca seluruh berkas. Sinkronisasi inkremental melakukan dedup pada `size`+`mtime` lebih dulu, dan hanya memeriksa ulang hash konten bila `scan.compareByHash` diaktifkan.

```javascript
// backend/src/utils/fileScanner.js
async function computeContentHash(filePath, size) {
  try {
    const SAMPLE = 65536;
    const h = createHash('md5');
    h.update(String(size));
    const fd = await fs.open(filePath, 'r');
    try {
      const buf1 = Buffer.allocUnsafe(Math.min(SAMPLE, size));
      await fd.read(buf1, 0, Math.min(SAMPLE, size), 0);
      h.update(buf1);
      if (size > SAMPLE * 2) {
        const buf2 = Buffer.allocUnsafe(SAMPLE);
        await fd.read(buf2, 0, SAMPLE, size - SAMPLE);
        h.update(buf2);
      }
    } finally {
      await fd.close();
    }
    return h.digest('hex');
  } catch {
    return null;
  }
}
```

> **Apa kerjanya:** Membangun hash MD5 dari ukuran + 64 KB pertama + 64 KB terakhir berkas sebagai sidik jari konten cepat.
> **Dampak:** Mendeteksi perubahan konten tanpa membaca seluruh berkas, menjaga pindai cepat meski untuk berkas besar.
> **Alternatif serupa:** Hash SHA-256 penuh lebih akurat tetapi lebih lambat; pengambilan sampel cukup untuk deteksi perubahan biasa.
> **Kalau tidak pakai ini:** Berkas yang berubah namun dengan ukuran/waktu sama bisa terlewat oleh pembaruan metadata.

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

> **Apa kerjanya:** Melewati berkas yang ukuran dan mtime-nya cocok dengan DB; hanya bila `compareByHash` diaktifkan hash konten diperiksa.
> **Dampak:** Pemindaian inkremental sangat cepat karena berkas tak berubah langsung dilewati.
> **Alternatif serupa:** Selalu menghitung hash penuh memungkinkan, tetapi memboroskan I/O pada berkas yang jarang berubah.
> **Kalau tidak pakai ini:** Setiap pindai akan membandingkan ulang semua berkas, menjadi lambat dan berat di disk.

#### 8.2.2 Watcher (kode)

`startWatcher()` menggunakan `fs.watch` (rekursif) per akar media dan merutekan perubahan melalui `debouncedRescan()`, yang menunggu 2 dtk setelah event terakhir (dan melewati masa tenggang startup 30 dtk) sebelum menjalankan `incrementalSync()` dan menyiarkan event SSE `folder_updated`.

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

> **Apa kerjanya:** Mengawasi perubahan direktori via `fs.watch`, lalu menunggu 2 detik sebelum pemindaian inkremental + siaran event SSE ke klien.
> **Dampak:** UI menyegarkan otomatis saat berkas baru tiba, tanpa polling terus-menerus.
> **Alternatif serupa:** `chokidar` lebih portabel lintas OS, tetapi `fs.watch` rekursif cukup di Linux.
> **Kalau tidak pakai ini:** Pengguna harus menyegarkan manual untuk melihat berkas baru.

#### 8.2.3 Thumbnail (kode)

`extractFrameThumbnail()` men-seek ke 1 dtk dan mengambil satu frame, diskalakan ke lebar 200 via `scale=200:-1` menggunakan ffmpeg (tanpa dependensi `sharp`). `hasEmbeddedCover()`/`extractEmbeddedThumbnail()` mendeteksi dan menyalin stream gambar tertanam (`attached_pic`/mjpeg/png) alih-alih mengambil sampel frame acak.

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

> **Apa kerjanya:** Menyalin satu frame video yang merupakan cover art tertanam (`attached_pic`/mjpeg/png) ke berkas gambar via `-c copy -frames:v 1`.
> **Dampak:** Musik/video dengan cover art internal langsung mendapat thumbnail tanpa mengambil sampel frame acak — lebih relevan secara visual.
> **Alternatif serupa:** Dapat menggunakan `music-metadata` untuk membaca cover, tetapi ffmpeg sudah menangani audio+video secara seragam; trade-off: ffmpeg cukup.
> **Kalau tidak pakai ini:** Berkas dengan cover art tertanam tetap mendapat frame acak yang diambil sampel, kurang indah secara estetika.

### 8.3 Pengunduh (`downloader/manager.js`)

Sumber yang didukung (`SOURCE_ROUTES`): youtube, tiktok, twitter, instagram, torrent. Alat: yt-dlp, gallery-dl, aria2c, ffmpeg/ffprobe.

|  Sumber     |  Alat                |  Jalur Output                                                      |
|-----------|--------------------|------------------------------------------------------------------|
|  YouTube    |  yt-dlp              |  /home/CATIAA/Videos/YouTube                                      |
|  TikTok     |  gallery-dl          |  /home/CATIAA/Videos/TikTok, /home/CATIAA/Pictures/TikTok         |
|  Twitter/X  |  gallery-dl          |  /home/CATIAA/Videos/Twitter, /home/CATIAA/Pictures/Twitter       |
|  Instagram  |  yt-dlp/gallery-dl   |  /home/CATIAA/Videos/Instander, /home/CATIAA/Pictures/Instander   |
|  Torrent    |  aria2c              |  /home/CATIAA/homelab                                             |

Pipeline Instagram: 1 konkuren + jeda 12 dtk, dedup SHA256, VP9/AV1 → transcode H.264/AAC, staging di bawah `/home/CATIAA/homelab/DUMMY`.

#### 8.3.1 Kode pengunduh (verbatim)

Kutipan dari `backend/src/downloader/manager.js`.

**`SOURCE_ROUTES` + `QUALITY_MAP`** (`manager.js:20-72`). Memetakan setiap sumber ke direktori output dan daftar kualitas yang diizinkan; direktori output di-`mkdirSync` saat pemuatan.

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

> **Apa kerjanya:** Mendefinisikan pemetaan setiap sumber (youtube, tiktok, twitter, instagram, torrent) ke direktori output video/audio/gambarnya, plus daftar kualitas yang diizinkan per sumber; direktori output dibuat saat pemuatan modul via `mkdirSync`.
> **Dampak:** Menjamin unduhan mendarat di lokasi yang konsisten per-platform; validasi kategori/kualitas di `createTask` sepenuhnya bergantung pada peta ini.
> **Alternatif serupa:** Dapat membaca peta dari env/JSON; trade-off: peta hardcoded lebih sederhana dan cukup untuk sumber tetap.
> **Kalau tidak pakai ini:** Jalur output tidak terdefinisi dan validasi kategori/kualitas gagal, sehingga tugas unduh tidak dapat dibuat.

**`spawnYtdlp`** (`manager.js:1511-1549`). Membangun vektor argumen yt-dlp — `--concurrent-fragments 4`, pemilih format per kategori (Instagram memaksa penggabungan MP4 H.264/AVC), ekstraksi audio, dan template output.

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

> **Apa kerjanya:** Membangun vektor argumen `yt-dlp` berdasarkan kategori tugas — jumlah fragmen konkuren, pemilihan format (Instagram memaksa penggabungan MP4 H.264/AVC), ekstraksi audio, template output, dan cookie Twitter.
> **Dampak:** Menentukan kualitas, kompatibilitas browser, dan lokasi berkas akhir; Instagram selalu dirutekan ke MP4 agar diputar langsung di klien.
> **Alternatif serupa:** Wrapper seperti `ytdl-core` dapat digunakan; trade-off: memanggil biner langsung lebih fleksibel dan mengikuti rilis `yt-dlp` terbaru.
> **Kalau tidak pakai ini:** Unduhan tidak dapat berjalan karena argumen tidak terbentuk, atau akan menghasilkan format yang tidak kompatibel dengan pemutar.

**Transcode Instagram VP9/AV1 → H.264/AAC** (`manager.js:503-531`). Meng-encode ulang video Instagram yang tidak kompatibel browser pada `crf 18` / `preset medium` agar diputar langsung di browser.

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

> **Apa kerjanya:** Meng-encode ulang video Instagram yang tidak kompatibel (VP9/AV1) ke H.264/AAC MP4 via `ffmpeg` dengan `crf 18`/`preset medium`, lalu memeriksa berkas output ada sebelum mengembalikannya.
> **Dampak:** Menjamin setiap video Instagram diputar langsung di browser tanpa kegagalan pemutaran. Seperti dicatat dalam catatan overkill, transcode ini berat/lambat, tetapi sepadan karena Instagram adalah jalur ingest utama dan menghindari kesalahan pemutaran klien.
> **Alternatif serupa:** Transcode dapat dilewati bila sumber sudah `avc1`/`h264` via `probeVideoFile` + `isInstagramVideoCodecCompatible`; trade-off: lebih cepat tetapi berisiko gagal di beberapa browser.
> **Kalau tidak pakai ini:** Video VP9/AV1 tidak dapat diputar di banyak browser, menyebabkan kesalahan pemutaran pada media Instagram.

**Instagram 1-konkuren + batas 12 dtk** (`manager.js:16-18`, `manager.js:1160-1186`). Penjadwal antrean menserialisasi tugas Instagram dan menyisipkan celah 12 dtk di antaranya untuk tetap di bawah batas laju Instagram.

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

> **Apa kerjanya:** Membatasi antrean Instagram ke 1 tugas konkuren dan menyisipkan celah minimal 12 detik antar tugas via `INSTAGRAM_CONCURRENT`/`INSTAGRAM_DELAY_MS` di `processQueue`.
> **Dampak:** Menghindari pembatasan/blokir dari Instagram dengan tidak memicu terlalu banyak unduhan simultan.
> **Alternatif serupa:** Ember token atau pustaka rate-limiter dapat digunakan; trade-off: penghitung sederhana + `setTimeout` tanpa dependensi dan cukup.
> **Kalau tidak pakai ini:** Instagram dapat membatasi atau memblokir akun karena terlalu banyak permintaan simultan dalam waktu singkat.

### 8.4 Transfer ADB (`utils/adbManager.js`, `adbTransaction.js`, `adbWorkerPool.js`, `routes/adb.js`)

Siklus hidup tugas: `adbManager.push(device, sources, dest, { maxWorkers: 3, conflictStrategy })` → progres transaksi `pending → running → [done|error|cancelled]`.

Tabel basis data ADB (`adb_jobs`, `adb_transactions`). Status transaksi: PENDING, CONFLICT_CHECK, CONFLICT, TRANSFERRING, VERIFYING, DONE, CANCELLED, FAILED, SKIPPED. Resolusi konflik: skip / overwrite / rename / cancel / applyAll.

#### 8.4.1 Kode ADB (verbatim)

**State machine transaksi** (`adbTransaction.js:6-30`). Enum `TX_STATUS` eksplisit + peta `VALID_TRANSITIONS` memaksa progres legal (`pending → checking → transferring → verifying → metadata → committed`). Transisi ilegal ditolak oleh `updateStatus`.

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

> **Apa kerjanya:** Mendefinisikan enum status transaksi ADB (PENDING, CONFLICT_CHECK, TRANSFERRING, VERIFYING, METADATA, COMMITTED, dll.) bersama `VALID_TRANSITIONS` yang hanya mengizinkan transisi legal antar status.
> **Dampak:** Mencegah korupsi status transaksi; `updateStatus` menolak transisi ilegal sehingga siklus hidup transfer tetap konsisten dan dapat dipulihkan setelah crash.
> **Alternatif serupa:** Pustaka state-machine (mis. `xstate`) dapat digunakan; trade-off: peta eksplisit lebih ringan dan mudah diaudit.
> **Kalau tidak pakai ini:** Transaksi dapat melompat ke status tidak valid (mis. committed→transferring), membuat verifikasi dan pemulihan tidak dapat diandalkan.

**Worker pool berbatas-konkuren** (`adbWorkerPool.js:90-168`). `AdbWorkerPool.processJob` memutar `min(maxWorkers, pending.length)` worker dan `_prepAhead` look-ahead yang melakukan pre-stat direktori jarak jauh dan menyelesaikan konflik sebelum transfer dimulai.

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

> **Apa kerjanya:** Menjalankan transfer dengan worker pool berukuran `min(maxWorkers, jumlah pending)`; setiap worker memroses satu transaksi sementara `_prepAhead` melakukan stat jarak jauh dan resolusi konflik di awal.
> **Dampak:** Mengaktifkan transfer paralel konkuren-aman antar berkas; retry otomatis dan penanganan konflik terpusat di worker.
> **Alternatif serupa:** `p-queue` atau `worker_threads` dapat digunakan; trade-off: implementasi berbasis promise buatan sendiri cukup untuk orkestrasi ADB.
> **Kalau tidak pakai ini:** Transfer akan berjalan serial atau dengan konkurensi tak terbatas, memperlambat tugas besar atau membanjiri perangkat target.

**Verifikasi checksum / ukuran setelah push** (`adbWorkerPool.js:418-426`). Setiap berkas di-re-stat di perangkat dan dibandingkan dengan ukuran yang diharapkan (dan, setelah metadata, mtime). Ketidakcocokan ukuran memunculkan error dan transaksi diulang (hingga `max_attempts`).

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

> **Apa kerjanya:** Setelah push, memanggil `verifyFile` di perangkat untuk membandingkan ukuran berkas tujuan (dan mtime setelah metadata) dengan ukuran yang diharapkan; bila gagal memunculkan error `SIZE_MISMATCH`/`FILE_MISSING`.
> **Dampak:** Menjamin integritas berkas yang ditransfer; kegagalan verifikasi memicu retry otomatis hingga `max_attempts` sebelum ditandai gagal.
> **Alternatif serupa:** Dapat membandingkan checksum SHA256 alih-alih ukuran; trade-off: ukuran lebih cepat, SHA256 lebih tangguh tetapi butuh baca ulang.
> **Kalau tidak pakai ini:** Berkas rusak/terpotong dapat lolos sebagai sukses, merusak pustaka di perangkat.

**Pembuatan tugas `push()`** (`adbManager.js:461-503`). Membangun rekam tugas yang membawa `maxWorkers` dan `conflictStrategy` (`skip` | `overwrite` | `ask`), menyimpannya, dan mengantrekannya di antrean per-perangkat.

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

> **Apa kerjanya:** Membuat rekam tugas push yang memuat perangkat, sumber, tujuan, `maxWorkers`, dan `conflictStrategy` (`skip`|`overwrite`|`ask`), menyimpannya ke DB via `transactionEngine`, lalu mengantrekannya per perangkat.
> **Dampak:** Berfungsi sebagai titik masuk transfer; tugas disimpan agar dapat dipulihkan setelah restart dan berjalan sekuensial per perangkat.
> **Alternatif serupa:** Dapat langsung di-spawn tanpa persistensi tugas; trade-off: tugas + DB mengaktifkan resume, jeda, dan progres SSE.
> **Kalau tidak pakai ini:** Tidak ada pelacakan tugas, sehingga tak ada progres, jeda, atau pemulihan setelah crash.

### 8.5 Unggah (`utils/uploadManager.js`, `routes/upload.js`)

Unggah multipart Busboy. State: `MEDIA_ROOTS`, Map `activeUploads`, `uploadIdCounter`, `UPLOAD_TEMP`. Setelan runtime: `upload.maxSizeGB` (100), `upload.concurrent` (4), `upload.duplicateStrategy` (rename), `upload.autoScan` (true), `upload.verifyIntegrity` (true), `upload.autoThumbnail` (true). `sanitizeFilename()` menghapus `..`, `/`, `\`, `\0`, maks 255 karakter.

### 8.6 Pemantauan (`monitor/*`)

Interval poll engine adalah **3000ms** (`pollIntervalMs = 3000` di `engine.js`); throttle siaran WebSocket **3000ms** (`BROADCAST_THROTTLE_MS`); snapshot historis setiap **30 dtk**. Setelan dasbor `monitor.refreshInterval` default **1000ms** dan merupakan interval **fallback polling frontend** — tidak mengubah poll engine backend. Backend menggunakan `monitor/monitoringCache.js` yang di-fork → `src/sensors-worker.mjs` untuk pembacaan sensor; pengumpulan GPU dapat dilewati via `MONITOR_DISABLE_GPU`.

#### 8.6.1 Kode pemantauan (verbatim)

**Loop poll `collectAll()`** (`engine.js:32-97`). Keenam collector berjalan konkuren dengan `Promise.race` timeout 3 dtk per collector; hasil disiarkan (throttled) dan di-snapshot setiap 30 dtk. `pollIntervalMs = 3000` adalah konstanta di `engine.js:20`.

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

> **Apa kerjanya:** Menjalankan keenam collector (cpu, ram, gpu, disk, network, system) secara sekuensial dengan timeout 3 detik per collector via `Promise.race`, lalu menyiarkan stat (throttle 3 dtk) dan menyimpan snapshot setiap 30 dtk.
> **Dampak:** Dasbor mendapat metrik segar setiap poll 3000ms tanpa collector lambat memblokir loop (guard `collecting` mencegah tumpang tindih).
> **Alternatif serupa:** `Promise.all` tanpa timeout dapat digunakan, tetapi timeout melindungi dari collector macet.
> **Kalau tidak pakai ini:** Seorang collector yang terjebak dapat menghentikan pembaruan metrik di seluruh sistem.
<!-- annot:engine_collectall -->
**Pembacaan sensor forked — `monitoringCache.js` + `sensors-worker.mjs`** (`monitoringCache.js:69-77`, `165-184`). Pembacaan sensor perangkat keras (`/sys/class/hwmon`) didorong ke dalam **proses anak terpisah** sehingga hang D-state kernel pada `hwmon` tidak pernah memblokir event loop HTTP utama. Induk membaca JSON hasil anak setelah settle 1,5 dtk.



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

> **Apa kerjanya:** Mem-fork proses Node terpisah (`sensors-worker.mjs`) yang membaca hwmon sysfs, lalu setelah 1,5 dtk membaca hasil JSON-nya dari berkas cache; anak di-`unref()` agar tidak menahan proses tetap hidup.
> **Dampak:** Pembacaan sensor yang dapat hang dalam D-state (tidur tak-terinterupsi) tidak lagi memblokir event loop HTTP utama, sehingga server tetap responsif saat perangkat keras berperilaku buruk.
> **Alternatif serupa:** Dapat membaca `/sys/class/hwmon` langsung di thread utama (lebih murah), tetapi itu berisiko hang pada sensor flaky — proses terpisah adalah trade-off ketangguhan/overkill yang disengaja.
> **Kalau tidak pakai ini:** Hang D-state sysfs dapat membekukan seluruh server media sehingga tidak dapat merespons permintaan.
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

> **Apa kerjanya:** Membaca semua entri `hwmon` dari sysfs, mengonversi nilai mentah ke °C (bagi 1000), mengambil `high`/`crit`, lalu menulis hasil ke `/tmp/homelab_sensors.json`.
> **Dampak:** Menyediakan data sensor yang diambil di luar proses utama sehingga induk dapat membacanya dengan aman.
> **Alternatif serupa:** Dapat mengembalikannya via IPC, tetapi menulis berkas cache lebih sederhana dan terlepas dari event loop.
> **Kalau tidak pakai ini:** Pembacaan sensor harus terjadi di proses utama, yang rentan terhadap hang D-state.
<!-- annot:sensors_worker -->
Loop penyegaran latar belakang (`monitoringCache.js:165-184`) menjalankan ulang setiap pembaca pada timer-nya sendiri (sensor 30 dtk, cpu freq / kipas / baterai / media 15 dtk, uptime 10 dtk).

**Collector GPU — `nvidia-smi` + short-circuit `MONITOR_DISABLE_GPU`** (`gpu.js:149-153`, `72-95`).

```javascript
// backend/src/monitor/collectors/gpu.js:149
export function collect() {
  if (process.env.MONITOR_DISABLE_GPU) return null;
  refreshGpu();
  return cachedGpu;
}
```

> **Apa kerjanya:** `collect()` langsung mengembalikan `null` bila `MONITOR_DISABLE_GPU` disetel, jika tidak memanggil `refreshGpu()` dan mengembalikan `cachedGpu`.
> **Dampak:** Memungkinkan menonaktifkan collector GPU tanpa mengubah engine — berguna bila tidak ada GPU NVIDIA.
> **Alternatif serupa:** Collector dapat difilter di `engine.js`, tetapi guard env di sini lebih terlokalisasi.
> **Kalau tidak pakai ini:** Engine akan terus memanggil `nvidia-smi`, yang akan gagal terus-menerus di host tanpa GPU.
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

> **Apa kerjanya:** Menjalankan `nvidia-smi --query-gpu=...` lalu mem-parse CSV-nya ke objek metrik (utilisasi, VRAM, suhu, clock, daya, driver).
> **Dampak:** Dasbor GPU diisi dari output `nvidia-smi` dengan timeout 5 detik; bila gagal mengembalikan null dan menggunakan cache.
> **Alternatif serupa:** NVML sysfs dapat dibaca langsung, tetapi CLI `nvidia-smi` cukup dan portabel.
> **Kalau tidak pakai ini:** Tidak ada metrik GPU NVIDIA yang ditampilkan dalam pemantauan.
<!-- annot:gpu_refreshnvidia -->
**Collector disk — `statvfs` + `smartctl` dengan cache** (`disk.js:49-102`, `132-159`).

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

> **Apa kerjanya:** Menjalankan `smartctl -H` dan `smartctl -A` paralel per disk fisik (`Promise.allSettled`), menentukan status PASSED/FAILED dan suhu, lalu menyimpannya di `smartCache` (TTL 60 dtk).
> **Dampak:** Kesehatan disk SMART tersedia untuk widget disk tanpa memanggil `smartctl` di setiap poll.
> **Alternatif serupa:** `libatasmart`/ioctl langsung dapat digunakan, tetapi CLI `smartctl` sudah ada dan mudah di-timeout.
> **Kalau tidak pakai ini:** Widget disk tidak menampilkan status/suhu SMART dan pembaruan per-poll akan lambat.
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

> **Apa kerjanya:** Membaca `/proc/mounts`, memfilter ke fstype ext4/btrfs/xfs/zfs atau mount `/`, lalu menggunakan `statfsSync` untuk menghitung total/used/free dan persentase penggunaan.
> **Dampak:** Menyediakan daftar partisi dengan penggunaan disk yang ditampilkan di dasbor.
> **Alternatif serupa:** CLI `df` dapat digunakan, tetapi `statfsSync` sinkron lebih sederhana dan menghindari spawn.
> **Kalau tidak pakai ini:** Tidak ada data penggunaan filesystem yang ditampilkan dalam pemantauan disk.
<!-- annot:disk_getfilesystems -->
> Hasil SMART di-cache 60 dtk (`SMART_CACHE_TTL = 60_000`); daftar partisi 30 dtk. `getDiskstats()` (dari `/proc/diskstats`) menghitung delta byte baca/tulis per perangkat antar poll untuk widget I/O.

**Alert — dedupe `checkAlerts()` threshold + 60 dtk** (`alerts.js:59-129`). CPU/RAM/disk/temp/gpuTemp masing-masing memunculkan event `warning`/`critical`; tipe+severity identik ditekan selama 60 dtk.

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

> **Apa kerjanya:** Membandingkan metrik cpu/ram/disk/suhu/gpuTemp terhadap ambang warning/critical, lalu memfilter duplikat berdasarkan tipe+severity dalam 60 detik terakhir.
> **Dampak:** Mencegah alert yang sama membanjiri; riwayat disimpan (maks 200) dan penulisan disk di-debounce 5 detik.
> **Alternatif serupa:** Pustaka alerting eksternal dapat digunakan, tetapi dedupe manual cukup dan tanpa dependensi.
> **Kalau tidak pakai ini:** Alert yang sama dapat membanjiri setiap poll (3 detik), membebani log/riwayat.
<!-- annot:alerts_checkalerts -->
### 8.8 WhatsApp / Kirim (`routes/whatsapp.js`, `routes/send.js`, `whatsapp-bot/`)

Jembatan WhatsApp dimuat oleh `server.js` via `initWhatsApp()` (10 dtk setelah listen, hingga 5 retry backoff). `routes/whatsapp.js` mengimpor dari `../../../whatsapp-bot/src/` dan mengekspos `/api/whatsapp/*` plus SSE `/api/whatsapp/logs/stream`. Kirim Telegram (`routes/send.js`) bersifat opsional — aktif hanya bila `TELEGRAM_BOT_TOKEN` disetel.

#### 8.8.1 Kode WhatsApp / Kirim (verbatim)

**`setupWhatsAppRoutes(app)`** (`routes/whatsapp.js:34`). Modul rute backend mengimpor langsung dari `../../../whatsapp-bot/src/` dan memasang endpoint REST + SSE `/api/whatsapp/*` ke Express `app`.

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

> **Apa kerjanya:** Mendaftarkan endpoint REST+SSE `/api/whatsapp/*` ke Express `app`, mengimpor langsung dari `../../../whatsapp-bot/src/` dan menggabungkan status koneksi dengan pencacah Telegram/WhatsApp.
> **Dampak:** Backend dapat mengontrol dan memantau jembatan WhatsApp dari satu rute tanpa proses terpisah.
> **Alternatif serupa:** whatsapp-bot dapat berjalan sebagai layanan mandiri, tetapi impor langsung menyatukan siklus hidupnya dengan server.
> **Kalau tidak pakai ini:** Endpoint WhatsApp tidak dipasang, sehingga fitur jembatan tidak dapat dijangkau via API.
<!-- annot:wa_setuproutes -->
**Guard Telegram — `TELEGRAM_BOT_TOKEN`** (`utils/telegramBot.js:11-16`). Bot hanya dibangun bila variabel env token disetel; jika tidak `getBot()` mengembalikan `null` dan setiap kirim memunculkan error `"TELEGRAM_BOT_TOKEN not configured"`.

```javascript
// backend/src/utils/telegramBot.js:11
export function getBot() {
  if (!bot && BOT_TOKEN) {
    bot = new TelegramBotApi(BOT_TOKEN, { polling: false });
  }
  return bot;
}
```

> **Apa kerjanya:** Menginisialisasi `TelegramBotApi` hanya bila `TELEGRAM_BOT_TOKEN` ada; jika tidak `getBot()` mengembalikan `null` dan setiap kirim memunculkan error konfigurasi.
> **Dampak:** Fitur Telegram otomatis nonaktif bila token tidak disetel, tanpa merusak startup server.
> **Alternatif serupa:** Token dapat dibaca dari file/secret manager, tetapi variabel env adalah standar.
> **Kalau tidak pakai ini:** Server akan crash saat mencoba mengirim pesan Telegram tanpa token.
<!-- annot:tg_getbot -->
`routes/send.js` mengekspos `/api/send/telegram` dan `/api/send/all`; endpoint `/telegram/status` melaporkan `configured: !!process.env.TELEGRAM_BOT_TOKEN`, sehingga UI dapat menyembunyikan aksi bila tidak dikonfigurasi.

**Koneksi WhatsApp** (`whatsapp-bot/src/connection.js:42-60`). Menggunakan `whatsapp-web.js` (LocalAuth + puppeteer headless), mendaftarkan handler `qr`/`ready`/`disconnected`/`auth_failure`/`message`, dan menyambung ulang otomatis dengan exponential backoff dibatasi di 5 menit.

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

> **Apa kerjanya:** Menginisialisasi klien `whatsapp-web.js` dengan `LocalAuth` + puppeteer headless, lalu mendaftarkan handler `qr`/`ready`/`disconnected`/`auth_failure`/dst dan sambung-ulang otomatis.
> **Dampak:** Koneksi WhatsApp persisten dengan sesi tersimpan dan QR untuk pairing; saat putus ia sambung ulang otomatis.
> **Alternatif serupa:** Baileys dapat digunakan, tetapi repo sudah menggunakan whatsapp-web.js.
> **Kalau tidak pakai ini:** Tidak ada koneksi/QR WhatsApp, sehingga jembatan tidak berfungsi.
<!-- annot:wa_connection -->
**Pemicu kata kunci / hastag** (`whatsapp-bot/src/listener.js:123-131`). Listener hanya menyala bila sebuah video dikutip (atau dikirim) bersama kata kunci terkonfigurasi (mis. `save`) atau hastag (mis. `#upload`).

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

> **Apa kerjanya:** Memeriksa apakah sebuah pesan berisi pemicu kata kunci atau hastag, dan hanya menyala bila video dikutip/dikirim bersama pemicu tersebut.
> **Dampak:** Memfilter pesan sehingga hanya media + perintah tertentu yang diproses (mis. simpan video), mencegah aksi sewenang-wenang.
> **Alternatif serupa:** Perintah regex global dapat digunakan, tetapi pemeriksaan kata kunci/hastag per-pesan lebih terarah.
> **Kalau tidak pakai ini:** Semua pesan video akan diproses tanpa filter, memicu unggahan yang tidak diinginkan.
<!-- annot:wa_listener -->
### 8.9 Cache Video (`routes/videoCache.js`)

Dipasang di `/api/video-cache`. Menyediakan pembukuan cache video (util `videoCache.js` melacak segmen/derivat video cache). Konsultasikan endpoint langsung untuk surface yang tepat.

---

### 8.10 Metadata (`utils/metadataWriter.js`, `musicbrainz.js`, `lrclib.js`)

**Penanaman cover art** (`metadataWriter.js:74-111`). String perintah `ffmpeg`/`python3` per-format. FLAC menggunakan `embed_cover.py` yang di-spawn; MP3/OGG/Opus/M4A/WebM menggunakan `ffmpeg` dengan flag disposition/container yang sesuai, menulis ke `.tmp` lalu rename atomik.

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

> **Apa kerjanya:** Menulis buffer gambar ke berkas temp lalu menanamkan cover via `embed_cover.py` (FLAC) atau `ffmpeg` per-format (mp3/ogg/opus/m4a/webm) ke berkas `.tmp`, lalu rename atomik.
> **Dampak:** Cover art disimpan di dalam berkas audio/video tanpa merusak asli (rename atomik), mendukung banyak format.
> **Alternatif serupa:** `music-metadata` dapat digunakan untuk menulis tag, tetapi ffmpeg/python menangani cover gambar lintas format.
> **Kalau tidak pakai ini:** Perubahan cover tidak disimpan ke berkas, sehingga metadata cover hilang saat dibaca ulang.
<!-- annot:meta_embedcover -->
**MusicBrainz / Cover Art Archive** (`musicbrainz.js:43-56`, `72-93`). `getCoverArt` menyerang Cover Art Archive untuk MBID rilis; `searchCoverArt` mencoba pencarian rekaman dulu, lalu fallback ke artis+album, lalu artis saja.

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

> **Apa kerjanya:** Membangun URL Cover Art Archive dari MBID rilis lalu mengambil gambar depan via `mbFetch`.
> **Dampak:** Menyediakan sumber cover art MusicBrainz resmi untuk pencarian metadata.
> **Alternatif serupa:** Penyedia cover lain (mis. iTunes) dapat digunakan, tetapi CAA terikat pada MBID yang sudah diverifikasi.
> **Kalau tidak pakai ini:** Pencarian cover art tidak memiliki sumber resmi berdasarkan MBID MusicBrainz.
<!-- annot:mb_getcoverart -->
**Lirik LRCLIB** (`lrclib.js:22-44`). `getLyrics` melakukan pencarian persis track/artist/durasi (timeout `AbortController` 5 dtk); `searchLyricsByMetadata` fallback ke pencarian teks bebas.

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

> **Apa kerjanya:** Membangun kueri LRCLIB dari track/artist/album/durasi lalu mengambil lirik polos dan tersinkron via `lrclibFetch`.
> **Dampak:** Mengambil lirik (polos/tersinkron) untuk ditampilkan di pemutar audio.
> **Alternatif serupa:** Genius/NetEase dapat digunakan, tetapi LRCLIB fokus pada LRC terstruktur gratis.
> **Kalau tidak pakai ini:** Fitur lirik tidak diisi dari sumber LRCLIB.
<!-- annot:lrclib_getlyrics -->

---
## 9. Arsitektur Frontend

Frontend adalah SPA React 18 yang dibangun dengan Vite 5, Tailwind 3.4, Zustand 5.0, hls.js 1.5, recharts 3.8, framer-motion 12.40, lucide-react 1.16, react-window 1.8.

### 9.1 Entri & Shell

- `src/main.jsx` memasang `<App/>` di dalam `<DebugProvider>`; merender `#root`.
- `src/App.jsx` (~2000+ baris) membungkus semuanya dalam **ErrorBoundary** (anti-layar-kosong) dan mengimplementasikan **routing berbasis hash** (lihat di bawah).
- Perlu dicatat, `react-router-dom` (v7) **digunakan** untuk sub-routing dasbor Pemantauan (`MemoryRouter`/`Routes`/`Route` di `components/MonitoringView.jsx` dan `monitoring/layout/*`). Navigasi aplikasi tingkat atas (di luar Pemantauan) tetap merupakan mesin status hash kustom via `parseHash()` + `sessionStorage`.

### 9.2 Routing (Mesin Status Hash Kustom)

`App.jsx` mem-parse `location.hash` dan mempertahankan tampilan saat ini di `sessionStorage`. Contoh rute:

|  Hash                        |  Tipe Rute               |
|----------------------------|-------------------------|
|  `#media`                    |  grid media (root)        |
|  `#media/v/{id}`             |  video dari root          |
|  `#f/{folderId}`             |  folder                   |
|  `#f/{folderId}/v/{fileId}`  |  berkas (video di folder) |
|  `#monitoring`               |  pemantauan               |
|  `#monitoring/{subPath}`     |  pemantauan dengan subpath |
|  `#downloader`               |  pengunduh                |
|  `#adb`                      |  transfer ADB             |
|  `#playlists`                |  daftar putar             |
|  `#playlist-detail`          |  detail daftar putar      |
|  `#audio`                    |  pemutar audio            |
|  `#scrcpy`                   |  mirror scrcpy            |

### 9.3 Store Zustand (6)

|  Store                  |  Jalur                                    |  Persistensi               |
|------------------------|----------------------------------------|--------------------------|
|  `favoritesStore`        |  `store/favoritesStore.js`              |  localStorage (`persist`)  |
|  `monitoringStore`       |  `monitoring/stores/monitoringStore.js`  |  memory (partial)          |
|  `playbackStore`         |  `store/playbackStore.js`                |  memory                    |
|  `playlistStore`         |  `store/playlistStore.js`                |  localStorage (`persist`)  |
|  `folderSortStore`       |  `store/folderSortStore.js`              |  localStorage (`persist`)  |
|  `folderMetaSortStore`   |  `store/folderMetaSortStore.js`          |  localStorage (`persist`)  |
|  `useDebugStore`         |  `debug/useDebugStore.js`                |  memory                    |

### 9.4 Model Komunikasi

- **REST:** klien pusat `src/utils/api.js` dengan dedupe in-flight + cache 2 dtk; base URL `import.meta.env.VITE_API_URL || ''`.
- **WebSocket:** `ws://<host>/ws/monitor` (atau `wss`) via `src/hooks/useWebSocket.js` — auto-reconnect dengan backoff, heartbeat, dan **loop polling fallback** `GET /api/monitoring/stats` (1 dtk foreground / 15 dtk background).
- **SSE:** untuk streaming log/tugas/sesi — lihat §7.14.

### 9.5 UI Menonjol

- Pemutar audio multi-mode (penuh / cover / lirik / video-split), lirik LRC tersinkron.
- Video adaptif HLS via hls.js; grid media ter-virtualisasi via react-window.
- Mirror scrcpy Android + UI transfer ADB.
- Dasbor pemantauan lengkap (gauge CPU/GPU/RAM/disk/jaringan/sistem + bagan via recharts, proses, layanan, docker, sesi, tugas, antrean, alert, terminal log).
- Toolkit debug/inspeksi bawaan (`src/debug/`).

### 9.6 Proxy Dev Vite

Server dev `vite` mem-proxy ke `http://127.0.0.1:3001`: `/api`, `/stream`, `/file`, `/thumbnails`, `/ws` (ws), dan `/api/audio` → `/stream/audio`.

### 9.7 Kode Frontend (ringkasan)

> Source lengkap verbatim dihapus demi keterbacaan. Frontend adalah SPA React 18 + Vite 5 (lihat `frontend/src/App.jsx`, `frontend/src/main.jsx`, `frontend/vite.config.js`):

- **Entri / shell** — `main.jsx` memasang `<App/>`; `App.jsx` mengimplementasikan router hash kustom dan tata letak tingkat atas (sidebar, grid media, pemutar, pemantauan).
- **State** — enam store Zustand (`useLibraryStore`, `usePlayerStore`, `useSettingsStore`, `useMonitoringStore`, `useUiStore`, `useSendStore`).
- **Comms** — REST via `fetch` ke `/api/*`, plus WebSocket (`/ws`) dan SSE (`/api/logs/stream`, `/api/whatsapp/logs/stream`) untuk pembaruan langsung.
- **Pemutaran** — video HTML5 dengan range/HLS (`hls.js`) dan audio HTML5 dengan waveform + lirik LRC tersinkron.
- **Proxy dev** — `vite.config.js` mem-proxy `/api`, `/stream`, `/file`, `/thumbnails`, `/ws` ke `https://127.0.0.1:3001`.

## 10. Diagram Alur

### 10.1 Alur Permintaan

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

### 10.2 Alur Pemindaian Berkas

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

### 10.3 Alur Pemutaran

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

### 10.4 Alur Unduh

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

### 10.5 Alur Pemantauan

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

### 10.6 Grafik Panggilan Subsistem Pemantauan

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

### 10.7 Grafik Panggilan Subsistem Pemutaran

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

### 10.8 Grafik Panggilan Subsistem Pindai

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

### 10.9 Grafik Panggilan Subsistem Unduh

```
routes/downloader.js
└── downloader/manager.js
    ├── createTask()               → task creation
    ├── processTask()              → yt-dlp/gallery-dl/aria2c spawn
    ├── postProcessFile()          → move/embed
    └── SOURCE_ROUTES map          → YouTube/TikTok/Instagram/Twitter/Torrent paths
```

---
## 11. Konfigurasi & Jalur

**Berkas:** `backend/src/config/paths.js`

`PROJECT_ROOT` berada **4 level di atas** `config/`. Semua direktori cache/log di bawah `cache/` dan `logs/` dibuat otomatis. Getter `PATHS`:

|  Getter               |  Diresolusi Ke                          |
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
|  `mediaRoot`          |  `MEDIA_ROOT` pertama                   |

Getter `SETTINGS` dengan default nyata:

|  Konstanta             |  Default         |  Sumber                                  |
|----------------------|----------------|---------------------------------------|
|  `maxCacheSizeBytes`   |  10 GiB          |  `playback.maxCacheSizeGB ?? 10`        |
|  `maxCacheAgeMs`       |  30 hari         |  `playback.maxCacheAgeDays ?? 30`       |
|  `cleanupIntervalMs`   |  24 jam          |  `playback.cleanupIntervalHours ?? 24`  |
|  `probeTimeoutMs`      |  15000 ms        |  `playback.probeTimeoutMs ?? 15000`     |
|  `lruEnabled`          |  true            |  `playback.lruEnabled ?? true`          |
|  `logLevel`            |  'info'          |  `playback.logLevel ?? 'info'`          |
|  `hlsSegmentDuration`  |  3 (hardcoded)   |  Panjang segmen HLS                      |
|  `shutdownTimeoutMs`   |  30000 ms        |  `playback.shutdownTimeoutMs ?? 30000`  |

---

## 12. Variabel Lingkungan

|  Variabel                |  Default                      |  Digunakan Oleh                                            |  Catatan                                            |
|------------------------|----------------------------|---------------------------------------------------------|---------------------------------------------------|
|  `PORT`                  |  3001                        |  server.js                                                |  Port HTTP/WS; retry 3002–3006 pada `EADDRINUSE`    |
|  `MEDIA_ROOT`            |  `/home/CATIAA/homelab`      |  server.js, fileScanner.js, uploadManager.js, upload.js   |  Daftar dipisahkan titik dua didukung (split on `:`)|
|  `MAX_CONCURRENT_DOWNLOADS` |  3                        |  downloader/manager.js                                    |  Batas konkuren yt-dlp/gallery-dl                  |
|  `TELEGRAM_BOT_TOKEN`    |  (tidak disetel)             |  telegramBot.js, routes/send.js                           |  Bila absen, kirim Telegram dinonaktifkan          |
|  `TELEGRAM_CHAT_ID`      |  `<telegram_chat_id_anda>`   |  routes/send.js, telegramBot.js                           |  Chat target default (disetel via env)             |
|  `MONITOR_DISABLE_GPU`   |  (tidak disetel)             |  monitor/collectors/gpu.js                                |  Apa pun yang truthy → collector GPU mengembalikan null |
|  `DISPLAY`               |  `:0`                        |  routes/scrcpy.js                                         |  Diteruskan ke anak scrcpy                          |
|  `TARGET_CHAT_JID`       |  `<whatsapp_chat_jid_anda>`  |  whatsapp-bot/config.js                                   |  Chat target WhatsApp                              |
|  `ALLOWED_GROUPS`        |  (tidak disetel)             |  whatsapp-bot/config.js                                   |  Grup yang diizinkan dipisahkan koma               |

> **Catatan:** Berkas `.env` ada di root repo (berisi rahasia — jangan pernah commit). Backend menggunakan `--env-file-if-exists=.env` (opsional). Default `MEDIA_ROOT` adalah jalur tunggal; bila beberapa diberikan, mereka dipisahkan pada `:`.

---

## 13. Pekerjaan Latar Belakang / Penjadwal

|  Pekerjaan           |  Interval                 |  Fungsi                              |
|---------------------|-------------------------|------------------------------------|
|  WAL checkpoint       |  60 mnt                  |  `PRAGMA wal_checkpoint(TRUNCATE)`   |
|  Pembersihan yatim    |  10 mnt                  |  Hapus rekam DB untuk berkas hilang  |
|  Pengayaan metadata   |  10 mnt                  |  backfill durasi ffprobe             |
|  Analitik            |  24 j                    |  `PRAGMA ANALYZE`                    |
|  Pembersihan metrik   |  24 j                    |  Hapus baris historis lama           |
|  Pembersihan pemutaran |  24 j                  |  Pengusiran LRU                       |
|  FS watcher          |  5 dtk periodik + debounce |  Pemicu pindai inkremental         |

---

## 14. Kinerja, Memori, Disk, Konkurensi

### 14.1 Optimasi Kunci (Diimplementasikan)

|  Lapisan      |  Optimasi                    |  Dampak                       |
|------------|---------------------------|-----------------------------|
|  Basis data   |  API sinkron (better-sqlite3) |  Tanpa overhead async         |
|  Basis data   |  Mode WAL                    |  Baca konkuren                |
|  Basis data   |  Cache 80MB + mmap 4GB       |  Working set besar di memori  |
|  Pemantauan   |  Collector async + cache     |  Pembacaan sensor non-blokir  |
|  Thumbnail    |  Antrean berbatas-konkuren   |  Paralelisme terkendali       |

### 14.2 Bottleneck Diketahui

|  Komponen            |  Masalah                          |  Mitigasi                 |
|--------------------|---------------------------------|-------------------------|
|  Pembersihan yatim   |  Pindai tabel penuh + existsSync  |  Pemrosesan batch         |
|  Penghitungan rekursif |  CTE penuh setiap 5 mnt         |  Async latar belakang     |
|  Unduh Instagram    |  Workspace sekuensial             |  1 konkuren + jeda 12 dtk |

### 14.3 Model Threading & Async

|  Komponen               |  Model Threading                                                  |
|-----------------------|-----------------------------------------------------------------|
|  Basis data             |  Proses tunggal, API sinkron (better-sqlite3)                      |
|  Server HTTP            |  Event loop Node.js tunggal                                        |
|  Collector pemantauan   |  Pembacaan sinkron dengan cache in-memory (pembacaan sensor di-fork)|
|  Pembuatan thumbnail    |  Antrean async, konkurensi dapat diatur (default: 32)              |
|  Transfer ADB           |  Worker latar belakang via adbWorkerPool.js (paralel: 3)           |
|  Tugas unduh            |  Dikelola oleh downloader/manager.js (maks konkuren: 3)            |

### 14.4 Pola Penggunaan Memori

|  Subsystem          |  Profil Memori                            |
|------------------|-----------------------------------------|
|  Cache SQLite      |  ~80MB page cache + mmap virtual 4GB      |
|  Cache pemutaran   |  Dikelola LRU, maks 10GB default          |
|  Cache thumbnail   |  Direktori datar, tumbuh dengan ukuran pustaka |
|  Store pemantauan  |  ~500 baris buffer deret waktu           |

### 14.5 Penggunaan Disk

|  Lokasi             |  Pola Penggunaan                      |
|--------------------|-------------------------------------|
|  `data/media.db`     |  SQLite WAL, tumbuh dengan pustaka    |
|  `cache/playback/`   |  Transien, dibersihkan oleh LRU       |
|  `cache/hls/`        |  TTL 60 mnt, dibersihkan pemeliharaan |
|  `data/thumbnails/`  |  Permanen, tidak pernah di-evict otomatis |

### 14.6 Batas Konkurensi

|  Subsystem    |  Batas                |  Sumber                        |
|-------------|---------------------|------------------------------|
|  Unduhan      |  3 konkuren           |  `MAX_CONCURRENT_DOWNLOADS`    |
|  Instagram    |  1 konkuren           |  Pipeline Instagram            |
|  Thumbnail    |  32 konkuren          |  setelan `thumb.concurrent`    |
|  Worker ADB   |  3 konkuren / tugas   |  opsi `max_workers`            |
|  Unggah       |  4 konkuren           |  setelan `upload.concurrent`   |

---

## 15. Keamanan & Produksi

### 15.1 Autentikasi

|  Area         |  Status                       |
|-------------|-----------------------------|
|  API          |  Tidak ada (jaringan LAN/tepercaya) |
|  WebSocket    |  Tidak ada (endpoint WS)       |
|  SSE          |  Tidak ada                     |
|  Akses berkas |  Dibatasi ke `MEDIA_ROOT`      |

### 15.2 Reverse Proxy yang Disarankan

Untuk akses eksternal, letakkan di belakang Caddy/Traefik dengan:
- Autentikasi OAuth atau mTLS
- Pembatasan laju untuk endpoint API
- Terminasi TLS

### 15.3 Perlindungan Akses Berkas

- Semua jalur berkas diresolusi via `getRelPath()` + `resolveFullPath()`
- Hash MD5 sebagai ID mencegah injeksi jalur
- Pembatasan `MEDIA_ROOT` ditegakkan di pemindai
- Sanitasi nama berkas: menghapus `..`, `/`, `\`, `\0`, maks 255 karakter

### 15.4 Sidecar Docker

Docker **tidak** digunakan untuk mengontainerisasi backend. Ia hanya menampung dua sidecar opsional (lihat §16). Tidak ada lapisan auth secara default — API terbuka di LAN; reverse proxy diperlukan untuk ekspos eksternal.

### 15.5 Konfigurasi Yatim / Tidak Digunakan

`Docker/litellm-config.yaml` **ada tetapi YATIM (ORPHANED)** — tidak di-mount oleh `docker-compose.yml` dan tidak ada layanan litellm. Jangan asumsikan ada proxy LLM aktif.

---

## 16. Penyebaran

### 16.1 Backend (Proses Node Asli)

Backend server media **tidak** di-kontainerisasi. Jalankan langsung:

```bash
cd backend && npm install && npm start
# listens on 0.0.0.0:3001 (retries 3002–3006 on EADDRINUSE)
```

Frontend adalah SPA statis yang disajikan oleh Express (dibangun via `vite build`, atau dijalankan dengan `vite --host 0.0.0.0` di dev).

### 16.2 Hanya Sidecar Docker

**Berkas:** `Docker/docker-compose.yml`

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

- **waha** — API WhatsApp (devlikeapro/waha). Pendamping opsional untuk jembatan WhatsApp.
- **nginx-nvidia** — reverse proxy + pembatas laju ke `https://integrate.api.nvidia.com`: batas laju **39 req/mnt per IP**, burst 5, mengembalikan **429**; menambahkan `X-RateLimit-Source: nginx` dan `Retry-After: 5`; meneruskan `Authorization`/`Content-Type`/`Host`; `proxy_ssl_server_name on`.

> **Catatan:** `litellm-config.yaml` ada di `Docker/` tetapi **tidak** di-mount dan tidak ada layanan litellm — anggap tidak digunakan.

### 16.3 Jalur Diabaikan / Dapat Di-commit

Berikut adalah jalur yang tidak di-commit (cache, logs, sesi) dan jalur yang harus di-waspadai (data, Docker/waha-data):

### 16.4 Daftar Periksa Produksi

|  Tugas                     |  Deskripsi                                                                         |
|-------------------------|----------------------------------------------------------------------------------|
|  Variabel lingkungan       |  Setel `PORT`, `MEDIA_ROOT`, `MAX_CONCURRENT_DOWNLOADS`                            |
|  Inisialisasi basis data   |  Jalankan pindai pertama via `/api/refresh`                                        |
|  Reverse proxy            |  Konfigurasi Caddy/Traefik untuk terminasi TLS + auth                             |
|  Penyiapan pemantauan      |  Konfigurasi ambang batas alert                                                   |
|  Strategi cadangan         |  Jadwalkan cadangan WAL SQLite                                                    |
|  Rahasia                  |  Pastikan `data/` dan `Docker/waha-data/` dikecualikan dari VCS bila berisi state |

---

## 17. Penanganan Kesalahan & Mode Kegagalan

### 17.1 Pemutaran

|  Skenario                      |  Penanganan                                 |
|------------------------------|------------------------------------------|
|  Kegagalan ffprobe             |  Fallback ke transcode, cache miss         |
|  Kegagalan remux FFmpeg        |  Log error, kembalikan status error        |
|  Disk cache penuh             |  Usir entri terlama (LRU)                  |
|  Entri cache rusak            |  Lewati saat validateIntegrity(), regenerate |
|  Permintaan berkas sama konkuren |  Dedup via Map activeJobs                |

### 17.2 Pemindai

|  Skenario               |  Penanganan                        |
|-----------------------|----------------------------------|
|  Akses berkas ditolak   |  Log peringatan, lanjut pindai     |
|  Error fs.watch         |  Log, pertahankan watcher lain hidup |
|  SQLite terkunci        |  busy_timeout=5000, retry          |
|  Metadata berkas invalid |  Lewati thumbnail untuk berkas itu  |

### 17.3 Pemantauan

|  Skenario                     |  Penanganan                               |
|-----------------------------|-----------------------------------------|
|  Timeout nvidia-smi           |  Kembalikan null, gunakan nilai cache     |
|  smartctl tidak tersedia      |  Widget disk hanya tampil info partisi    |
|  Timeout collector (3 dtk)    |  Set hasil ke null, lanjut               |
|  Klien WebSocket putus        |  Pembersihan zombie setiap 30 dtk         |

### 17.4 Pengunduh

|  Skenario                        |  Penanganan                              |
|--------------------------------|----------------------------------------|
|  Error jaringan                   |  Retry maks 3 dengan exponential backoff |
|  Error konten (age-restricted)   |  Gagal segera, tanpa retry               |
|  Unduhan parsial                 |  Lanjut via checksum                     |
|  Kegagalan pembersihan workspace |  Deteksi yatim via pemindai              |

---

## 18. Detail Dasbor Pemantauan

### 18.1 Arsitektur Collector

|  Collector   |  Sumber                                |  Cache TTL                   |
|------------|--------------------------------------|----------------------------|
|  cpu.js      |  /proc/stat, /sys/devices/system/cpu   |  freq: 5 dtk, temp: 3 dtk     |
|  memory.js   |  /proc/meminfo                         |  Tidak ada                   |
|  gpu.js      |  nvidia-smi                            |  3 dtk                       |
|  disk.js     |  statvfs, smartctl                     |  SMART: 60 dtk, partisi: 30 dtk |
|  network.js  |  /sys/class/net, /proc/net/fib_trie    |  iface: 10 dtk, fib: 30 dtk   |
|  system.js   |  /proc/uptime, uname                   |  who: 10 dtk, systemctl: 15 dtk |

**Interval poll engine:** **3000ms** (`pollIntervalMs` di `engine.js`). **Throttle siaran:** **3000ms** (`BROADCAST_THROTTLE_MS`). **Interval snapshot:** **30000ms** (metrik historis setiap 30 dtk). Setelan dasbor `monitor.refreshInterval` (default 1000ms) adalah interval **fallback polling frontend**, bukan poll backend.

### 18.2 Format Pesan WebSocket

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

### 18.3 Logika Ambang Batas Alert (`monitor/alerts.js`)

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

### 18.4 Widget Dasbor

|  Widget         |  Berkas                                   |  Sumber Data                    |
|---------------|-----------------------------------------|-------------------------------|
|  CpuWidget      |  `monitoring/widgets/CpuWidget.jsx`       |  Collector CPU + freq per-core |
|  MemoryWidget   |  `monitoring/widgets/MemoryWidget.jsx`    |  Collector RAM + swap          |
|  DiskWidget     |  `monitoring/widgets/DiskWidget.jsx`      |  Collector disk + SMART        |
|  GpuWidget      |  `monitoring/widgets/GpuWidget.jsx`       |  Collector GPU (nvidia-smi)    |
|  NetworkWidget  |  `monitoring/widgets/NetworkWidget.jsx`   |  Collector network             |
|  SystemWidget   |  `monitoring/widgets/SystemWidget.jsx`    |  Collector system              |
|  MiniGauge      |  `monitoring/widgets/MiniGauge.jsx`       |  DOM langsung, transisi CSS     |

---

## 19. Ekstensi Masa Depan / Peta Jalan

### 19.1 Opsi Skalasi Arsitektur

|  Opsi                |  Deskripsi                                               |  Upaya  |
|----------------------|--------------------------------------------------------|--------|
|  Multi-proses         |  Pisahkan pemantauan/unduh/pemindai ke proses terpisah   |  Tinggi |
|  Sharding thumbnail   |  256 subdirektori untuk kinerja filesystem               |  Sedang |
|  Transcode perangkat keras |  NVENC/Intel QuickSync untuk H.264                   |  Sedang |
|  DB jarak jauh        |  PostgreSQL/MySQL untuk akses jaringan                   |  Tinggi |
|  Klaster WebSocket    |  Beberapa instance server dengan sesi sticky            |  Tinggi |

### 19.2 Fitur Direncanakan

|  Fitur                   |  Status    |  Catatan                          |
|-------------------------|----------|---------------------------------|
|  Pemantauan GPU AMD       |  Dicadangkan |  Saat ini hanya NVIDIA          |
|  Encoder perangkat keras  |  Dicadangkan |  Butuh deteksi NVENC/QSV        |
|  Autentikasi OAuth        |  Dicadangkan |  Untuk akses eksternal           |
|  Sumber unduh plugin      |  Dicadangkan |  Abstraksi wrapper yt-dlp        |
|  Sharding thumbnail       |  Dicadangkan |  id % 256 untuk 256 subdirektori |

> **Catatan:** Lihat `docs/archive/ideas/IDEAS.md` untuk peta jalan berwibawa (Auth, Lanjutkan Pemutaran, Subtitle Eksternal, dll.). Item di atas merangkum ide yang sering dirujuk.

---

## 20. Catatan Pengembangan

### 20.1 Menambah Endpoint API Baru

1. Tambah penangan rute di `backend/src/routes/*.js`
2. Bila butuh DB: tambah prepared statement di `db.js`
3. Tambah kunci setelan di `deferredDbInit()` bila dapat dikonfigurasi
4. Uji endpoint dengan curl/postman
5. Perbarui README.md (dan READMEID.md) dengan spesifikasi endpoint

### 20.2 Menambah Sumber Pengunduh Baru

1. Tambah entri ke `SOURCE_ROUTES` di `manager.js`
2. Buat direktori output `mkdirSync` di blok init
3. Tambah opsi kualitas ke `QUALITY_MAP`
4. Tambah pemilih format bila perlu di `SOURCE_FORMAT_PREFERENCE`
5. Uji dengan URL nyata

### 20.3 Menambah Aturan Pemutaran Baru

1. Modifikasi `getPlaybackDecision()` di `playbackEngine.js`
2. Tambah konstanta baru (REGEX) di awal berkas
3. Tambah fungsi penangan (`handleNewRule`)
4. Perbarui logika pembersihan bila perlu
5. Tambah pelacakan stat untuk aksi baru

### 20.4 Menambah Collector Pemantauan Baru

1. Buat `backend/src/monitor/collectors/<name>.js` yang mengekspor fungsi `collect()`
2. Daftarkan di `collectAll()` milik `monitor/engine.js`
3. Tambah agregasi + field WS
4. Tambah widget dasbor di `frontend/src/monitoring/widgets/`

---

## 21. Perintah Debug / Operasi

### 21.1 Debug Pemutaran

```bash
# Periksa cache
ls -la cache/playback/remux/
ls -la cache/playback/transcode/

# Lihat stat
curl http://localhost:3001/api/playback/stats

# Periksa codec
ffprobe -v quiet -show_streams -show_format /path/to/file
```

### 21.2 Debug Pemindai

```bash
# Jalankan pindai inkremental
curl -X POST http://localhost:3001/api/refresh

# Periksa FTS
sqlite3 data/media.db "SELECT * FROM files_fts LIMIT 10;"

# Periksa yatim
curl http://localhost:3001/api/files/stats
```

### 21.3 Pemantauan

```bash
# Periksa koneksi WebSocket
wscat -c ws://localhost:3001/ws/monitor

# Verifikasi data collector
curl http://localhost:3001/api/monitoring/stats

# Uji ambang batas alert
curl -X POST http://localhost:3001/api/monitoring/alerts/check
```

### 21.4 Log Backend

```bash
# Aliran log langsung (SSE)
curl -N http://localhost:3001/api/logs/stream

# Log jembatan WhatsApp (SSE)
curl -N http://localhost:3001/api/whatsapp/logs/stream
```

---

## 22. Lampiran: Metrik Basis Kode

Jumlah dihitung dari sumber pada **2026-07-14** (rekursif, `node_modules` dikecualikan). Menggantikan angka perkiraan sebelumnya.

|  Modul                      |  Berkas  |         LOC  |
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
|  **Total backend**           |         |  **21,409**  |
|  **Total frontend**          |         |  **28,093**  |
|  **Bot WhatsApp**            |         |     **794**  |
|  **Total keseluruhan**       |         |  **50,296**  |

---

## 23. Lampiran: Riwayat Versi

|  Versi    |  Tanggal      |  Perubahan                                                                                                                                                                                                                                                                                                                                                                                                             |
|----------|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|  Doc v3.1  |  2026-07-14  |  Pembersihan dokumentasi: menghapus 3 `ARCHITECTURE copy*.md` dan `fix_architecture.py` duplikat; mengarsipkan dok scratch/debug ke `docs/archive/`. Memperbaiki SoT vs kode: menambah dependensi frontend yang hilang (`qrcode`, `source-map-js`), memperbaiki catatan penggunaan `react-router-dom`, memperjelas `utils/` = 38 `.js` + 3 `.py`, memperbaiki bagian variabel env (`.env` ada; placeholder chat ID), menambah lampiran Metrik Basis Kode yang akurat.  |
|  Doc v3.0  |  2026-07-08  |  Diverifikasi terhadap basis kode; memperbaiki jumlah rute (19), poll pemantauan (3000ms), status tertanam WhatsApp, jalur `registry.js`/`downloader/manager.js`, menambah `webStats.js` + worker forked, kolom `youtube_id`/`video_offset`, daftar indeks lengkap, tabel dependensi, arsitektur frontend, variabel env. Versi basis kode: backend 1.0.0, frontend 1.0.0.                                                              |
|  2.4.0     |  2026-07-05  |  Revisi dokumen sebelumnya (catatan: "2.4.0" merujuk hanya ke dokumentasi, bukan aplikasi).                                                                                                                                                                                                                                                                                                                             |
|  2.3.0     |  2026-07-02  |  Dokumentasi komprehensif awal.                                                                                                                                                                                                                                                                                                                                                                                |
