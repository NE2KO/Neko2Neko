# Music Sync Engine — Stabilization & Calibration Roadmap

## Status: Investigation Phase → Targeted Fixes

**Core Principle:** Stop generating new hypotheses. The data is strong enough to act on confirmed findings.

Evidence hierarchy (highest confidence first):
1. ✅ Soft seek recovery is structurally slower than hard seek in browser environment (150-170ms vs 20-30ms)
2. ✅ Bias learning materially improves engine stability (sigma 2ms vs 67ms)
3. ✅ BG engine has structural offset (-205ms bias, 85ms seek latency) vs MV (+15ms bias, 19ms seek latency)
4. ✅ Spike recorder categorizes BG spikes as SEEK_COMPLETE 95%+ confidence
5. 🔶 Periodic ~200ms clock jumps observed in provenance (needs validation)
6. 🔵 Drift acceleration (Δ²drift) added as early spike detector (not yet validated)

---

## Confirmed Findings (Do Not Re-Debate)

### F1. Soft Seek is Slow in Browser
- Soft seek recovery: 150-170ms across multiple measurements (159, 160, 153, 168, 141)
- Hard seek recovery: 20-30ms (MV), 85ms (BG)
- **This is browser/media pipeline behavior, not engine logic.**

### F2. Bias Learning is Effective
- Bias ON: MV sigma 2ms, BG sigma 36ms (BG still has structural offset)
- Bias OFF: both engines sigma 65-67ms
- Bias is AMPLIFIER, not root cause: EMA learns real structural offset (-205ms BG)

### F3. BG is the Problem, MV is Healthy
- MV: sigma 2ms, softTh 8ms (minimum), lock% 45%, bias +15ms
- BG: sigma 36ms, softTh 40ms, bias -205ms, corrected drift 157ms
- Hard seek latency gap: BG 85ms vs MV 19ms = **66ms structural difference**
- Soft seek total path: BG 709ms vs MV 141ms

### F4. BG Spikes are Post-Seek Transients
- BG spike recorder: ~100% SEEK_COMPLETE (confidence 95%)
- MV: mixed (SEEK_COMPLETE, DECODER, SCHEDULER)
- This indicates seek pipeline latency, not scheduler or EMA issues

### F5. Potential Periodic Pattern
- Clock provenance shows repeating pattern: normal tick (30ms) → spike (199ms) → normal (30ms) → spike (178ms)
- Period: ~60ms between large deltas
- **Hypothesis:** Something in browser pipeline causes periodic ~200ms stall (decoder flush? compositor? keyframe boundary?)
- **Action:** Validate in Track 0.5/0.75 before fixing

### F6. Drift Acceleration (Δ²drift) as Early Spike Detector
- First derivative: `driftDeltaMs = Math.abs(rawDriftMs - prevRawDriftMs)` — measures velocity per tick
- Second derivative: `driftAccelerationMs = Math.abs(driftDeltaMs - prevDriftDeltaMs)` — measures acceleration
- Pattern: normal LOCKED drift changes gradually (~3-10ms/tick), velocity ~0-5ms, acceleration ~0-2ms
- Pre-spike signature: velocity jumps to 20-50ms/tick, acceleration spikes to 15-40ms/tick BEFORE rawDrift crosses 50ms threshold
- **Value:** Detects spike onset 1-2 ticks earlier than rawDrift threshold, enabling pre-emptive attribution
- **Implementation:** Add `prevDriftDeltaMs` to engine state; compute acceleration in `tick()` before `observeDrift`
- **Overlay:** Show drift acceleration alongside drift velocity; color code: |acc| < 5 green, 5-15 yellow, >15 red

### F7. Consistent Post-Seek Pipeline Pattern Across All Sessions
- Observed pattern across multiple sessions:
  ```
  Browser seek
  ↓
  pipeline flush
  ↓
  decoder belum produces frame
  ↓
  video clock tertahan
  ↓
  audio clock tetap jalan
  ↓
  drift naik
  ↓
  engine mengoreksi
  ↓
  stabil lagi
  ```
- This is NOT an engine algorithm bug. It is browser/media pipeline behavior.
- Engine must be **tolerant of this transien** rather than trying to "fix" it via threshold/EMA changes.

---

## Strategic Reframing (2026-07-31)

Berdasarkan observasi telemetry dan analisis drift, fokus investigasi telah bergeser:

**Dari:** "Algoritma sync salah? Threshold terlalu tinggi? Bias tidak aktif?"

**Menjadi:** "Algoritma sudah cukup baik. Issue yang tersisa adalah karakteristik browser media pipeline — yang saat ini merupakan hipotesis utama, bukan kesimpulan akhir."

Implikasi langsung:
- **Threshold adalah efek, bukan penyebab.** Nilai `SoftTh 8/40ms` dan `HardTh 200ms` adalah respon adaptif terhadap `σ` aktual. Mengubah threshold tanpa memahami sumber spike hanya menggeser masalah.
- **Pertanyaan prioritas sekarang:** Apakah spike berasal dari **browser subsystem** (decoder queue, compositor, RVFC, seek pipeline) atau dari **algoritma sync** itu sendiri?
- **Checkpoint kritis sebelum Track A:** Verifikasi integritas clock, lalu verifikasi periodisitas spike. Jika spike muncul dengan pola waktu tertentu (e.g., setiap 200ms), itu menunjuk ke proses browser yang periodik, bukan ke algorithm bug.

