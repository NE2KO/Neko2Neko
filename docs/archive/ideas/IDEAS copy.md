# Feature Ideas — Media Vault

> **Audience:** 1 user, 2–3 devices (laptop + HP + maybe TV)
> **Goal:** Fitur yang benar-benar berguna, tanpa beban maintenance yang tidak perlu
> **Last updated:** 2026-06-28

---

## Legend

| Tag | Meaning |
|-----|---------|
| 🔴 WAJIB | Harus ada, fundamental missing piece |
| 🟡 OPSIONAL | Bagus ada, tapi tidak daily-critical |
| 🟢 OVERKILL | Kebanyakan untuk 1 user, effort tidak sebanding |

---

## 🔴 WAJIB

### 1. Authentication (Basic Auth / PIN)
**Effort:** Kecil–sedang

**What:** Siapa pun yang buka `localhost:3001` bisa akses semua media, playlist, setting, dan downloader. Kalau expose ke Tailscale/WireGuard atau VPN, ini lubang keamanan besar.

**Proposal:**
- Basic Auth header check di Express middleware
- Atau PIN entry di frontend yang disimpan di `sessionStorage`
- Bisa plus allowlist IP LAN saja

**Why:** Tanpa auth, satu orang yang nemu port 3001 bisa hapus semua data atau ubah setting.

---

### 2. Resume Playback (Continue Watching)
**Effort:** Sedang–besar

**What:** Simpan posisi terakhir tiap file (`position_ms`, `last_watched_at`). Saat buka file yang pernah ditonton, resume dari posisi itu. Sync antar device.

**Proposal:**
- Tabel DB baru `watch_history(file_id, position_ms, last_watched_at, device)`
- Saat `<video>` / `<audio>` seek/duration change → debounce 5 detik → save ke DB
- Saat buka file yang ada history → auto-seek ke posisi tersimpan
- Tampilkan "Continue watching" section di folder root atau halaman khusus

**Why:** Saat ini nonton di laptop, tinggal buka di HP → ulang dari detik 0. Ini fitur yang paling dirasakan missing di setiap media server.

---

### 3. External Subtitles (SRT / ASS / VTT)
**Effort:** Sedang

**What:** Saat ini server hanya serve video + thumbnail. Subtitle file yang namanya match (e.g., `video.mp4` + `video.srt`) tidak dilayani secara otomatis.

**Proposal:**
- Saat scan file, juga daftarin `.srt/.ass/.vtt` yang cocok nama di folder yang sama
- Route baru: `/api/subtitles/:fileId` atau serve sebagai static dengan content-type yang benar
- Frontend `<video>` player expose subtitle track via `TextTrack` + `<track>` element
- Atau minimal: download subtitle button di modal

**Why:** Tanpa subtitle, film/series luar dengan subtitle terpisah tidak bisa ditonton langsung dari UI.

---

### 4. Direct Download Button
**Effort:** Kecil

**What:** Downloader page ada untuk yt-dlp, tapi tidak ada cara download file yang SUDAH ada di library secara langsung dari grid/media modal.

**Proposal:**
- Tambah icon download di `MediaGrid` item (hanya untuk file, bukan folder)
- Click → `GET /file/:id` dengan `Content-Disposition: attachment`
- Atau: context menu ("Download", "Copy stream URL", "Open external")

**Why:** Saat ini untuk download file yang ada di library, user harus buka debug tools / coba URL manual.

---

### 5. Subtitle Search & Download (UI)
**Effort:** Sedang

**What:** Buka file → tidak ada subtitle → user bisa search subtitle langsung dari modal (OpenSubtitles, Subscene, atau manual URL paste).

**Proposal:**
- Di `MediaModal`, tambah section "Subtitles"
- Input: search query (auto-fill dari filename) + "Search" + "Paste URL"
- Download `.srt` → simpan di folder yang sama → auto-scan detect
- Tampilkan list subtitle yang tersedia, pilih yang mau dipakai

**Why:** Tanpa subtitle search UI, user harus download subtitle secara manual lewat browser, lalu letak secara manual.

---

### 6. File / Folder Rename & Move
**Effort:** Sedang

**What:** Tidak ada cara rename atau pindah file/folder dari UI. Kalau mau rename, harus lewat OS filesystem langsung.

