# Lyrics not centered in cover

## Lokasi File
- **Component**: `frontend/src/components/LyricsDisplay.jsx`
- **Scroll Engine**: `frontend/src/components/LyricsScrollController.js`
- **Parent**: `frontend/src/components/AudioPlayer.jsx` (baris 390-397)

## Deskripsi
Lirik tidak di tengah area cover saat lyrics mode aktif. Lirik bisa muncul di bawah atau di atas cover.

## Root Cause History

### Fix 1 (Awal)
Spacer `h-16` (64px) terlalu kecil untuk container cover.

### Fix 2 (Percobaan kedua)
Scroll calculation double adjustment, spacer tidak include padding, tidak ada ResizeObserver.

### Fix 3 (Architectural Rewrite)
Cumulative height calculations, offsetTop DOM traversal, spacer menggunakan active line height, snap logic.

### Fix 4 (Final — CSS + Measurement)
**6 bug ditemukan dan di-fix:**

#### Bug 1 — DRIFT (Critical)
`will-change: scroll-position` di scroll container bikin browser pakai GPU compositor layer untuk scroll. `getBoundingClientRect()` return nilai STALE dari compositor snapshot → setiap frame animasi baca data salah → koreksi salah → error akumulasi → drift.
**Fix**: Hapus `willChange: 'scroll-position'`.

#### Bug 2 — PATAH (Critical)
Font-size berubah INSTANT dari 14px → 18px saat line jadi active. Tinggi elemen loncat ~6.5px → frame pertama animation baca delta yang termasuk height jump → scroll correction terlalu besar → terasa "patah".
**Fix**: Pakai `transform: scale(1.29)` di CSS, bukan font-size change. Transform tidak mempengaruhi layout → tidak ada height jump → tidak ada delta spike.

#### Bug 3 — PATAH + DRIFT (Critical)
`will-change: opacity` di SETIAP lyrics line bikin 50-100+ GPU compositor layers. Saat transisi, browser harus composite semua layers → frame drops → patah. Juga bikin `getBoundingClientRect()` makin lambat.
**Fix**: Hapus `will-change: opacity` dari CSS.

#### Bug 4 — PATAH (Medium)
Frame pertama animasi langsung scroll `delta * 0.18`. Kalau delta 50px, frame pertama scroll 9px → terasa jerk.
**Fix**: Two-phase — frame pertama pakai gain 0.5, frame selanjutnya pakai 0.18.

#### Bug 5 — Drift (Minor)
Spacer height hardcoded 23px vs actual rendered height (22.75px, bisa 22px tergantung subpixel rendering).
**Fix**: Measure actual height dari first inactive line element.

#### Bug 6 — Patah (Minor)
Previous active line opacity flash jika outside ±4 ring.
**Fix**: Selalu hitung opacity untuk previous active line di distance loop.

## Solusi Final

### Architecture
- **Separated concerns**: `LyricsScrollController.js` (reusable scroll engine) + `LyricsDisplay.jsx` (UI component)
- **Event-driven**: Hanya animate saat active index berubah, bukan continuous rAF loop
- **Fresh DOM measurement**: `getBoundingClientRect()` untuk centering

### LyricsScrollController.js (Scroll Engine)
```
CONFIG:
- AUTO_RESUME_MS: 3000              // Resume setelah 3 detik tidak scroll
- SMOOTH_SCROLL_FACTOR: 0.18        // Lerp factor (frames 2+)
- SMOOTH_SCROLL_FACTOR_INITIAL: 0.5 // Lerp factor (frame pertama — fast catch-up)
- SMALL_DELTA_PX: 0.3               // Threshold untuk stop animasi
- TIME_POLL_INTERVAL_MS: 50         // Polling interval (50ms = 20Hz)
- MAX_ANIMATION_FRAMES: 120         // Safety limit per animasi
- INACTIVE_LINE_HEIGHT: 23          // Fallback jika measure gagal
```

### LyricsDisplay.jsx (UI Component)
- **50ms clock-based polling** (bukan `timeupdate` event)
- **Two-phase scroll**: Gain 0.5 (frame 1) → 0.18 (frame 2+)
- **`transform: scale(1.29)`** untuk active line — tidak mengubah layout/height
- **Dynamic spacer height** — measure dari first inactive line
- **No `will-change`** — hindari GPU compositor layer issues
- **Debug overlay**: Ctrl+Shift+D / `?debugLyrics=1` / localStorage

## Container Hierarchy
```
cover-art-container (relative, max-w-[340px], aspect-square)
└── lyrics-overlay (absolute inset-0, overflow-hidden)
    └── LyricsDisplay root (relative w-full h-full)
        └── scroll-container (absolute inset-0, overflow-y-auto, px-6)
            └── inner-div (min-h-full flex flex-col items-center)
                ├── topSpacer (~158px)
                ├── lyrics lines (all: 14px, active: scale(1.29))
                └── bottomSpacer (~158px)
```

## Status
Fixed — lirik center, animasi halus, no drift, UI ringan.
