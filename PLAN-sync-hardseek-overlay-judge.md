# PLAN — Fix HARD_SEEK frame lock + overlay data + live-drift judge + pairwise sync

## Konteks / Root Cause (terkonfirmasi lewat overlay user)

Lagu tanpa MV → `CachedVideoPlayer` tidak dirender (`Music.jsx:3268`, hanya `{youtubeId && ...}`)
→ `videoRef.current === null`. Namun config MV engine:

- `getReadyState: () => videoRef.current?.getReadyState?.() ?? 4` (`Music.jsx:1998`) — default **4** (siap penuh),
  padahal BG pakai `?? 0` (`Music.jsx:2058`).
- `getPaused: () => ... ?? false` (`Music.jsx:1996`).

Akibatnya MV "membayangkan" ada video ready: `currentTime=0`, `paused=false` → drift = −87 s
→ DecisionEngine memutuskan HARD_SEEK tiap tick (**HARD:9265** pada overlay user), `forceSeek`
pada video yang tak ada = no-op, `seeked` tak pernah datang, `seekPending` nyangkut → Mode RECOVERY permanen.
BG benar (HOLD/IDLE, HARD:0) karena default readyState `0`.

Catatan: Analisa "ExecutionQueue di-share antar engine" dari model lain **tidak benar** —
`executionQueue` dibuat di dalam `createVideoSyncEngine()` (`Music.jsx:106`), jadi per-instance
per engine (MV: `1993`, BG: `2053`). Tidak ada flag `_inFlight` yang dibagi. Satu-satunya butir
valid: `reset()`/`softReset()` tidak memanggil `executionQueue.clear()` → aksi basi bisa menyeberang
lintas ganti lagu. Itu diadopsi sebagai item kecil (A8).

## A. Hentikan loop HARD_SEEK & frame lock

| # | File | Perubahan |
|---|------|-----------|
| A1 | `Music.jsx:1998` | MV `getReadyState` default `4` → `0` (paritas BG) |
| A2 | `Music.jsx:1996` | MV `getPaused` default `false` → `true` |
| A3 | `Music.jsx:2204-2219` | Loop tick 30 ms: skip `mvEngine.tick()`/`bgEngine.tick()` bila video-nya tidak ada |
| A4 | `Music.jsx:2003-2005` | MV `seek` fn: ganti `mvEngine.pause()` → `video.pauseVideo?.()` langsung (guard `getPaused`), jangan lewat engine method yang me-reset `seekPending/mode` → watchdog `tick:396` & constraint `isRecovering` berfungsi |
| A5 | `CachedVideoPlayer.jsx` | Implementasikan coalescing `pendingForceSeekRef` yang benar (set saat seek in-flight, chase saat `seeked`); sekarang dead code |
| A6 | `Music.jsx:265-348` (anchor) | Batas percobaan re-seek `didSeek`: counter `reSeekCount`, jika >2 ke target sama tanpa mendarat → stop re-seek, force `play` |
| A7 | `Music.jsx:160-166` + `CachedVideoPlayer.jsx` | Clamp target ke `[0, duration]` di `resolveTarget` (non-looping) dan di `forceSeek`/`seekTo` (guard NaN/Infinity) |
| A8 | `Music.jsx:186-263` | `executionQueue.clear()` di `reset()`/`softReset()` |

## B. Perbaiki overlay (field 0 / no data)

| # | File | Perubahan |
|---|------|-----------|
| B1 | `Music.jsx:117-158,457,186-263` | `state.driftAccelerationMs` tidak pernah di-set → tambah ke state, set di `tick`, tambah ke `reset()`/`softReset()` |
| B2 | `Music.jsx:350-392` | BG `tick` return dini di `readyState<3` sebelum `recordClockSnapshot` (`tick:462`) → buat helper `recordClock()` dan panggil juga di cabang early-return (paused/seeking/not-ready/not-playing) agar CLOCK PROVENANCE selalu tercatat |
| B3 | — | Konsekuensi otomatis A: Drift ~0, HARD:0, Mode IDLE, Sync OK, histogram/graph berisi |
| B4 | `SyncOverlay.jsx:305` | `BiasN` BG pakai `bg?.stats?.biasSamples` → `bg?.biasSamples` (samakan dengan MV) |