---

## Evidence Hierarchy

1. ✅ **Soft seek recovery 150–170ms** — Evidence: **L4** (terverifikasi lintas browser, Chrome & Firefox)
2. ✅ **Bias learning efektif: sigma 2ms vs 67ms** — Evidence: **L2** (reproducible dalam satu session, perlu verifikasi lebih lanjut untuk L3+)
3. ✅ **BG structural offset -205ms, hard seek 85ms vs MV +15ms, hard seek 19ms** — Evidence: **L3** (terukur, verified via seek pipeline instrumentation)
4. 🔶 **BG spikes ~100% SEEK_COMPLETE — hipotesis utama: post-seek pipeline latency** — Evidence: **L1** (terlihat sekali, perlu Clock Integrity + native comparison untuk naik ke L3+)
5. 🔶 **Clock provenance: pola `30 / 30 / 199 / 30 / 30 / 178 / 30 / 30 / 210`** — Evidence: **L1** (terlihat sekali, perlu Clock Integrity + Periodicity Verification untuk naik ke L3+)
6. 🔵 **Drift acceleration (Δ²drift): early detector** — Evidence: **L0** (belum di-validasi di lapangan, perlu data collection untuk naik ke L1+)
7. 🔶 **Pola post-seek lintas session: browser seek → pipeline flush → decoder belum produces frame → video tertahan → audio lanjut → drift naik → engine koreksi → stabil** — Evidence: **L2** (reproducible lintas session, perlu verifikasi lebih lanjut untuk L3+)
8. 🔵 **Algorithm determinism belum diuji** — Evidence: **L0** (belum ada harness; perlu Algorithm Determinism Test untuk naik ke L1+)

---

## Evidence Level Taxonomy

Setiap temuan diberi tingkat keyakinan agar keputusan berbasis bukti, bukan hanya status benar/salah.

| Level | Arti                         | Contoh                                                |
| ----- | ---------------------------- | ------------------------------------------------------ |
| L0    | Dugaan                       | "Kemungkinan decoder yang menyebabkan spike"           |
| L1    | Terlihat sekali              | "Setiap spike diikuti oleh event `seeking`"            |
| L2    | Reproducible                 | "Pola terulang di 5/5 percobaan dalam satu session"     |
| L3    | Terukur                      | "Spike terjadi 200ms setelah `seeking`, verified via clock provenance" |
| L4    | Terverifikasi lintas browser | "Pola sama di Chrome dan Firefox"                       |
| L5    | Terverifikasi native         | "Pola hilang di libmpv/GStreamer → confirmed browser-origin" |

### Penggunaan

- Setiap finding di Evidence Hierarchy harus dilengkapi dengan Evidence Level.
- Keputusan untuk masuk Track A hanya boleh diambil jika finding yang mendasinya minimal **L3**.
- Jika finding hanya **L0/L1**, lanjutkan instrumentasi, jangan ubah engine behavior.
- **Reference Baseline Matrix** menetapkan target numerik sehingga setiap sigma/lock% bisa dibandingkan dengan lingkungan lain (L5 untuk perfect synthetic, L4 untuk browser, L3 untuk mpv native).

---

## Revised Roadmap: Origin-First, Algorithm-Last

```
Engine Logic
    │
    ▼
Algorithm Determinism Test            ← Level A (Functional) + Level B (State Transition)
    │   (synthetic input, 1000+ runs,
    │    SHA256 state hash per tick)
    ▼
Reference Baseline Matrix              ← NEW — target numerik sebelum tuning
    │   (Perfect / Simulated / mpv / Chromium / Firefox)
    ▼
Runtime Characterization               ← COMBINED (Clock Integrity + Clock Quality + Environment)
    │   (clock provenance, ground truth,
    │    display/decoder/gpu/audio/vsync snapshot)
    ▼
Spike Periodicity Verification
    │   (auto-correlation / spectral analysis,
    │    kategori: periodik / acak / event-driven)
    ▼
Confidence Gate (13 criteria)
    │
    ▼
Decision
    ├── Kalau periodik → Browser subsystem investigation (skip Track A)
    └── Kalau acak/event-driven → Track A (targeted fixes)
```

---

## Updated Confidence Gate (13 Criteria — ALL MUST PASS before Track A)

**Semua harus lulus sebelum Track A:**

### 8 Data Criteria
1. **Spike count:** ≥ 50 (prefer 100)
2. **Categorized rate:** ≥ 80%
3. **Unknown rate:** ≤ 20%
4. **Top-1 confidence:** ≥ 85%
5. **Subsystem attribution:** top-3 causes confirmed via Track 0.5 + 0.75
6. **BG seek pipeline:** assessed dan classified (structural vs fixable)
7. **Reproducibility:** dominant spike pattern reproducible across ≥ 3 distinct playback sessions
8. **Spike Periodicity Verification (NEW):** dominant spike pattern either:
   - A. Periodik → identifikasi interval dalam ±15% Jaccard/auto-correlation; atau
   - B. Acak → verifikasi via spectral analysis / autocorrelation bahwa tidak ada period dominan; atau
   - C. Event-driven → 100% terkait dengan seek/lifecycle event terverifikasi