**Proposal:**
- Rename: `POST /api/files/:id/rename` + `POST /api/folders/:id/rename`
- Move: `POST /api/files/:id/move` dengan target folder
- UI: edit button di modal header, atau drag-drop antar folder
- Update DB `name`, `path`, `dir_id` + FTS reindex

**Why:** Organize library tanpa keluar dari browser. After rename, watcher akan detect change dan update DB.

---

### 7. Watched / Unwatched Status per File
**Effort:** Kecil–sedang

**What:** Tidak ada tracking "sudah ditonton" atau "belum". Saat ini video 1 jam yang udah ditonton sampai habis, tidak ada penanda.

**Proposal:**
- Tabel `watch_history` + flag `watched` (boolean) + `completed_at`
- Saat video selesai (ended event) → mark as watched
- Tampilkan badge/indicator di grid item (centang hijau, atau overlay)
- Filter "Show watched / unwatched only" di sidebar

**Why:** Berguna buat episodic content (tv show) atau buat inget mana yang sudah ditonton.

---

## 🟡 OPSIONAL

### 8. Watchlist / Favorites
**Effort:** Kecil

**What:** Tandai file sebagai "favorite" atau "ingin ditonton". Tampilkan di view khusus atau filter di grid.

**Proposal:**
- Tabel kecil `favorites(file_id, created_at)` atau reuse `playlists` dengan fixed name `__favorites__`
- Toggle favorite via icon di grid / modal
- View khusus: `#/favorites` atau filter di sidebar

---

### 9. "Recently Added" Smart View
**Effort:** Kecil

**What:** Otomatis tampilkan file yang baru ditambahkan (misal 7 hari terakhir), tanpa perlu buka folder tertentu.

**Proposal:**
- Query DB: `WHERE created_at > now() - 7 days` + cursor pagination
- Tampilkan sebagai section di home (`#/media`) atau tab khusus "New"
- Bisa combine dengan "Continue watching" → "Home" hybrid

---

### 10. Batch Metadata Edit
**Effort:** Sedang

**What:** Saat ini `MetadataEditor.jsx` cuma handle 1 file. Pilih 5 file audio sekaligus → ganti Artist/Album semuanya.

**Proposal:**
- Checkbox selection di `MediaGrid` (shift-click supported)
- Bulk action bar: "Edit metadata for N files"
- Form: Artist, Album, Genre, Year → apply ke semua yang diseleksi
- Preview per-file sebelum apply (show old → new diff)

---

### 11. Keyboard Navigation
**Effort:** Kecil

**What:**
- `↑`/`↓` / `j`/`k` navigate grid
- `Enter` play / open
- `Space` play/pause di video/audio player
- `Esc` close modal
- `/` focus search
- `m` toggle mute
- `d` toggle dark/light theme (kalo ada)
- `f` toggle favorite

---

### 12. One-Click Copy Stream URL
**Effort:** Kecil

**What:** Copy direct URL `http://host:3001/stream/:id` ke clipboard. Buat dipakai di external player (VLC, MPV, IINA).

**Proposal:**
- Right-click context menu di grid item, atau button di modal
- Copy `/stream/:id` atau `/file/:id` untuk raw
- Tampilkan toast "URL copied"

---

### 13. Schedule Scan (Cron)
**Effort:** Kecil–sedang

**What:** Scan otomatis di jam tertentu (misal 03:00), bukan cuma on-demand + fs watcher.

**Proposal:**
- Setting: `scan.schedule` (cron expression atau "jam X setiap hari")
- `node-cron` atau setTimeout check each minute
- Saat waktu match → `runIncrementalScan()`

**Why:** Berguna kalau library tambah file dari SMB/NFS mount yang tidak trigger `fs.watch`.

---

### 14. DB Maintenance UI
**Effort:** Sedang

**What:** VACUUM, integrity check, clear old metrics. Saat ini harus pakai sqlite3 CLI.

**Proposal:**
- Halaman baru di monitoring: "Database"
- Button: "VACUUM", "Check integrity", "Clear history older than X days"
- Show DB size before/after
- Confirmation dialog sebelum aksi

---

### 15. Storage Quota Warning
**Effort:** Kecil

**What:** Alert + UI indicator kalau disk `MEDIA_ROOT` hampir penuh (>80%, >90%).

**Proposal:**
- Progress bar di TopBar dengan warna: hijau → kuning → merah
- Alert di monitoring page
- Configurable threshold di settings

---