## C. Juri baca drift real-time + hold adaptif

| # | File | Perubahan |
|---|------|-----------|
| C1 | `Music.jsx:638-670` | Teruskan `validatedSensor` (drift instan) + `driftMemory.driftHistory` (trend) + `framePeriodMs` ke `decide()` — juri gabungkan live + EMA, bukan EMA saja |
| C2 | `utils/memory/DerivedMetrics.js` | Tambah `sampleCount` (dari `driftEMA.count`) ke derived metrics |
| C3 | `utils/decision/DecisionEngine.js` | Tambah jalur **HOLD_TO_OBSERVE** adaptif: `adaptiveHoldMs(confidence, sampleCount)` — confidence ≥0.9 & sampel ≥30 → instan (observeMs 0); ≥0.7 → ~150 ms; ≥0.5 → ~300 ms; <0.5 → ~800 ms. `decide()` kembalikan `observeMs`; bila low-confidence, kembalikan HOLD + `observedType` |
| C4 | `Music.jsx` tick decision section | Engine kelola `state.holdUntil = max(holdUntil, now + observeMs)`; hanya enqueue action bila `observeMs === 0`; tambah `state.observeMs`/`holdUntil` ke reset |
| C5 | `SyncOverlay.jsx` | Tambah row **Hold** (sisa `holdUntil - now`) di kartu SYNC STATUS |

## D. Target pairwise Audio↔MV↔BG = 0 ms

Toleransi = **1 frame period** per engine dari FPS terukur (24/30/60 fps → 41.7/33.3/16.7 ms, fallback 33 ms).

| # | File | Perubahan |
|---|------|-----------|
| D1 | `Music.jsx` tick | Hitung `mvFramePeriodMs`/`bgFramePeriodMs` dari `syncCore.getStats(...).stats.fps.current`, kirim `pairwiseThresholdMs = max(keduanya)` ke `decide()` |
| D2 | `utils/decision/DecisionEngine.js` | Rule pairwise: bila `|triangleDrifts.mvBgMs| > pairwiseThresholdMs` padahal masing-masing dekat audio → koreksi engine yang lebih jauh dari audio (soft-seek/rate menuju audio), 1 engine per tick (pilih yang `|audio drift|` lebih besar; tie-break nama engine) |

## Verifikasi

```bash
cd /home/CATIAA/homelab-media-server/frontend && npx vite build --mode development
```

- Lagu tanpa MV → overlay: MV HOLD/IDLE, HARD:0, drift ~0, tidak RECOVERY.
- Lagu dengan MV → hard seek tidak strobing; Audio↔MV↔BG ≤ frame period; Drift Δ² terisi; BG CLOCK PROVENANCE terisi.
- Overlay: `window.__SYNC_DEBUG__ = true`; log: `window.__SYNC_ENABLED__ = true`.

## Urutan eksekusi

1. Fase 1 = A (A1–A8) + build.
2. Fase 2 = B (B1, B2, B4) + build.
3. Fase 3 = C (C1–C5) + build.
4. Fase 4 = D (D1–D2) + build.
5. Smoke-test manual di browser oleh user.

## Status

- ✅ **Fase 1 (A)** — semua terpasang. Deviasi dari plan: A7 dipecah jadi `resolveTarget`
  clamp (`Music.jsx:160-166`) + `clampTime()` di `CachedVideoPlayer.jsx`; A6 guard
  `reSeekCount` terpasang di branch `didSeek` `anchor`.
- ✅ **Fase 2 (B)** — B1 (`driftAccelerationMs` → state + reset), B2 (`recordClock` helper
  di scope factory, dipanggil di 4 cabang early-return + tick normal), B4 (BiasN BG). B3 otomatis.