### 5 Mandatory Verifications (prerequisite for Track A)
9. **Algorithm Determinism Test (NEW):** engine diberi input sintetis identik untuk 1000+ runs; output keputusan harus sama setiap kali. Jika berbeda: algoritma memiliki nondeterminism internal.
10. **Reference Baseline Matrix (NEW):** target numerik ditetapkan untuk setiap lingkungan (Perfect synthetic, Simulated noise, mpv native, Chromium, Firefox). Tanpa baseline, tuning tidak punya pembanding objektif.
11. **Runtime Characterization (COMBINED — replaces Clock Integrity + Clock Quality + Environment):**
    - **Clock Integrity Verification:** pastikan clock mana yang mengalami diskontinuitas saat spike (`audio.currentTime` vs `video.currentTime` vs `performance.now()` vs `RVFC.mediaTime`)
      - Validasi: setiap spike harus terklasifikasi ke clock source yang mengalami diskontinuitas
    - **Clock Quality Characterization:** matriks kualitas setiap clock source → identifikasi **ground truth clock**
      - `performance.now()`: monotonic, resolution, jitter
      - `audio.currentTime`: monotonic, resolution, jitter, vs `performance.now()`
      - `video.currentTime`: monotonic, resolution, jitter, vs `performance.now()`
      - `RVFC.mediaTime`: monotonic, resolution, jitter, vs `performance.now()`
    - **Environment Validation:** isolasi faktor eksternal di bawah layer browser yang bisa mempengaruhi timing
      - Display, Video Decoder, Audio Backend, GPU Backend, Compositor, Power State, Refresh Rate
      - Outcome: environment contributors diidentifikasi; netral atau known limitation ter-dokumentasi
12. **Reproducibility Gate (NEW as formal criterion):** dominant pattern must reproduce in ≥4/5 attempts per session across ≥3 sessions.

**Jika A atau B terverifikasi periodik:** Lanjut browser subsystem investigation sebelum Track A. Track A hanya berlaku jika C (acak) terverifikasi atau setelah browser issue diperbaiki.

**Jika SNR fails untuk attribusi atau determinism gagal atau clock quality gagal atau environment gagal:** Stop semua Track A. Lanjut instrumentasi.

---

## Algorithm Determinism Test (Level A + Level B — sebelum Reference Baseline)

Tujuan: verifikasi engine secara murni, tanpa variable browser/audio/video.

### Level A — Functional Determinism

Input identik → Output identik.

- Build harness yang memberikan input sintetis identik ke engine:
  - `audio.currentTime` disimulasikan: `10.000, 10.030, 10.060, ...`
  - `video.currentTime` disimulasikan: `10.042, 10.072, 10.102, ...`
  - `drift` diberikan sebagai fixed sequence: `42, 21, 8, -5, ...`
- Jalankan engine untuk **1000+ runs** dengan input yang sama persis.
- Bandingkan output keputusan setiap run:
  - `mode` (LOCKED / RECOVERY / etc.)
  - `correctedDrift`
  - `biasEMA.value`
  - `lockedConsecutiveTicks`
  - decision log

### Level B — State Transition Determinism

Input stream identik → State transition identik.

Engine bukan pure function: dia punya EMA, histogram, replay, bias, rolling stats, lock counter, state machine. Yang dibandingkan bukan cuma output, tetapi **state seluruh engine setiap tick**.

- Build harness yang mereplay input stream yang sama persis (misalnya 3000 tick).
- Setiap tick, hitung hash dari seluruh state machine:
  ```
  SHA256(
    mode,
    biasEMA.value,
    biasEMA.samples,
    rawDriftEMA.value,
    rawDriftEMA.stdDev,
    correctedDriftEMA.value,
    rollingStats.min, rollingStats.max, rollingStats.sum,
    decisionCounter,
    lockTicks,
    candidateTicks,
    seekPending,
    seekJustCompleted,
    recentDrifts[],       // ring buffer
    replayLog[],          // ring buffer
    ...
  )
  ```
- Jalankan 1000+ replays dengan input identik.
- Hash setiap tick harus identik di semua runs.

### Kriteria Pass

- **Level A:** Semua 1000+ runs menghasilkan `JSON.stringify(decisionLog)` yang sama.
- **Level B:** SHA256 state hash setiap tick identik untuk semua 1000+ runs.
- Tidak ada discrepancy akibat `Date.now()`, `Math.random()`, atau unordered Map/Set iteration.

### Kriteria Fail

- Ada minimal 1 perbedaan output atau state hash antar runs.
- Maka algoritma memiliki nondeterminism internal yang perlu diperbaiki sebelum dibandingkan dengan environment lain.

### Outcome

- **Deterministic:** lanjut ke Reference Baseline Matrix. Engine dapat diandalkan sebagai baseline.
- **Non-deterministic:** stop, fix algoritma terlebih dahulu. Track A, Track B, native comparison tidak boleh dimulai sampai engine deterministic.

---