### 16. Quick Info Tooltip (Hover Metadata)
**Effort:** Kecil–sedang

**What:** Saat hover grid item, tampilkan tooltip kecil: duration, resolution, codec, size — tanpa perlu click buka modal.

**Proposal:**
- Pre-fetch minimal metadata via existing API response
- Tooltip dengan 300ms delay
- Hide saat mouse leave

---

### 17. Image Slideshow Mode
**Effort:** Kecil–sedang

**What:** Gallery mode buat browse foto. Auto-play slideshow dengan interval yang bisa diatur.

**Proposal:**
- Di `ImageViewer`, tambah tombol slideshow (play/pause, prev/next, interval)
- Atau mode khusus: `#/gallery/:folderId`
- Keyboard: ← → navigate, Space pause/play

**Why:** Folder dengan banyak screenshot/vacation photos butuh quick slideshow tanpa manual klik satu per satu.

---

### 18. Playback Speed Control
**Effort:** Kecil

**What:** Ubah kecepatan playback video/audio (0.5x, 1.25x, 1.5x, 2x). Saat ini cuma default 1x.

**Proposal:**
- Tambah dropdown atau slider di `MediaControls`
- Simpan per-file preference di `watch_history` table
- Apply saat load video via `video.playbackRate`

**Why:** Buat review tutorial, atau nonton fast-forward content.

---

### 19. Picture-in-Picture (PiP) Toggle
**Effort:** Kecil

**What:** Floating video player di atas semua window. Browser native `requestPictureInPicture()`.

**Proposal:**
- Button di `VideoPlayer` / `MediaControls`
- Saat PiP aktif → minimize modal ke corner screen
- Close PiP → kembali ke modal

**Why:** Multitasking: kerja di laptop sambil nonton di PiP window kecil.

---

### 20. Sleep Timer
**Effort:** Kecil

**What:** Auto-stop playback setelah X menit. Berguna buat nonton sebelum tidur.

**Proposal:**
- Button di `AudioPlayer` / `MiniPlayer`
- Pilihan: 15m, 30m, 60m, end of current episode
- Countdown overlay kecil, tap untuk cancel
- Fade out volume 30 detik sebelum stop (opsional)

---

### 21. Bulk Delete / Archive
**Effort:** Sedang

**What:** Pilih beberapa file → delete permanently atau pindah ke folder "Archive" (tanpa hard delete).

**Proposal:**
- Checkbox multi-select di `MediaGrid`
- Bulk action: "Delete" (soft delete → move ke `media/.archive/`) atau "Hard delete"
- Confirmation dialog dengan jumlah file + total size
- `softDelete` flag di DB + FTS reindex

**Why:** Saat ini delete cuma satu per satu via OS filesystem, atau manual edit DB.

---

### 22. Playback History Timeline (Mini-Graph)
**Effort:** Sedang

**What:** Tampilkan grafik kecil "kapan kamu biasanya nonton file ini" — misal, 3 hari terakhir ada activity.

**Proposal:**
- Query `watch_history` untuk file yang lagi di-open
- Mini bar chart: hari ini vs 7 hari lalu (berapa menit ditonton)
- Tooltip: total watch time untuk file itu

**Why:** Berguna buat episodic content — inget kapan terakhir lanjut season 2 episode 3.

---

### 23. Auto-Play Next Episode (Smart Queue)
**Effort:** Sedang–besar

**What:** Saat video/audio episode selesai, otomatis play file berikutnya di folder yang sama (nama terurut, atau dari playlist).

**Proposal:**
- Detect "ended" event di `<video>` / `<audio>` player
- Cari file berikutnya di DB: `WHERE dir_id = X AND created_at > Y LIMIT 1`
- Show toast "Playing next: [filename]" dengan cancel button (3 detik)
- Setting: auto-play on/off

**Why:** Binge-watching episodes tanpa manual klik next setiap 20 menit.

---

### 24. Search by Actor / Director / Genre
**Effort:** Sedang–besar

**What:** Saat ini search cuma by filename + FTS. Kalau mau cari film oleh特定 actor, tidak bisa tanpa metadata lengkap.

**Proposal:**
- Integrasi TMDB / OMDb API untuk fetch metadata
- Tabel baru `media_meta(file_id, title, overview, actor, director, genre, year, rating, poster_url)`
- Index + FTS di kolom baru
- Filter sidebar: Genre, Year, Rating range