- ✅ **Fase 3 (C)** — C1 (lewat `validatedSensor` via `sensorCtx` + `driftHistory` +
  `mvFramePeriodMs`/`bgFramePeriodMs` ke `decide()`), C2 (`sampleCount`), C3 (HOLD_TO_OBSERVE
  `C012`, hold adaptif 250/120/0 ms berdasar `sampleCount/confidence/sensor valid/history`),
  C4 (engine set `state.holdUntil = now + holdMs`, gate di awal decision block, `observeMs` untuk
  overlay), C5 (row **Hold** di kartu SYNC STATUS mv+bg).
- ✅ **Fase 4 (D)** — D1 (`mvFramePeriodMs`/`bgFramePeriodMs` dari `syncCore.mv/bg.fps.current`,
  fallback 33 ms), D2 (rule pairwise `|mvBgMs| > min(mvPeriod, bgPeriod)` → koreksi engine yang
  lebih jauh dari audio, 1 engine/tick; HARD_SEEK bila > 2.5×tol, SOFT_SEEK/SET_RATE bila dekat;
  reason code `PAIRWISE_OFFSET` `C013`).
- ✅ Build `npx vite build --mode development` lulus (warn chunk >500 kB normal).
- ⏭️ Menunggu smoke-test manual user. Belum di-commit.

## Round 2 — BG HARD_SEEK deadlock (dari overlay user)

Symptom: MV sudah bersih (HARD:1, drift −42 ms) tapi **BG HARD:239**, `hard_seek bg` tiap
~30 ms terus-menerus, BG terjebak di 5.96 s vs audio 12.3 s, Δ MV↔BG −6320 ms.

Root cause: **watchdog seek-stuck di `tick`** (`Music.jsx:~477`) memakai `state.lastAnchorTime`,
tapi jalur decision `hardSeek` dan `engineAnchor` (anchor milik ExecutionQueue) **tidak pernah
mengisi `lastAnchorTime`** (hanya jalur softSeek & `anchor()` asli yang mengisi). Akibatnya:
seekPending=1 tiap tick → watchdog melihat `now − lastAnchorTime(≈0) > 2000` → langsung clear
seekPending + buang `pendingAnchorTarget` → tick berikutnya decision hardSeek lagi → loop 30 ms.
Video tak pernah diberi kesempatan mendarat + anchor-play, `seeked` datang tapi pending-anchor
sudah dibuang → video berhenti melacak audio.

Fix yang diterapkan:
- `Music.jsx` hardSeek decision block: set `state.lastAnchorTime = now` + `graceUntil` (watchdog
  kini mengukur sejak seek benar-benar dimulai).
- Watchdog: hanya clear bila `state.lastAnchorTime > 0 && now − lastAnchorTime > 2000`; saat
  clear, reset `lastHardSeekTime=0` supaya play-retry di tick berikutnya tidak diblokir
  `justHardSeeked` (video yang pause tidak jadi di-play → drift membesar terus).
- Throttle hard-seek di decision: bila `lastHardSeekTime` < 1 s, jangan re-issue hardSeek
  (log `hard_seek_throttled`) — max ~1 seek/detik, beri waktu mendarat+recovery.
- Anti-wedge seek BG: `bgSeekInProgressRef` kini punya timestamp (`bgSeekStartedAtRef`); jika
  event `seeked` terlewat dan flag macet >2 s, seek berikutnya dipaksa fresh (bukan silent-drop).
  Reset timestamp di seeked/onPause/track-change.

## Round 3 — MV loop tersisa + DecisionEngine pakai threshold statis (dari overlay user)

Symptom: BG sudah membaik (drift −66 ms, Δ Audio↔BG −67 ms, LockTicks 262) tapi **MV masih
loop**: HARD:13, drift −782 ms, Mode RECOVERY, SeekPend YES, Δ Audio↔MV −453 ms, Δ MV↔BG +386 ms,
Consistency 30% outlier MV. Log seek MV mendarat ~2 s lebih pendek dari `t=` — tapi `t=` itu
wall-clock (`performance.now()/1000`), bukan target seek, jadi MV sebenarnya hanya ~450 ms di
belakang audio.