## Reference Baseline Matrix (NEW — setelah Algorithm Determinism)

Tujuan: menetapkan **target numerik** sebelum tuning. Tanpa baseline, semua tuning menjadi "sigma 8ms — bagus? entahlah."

### Acceptance Baseline (Target Numerik)

Target sebelum tuning dimulai. Semua target adalah PASS threshold, bukan aspirasi estetis.

| Environment       | Sigma    | Lock%    | Soft/min | Hard/min | Correction latency | Status   |
| ----------------- | -------- | -------- | -------- | -------- | ------------------ | -------- |
| Synthetic Perfect | ≤0.5 ms  | ≥99.9%   | 0        | 0        | —                  | Target   |
| Synthetic Noise   | ≤3 ms    | ≥95%     | ≤2       | 0        | —                  | Target   |
| mpv native        | ≤5 ms    | ≥90%     | ≤3       | 0        | HA ≤40ms           | Target   |
| Chromium          | Measured | Measured | Measured | Measured | Measured           | PASS     |
| Firefox           | Measured | Measured | Measured | Measured | Measured           | PASS     |

Keterangan:
- `Soft/min` dan `Hard/min`: rata-rata per menit steady-state, bukan burst seek saat track change.
- `Correction latency`: hard seek completion latency, khususnya untuk BG engine yang terlihat lebih lambat di browser.
- Synthetic Perfect dan Synthetic Noise diproduksi oleh golden replay harness; tidak perlu environment khusus.
- mpv native target ditunda ke Phase 2 jika environment belum tersedia; baseline browser tetap diisi terlebih dahulu.
- Browser target adalah **measured**, bukan **target** numerik, karena lingkungan browser tidak sepenuhnya di bawah kendali aplikasi.

### Baseline Matrix

| Environment       | Sigma    | Lock%    | Soft Seek/hr | Hard Seek/hr | Avg Hard Seek Latency | Evidence |
| ----------------- | -------- | -------- | ------------ | ------------ | --------------------- | -------- |
| Perfect synthetic | target   | target   | target       | target       | target                | L5       |
| Simulated noise   | target   | target   | target       | target       | target                | L5       |
| mpv native        | measured | measured | measured     | measured     | measured              | L5       |
| Chromium          | measured | measured | measured     | measured     | measured              | L4       |
| Firefox           | measured | measured | measured     | measured     | measured              | L4       |

### Metodologi

1. **Perfect synthetic:** Node.js harness (lihat Golden Replay Suite) dengan clock tanpa jitter, tanpa decoder stall, tanpa seek latency. Target: sigma <0.5ms, lock% >99%.
2. **Simulated noise:** Tambahkan Gaussian noise (σ=1ms, σ=5ms, σ=10ms) ke synthetic clock. Target: sigma sesuai noise floor, lock% tetap tinggi.
3. **mpv native:** Jalankan engine di libmpv/GStreamer (Phase 2). Target: measured baseline.
4. **Chromium:** Ukur di environment saat ini. Target: measured baseline.
5. **Firefox:** Ukur di environment saat ini. Target: measured baseline.

### Exit Criteria

- Perfect synthetic selesai (sigma, lock%, seek latency tercatat)
- Simulated noise selesai (1ms, 5ms, 10ms noise floors tercatat)
- mpv native selesai (atau ditunda ke Phase 2 dengan dokumentasi)
- Browser environments (Chromium, Firefox) selesai diukur

Setiap perubahan algoritma dibandingkan dengan Acceptance Baseline, bukan hanya state sebelumnya. Baru tuning boleh dimulai. Kalau hasil tuning turun under baseline, itu regresi walaupun "terasa lebih baik" di lapangan.

---

## Runtime Characterization (COMBINED — replaces Clock Integrity + Clock Quality + Environment)

Tujuan: gabungkan Clock Integrity, Clock Quality, dan Environment Validation menjadi satu fase yang efisien karena faktor-faktor ini saling bergantung (misalnya refresh rate mempengaruhi clock quality, decoder mempengaruhi clock integrity).

### Clock Integrity Verification

Pastikan clock mana yang mengalami diskontinuitas saat spike.

```
audio.currentTime
vs
video.currentTime
vs
performance.now()
vs
RVFC.mediaTime
```

**Validasi:**
- Jika `video.currentTime` meloncat tapi `RVFC.mediaTime` normal → masalah di video pipeline, bukan decoder.
- Jika `performance.now()` meloncat → scheduler issue.
- Jika `audio.currentTime` meloncat → audio pipeline.

**Output:** klasifikasi per-spike ke clock source yang mengalami discontinuity.

### Clock Quality Characterization

Tentukan clock mana yang paling bisa dipercaya sebagai **ground truth** untuk analisis selanjutnya.

Berbeda dari Clock Integrity (siapa yang meloncat), Clock Quality bertanya: **siapa yang paling stabil secara intrinsik?**

#### Matrix