**Why:** Browse library lebih menyenangkan kalau ada poster, overview, dan filter by actor. Tapi effortnya besar karena perlu scrape/manual input metadata.

---

### 25. Mark as Watched / Unwatched (Toggle)
**Effort:** Kecil

**What:** Manual toggle status "sudah ditonton" tanpa harus play sampai habis.

**Proposal:**
- Button di `MediaModal` atau context menu grid: "Mark as watched" / "Mark as unwatched"
- Set `completed_at = now()` atau `NULL`
- Show indicator di grid (centang hijau)
- Filter "Show unwatched only"

**Why:** Kadang file ditandai "watched" padahal cuma preview 1 menit. Manual override penting.

---

## 🟢 OVERKILL

### 26. Multi-User & RBAC
**Effort:** Besar

**Why:** 1 user. Role-based access, user management, quota per-user → kompleksitas maintenance tinggi, tidak ada value untuk use case ini.

---

### 27. Transcoding Queue UI
**Effort:** Besar

**Why:** On-demand transcode sudah cukup (ffmpeg spawn saat stream request). Full queue management UI untuk 1 user tidak dibutuhkan. Transcoding biasanya sekali tembak (saat play), bukan batch job.

---

### 28. Chromecast / DLNA / AirPlay
**Effort:** Besar