Root cause: `DecisionEngine.decide()` memakai konstanta `softThresholdMs=30` / `hardThresholdMs=300`,
padahal adaptive threshold MV di overlay = SoftTh 40 ms / HardTh 500 ms (dari
`syncCore.getAdaptiveThresholds('mv')`). Drift MV −453 ms (di bawah adaptive hard 500 ms) tetap
di-rating HARDSEEK tiap tick karena 453 > 300 → loop. `LearningMemory.adaptiveThresholds` tidak
pernah di-update (selalu default 30/300), dan `DerivedMetrics` tidak meneruskannya ke DecisionEngine.

Fix yang diterapkan:
- `DerivedMetrics.js`: `adaptiveThresholds` (dari `memorySnapshot.adaptiveThresholds`) kini
  diteruskan ke `createDerivedMetrics` dan dibekukan di hasil — DecisionEngine bisa membacanya.
- `Music.jsx` tick: setelah hitung `softThreshold`/`activeHardThreshold` (detik), panggil
  `learningMemory.setAdaptiveThresholds({ softMs: soft*1000, hardMs: hard*1000 })` supaya nilai
  adaptive syncCore mengalir ke snapshot → derivedMetrics → DecisionEngine (MV jadi 40/500, BG 8/200).
- `DecisionEngine.js`: `softThresholdMs`/`hardThresholdMs` diambil dari
  `derivedMetrics.adaptiveThresholds?.softMs/hardMs` (fallback 30/300).
- `DecisionEngine.js` pairwise rule: gate HARD_SEEK dinaikkan dari `pairTol*2.5` menjadi
  `max(hardThresholdMs, pairTol*2.5)` — jadi pairwise tak lagi hard-seek MV di bawah adaptive hard
  (MV −453 ms → turun ke SOFT_SEEK/SET_RATE, bukan HARDSEEK tiap tick).

Belum ditangani (perlu data live):
- Mengapa pembacaan `getCurrentTime()` MV tampak tidak maju setelah seek (~0.4–2 s di belakang) —
  cek interaksi `chasing pending`/`forceSeek` di `CachedVideoPlayer.jsx` bila drift tetap tinggi.
- Build `npx vite build --mode development` lulus. Belum di-commit. ⏭️ Menunggu smoke-test manual.

## Round 3b — BG "frame jalan, ditarik, ga bisa keep" (dari log + overlay user)

Symptom: MV sudah bersih (Δ Audio↔MV 40ms) tapi **BG jatuh -3536ms** (A 10629 / BG 7093),
BG Judge HARDSEEK tiap ~1-2s, drift 414→510→3233→3155→3588 (membesar), Decoder BG "PAUSED",
BG hanya maju ~2800ms selama audio maju ~6000ms (efektif ~0.5x). Konsisten dengan "biarin frame
jalan, annti di tarik" — BG praktis diam di antara hard seek.

Root cause (dari trace seek lifecycle):
1. **Re-anchor ke target basi.** Decision hardSeek enqueue `target: audioTarget` (saat tick),
   lalu `ExecutionQueue.anchor` menyimpan nilai persis itu ke `pendingAnchorTarget`. Native seek
   butuh ~1-2s (buffering/waiting). Saat `seeked` akhirnya datang, `onSeeked` re-anchor ke
   `pendingAnchorTarget` yang **stale** (`Music.jsx` lama:935) → video mendarat ~1-2s di belakang
   audio saat itu → drift membesar lagi → hard seek lagi. Loop, gap tumbuh.
2. **Deferred seek dibuang.** `bgPendingForceSeekRef` diisi (2196) saat seek lain in-flight tapi
   tidak pernah dikonsumsi → koreksi yang datang saat seek lain berjalan hilang.