| Clock               | Monotonic | Resolution | Jitter (target) | Trust Level | Notes |
| ------------------- | --------- | ---------- | --------------- | ----------- | ----- |
| `performance.now()` | ✅         | ~0.1ms     | <1ms            | High        | Browser monotonic, bukan realtime |
| `audio.currentTime` | ?         | ?          | ?               | ?           | Perlu validasi vs `performance.now()` |
| `video.currentTime` | ?         | ?          | ?               | ?           | Perlu validasi vs `performance.now()` |
| `RVFC.mediaTime`    | ?         | ?          | ?               | ?           | Perlu validasi vs `performance.now()` |

#### Validasi
- Ambil 1000 sampel selama 30 detik steady-state playback.
- Hitung: delta consecutive, stdDev, gap vs `performance.now()`.
- Tentukan: mana yang punya jitter terendah, mana yang punya gap paling konsisten.

#### Outcome
- **Ground truth clock** ditetapkan untuk:
  - Periode drift calculation
  - Spike timestamp anchoring
  - Periodicity analysis
- Clock dengan jitter tinggi ditandai sebagai **untrusted** dan tidak boleh jadi reference untuk analisis periodisitas.

### Environment Validation

Isolasi apakah spike dipengaruhi oleh **variabel eksternal di bawah layer browser**, sehingga tidak salah disalahkan ke algoritma sync atau browser subsystem.

#### Variabel yang Diukur

| Category              | Parameter                         | Measurement Method               |
| --------------------- | --------------------------------- | --------------------------------- |
| **Display**           | Refresh rate, VSync, FPS          | `requestAnimationFrame` timing, `screen` API fallback |
| **Video Decoder**     | Hardware acceleration, codec, lag | CDM status, decode latency dari seek pipeline |
| **Audio Backend**     | Backend type, buffer size, jitter | Web Audio API vs HTML5 Audio, `audiocontext` state |
| **GPU Backend**       | Vendor, driver, renderer          | `WEBGL_debug_renderer_info`, `GPUAdapter` info |
| **Compositor**        | Thread, vsync, scheduling         | Frame timeline API, overlay compositing detection |
| **Power State**       | CPU governor, thermal, throttling | `navigator.getBattery()`, timing anomaly correlation |
| **Refresh Rate**      | Monitor Hz, adaptive sync         | `matchMedia('(prefers-reduced-motion)')`, RAFCapture sampling |

#### Validasi
- Capture environment snapshot pada saat spike terjadi.
- Jika spike terjadi pada konfigurasi tertentu (misalnya hardware decode OFF, atau power save ON), catat sebagai suspect.
- Jika spike terjadi konsisten lintas konfigurasi yang berbeda,urangi kemungkinan environment sebagai root cause.

#### Outcome
- **Environment contributors** diidentifikasi: mana yang berkontribusi, mana yang netral.
- Kalau semua environment factor netral: lanjut ke Spike Periodicity Verification dengan asumsi faktor lingkungan tidak dominan.
- Kalau ada environment factor dominan: document sebagai known limitation, bukan algorithm bug.

---

## Spike Periodicity Verification (NEW — setelah Runtime Characterization)

Tujuan: deteksi pola dalam provenance menggunakan ground truth clock.

### Metodologi
- Gunakan ground truth clock dari Clock Quality Characterization.
- Ambil timestamp setiap spike dari Track 0/0.25/0.5/0.75.
- Jalankan auto-correlation dan spectral analysis.
- Kategorikan:
  - **Periodik:** interval stabil (e.g., setiap 200ms ±15%) → menunjuk ke browser subsystem periodik
  - **Acak:** tidak ada period dominan → mungkin algorithm-driven atau stochastic
  - **Event-driven:** 100% terkait dengan seek/lifecycle event terverifikasi

### Validasi
- Auto-correlation peak harus melebihi threshold (misalnya >0.3) untuk kategori periodik.
- Untuk acak: distribusi interval harus sesuai dengan uniform/poisson, bukan periodic.
- Untuk event-driven: setiap spike harus memiliki event terverifikasi dalam 50ms sebelum spike.

### Outcome
- **Kategori ditetapkan** dengan confidence ≥90%.
- Hanya setelah kategori ditetapkan, lanjut ke Decision.

---

## Track A — Engine Fixes (Post-Confidence Gate + Periodicity Check)

### Prasyarat
- Confidence Gate lulus 13/13 (8 data criteria + Algorithm Determinism + Reference Baseline + Runtime Characterization + Reproducibility Gate).
- **Spike periodicity NOT confirmed** (acak/event-driven), atau browser issue sudah diperbaiki.
- **Engine determinism confirmed** via Algorithm Determinism Test.
- **Ground truth clock sudah diidentifikasi** via Clock Quality Characterization.
- **Environment contributors sudah diidentifikasi** via Environment Validation.
- **Reference baseline sudah ditetapkan** — semua tuning akan dibandingkan dengan baseline matrix.
- Jika periodicity terkonfirmasi: **Track A ditunda** sampai browser subsystem di-instrumentasi.

### A1. MV Stabilization (Low Priority)
- Current: sigma 2ms, lock% 45% — sudah sehat.
- Hanya diperlukan jika cross-engine shared policy memerlukan MV-specific adjustment.
- **Prioritas terendah.**

### A2. BG Stabilization (PRIMARY — hanya jika bukan browser issue)

**Hypothesis H2 (context-aware, bukan blanket ban):**
Soft seek bukan "buruk". Ia hanya mengganggu HANYA saat re-stabilization setelah audio disruption.