**Why:** Untuk 2 device (laptop + HP + TV), browser playback + external player (dari fitur #12) sudah cukup. DLNA server + discovery + session management = ribet untuk use case kecil.

---

### 29. Plugin System / Extension API
**Effort:** Besar

**Why:** Arsitektur monolith saat ini sudah jelas. Plugin system (hooks, events, sandboxed modules) untuk 1 user adalah abstraksi yang tidak dibutuhkan. Tambah fitur langsung ke codebase lebih cepat.

---

### 30. GraphQL API
**Effort:** Besar

**Why:** REST sudah cukup untuk semua use case. GraphQL untuk single client (SPA) dengan ~20 endpoint adalah over-engineering. Query complexity + caching + security overhead tidak sebanding.

---

### 31. Mobile App (React Native / Flutter)
**Effort:** Sangat besar

**Why:** Responsive web + PWA manifest sudah cukup buat HP. Native app = maintain 2 codebase frontend. Untuk 1 user yang bikin sendiri, web-only lebih practical.

---

### 32. Social / Sharing Features
**Effort:** Besar

**What:** Shared playlists, recommendations, "friends also watched", activity feed.

**Why:** 1 user. Tidak ada social graph.

---

## Priority Matrix

```
Quick Wins (Kecil effort, tinggi value):
  🔐 Auth basic             [Week 1]
  ⬇️  Direct download       [Week 1]
  📋 Copy stream URL        [Week 1]
  ⌨️  Keyboard nav          [Week 2]
  🎯 Favorites              [Week 2]
  ⚠️  Storage quota warning [Week 2]
  💡 Quick info tooltip     [Week 2]
  📊 Recently added view    [Week 2]
  ⏱️  Sleep timer           [Week 2]
  🖼️  PiP toggle            [Week 2]
  🎬 Playback speed         [Week 2]

Medium (Sedang effort, moderate value):
  ▶️  Resume playback       [Week 3–4]
  📝 Subtitle serve         [Week 3–4]
  ✏️  Batch metadata edit   [Month 2]
  ✏️  File rename/move      [Month 2]
  🔧 DB maintenance UI      [Month 2]
  🗂️  Bulk delete/archive   [Month 2]
  📊 Watch history timeline [Month 2]
  ⏰ Schedule scan          [Month 2]
  🖼️  Image slideshow       [Month 2]

Big (Besar effort, specific value):
  ▶️  Auto-play next        [Month 3+]
  🎬 TMDB metadata search   [Month 3+]
  🔍 Subtitle search API    [Month 3+]
```

---

Design and implement a GPU-native Screen Streaming Engine inspired by GPU Screen Recorder (GSR), but integrated into the Homelab Media Server architecture.

This is NOT an OBS-like canvas capture.

This is NOT browser screen sharing.

The objective is to capture the Linux desktop with minimal CPU usage by leveraging the GPU capture and hardware video encoder pipeline.

======================================================================
Objectives
======================================================================

Create a low-latency screen streaming subsystem.

Requirements:

• Minimal CPU usage.

• Maximum GPU utilization.

• Hardware encoding.

• Zero-copy whenever possible.

• Suitable for remote desktop inside the Homelab Media Server.

======================================================================
Architecture
======================================================================

Design the subsystem as:

Capture Backend

↓

Frame Acquisition

↓

Hardware Encoder

↓

Streaming Engine

↓

WebRTC

↓

Frontend Player

Each component should be modular.

======================================================================
Capture Backends
======================================================================

Investigate and support:

Wayland

PipeWire

DMA-BUF

X11

KMS

Automatically select the best backend.

Fallback gracefully when unavailable.

======================================================================
Hardware Encoding
======================================================================

Use hardware encoders whenever available.

Priority:

VAAPI

AMF

NVENC

Intel QSV

Software encoding only as a last resort.

Never perform unnecessary software encoding.

======================================================================
Zero-Copy Pipeline
======================================================================

Avoid unnecessary memory copies.

Preferred flow:

GPU Framebuffer

↓

DMA-BUF

↓

Hardware Encoder

↓

Encoded H264 / HEVC / AV1

↓

WebRTC

Avoid GPU → CPU → GPU copies whenever possible.

======================================================================
Streaming
======================================================================

Prefer WebRTC.

Reasons:

Low latency.

Adaptive bitrate.

Browser compatibility.

Automatic congestion control.

No custom protocol unless necessary.

======================================================================
Frontend
======================================================================

Frontend should only display:

<video>

No canvas rendering.

No pixel manipulation.

No frame copying.

======================================================================
Capabilities
======================================================================

Support:

Entire desktop

Single monitor

Specific window (future)

Region capture (future)

Cursor capture

Optional audio capture

======================================================================
Performance Targets
======================================================================

1080p60

Low CPU utilization

Stable FPS

Low latency

Minimal memory allocation

======================================================================
Monitoring
======================================================================

Expose runtime metrics.

Examples:

Current FPS

Encoder FPS

Dropped Frames

Encoder Latency

Bitrate

GPU Utilization

CPU Utilization

Capture Backend

Encoder

Streaming Clients

Network Throughput

Expose through API.

======================================================================
Configuration
======================================================================

Configurable:

Encoder

Bitrate

FPS

Resolution

Keyframe Interval

Hardware Preference

Capture Backend

======================================================================
Security
======================================================================

Require authentication.

Only authenticated users can start a capture session.

Support multiple viewers.

======================================================================
Documentation
======================================================================

Produce complete architecture documentation.

Explain:

Capture Flow

Encoder Flow

Streaming Flow

Zero-Copy Pipeline

Backend Selection

Hardware Detection

Fallback Logic

======================================================================
Research Requirement
======================================================================

Before implementation, audit the Linux graphics stack.

Determine the best approach for:

Wayland

PipeWire

DMA-BUF

VAAPI

AMF

NVENC

WebRTC

The implementation should prioritize performance, low latency, maintainability, and compatibility rather than simply making screen capture work.

The final subsystem should resemble a lightweight GPU-native streaming engine rather than an OBS clone.

ROLE

Bertindak sebagai Senior Software Architect, Systems Engineer, Technical Writer, Code Auditor, dan Documentation Engineer.

Tujuan utama BUKAN langsung mengubah dokumentasi utama.

Tujuan utama adalah membangun knowledge cache yang lengkap, akurat, dapat diverifikasi, dan dapat terus berkembang tanpa kehilangan informasi.

==================================================
WORKSPACE
==================================================

Production documentation

/home/CATIAA/homelab-media-server/ARCHITECTURE.md

Temporary knowledge workspace

/home/CATIAA/.local/share/kilo/plans/architecture-cache/

Seluruh hasil analisis WAJIB ditulis terlebih dahulu ke folder cache.

JANGAN mengubah ARCHITECTURE.md selama proses analisis.

==================================================
MAIN PRINCIPLE
==================================================

Anggap ARCHITECTURE.md sebagai:

Source of Truth

Sedangkan folder architecture-cache adalah:

Knowledge Workspace

Semua observasi, analisis, audit, penemuan, dependency, call graph, bug, maupun dokumentasi sementara HARUS masuk ke architecture-cache terlebih dahulu.

ARCHITECTURE.md hanya boleh diupdate setelah seluruh cache selesai diverifikasi.

==================================================
GOALS
==================================================

Lakukan audit penuh terhadap seluruh project.

Jangan hanya mencari bug.

Jangan hanya membaca file.

Tetapi bangun knowledge base sedalam mungkin.

Target:

- memahami seluruh project
- memahami seluruh hubungan antar module
- memahami seluruh flow
- memahami seluruh lifecycle
- memahami seluruh dependency
- memahami seluruh state
- memahami seluruh API
- memahami seluruh konfigurasi
- memahami seluruh database
- memahami seluruh cache
- memahami seluruh scheduler
- memahami seluruh monitoring
- memahami seluruh playback
- memahami seluruh downloader
- memahami seluruh frontend
- memahami seluruh backend

==================================================
DO NOT
==================================================

Jangan meringkas.

Jangan menghapus informasi.

Jangan overwrite cache lama.

Jangan mengedit ARCHITECTURE.md.

Jangan membuat asumsi.

Jangan membuat informasi tanpa bukti dari source code.

==================================================
CACHE STRUCTURE
==================================================

Gunakan struktur berikut.

architecture-cache/

00-index.md

01-project-overview.md

02-folder-tree.md

03-backend/

04-frontend/

05-api/

06-database/

07-playback/

08-monitoring/

09-downloader/

10-websocket/

11-settings/

12-state-machine/

13-call-graph/

14-dependency-graph/

15-background-jobs/

16-performance/

17-cache-system/

18-security/

19-error-handling/

20-code-audit/

21-bugs/

22-improvements/

23-missing-documentation/

24-review/

25-final-verification/

26-merge-plan/

==================================================
FOR EACH CACHE FILE
==================================================

Isi sedetail mungkin.

Contoh isi:

Purpose

Responsibilities

Dependencies

Imports

Exports

Consumers

Who calls this

Who uses this

Call flow

Lifecycle

Sequence

State changes

Failure cases

Recovery

Performance impact

Memory impact

Disk impact

CPU impact

Potential bottleneck

Future improvement

Known limitation

Related files

Cross references

Configuration

Environment variables

Database usage

API usage

Threading

Background tasks

Cache usage

Security consideration

Notes

TODO

Confidence Level

Verification Status

==================================================
DISCOVERY
==================================================

Cari SEMUA:

Function

Method

Class

Route

API

Scheduler

Timer

Worker

Queue

Cache

Singleton

Context

Store

State

Database

Migration

Utility

Hook

React Component

Event

WebSocket

Polling

Monitoring

Playback

Streaming

Download

Upload

Thumbnail

Metadata

Scanner

Maintenance

Logger

Settings

Environment

==================================================
EVERY DISCOVERY MUST INCLUDE
==================================================

Nama

Lokasi file

Lokasi function

Tujuan

Parameter

Return

Caller

Consumer

Dependency

Side effect

Failure mode

Recovery

Performance

==================================================
CALL GRAPH
==================================================

Bangun call graph.

Misalnya

Server

↓

Router

↓

Controller

↓

Service

↓

Utility

↓

Database

↓

Filesystem

↓

Response

==================================================
DEPENDENCY GRAPH
==================================================

Bangun dependency graph.

Frontend

↓

API

↓

Route

↓

Utility

↓

Database

↓

Filesystem

==================================================
STATE MACHINE
==================================================

Bangun state machine untuk:

Playback

Monitoring

Downloader

Scanner

Background Jobs

Startup

Shutdown

==================================================
VERIFICATION
==================================================

Setelah seluruh cache selesai.

Audit ulang seluruh cache.

Cari:

Missing API

Missing file

Missing module

Missing dependency

Missing route

Missing scheduler

Missing settings

Missing lifecycle

Missing diagram

Missing call graph

Missing state

Missing documentation

==================================================
IF SOMETHING IS MISSING
==================================================

JANGAN update ARCHITECTURE.md.

Tetapi buat file cache baru.

Contoh

missing-playback.md

missing-monitoring.md

missing-api.md

missing-settings.md

missing-flow.md

==================================================
FINAL VERIFICATION
==================================================

Setelah semua cache selesai.

Bangun verification report.

Contoh

Files scanned

Functions documented

Routes documented

Components documented

Database tables

Settings

Schedulers

Workers

Background Jobs

Caches

Call Graphs

State Machines

Missing Items

Confidence

Coverage

==================================================
ONLY AFTER EVERYTHING IS VERIFIED
==================================================

Baru buat Merge Plan.

Jangan langsung merge.

Merge Plan harus berisi:

Apa yang berubah.

Bagian mana ARCHITECTURE.md yang harus diupdate.

Bagian mana yang harus ditambah.

Bagian mana yang obsolete.

Bagian mana yang harus dipindahkan.

==================================================
VERY IMPORTANT
==================================================

Folder architecture-cache adalah workspace permanen.

Folder ini boleh terus bertambah.

Folder ini boleh memiliki ratusan file.

Folder ini boleh mencapai puluhan ribu baris.

Tidak ada batas ukuran.

Yang penting:

Semua informasi terdokumentasi.

Semua informasi dapat diverifikasi.

Semua informasi memiliki referensi source code.

ARCHITECTURE.md tetap menjadi dokumentasi production yang bersih, sedangkan architecture-cache menjadi "otak" dan basis pengetahuan proyek yang terus berkembang.

ROLE

Bertindak sebagai Principal Software Architect, Systems Engineer, Knowledge Engineer, Technical Writer, Code Auditor, Documentation Engineer, dan Software Analyst.

Tujuan utama bukan mengedit ARCHITECTURE.md.

Tujuan utama adalah membangun Knowledge Base project yang dapat berkembang selama bertahun-tahun.

==================================================
WORKSPACE
==================================================

Project Root

/home/CATIAA/homelab-media-server/

Master Documentation

/home/CATIAA/homelab-media-server/ARCHITECTURE.md

Knowledge Workspace

/home/CATIAA/.local/share/kilo/plans/architecture-cache/

==================================================
MAIN PRINCIPLE
==================================================

ARCHITECTURE.md adalah:

Single Source of Truth

Sedangkan

architecture-cache

adalah

Knowledge Workspace.

Semua analisis HARUS masuk ke architecture-cache terlebih dahulu.

ARCHITECTURE.md tidak boleh diubah selama proses analisis berlangsung.

==================================================
KNOWLEDGE PIPELINE
==================================================

Seluruh pekerjaan mengikuti pipeline berikut.

Source Code

↓

Knowledge Cache

↓

Verification

↓

Review

↓

Merge Plan

↓

ARCHITECTURE.md

Tidak boleh melompati tahapan.

==================================================
TARGET
==================================================

Bangun knowledge base yang dapat digunakan AI maupun developer untuk memahami seluruh project.

Target bukan membuat ringkasan.

Target adalah memahami seluruh project hingga level implementasi.

Dokumentasikan seluruh informasi penting.

Tidak ada batas ukuran.

Knowledge Base boleh mencapai puluhan bahkan ratusan ribu baris apabila memang diperlukan.

==================================================
CACHE STRUCTURE
==================================================

Gunakan struktur berikut.

architecture-cache/

00-meta/

01-raw/

02-analysis/

03-verified/

04-review/

05-merge/

archive/

==================================================
DETAIL DIRECTORY
==================================================

00-meta/

project-summary.md

statistics.md

coverage.md

knowledge-map.md

scan-status.md

merge-status.md

--------------------------------------------------

01-raw/

backend/

frontend/

database/

api/

monitoring/

playback/

downloader/

scanner/

websocket/

settings/

storage/

utilities/

--------------------------------------------------

02-analysis/

architecture/

dependency/

callgraph/

lifecycle/

state-machine/

performance/

cache/

security/

filesystem/

threading/

memory/

scheduler/

--------------------------------------------------

03-verified/

backend/

frontend/

database/

api/

monitoring/

playback/

scanner/

--------------------------------------------------

04-review/

missing.md

duplicate.md

obsolete.md

refactor.md

improvement.md

performance.md

future.md

--------------------------------------------------

05-merge/

architecture-update.md

api-update.md

database-update.md

frontend-update.md

backend-update.md

changelog.md

==================================================
ANALYSIS MODE
==================================================

Lakukan audit penuh terhadap seluruh source code.

Jangan hanya membaca file.

Bangun knowledge.

Cari seluruh:

Function

Method

Class

Component

React Hook

Context

Store

Scheduler

Worker

Route

Endpoint

Database

Migration

Table

Filesystem

Thread

Queue

Cache

Logger

Background Job

Playback

Downloader

Monitoring

WebSocket

Scanner

Configuration

Settings

Environment

Lifecycle

Decision Tree

State Machine

Performance

Dependency

Call Graph

==================================================
FOR EVERY DISCOVERY
==================================================

Minimal dokumentasikan:

Nama

Lokasi File

Lokasi Function

Purpose

Responsibilities

Parameters

Return Value

Caller

Consumer

Imports

Exports

Dependencies

Configuration

Environment Variables

Filesystem Access

Database Access

API Usage

Background Jobs

Cache Usage

Side Effects

Failure Cases

Recovery

Performance Impact

CPU Usage

Memory Usage

Disk Usage

Security Notes

Future Improvements

Related Files

Related Functions

Confidence Level

Verification Status

==================================================
CALL GRAPH
==================================================

Bangun call graph.

Contoh.

Server

↓

Router

↓

Middleware

↓

Controller

↓

Service

↓

Utility

↓

Database

↓

Filesystem

↓

Response

==================================================
DEPENDENCY GRAPH
==================================================

Bangun dependency graph.

Frontend

↓

API

↓

Route

↓

Business Logic

↓

Database

↓

Filesystem

==================================================
STATE MACHINE
==================================================

Bangun state machine lengkap untuk.

Playback

Monitoring

Downloader

Scanner

Folder Scan

Background Jobs

Startup

Shutdown

Authentication

==================================================
PERFORMANCE ANALYSIS
==================================================

Cari.

Blocking IO

spawnSync

Sync Filesystem

Duplicate Scan

Duplicate Cache

Large Memory Allocation

Race Condition

Deadlock

Busy Wait

Potential Bottleneck

Thread Blocking

Disk Intensive Process

==================================================
VERIFICATION
==================================================

Setelah seluruh cache selesai.

Audit ulang.

Cari.

Missing File

Missing Function

Missing API

Missing Component

Missing Scheduler

Missing Cache

Missing State

Missing Dependency

Missing Diagram

Missing Lifecycle

Missing Documentation

==================================================
IF SOMETHING IS MISSING
==================================================

Jangan update ARCHITECTURE.md.

Tetapi buat file baru.

Contoh.

missing-playback.md

missing-monitoring.md

missing-backend.md

missing-frontend.md

missing-api.md

missing-settings.md

==================================================
KNOWLEDGE MAP
==================================================

Selalu update knowledge-map.md.

Contoh.

Backend

Raw

Analysis

Verified

Review

Merge Ready

Frontend

Raw

Analysis

Verified

Review

Merge Ready

Monitoring

Raw

Analysis

Verified

Review

Merge Ready

Playback

Raw

Analysis

Verified

Review

Merge Ready

Downloader

Raw

Analysis

Verified

Review

Merge Ready

==================================================
METADATA
==================================================

Setiap file wajib memiliki metadata.

Generated

Last Verified

Files Scanned

Functions

Classes

Components

Routes

Endpoints

Settings

Schedulers

Coverage

Confidence

Verification Status

Need Merge

==================================================
MERGE RULE
==================================================

ARCHITECTURE.md TIDAK BOLEH disentuh sampai:

Seluruh cache selesai.

Seluruh cache diverifikasi.

Tidak ada Missing Item.

Tidak ada Duplicate.

Tidak ada Contradiction.

==================================================
MERGE PLAN
==================================================

Setelah seluruh cache selesai.

Buat Merge Plan.

Isi.

Bagian ARCHITECTURE.md yang perlu diubah.

Bagian baru yang perlu ditambahkan.

Bagian obsolete.

Bagian yang harus dipindahkan.

Bagian yang perlu dipecah menjadi dokumen terpisah.

==================================================
VERY IMPORTANT
==================================================

Knowledge Cache adalah workspace permanen.

Knowledge Cache bukan temporary file.

Knowledge Cache adalah basis pengetahuan proyek.

Knowledge Cache boleh terus berkembang.

Knowledge Cache boleh mencapai ratusan file.

Knowledge Cache boleh mencapai ratusan ribu baris.

ARCHITECTURE.md tetap menjadi dokumentasi production yang bersih, sedangkan architecture-cache menjadi "otak" proyek yang menyimpan seluruh hasil analisis, verifikasi, audit, investigasi, dependency, call graph, lifecycle, dan seluruh pengetahuan proyek yang dapat digunakan kembali oleh AI maupun developer di masa depan.

*File: IDEAS.md — tidak mengubah apapun di codebase, hanya referensi.*