Fix yang diterapkan (Round 3b):
- `Music.jsx` `onSeeked`: re-anchor sekarang ke **posisi audio LIVE** saat `seeked` tiba
  (`freshTarget = getAudioCurrentTime() + getVideoOffset()`), bukan `pendingAnchorTarget` basi.
  Video mendarat di posisi audio terkini → drift ≈ 0 → hard seek berhenti, playback jalan dari
  titik nyaris sinkron dan konvergen.
- BG video `onSeeked` handler: `bgPendingForceSeekRef.current = null` (target yang diparkir saat
  seek lain in-flight sudah disupersed re-anchor live; dibuang biar tidak diterapkan basi).

Catatan:
- `anchor()` sendiri tetap membatasi re-seek (reseen-bound setelah 2×), jadi re-anchor live tidak
  bisa loop tanpa batas.
- Build lulus. Belum di-commit. ⏭️ Menunggu smoke-test manual.

## Round 3c — MV hard-seek loop: video tak pernah PLAY + rate catch-up mati

Symptom (overlay+log user setelah Round 3b): BG sudah bersih (Δ Audio↔BG −214ms) tapi
**MV jatuh −3465ms** (A 14856 / MV 11391), Consistency 30% outlier: MV, MV HARD:5, Decoder MV
PAUSED, waiting 25×/pause 21×. Di CachedVideoPlayer: tiap `seeked` ct-nya SAMA dengan `seeking`
ct (seek tak menggerakkan posisi ke arah audio), video praktis diam di antara hard seek.

Temuan akar masalah:
1. **SET_RATE tanda terbalik** (`Music.jsx` setRate handler): `newRate = 1 + sign(correctedDrift)*delta`.
   `correctedDrift = current - target`; MV di belakang → negatif → rate < 1 → video justru
   DIPERLAMBAT → makin tertinggal. Karena itu RATE tak pernah dipakai (RATE:0) dan engine terpaksa
   andalkan hard seek yang selalu mendarat pendek.
2. **SET_RATE terblokir saat seek futile**: DecisionEngine rate branch mensyaratkan
   `futileCount < 3`; saat FUTILE_SEEK_PATTERN aktif (futileCount≥3) malah jatuh ke HOLD, bukan rate.
3. **Play ditunda 3s setelah hard seek** (`justHardSeeked` gate): tiap hard seek pause video
   (gap>0.3), lalu play ditunda sampai canplay/playing — dengan hard seek tiap ~1-2s video hampir
   tak pernah benar-benar PLAY → tidak bisa mengejar (dan tak bisa melewati celah keyframe yang
   membuat seek selalu mendarat pendek).

Fix yang diterapkan (Round 3c):
- SET_RATE: tanda dibalik (`1 - sign*delta`) + clamp [0.5, 2.0]. Video di belakang → rate >1 → catch-up.
- DecisionEngine rate branch: `futileCount < 3` dihapus → SET_RATE jadi jalur default saat drift >
  soft threshold (termasuk saat seek terbukti futile), menggantikan hard/soft seek yang buntu.
- Deteksi futilitas hard-seek di tick: hard seek yang sudah settle (seekPending clear, >1.2s) tapi
  drift masih ≥ adaptive hard threshold dan tak membaik ≥10% → `learningMemory.recordFutile()`.
  Setelah 3× futile → FUTILE_SEEK_PATTERN memblokir SEEK → decision beralih ke SET_RATE.
- `onSeeked`: play di-resume segera setelah seeked (hapus gate justHardSeeked/readyState), kecuali
  decoder sedang `waiting` (onCanPlay/onPlaying retry lewat playRetryPending). Stream sudah fully
  buffered (buf penuh), jadi menunda play hanya bikin video pause terus.

Catatan:
- Fresh re-anchor Round 3b dipertahankan (itu yang bikin BG mendarat di posisi audio live).
- Build lulus. Belum di-commit. ⏭️ Menunggu smoke-test manual.
