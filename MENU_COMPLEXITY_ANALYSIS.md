# Menu Complexity Analysis — homelab-media-server

## Overview

This document compares the overall web project complexity with the Music menu complexity, identifying the Music menu as the most complex menu (#1) in the application.

---

## Part 1: Overall Web Project Analysis

### Project Scale

| Metric | Value |
|---|---|
| Frontend files | 150 |
| Backend files | 105 |
| Frontend LOC | 35,884 |
| Backend LOC | 24,665 |
| Total LOC | 60,549 |
| Top-level views | 10 |
| Backend route modules | 19 |
| Backend utils files | 41+ |

### Tech Stack

- **Frontend:** React 18, Vite 5, TailwindCSS 3, Zustand (state), Lucide React (icons)
- **Backend:** Node.js ESM, Express, SQLite (better-sqlite3)
- **Whatsapp Bot:** Embedded (whatsapp-web.js)

### Top-Level Menu Structure (Sidebar)

| # | Menu Item | View Type | Complexity |
|---|---|---|---|
| 1 | Media Vault | `media` | Medium |
| 2 | Monitoring | `monitoring` (12 sub-pages) | High |
| 3 | Downloader | `downloader` | Medium |
| 4 | ADB Transfer | `adb` | Medium |
| 5 | Scrcpy Mirror | `scrcpy` | Medium |
| 6 | **Music** | `playlists` / `audio` | **Highest** |
| 7 | Bot (WhatsApp) | `whatsapp` | Medium |
| 8 | Antrian Kirim (Send Queue) | `sendqueue` | Medium-High |
| 9 | AI Chat | `ai` | Medium |
| 10 | AI Settings | `ai-settings` | Low |

### Backend Route Modules

| Module | Lines | Purpose |
|---|---|---|
| adb.js | — | ADB device management |
| ai-context.js | — | AI context management |
| ai.js | — | AI chat routing |
| ai-providers.js | — | AI provider config |
| downloader.js | — | Download management |
| file.js | — | File operations |
| files.js | — | File listing/search |
| git.js | — | Git integration |
| jobs.js | — | Background jobs |
| metadata.js | 295 | Metadata + lyrics CRUD |
| monitoring.js | — | Monitoring endpoints |
| playback.js | — | Playback control |
| playlists.js | 1,126 | Playlist CRUD + XSPF import |
| scrcpy.js | — | Screen mirroring |
| send.js | — | Send queue |
| services.js | — | Service management |
| settings.js | — | Settings API |
| stream.js | — | HLS streaming |
| thumbnails.js | — | Thumbnail generation |
| upload.js | — | File upload |
| videoCache.js | — | Video cache |
| whatsapp.js | — | WhatsApp bot API |

### Largest Backend Files

| File | Lines |
|---|---|
| downloader/manager.js | 2,030 |
| db.js | 1,354 |
| utils/adbManager.js | 1,203 |
| routes/playlists.js | 1,126 |
| utils/playbackEngine.js | 701 |
| utils/fileScanner.js | 679 |
| routes/whatsapp.js | 585 |
| routes/send.js | 570 |
| utils/adbTransaction.js | 545 |
| routes/files.js | 531 |

### Largest Frontend Files

| File | Lines | Purpose |
|---|---|---|
| App.jsx | 2,615 | Main app + routing + sidebar |
| Music.jsx | 2,837 | Music player + sync engine |
| SendQueueView.jsx | 1,390 | Send queue UI |
| PlaylistView.jsx | 1,348 | Playlist management UI |
| DownloaderPage.jsx | 1,169 | Downloader page |
| AdbTransfer.jsx | 1,075 | ADB transfer UI |
| MetricsTable.jsx | 832 | Monitoring metrics table |
| SettingsPage.jsx | 749 | Settings page |
| GitView.jsx | 746 | Git view |
| api.js | 717 | API utilities |
| MetadataEditor.jsx | 637 | Metadata editor |
| syncCore.js | 628 | A/V sync engine core |
| MediaControls.jsx | 608 | Media controls |
| ScrcpyView.jsx | 585 | Scrcpy mirror |
| WhatsAppView.jsx | 550 | WhatsApp bot UI |

---

## Part 2: Music Menu Analysis (Rated #1 — Most Complex)

### Why Music Is #1

The Music menu is the most complex menu in the application due to the convergence of **five distinct subsystems** that must work together in real time:

1. **A/V Sync Engine** — client-side adaptive drift correction
2. **Lyrics Sync Engine** — LRC parsing, offset adjustment, scroll animation
3. **Audio Output Routing** — browser device selection via `setSinkId`
4. **Playlist Management** — CRUD, XSPF import/export, queue management
5. **Telemetry & Debug System** — session recording, export, analysis

No other menu in the project combines this many interacting subsystems in a single view.

### File Inventory

#### Frontend Files

| File | Lines | Subsystem |
|---|---|---|
| Music.jsx | 2,837 | Main player + sync engine integration |
| PlaylistView.jsx | 1,348 | Playlist UI + queue management |
| SyncOverlay.jsx | 383 | Real-time A/V sync telemetry overlay |
| syncCore.js | 628 | Shared sync core (EMA, histogram, decisions) |
| audioOutput.js | 70 | Audio output device routing |
| LyricsDisplay.jsx | 381 | Lyrics rendering + sync offset |
| LyricsEditor.jsx | 277 | Lyrics search + save + multi-tab |
| LyricsScrollController.js | 206 | Lyrics scroll animation + DOM metrics |
| **Frontend Total** | **6,130** | |

#### Backend Files

| File | Lines | Subsystem |
|---|---|---|
| routes/playlists.js | 1,126 | Playlist CRUD + XSPF import |
| utils/playlistScanner.js | 275 | XSPF file scanner |
| utils/xspfParser.js | 249 | XSPF XML parser |
| routes/metadata.js | 295 | Metadata + lyrics CRUD + .lrc export |
| utils/lyricsSources.js | 247 | Multi-source lyrics search (6 providers) |
| utils/lrcParser.js | 56 | LRC parse/build |
| utils/lrcmux.js | 69 | lrcmux API client |
| **Backend Total** | **2,317** | |

#### Grand Total: 8,447 lines across 15 files

### Subsystem Deep Dive

#### 1. A/V Sync Engine (syncCore.js + Music.jsx lines 883–1299)

The sync engine is a client-side A/V synchronization system with two independent engines (MV = Main Video, BG = Background Video):

- **EMATracker** — Exponential Moving Average with Welford-like variance tracking
  - Bootstrap at 20 samples, full adaptivity at 100 samples
  - Per-engine drift tracking (raw + corrected)
  - Bias compensation (learns very slowly, α=0.005)
  - Presentation latency tracking (from RVFC)
  - Decode latency tracking (from RVFC `processingDuration`)
  - Seek latency tracking (seek start → `seeked` event)

- **Histogram** — 8-bin fixed distribution (0–2ms through 100+ms)

- **DecisionCounter** — Tracks LOCK / RATE / SOFT / HARD decisions per engine

- **SeekTelemetry** — Per-seek-type statistics (soft vs hard seek, drift, frame age)

- **SharedSyncCore** — The "brain" shared between MV and BG engines
  - Stable-state gate: only learns when playback is LOCKED
  - Confidence calculation (0–100%) based on bias samples, drift variance, histogram distribution, and total samples
  - Predicted target calculation (bias + presentation latency correction)
  - Adaptive thresholds: soft (2σ, clamped 8–40ms) and hard (4σ, clamped 200–500ms)
  - Scheduler awareness: skips correction when tick arrives >80ms late
  - CPU overload guard: graduated response (soft seeks disabled first, hard seeks remain)
  - Replay event log (ring buffer, 100K max)

- **Music.jsx `createVideoSyncEngine()`** — Configurable engine factory
  - 20+ configuration parameters per engine instance
  - State machine: IDLE → LOCKED → GRACE → RECOVERY
  - Soft seek (direct `currentTime` set, 1-tick correction)
  - Hard seek (pause + seek + play, for large drift)
  - Anchor coalescing (small target changes merge with in-flight seek)
  - Watchdog (stuck seek >2s auto-reset)
  - Grace period (no correction for N ms after anchor)
  - Loop boundary handling (circular diff)
  - Bias save logging (when bias correction prevents a soft seek)

#### 2. Lyrics Sync Engine (LyricsDisplay.jsx + LyricsScrollController.js)

- **LRC Parsing** — `parseLRC()` in `lrcParser.js` parses `[mm:ss.xx]` timestamps
- **Sync Offset** — Stored in `localStorage.mediavault-lyrics-offset` (persists across sessions)
- **LyricsScrollController** — DOM measurement-based scroll animation
  - `measure()` — `getBoundingClientRect()` for active line + container
  - Smooth scroll with configurable gain (0.18 default, 0.5 initial)
  - Auto-resume after 3s of user inactivity
  - Programmatic scroll detection (100ms window)
  - Max 120 animation frames per scroll session
  - Comprehensive metrics: correction count, animation frames, DOM measure time
  - Debug overlay with per-line delta, scroll position, animation state

- **LyricsDisplay.jsx Debug Overlay** — Shows real-time:
  - Line index / total, audio time vs clock time, delta in ms
  - Scroll position, container height, line height
  - Auto vs user scroll state
  - Correction stats (avg, max, min)
  - Animation frame stats (avg, longest, shortest)
  - Null/empty/invalid element counts
  - DOM measure time per call

#### 3. Audio Output Routing (audioOutput.js)

- Uses `navigator.mediaDevices.selectAudioOutput()` + `HTMLMediaElement.setSinkId`
- Requires secure context (HTTPS/localhost) and Chromium (Chrome/Edge)
- Firefox/Safari do not support `setSinkId` on media elements
- Persists selected device to `localStorage.audio.outputDevice`
- Re-applies device on `play`, `loadstart`, `loadedmetadata`, `canplay`, `seeked`, `playing`, `timeupdate` events
- Device change listener (OS-level connect/disconnect)
- Enforcement loop: checks `audio.sinkId` vs desired device, re-applies if drifted
- Debug mode via `?debugSink` query parameter

#### 4. Playlist Management (Backend)

- **playlists.js** (1,126 lines) — Full CRUD + XSPF import + scanning
  - `GET /api/playlists` — List all playlists with track counts, durations, sizes
  - `GET /api/playlists/:id` — Playlist detail with tracks
  - `POST /api/playlists` — Create playlist
  - `PUT /api/playlists/:id` — Update playlist
  - `DELETE /api/playlists/:id` — Delete playlist
  - `POST /api/playlists/:id/tracks` — Add tracks
  - `DELETE /api/playlists/:id/tracks/:trackId` — Remove track
  - `POST /api/playlists/import/xspf` — Import XSPF file
  - `GET /api/playlists/scan` — Scan filesystem for playlists
  - Path normalization for dedup (strip common prefixes, lowercase)
  - Source type detection: manual, folder, imported-xspf

- **playlistScanner.js** (275 lines) — Filesystem scanner for XSPF files
- **xspfParser.js** (249 lines) — XSPF XML parser (track list, metadata, extensions)

#### 5. Lyrics Backend (metadata.js + lyricsSources.js)

- **GET /api/metadata/:id/lyrics** — Returns plain, synced, and romaji lyrics
- **PUT /api/metadata/:id/lyrics** — Saves to DB + exports `.lrc` file to same directory
- **GET /api/metadata/lyrics/search** — Multi-source lyrics search
  - 6 providers: LRCLIB (primary), lrcmux, pyjlyric, netease, genius
  - Fallback chain: exact match → search → cleaned track name → artist-only
  - Deduplication by `trackName|artistName|source`
  - Romaji generation for Japanese tracks

#### 6. Telemetry & Debug System (Music.jsx lines 89–473)

- **Session Management** — Auto-starts on track change, auto-closes on unmount
  - Session metadata: trackId, filename, codec, resolution, duration, environment
  - Engine version: `sync-v3`
  - Config snapshot: all adaptive threshold parameters
  - Stored in `localStorage.sync_sessions` (max 5MB, ring buffer)

- **Console API** — 15+ global functions for debugging:
  - `window.__SYNC__(true/false)` — Start/stop session
  - `window.__SYNC_EXPORT__()` — Download current session JSON
  - `window.__SYNC_SUMMARY__()` — Print summary to console
  - `window.__SYNC_DOWNLOAD_CURRENT__()` — Download current session
  - `window.__SYNC_DOWNLOAD_SELECTED__()` — Download selected sessions
  - `window.__SYNC_DOWNLOAD_ALL__()` — Download all sessions
  - `window.__SYNC_CLEAR_SESSIONS__()` — Clear all sessions
  - `window.__SYNC_GET_SESSIONS__()` — Get session summaries
  - `window.__SYNC_GET_PREFS__()` / `__SYNC_SET_PREFS__()` — Telemetry prefs
  - `window.__SYNC_GET_NOTES__()` / `__SYNC_SET_NOTES__()` — Session notes
  - `window.__SYNC_GET_SELECTED__()` / `__SYNC_TOGGLE_SELECT__()` — Session selection
  - `window.__SYNC_CLEAR_SELECTED__()` — Clear selection

- **SyncOverlay.jsx** — Real-time telemetry overlay (toggle via `localStorage.syncDebug`)
  - Drift graph (60-char ASCII scrolling line chart)
  - Histogram display (8-bin distribution)
  - Decision counters (LOCK/RATE/SOFT/HARD per engine)
  - All model stats (bias, presLat, seekLat, decodeLat, frameAge)
  - Confidence + thresholds per engine
  - Engine state (mode, rate)
  - Seek telemetry (soft/hard count + avg drift)
  - 100ms polling interval

### Complexity Metrics

| Metric | Music Menu | Next Most Complex (Monitoring) | Ratio |
|---|---|---|---|
| Total LOC (frontend + backend) | 8,447 | ~5,000 (MonitoringView + 12 sub-pages) | 1.69x |
| Single largest file | 2,837 (Music.jsx) | 1,390 (SendQueueView.jsx) | 2.04x |
| Interacting subsystems | 5 | 3 | 1.67x |
| State machines | 3 (sync, playback, lyrics) | 1 | 3x |
| Real-time feedback loops | 2 (sync tick + lyrics scroll) | 1 | 2x |
| External API providers | 6 (lyrics) + 1 (audio output) | 0 | — |
| Client-side engines | 2 (MV + BG sync) | 0 | — |
| Debug/tooling systems | 1 (telemetry + overlay) | 0 | — |
| localStorage keys used | 8+ | 3 | 2.67x |

### Difficulty Factors

1. **Real-time A/V synchronization** — Must handle drift, buffering, seeking, and looping simultaneously with two independent engines
2. **Adaptive threshold math** — EMA with variance, Welford-like updates, confidence scoring, scheduler awareness
3. **Lyrics sync precision** — Sub-pixel scroll animation with DOM measurement, user scroll detection, auto-resume
4. **Cross-browser audio routing** — `setSinkId` only works on Chromium with secure context, requires fallback handling
5. **XSPF import/export** — XML parsing, path normalization, dedup logic, filesystem scanning
6. **Telemetry system** — Session management, ring buffer, JSON export, console API, overlay rendering
7. **State persistence** — Playlist state survives reload via sessionStorage + localStorage, must reconcile with URL
8. **Error handling** — Permission denied on Docker directories, missing lyrics, unsupported formats, device changes

---

## Part 3: Comparison Summary

### Overall Web Project

The homelab-media-server is a full-stack media management application with 10 top-level views, 150 frontend files, 105 backend files, and ~60K lines of code. The backend is the heavier side (24K LOC) with complex file scanning, download management, and WhatsApp bot integration. The frontend is React-based with a sidebar navigation pattern.

### Music Menu vs. Other Menus

| Menu | Key Complexity Drivers | LOC | #1 Factor |
|---|---|---|---|
| **Music** | A/V sync engine + lyrics sync + audio routing + playlist mgmt + telemetry | 8,447 | **Real-time dual-engine sync with adaptive thresholds** |
| Monitoring | 12 sub-pages with charts, logs, system metrics | ~5,000 | Data visualization variety |
| Send Queue | Per-item scheduling, progress tracking, retry logic | ~1,390 | State management complexity |
| Media Vault | File browsing, filtering, sorting, infinite scroll | ~4,000 | Data volume handling |
| Downloader | HLS segment management, progress tracking | ~1,169 | Streaming protocol handling |
| Bot (WhatsApp) | Message routing, media forwarding, status management | ~550 | External API integration |

### Conclusion

The Music menu is rated **#1 most complex** because it is the only menu that combines:
- A real-time adaptive synchronization engine with two independent drift trackers
- A lyrics synchronization system with DOM measurement-based scroll animation
- Browser audio output device routing with cross-browser fallback
- Full playlist management with XSPF import/export
- A comprehensive telemetry/debug system with session recording and analysis

No other menu in the project has more than 2 of these subsystems active simultaneously, and none requires the same level of real-time precision and adaptive algorithm complexity.