- Saat `stable === false` + `mode === 'LOCKED'` + `!seekPending`: **skip soft seek path**
- Fall through ke hard seek atau rate-only sampai `setStable(true)`
- Setelah `setStable(true)`: soft seek otomatis re-enabled

**Hypothesis H3:**
- Saat `stable === false`: relaxed stdDev gate dari 12ms → 20–25ms
- Saat `stable === true`: revert ke 12ms
- Purpose: allow counter mencapai 3+ ticks tanpa sigma blocking

**Expected outcome:**
- Re-stabilization window shortcut dari ~340ms menjadi ~200–250ms
- **Hanya jika BG spike yang tersisa adalah algoritma-driven, bukan browser-driven**

### A3. Path A2 Conditional — Threshold Tuning (FALLBACK, bukan prioritas)
- Hanya dieksekusi jika:
  - Attribution menunjukkan spike tidak periodik DAN
  - Sebagian besar spike berasal dari EMA/bias math (bukan browser event)
- Adjustment berbasis telemetry, bukan perasaan.

---

## Track B — Bias Calibration Warm-Start
**Independen dari Track A.** Bisa dilakukan paralel.

- `loadBiasCalibration()` / `saveBiasCalibration()` di Music.jsx
- Seed `biasEMA` saat engine creation dari cache per-video-id
- Target: bias aktif lebih cepat setelah track change (tanpa harus navigasi)

- `biasEMA.samples` reaches 20 faster after audio disruptions
- Lock% increases from 44% to target >65%

---

## Track C — Native Implementation Validation (Future Phase)

**Goal:** Validate that sync algorithm is correct by running it in native environment (libmpv/GStreamer/SDL) where browser pipeline is eliminated.

**If native = much more stable** → browser pipeline is the problem, not algorithm
**If native = same instability** → algorithm has bugs independent of browser

**Not a priority for current sprint.** Document as Phase 2 validation target.

---

## Golden Replay Suite (NEW — untuk regression testing setelah engine dipisah)

Setelah engine terpisah dari browser, buat test harness yang bisa mereplay input stream dan memverifikasi state transition.

### Struktur

```
test-harness/
  golden/
    perfect.json       — steady-state playback tanpa gangguan
    noisy.json         — Gaussian noise 1ms / 5ms / 10ms
    seek.json          — sequence seek dengan latency 0/50/150ms
    decoder.json       — decoder stall pattern (RVFC timeout, frame blank)
    browser.json       — actual browser trace dari Track 0/0.25
  harness.js           — node script: load golden → replay → hash → compare
```

### Format Golden File

```json
{
  "name": "perfect",
  "description": "Steady-state 30s playback, no disruptions",
  "ticks": [
    { "t": 0, "audio": 10.000, "video": 10.042, "drift": 0 },
    { "t": 30, "audio": 10.030, "video": 10.072, "drift": -2 },
    ...
  ],
  "expectedStateHash": "<SHA256 dari state tick terakhir>"
}
```

### Regression Test

Setiap commit:
```
node test-harness/harness.js --golden golden/perfect.json
→ Replay
→ Bandingkan state hash setiap tick
→ PASS jika 100% match, FAIL jika ada perbedaan
```

Ini seperti unit test, tapi untuk state machine. Kalau hash berubah, langsung tahu ada regression yang mengubah behavior engine.

---

## Implementation Status

### ✅ Completed
- Track 0: Spike recorder, timeline, clock provenance, attribution taxonomy
- Track 0.25: `clockProvenanceRing`, `spikeRecorder`, `recordClockSnapshot()`, `captureSpike()`, `_attributeSpikeCause()`
- Track 0.5: Pre-spike window capture, delta clocks, clock health panel
- Track 0.75: SEEK_LATENCY attribution, per-engine seek latency measurement
- SyncOverlay: CLOCK PROVENANCE, SPIKE RECORDER, RE-STABILITY sections

### 🔲 Next (Immediate)
- Collect 50-100 spikes with full attribution (Track 0/0.25/0.5/0.75)
- **Algorithm Determinism Test (Level A + Level B — critical checkpoint):** engine dengan input sintetis identik untuk 1000+ runs; output dan state hash harus sama. **EXIT:** deterministic confirmed atau nondeterministic detected.
- **Reference Baseline Matrix (NEW — critical checkpoint):** target numerik untuk setiap environment. **EXIT:** baseline matrix terisi (Perfect, Simulated, mpv, Chromium, Firefox).
- **Runtime Characterization (NEW — critical checkpoint):** Clock Integrity + Clock Quality + Environment dalam satu fase. **EXIT:** ground truth clock ditetapkan, environment contributors netral atau known limitation ter-dokumentasi, spike terklasifikasi.
- **Spike Periodicity Verification (NEW — critical checkpoint):** deteksi pola di provenance menggunakan ground truth clock. **EXIT:** kategori periodik/acak/event-driven ditetapkan (confidence ≥90%)
- Complete seek pipeline profiling in Track 0.75 (including audio clock progression during seek)
- Add drift acceleration (Δ²drift) metric to overlay for early spike detection

### 🔲 BLOCKED (Track A)
- Requires: Confidence Gate PASS + Spike Periodicity NOT confirmed + Algorithm Determinism PASS + Reference Baseline PASS + Runtime Characterization PASS
- A1: MV stabilization (likely NONE needed)
- A2: BG stabilization (disable soft seek ONLY during unstable bootstrap + relax stdDev gate) — hanya jika spike terbukti algorithm-driven
- A3: Threshold tuning (FALLBACK, bukan prioritas)

### ⏸️ Deferred (Track B)
- Warm-start bias persistence (`loadBiasCalibration` / `saveBiasCalibration`)
- Independen dari Track A; bisa dilakukan paralel dès maintenant jika telemetry menunjukkan bias loss antar-track

### 🔮 Future (Track C)
- Native implementation validation
- Phase 2 target

---

## Critical Decision Guardrails

1. **Do NOT implement Track A until Confidence Gate + Spike Periodicity Verification passes.**
2. **Do NOT treat BG seek latency as sync algorithm bug** — it is structural browser/platform difference.
3. **Do NOT change threshold sebagai tindakan utama.** Threshold adalah efek, bukan penyebab. Hanya diubah setelah spike origin teridentifikasi dan terbukti algorithm-driven.
4. **Do NOT shorten 250ms re-stabilization timer** until H2 is confirmed AND data supports it.
5. **Do NOT change `setStable(false)` callers** — fix the re-stabilization path instead.
6. **Do NOT persist bias until Track A is stable** — algorithm changes will invalidate calibration.
7. **Soft seek is NOT universally bad.** It is disabled ONLY during unstable bootstrap/re-stabilization. When engine is stable, soft seek remains useful for minor corrections. The fix is context-sensitive, not a blanket ban.
8. **Do NOT treat browser as confirmed root cause** — browser adalah hipotesis utama (leading hypothesis), bukan kesimpulan. Dibutuhkan pembanding native (libmpv/GStreamer) sebelum dapat mengkonfirmasi.
9. **Algorithm Determinism Test MUST PASS sebelum Reference Baseline Matrix.** Engine harus terbukti deterministic sebelum masuk ke baseline characterization.
10. **Reference Baseline Matrix MUST PASS sebelum Runtime Characterization.** Target numerik harus ditetapkan sebelum clock/environment diukur agar hasil bisa dibandingkan.
11. **Runtime Characterization MUST PASS sebelum Spike Periodicity Verification.** Ground truth clock harus diidentifikasi dan environment terisolasi sebelum analisis periodisitas dimulai.
12. **If spike terverifikasi periodik:** lanjut browser subsystem investigation SEBELUM Track A. Algoritma tidak perlu diubah sampai browser pipeline dipahami.
13. **Golden Replay Suite harus dibuat SEBELUM Track A** agar setiap perubahan engine bisa di-verifikasi via regression test.

---

## Exit Criteria

Setiap checkpoint/track punya definisi selesai yang objektif. Instrumentasi tidak boleh berlanjut selamanya tanpa melewati gate.

### Algorithm Determinism Test (Level A + Level B)
- **Selesai jika:** 1000 runs dengan input sintetis identik selesai; output `JSON.stringify(decisionLog)` sama untuk semua runs DAN SHA256 state hash setiap tick identik.
- **Berhenti jika:** Engine terbukti deterministic (pass) atau nondeterministic (fail, perlu fix).
- **Jangan lanjut instrumentasi:** Jika deterministic, lanjut ke Reference Baseline Matrix. Jika nondeterministic, fix algoritma terlebih dahulu.

### Reference Baseline Matrix
- **Selesai jika:** Semua environment tercapai: Perfect synthetic, Simulated noise (1/5/10ms), mpv native (atau ditunda ke Phase 2), Chromium, Firefox. Target numerik ditetapkan untuk setiap baris.
- **Berhenti jika:** Baseline matrix terisi dan disetujui sebagai pembanding untuk tuning selanjutnya.
- **Jangan lanjut instrumentasi:** Setelah baseline ditetapkan, lanjut ke Runtime Characterization.

### Runtime Characterization (Clock Integrity + Clock Quality + Environment)
- **Selesai jika:**
  - Clock Integrity: ≥50 spike terklasifikasi ke clock source yang mengalami discontinuity; categorized rate ≥95%.
  - Clock Quality: 1000 sampel steady-state telah dikumpulkan dari setiap clock source; stdDev, resolution, dan jitter telah dihitung; ground truth clock ditetapkan (L3+).
  - Environment Validation: Semua variabel environment yang relevan telah di-capture dalam minimal 3 playback session; tidak ada environment factor yang konsisten berkontribusi ke spike >30%.
- **Berhenti jika:** Semua tiga sub-criteria tercapai.
- **Jangan lanjut instrumentasi:** Setelah Runtime Characterization selesai, lanjut ke Spike Periodicity Verification.

### Spike Periodicity Verification
- **Selesai jika:** Auto-correlation / spectral analysis klarifikasi dalam kategori periodik/acak/event-driven dengan confidence ≥90%.
- **Berhenti jika:** Kategori telah ditetapkan: A (periodik), B (acak), atau C (event-driven).
- **Jangan lanjut instrumentasi:** Setelah kategori ditetapkan, lanjut ke Decision (browser vs algorithm).

### Track 0 / 0.5 / 0.75 (Data Collection)
- **Selesai jika:** 50–100 spike dengan full attribution + seek pipeline + clock provenance telah dikumpulkan; no new instrumentation needed for data collection.
- **Berhenti jika:** Data sudah cukup untuk memenuhi Confidence Gate.
- **Jangan lanjut instrumentasi:** Fokus bergerak ke analysis, bukan additional logging.

---

## Validation Tests

### Priority Order

1. **Algorithm Determinism Test (Level A + Level B)** — engine dengan input sintetis identik untuk 1000+ runs; output dan state hash harus sama. **EXIT:** deterministic confirmed atau nondeterministic detected. **MUST PASS sebelum Reference Baseline.**
2. **Reference Baseline Matrix** — target numerik untuk setiap environment. **EXIT:** baseline matrix terisi. **MUST PASS sebelum Runtime Characterization.**
3. **Runtime Characterization (Clock Integrity + Clock Quality + Environment)** — clock provenance, ground truth identification, environment isolation. **EXIT:** ground truth ditetapkan, environment contributors netral atau known limitation ter-dokumentasi. **MUST PASS sebelum Periodicity.**
4. **Periodicity Verification** — deteksi pola di provenance menggunakan ground truth clock. **EXIT:** kategori periodik/acak/event-driven ditetapkan (confidence ≥90%). **MUST PASS sebelum Track A.**
5. **Track 0/0.25/0.5/0.75 data collection** — 50–100 spike dengan full attribution + seek pipeline + clock provenance. **EXIT:** data cukup untuk Confidence Gate.
6. **Track A tests** — hanya jika Periodicity NOT confirmed dan Confidence Gate terpenuhi.

### Test A2 — BG Stabilization (PRIMARY — setelah periodicity check + integrity + quality + environment + baseline confirmed)
- Context: skip soft seek ONLY during `!stable` + relax stdDev gate 12→20ms
- Expected: re-stabilization window shortcut
- Risk: medium; mid-window drift goes uncorrected (NOOP)
- **Jangan jalankan jika spike terverifikasi periodik dari browser subsystem**

### Test A3 — Threshold Tuning (FALLBACK, bukan prioritas)
- Hanya dieksekusi jika attribution menunjukkan spike tidak periodik DAN sebagian besar spike berasal dari EMA/bias math
- Adjustment berbasis telemetry, bukan perasaan

---

## Bottom Line

Investigasi ini telah menghasilkan **temuan yang dapat ditindaklanjuti dengan tingkat keyakinan yang terukur**:

| Temuan | Evidence Level | Keterangan |
|--------|---------------|------------|
| Soft seek recovery 150–170ms | **L4** | Terverifikasi lintas browser (Chrome & Firefox) |
| Bias learning efektif | **L2** | Reproducible dalam satu session, perlu L3+ |
| BG structural offset -205ms | **L3** | Terukur via seek pipeline instrumentation |
| BG spikes ~100% SEEK_COMPLETE | **L1** | Terlihat sekali, perlu Clock Integrity + native comparison untuk L3+ |
| Clock provenance pola periodik | **L1** | Terlihat sekali, perlu Clock Integrity + Periodicity Verification untuk L3+ |
| Pola post-seek lintas session | **L2** | Reproducible lintas session, perlu L3+ |

Investigasi ini sudah bergeser dari:
- **Awal:** "Algoritma sync salah? Threshold terlalu tinggi? Bias tidak aktif?"
- **Sekarang:** "Algoritma sudah cukup baik. Hipotesis utama: karakteristik browser media pipeline — yang perlu divalidasi melalui Algorithm Determinism → Reference Baseline → Runtime Characterization → Spike Periodicity → Decision."

Roadmap sudah memiliki:
1. **Reference Baseline Matrix** — target numerik sebelum tuning
2. **State Machine Determinism** (Level A + Level B) — verifikasi engine murni dengan SHA256 state hash
3. **Golden Replay Suite** — regression test untuk state machine setelah engine dipisah
4. **Runtime Characterization** — fase gabungan untuk clock integrity, quality, dan environment
5. **13 Confidence Gate criteria** — semua harus lulus sebelum Track A

---

## Planning Freeze

Setelah tambahan ini dimasukkan, **jangan tambah checkpoint, hipotesis, atau fase investigasi baru** kecuali data yang terkumpul benar-benar bertentangan dengan roadmap. Fokus berikutnya adalah **eksekusi**, bukan memperluas desain.

Mulai implementasi sesuai urutan roadmap:
1. Algorithm Determinism Test (Level A + Level B)
2. Reference Baseline Matrix
3. Runtime Characterization (Clock Integrity + Clock Quality + Environment)
4. Spike Periodicity Verification
5. Collect 50-100 spikes (Track 0/0.25/0.5/0.75)
6. Decision (browser vs algorithm)
7. Track A (jika lolos gate)
8. Track B (paralel)

Kumpulkan data, lalu ambil keputusan berdasarkan hasil setiap exit criteria sebelum melanjutkan ke tahap berikutnya.
