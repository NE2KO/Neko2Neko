import { DriftMemory, PipelineMemory, SchedulerMemory, DecoderMemory, LearningMemory, GlobalMemory, createMemorySnapshot } from './memory';
import { computeDerivedMetrics } from './memory/DerivedMetrics.js';
import { decide, ExecutionQueue, getConstraints, createActionRequest } from './decision';
import { evaluateDriftAnalyzer, evaluatePipelineAnalyzer, evaluateSchedulerAnalyzer, evaluateDecoderAnalyzer, evaluateConsistencyAnalyzer } from './analyzers';
import { buildSensorSnapshot, validateAndAttach, logSensorSnapshot } from './sensor';
import { circularDiff, isValidTelemetrySample } from './syncHelpers';

function createVideoSyncEngine({
  getCurrentTime,
  getDuration,
  getPaused,
  getSeeking = () => false,
  getReadyState = () => 4,
  seek,
  play: playFn,
  pause: pauseFn,
  setRate,
  getIsPlaying,
  looping = false,
  hardSeekThreshold = 0.3,
  jumpSeekThreshold = 1.0,
  seekCooldown = 500,
  stallTimeout = 2000,
  gracePeriod = 10,
  pauseIfFarFromTarget = false,
  farThreshold = 0.5,
  rateMin = 0.003,
  rateGain = 0.15,
  rateMax = Infinity,
  rateCooldownMs = null,
  pauseOnStall = true,
  adaptiveThreshold = false,
  getAdaptiveThresholds = null,
  getNetworkState = () => 0,
  getWaiting = () => false,
  getStalled = () => false,
  getRvfcStatus = () => 'UNKNOWN',
  getDroppedFrames = () => 0,
  getDecodeLatencyMs = () => 0,
  getAudioCurrentTime = () => 0,
  getVideoPlaybackRate = () => 1,
  getBgPlaybackRate = () => 1,
  getVideoOffset = () => 0,
  getMvCurrentTime = () => 0,
  getBgCurrentTime = () => 0,
  getRvfcMvPresentationTime = () => undefined,
  getRvfcBgPresentationTime = () => undefined,
  getRvfcMvExpectedDisplayTime = () => undefined,
  getRvfcBgExpectedDisplayTime = () => undefined,
  getRvfcMvMediaTime = () => undefined,
  getRvfcBgMediaTime = () => undefined,
  log = () => {},
  seekStartTimeRef = null,
  trackChangeTimeRef,
  syncCore,
  engineName,
  analyzerEvidenceRef,
  decisionOutputRef,
}) {
  const getNow = () => performance.now();

  // Phase 1 — Memory Layer (parallel, no behavior change)
  const driftMemory = new DriftMemory(engineName);
  const pipelineMemory = new PipelineMemory(engineName);
  const schedulerMemory = new SchedulerMemory(engineName);
  const decoderMemory = new DecoderMemory(engineName);
  const learningMemory = new LearningMemory(engineName);

  // Phase 4 — Execution Queue is always active
  // Anchor helper – updates pending anchor state used by onSeeked/onPlaying
  const engineAnchor = ({ play = false, target = null }) => {
    state.pendingAnchorTarget = target !== undefined ? target : null;
    state.pendingPlay = !!play;
  };
  const executionQueue = new ExecutionQueue({
    engineId: engineName,
    seek,
    setRate,
    pause: pauseFn,
    play: playFn,
    anchor: engineAnchor,
    cooldownMs: 100,
    pipelineMemory,
  });

  const state = {
      seekPending: false,
      softSeekPendingSince: 0,
      lastAnchorTarget: null,
      lastAnchorTime: 0,
      pendingAnchorTarget: null,
      pendingPlay: false,
      playRetryPending: false,
      rate: 1,
      lastSync: 0,
      lastSeekTime: 0,
      graceUntil: 0,
      stalled: false,
      stalledSince: 0,
      stallPausedRef: null,
      intentionalPause: false,
      mode: 'IDLE',
      stableCandidateSince: 0,
      lockedConsecutiveTicks: 0,
      stableGateLogged: false,
      driftEMA: 0,
      lastRateAdjustAt: 0,
      schedulerLatenessEMA: 0,
      recentLateTickCount: 0,
      cpuOverloaded: false,
      lastSoftSeekTime: 0,
      softSeekFutileCount: 0,
      softSeekBackoffMultiplier: 1,
      driftBeforeSoftSeek: null,
      recentTickDeltas: [],
      // Track 0.25 — clock provenance + spike attribution
      prevRawDriftMs: 0,
      prevDriftDeltaMs: 0,
      driftAccelerationMs: 0,
      seekCompletedAt: 0,
      // Track 0.75 — seek pipeline investigation
      seekPipelineLatency: null,
      seekPipelineAudio: null,
      seekPipelineFirstRvfc: null,
      seekPipelineFirstFrame: null,
      seekPipelineStable: null,
      lastHardSeekTime: 0,
      lastHardSeekDrift: null,
      hardSeekFutileArmed: false,
      reSeekCount: 0,
      holdUntil: 0,
      observeMs: 0,
  };

  function resolveTarget(raw) {
      const dur = getDuration();
      if (looping && isFinite(dur) && dur > 0) {
          return ((raw % dur) + dur) % dur;
      }
      if (isFinite(dur) && dur > 0) {
          // Clamp non-looping targets to [0, duration] so forceSeek never points
          // past the clip (out-of-range seeks make Chrome snap to duration, which
          // the post-seek re-anchor can re-trigger forever).
          return Math.max(0, Math.min(raw, dur));
      }
      return raw;
  }

  function getDrift(current, target) {
      const dur = getDuration();
      return looping ? circularDiff(current, target, dur) : current - target;
  }

  function maybeSetRate(rate) {
    if (Math.abs(rate - 1) < rateMin) rate = 1;
    if (state.rate !== rate) {
      const prevRate = state.rate;
      state.rate = rate;
      setRate(rate);
      log('rate_change', looping ? 'bg' : 'mv', { from: prevRate, to: rate });
    }
  }

  // Record a clock snapshot even when the tick early-returns (paused,
  // seeking, not-ready), so syncCore statistics keep observing drift
  // instead of freezing on stale samples.
  const recordClock = (now, current) => {
      if (!syncCore) return;
      syncCore.recordClockSnapshot(engineName, {
          t: now,
          audioCurrentTime: getAudioCurrentTime(),
          videoCurrentTime: current,
          rvfcPresentationTime:
              engineName === 'mv'
                  ? getRvfcMvPresentationTime()
                  : getRvfcBgPresentationTime(),
          expectedDisplayTime:
              engineName === 'mv'
                  ? getRvfcMvExpectedDisplayTime()
                  : getRvfcBgExpectedDisplayTime(),
          mediaTime:
              engineName === 'mv'
                  ? getRvfcMvMediaTime()
                  : getRvfcBgMediaTime(),
          playbackRate:
              engineName === 'mv'
                  ? getVideoPlaybackRate()
                  : getBgPlaybackRate(),
          readyState: getReadyState(),
          paused: getPaused(),
          seeking: getSeeking(),
          networkState: getNetworkState ? getNetworkState() : 0,
          hidden: document.hidden,
          visibilityState: document.visibilityState || 'visible',
      });
  }

  return {
state,

reset() {
  executionQueue.clear();
  driftMemory.reset();
  pipelineMemory.reset();
  schedulerMemory.reset();
  decoderMemory.reset();
  learningMemory.reset();
  Object.assign(state, {
    seekPending: false,
    softSeekPendingSince: 0,
    lastAnchorTarget: null,
    lastAnchorTime: 0,
    pendingAnchorTarget: null,
    pendingPlay: false,
    playRetryPending: false,
    rate: 1,
    lastSync: 0,
    lastSeekTime: 0,
    graceUntil: 0,
    stalled: false,
    stalledSince: 0,
    stallPausedRef: null,
    mode: 'IDLE',
    stableCandidateSince: 0,
    lockedConsecutiveTicks: 0,
    stableGateLogged: false,
    driftEMA: 0,
    lastRateAdjustAt: 0,
    schedulerLatenessEMA: 0,
    recentLateTickCount: 0,
    cpuOverloaded: false,
    lastSoftSeekTime: 0,
    softSeekFutileCount: 0,
    softSeekBackoffMultiplier: 1,
    driftBeforeSoftSeek: null,
    prevRawDriftMs: 0,
    prevDriftDeltaMs: 0,
    driftAccelerationMs: 0,
    seekCompletedAt: 0,
    reSeekCount: 0,
    lastHardSeekDrift: null,
    hardSeekFutileArmed: false,
    holdUntil: 0,
    observeMs: 0,
    recentTickDeltas: [],
  });
},

  softReset() {
  // Flight-control reset only: clears pending seeks, recoveries, and
  // stability candidates. Bias, EMA, decision counters, and adaptive
  // thresholds in syncCore are intentionally preserved so learning
  // survives recoveries / remounts.
  executionQueue.clear();
  driftMemory.reset();
  pipelineMemory.reset();
  schedulerMemory.reset();
  decoderMemory.reset();
  learningMemory.reset();
  Object.assign(state, {
    seekPending: false,
    softSeekPendingSince: 0,
    lastAnchorTarget: null,
    lastAnchorTime: 0,
    pendingAnchorTarget: null,
    pendingPlay: false,
    playRetryPending: false,
    rate: 1,
    lastSync: 0,
    lastSeekTime: 0,
    graceUntil: 0,
    stalled: false,
    stalledSince: 0,
    stallPausedRef: null,
    mode: 'IDLE',
    stableCandidateSince: 0,
    lockedConsecutiveTicks: 0,
    stableGateLogged: false,
    lastRateAdjustAt: 0,
    schedulerLatenessEMA: 0,
    recentLateTickCount: 0,
    cpuOverloaded: false,
    lastSoftSeekTime: 0,
    softSeekFutileCount: 0,
    softSeekBackoffMultiplier: 1,
    driftBeforeSoftSeek: null,
    prevRawDriftMs: 0,
    prevDriftDeltaMs: 0,
    driftAccelerationMs: 0,
    seekCompletedAt: 0,
    reSeekCount: 0,
    lastHardSeekDrift: null,
    hardSeekFutileArmed: false,
    holdUntil: 0,
    observeMs: 0,
    recentTickDeltas: [],
  });
},

      anchor({ play = false, target: rawTarget, preserveRate = false } = {}) {
          const current = getCurrentTime();
          const dur = getDuration();
          const playing = getIsPlaying();
          const t = resolveTarget(rawTarget);
          log('anchor', looping ? 'bg' : 'mv', { play, target: t.toFixed(3), current: current.toFixed(3), duration: dur.toFixed(3), didSeek: Math.abs(current - t) >= 0.05 });

          if (play) state.intentionalPause = false;

          if (state.seekPending && state.lastAnchorTarget != null) {
              const pending = state.lastAnchorTarget;
              const delta = Math.abs(pending - t);
              if (delta < 0.5) {
                  // Small change: coalesce — just update target, keep current seek in flight.
                  if (play) state.pendingPlay = true;
                  state.lastAnchorTarget = t;
                  state.lastAnchorTime = getNow();
                  return;
              }
              // Large change (e.g. rapid skip/seek): force new seek immediately
              // instead of queuing. Abandon the in-flight seek and re-anchor.
              log('anchor_replace', looping ? 'bg' : 'mv', {
                  oldTarget: pending.toFixed(3),
                  newTarget: t.toFixed(3),
                  delta: delta.toFixed(3),
              });
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              state.pendingAnchorTarget = null;
              // Fall through to seek below
          }

          const diff = getDrift(current, t);
          const didSeek = Math.abs(diff) >= 0.05;

           if (didSeek) {
               // Track 0.75 — seek pipeline instrumentation
              state.seekPipelineLatency = {
                engine: engineName,
                seekStart: performance.now(),
                audioAtSeekStart: getAudioCurrentTime(),
              };
                state.seekPipelineAudio = { ...state.seekPipelineAudio, seekStart: getAudioCurrentTime() };
              // Record seek start for syncCore latency tracking
              if (syncCore) syncCore._seekStartTime = syncCore._seekStartTime || {};
              if (syncCore) syncCore._seekStartTime[engineName] = performance.now();
              seek(t);
              if (!getSeeking() && Math.abs(getCurrentTime() - current) < 0.05) {
                  state.seekPending = false;
                  state.softSeekPendingSince = 0;
                  if (play) {
                      state.pendingPlay = false;
                      playFn().catch(() => {});
                      log('play', looping ? 'bg' : 'mv', { kind: 'noopSeek' });
                  }
              } else {
                  // Bound repeated re-seeks to the same target. If a seek keeps
                  // landing off-target (keyframe snap / un-buffered region) and
                  // the re-anchor keeps re-seeking, the video strobe-scrolls a
                  // few frames forever. After N repeats, force playback and let
                  // the PID tick absorb the residual drift instead.
                  const repeat = state.seekPending && state.lastAnchorTarget === t;
                  state.reSeekCount = repeat ? (state.reSeekCount || 0) + 1 : 0;
                  if (state.reSeekCount > 2) {
                      state.seekPending = false;
                      state.softSeekPendingSince = 0;
                      state.lastAnchorTarget = null;
                      state.pendingAnchorTarget = null;
                      state.reSeekCount = 0;
                      if (play) {
                          state.pendingPlay = false;
                          playFn().catch(() => {});
                          log('play', looping ? 'bg' : 'mv', { kind: 'reseen-bound' });
                      }
                  } else {
                      state.seekPending = true;
                      state.softSeekPendingSince = 0;
                      state.lastAnchorTarget = t;
                      state.lastAnchorTime = getNow();
                      state.pendingAnchorTarget = null;
                      if (play) {
                          state.pendingPlay = true;
                          log('play', looping ? 'bg' : 'mv', { kind: 'deferred' });
                      }
                  }
              }
          } else {
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              if (play && playing) {
                  playFn().catch(() => {});
                  log('play', looping ? 'bg' : 'mv', { kind: 'noseek' });
              }
          }

          if (!preserveRate) {
              state.rate = 1;
              try { setRate(1); } catch (_) {}
          }
          state.lastSync = 0;
          state.lastSeekTime = getNow();
          state.graceUntil = getNow() + gracePeriod;
          state.mode = 'RECOVERY';
      },

      tick(audioTarget, tickDelta = 30) {
          const now = getNow();
          const EXPECTED_TICK = 30;
          const schedulerLateness = Math.max(0, tickDelta - EXPECTED_TICK);
          const playing = getIsPlaying();

          if (!playing) {
              pauseFn();
              state.pendingPlay = false;
              state.playRetryPending = false;
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              state.rate = 1;
              state.lastSync = 0;
              state.graceUntil = now + gracePeriod;
              state.mode = 'IDLE';
                  state.lockedConsecutiveTicks = 0;
                  state.stableCandidateSince = 0;
                  recordClock(now, getCurrentTime());
                  return;
          }
          if (getPaused()) {
              const justHardSeeked = state.lastHardSeekTime && (getNow() - state.lastHardSeekTime) < 3000;
              if (!state.seekPending && !justHardSeeked) {
                  playFn().catch(() => {});
              }
              // Mark as stalled so engine doesn't silently skip ticks
              if (!state.stalled) {
                  state.stalled = true;
                  state.stalledSince = getNow();
              }
              recordClock(now, getCurrentTime());
              return;
          }
          if (getSeeking()) {
              recordClock(now, getCurrentTime());
              return;
          }
          if (getReadyState() < 3) {
              // Video metadata not loaded yet — keep trying to play
              if (!state.seekPending) {
                  playFn().catch(() => {});
              }
              recordClock(now, getCurrentTime());
              return;
          }

          // Watchdog: if a seek is stuck for >2 s (no seeked/onPlaying),
          // clear it so the engine can resume normal sync instead of
          // freezing the video mid-track. lastAnchorTime must be a real seek
          // start (hardSeek decision now sets it); guard on >0 so a seek
          // that never recorded an anchor is not cleared instantly.
          if (state.lastAnchorTime > 0 && state.seekPending && now - state.lastAnchorTime > 2000) {
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              state.pendingAnchorTarget = null;
              state.pendingPlay = false;
              state.lastAnchorTime = now;
              // Reset so the next tick's play-retry is not blocked by
              // justHardSeeked (which would keep the video paused).
              state.lastHardSeekTime = 0;
              playFn().catch(() => {});
          }

          // Soft-seek safety: if seekPending was set by a soft seek (not
          // anchor) and seeked hasn't fired within 100 ms, clear it so
          // the engine doesn't skip ticks indefinitely.
          if (state.seekPending && state.softSeekPendingSince > 0 &&
              now - state.softSeekPendingSince > 100) {
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              state.graceUntil = now + 60;
          }

          if (state.seekPending) {
              return;
          }
          if (now < state.graceUntil && state.mode !== 'RECOVERY') {
              return;
          }

          if (state.stalled && now - state.stalledSince > stallTimeout) {
              state.stalled = false;
              state.stalledSince = 0;
          }
          if (state.stalled) {
              // When pauseOnStall is false (BG engine), don't skip ticks —
              // the video is still playing so we must keep correcting drift
              // even during a stall. Only skip ticks for engines that were
              // actually paused on stall (MV).
              if (pauseOnStall) return;
          }

          const target = resolveTarget(audioTarget);
          const current = getCurrentTime();
          const drift = getDrift(current, target);
          const adrift = Math.abs(drift);
          const dur = getDuration();

          const adaptiveThresholds = adaptiveThreshold && getAdaptiveThresholds
            ? getAdaptiveThresholds()
            : {};
          const softThreshold = adaptiveThresholds.soft ?? 0.030;
          const activeHardThreshold = adaptiveThresholds.hard ?? hardSeekThreshold;
          const activeJumpThreshold = adaptiveThresholds.jump ?? jumpSeekThreshold;

          // Sync adaptive thresholds (seconds) into LearningMemory (ms) so the
          // DecisionEngine reads the same soft/hard gates the overlay shows
          // instead of its hard-coded 30/300 defaults (MV −453ms was being
          // hard-seeked every tick against a static 300ms hard threshold).
          if (learningMemory?.setAdaptiveThresholds) {
            learningMemory.setAdaptiveThresholds({
              softMs: (softThreshold || 0.030) * 1000,
              hardMs: (activeHardThreshold || hardSeekThreshold) * 1000,
            });
          }

          // Phase 1: Bias compensation — subtract learned bias from drift
          // so the engine only reacts to NEW drift, not the constant offset.
          const bias = syncCore ? syncCore.getBias(engineName) : 0;
          const correctedDrift = drift - bias;
          const correctedAdrift = Math.abs(correctedDrift);

          // Observe drift for syncCore statistics (Phase 0 — no behavior change)
          const rawDriftMs = drift * 1000;
          const prevRawDriftMs = state.prevRawDriftMs || 0;
          const driftDeltaMs = Math.abs(rawDriftMs - prevRawDriftMs);
          const prevDriftDeltaMs = state.prevDriftDeltaMs || 0;
          const driftAccelerationMs = Math.abs(driftDeltaMs - prevDriftDeltaMs);
          state.prevRawDriftMs = rawDriftMs;
          state.prevDriftDeltaMs = driftDeltaMs;
          state.driftAccelerationMs = driftAccelerationMs;

          // Track 0.25 — clock provenance snapshot (per tick)
          recordClock(now, current);

          const attributionState = {
            mode: state.mode,
            schedulerStall: schedulerLateness > 80,
            rvfcStatus: getRvfcStatus(),
            hidden: document.hidden,
            seekPending: state.seekPending,
            seekJustCompleted:
              !!state.seekCompletedAt && now - state.seekCompletedAt < 100,
            schedulerLateness,
            prevRawDriftMs,
            driftDeltaMs,
            driftAccelerationMs,
          };

          // Phase 4 — drift is canonical in DriftMemory; overlay bridge updates syncCore below

          // Track 0.25 — capture spike when drift crosses 50 ms
          if (
            syncCore &&
            Math.abs(rawDriftMs) > 50 &&
            isValidTelemetrySample(rawDriftMs, {
              maxAbs: 5000,
              minAgeMs: 500,
              trackChangeTime: trackChangeTimeRef.current,
            })
          ) {
            syncCore.captureSpike(engineName, rawDriftMs, attributionState);
          }
          state.prevRawDriftMs = rawDriftMs;

// Scheduler awareness: when the tick is very late the engine itself was
// delayed by CPU load. Instead of skipping every correction, enter a HOLD
// state: update stall counters, feed scheduler telemetry, and let the
// hard-seek safety net still fire if drift has grown past the hard threshold.
if (schedulerLateness > 80) {
log('scheduler_stall', looping ? 'bg' : 'mv', {
  tickDelta: Math.round(tickDelta),
  lateness: Math.round(schedulerLateness),
  drift: Math.round(drift * 1000),
  hold: true,
});
// intentionally do not return — recentLateTickCount / schedulerLatenessEMA
// / cpuOverloaded are updated below, and hard seek is still evaluated.
}

          // Graduated CPU overload guard: track sustained scheduler lateness.
          // When the main thread is under heavy load, soft seeks and playbackRate
          // adjustments make things worse. Keep only hard seeks as a safety net.
          state.recentLateTickCount = (state.recentLateTickCount || 0) + 1;
          state.schedulerLatenessEMA = (state.schedulerLatenessEMA || 0) * 0.8 + schedulerLateness * 0.2;
          const cpuOverloaded = state.schedulerLatenessEMA > 40 && state.recentLateTickCount >= 8;
          state.cpuOverloaded = cpuOverloaded;

          // Confidence-Graduated Startup: read measurement confidence from syncCore.
          // Confidence is event-driven (decoder/render/scheduler/clock health), NOT timer-driven.
          const confidenceStats = syncCore ? syncCore.getStats(engineName) : null;
          const confidence = confidenceStats ? confidenceStats.compositeConfidence : 0;

          if (syncCore) {
            syncCore.observeTickDelta(engineName, tickDelta);
            syncCore.observeSchedulerLateness(engineName, schedulerLateness);
            syncCore.incTickCount(engineName);

            state.recentTickDeltas.push(tickDelta);
            if (state.recentTickDeltas.length > 30) state.recentTickDeltas.shift();
            const sortedDeltas = [...state.recentTickDeltas].sort((a, b) => a - b);
            const mid = Math.floor(sortedDeltas.length / 2);
            const median = sortedDeltas.length % 2 ? sortedDeltas[mid] : (sortedDeltas[mid - 1] + sortedDeltas[mid]) / 2;
            const tickMissThreshold = Math.max(40, Math.min(80, median * 1.5));
            if (tickDelta > tickMissThreshold) syncCore.incTickMisses(engineName);

            if (schedulerLateness > 80) syncCore.incSchedulerStalls(engineName);
            if (cpuOverloaded) syncCore.incCpuOverloads(engineName);
          }

          if (syncCore && bias !== 0) {
            const biasMs = Math.round(bias * 1000);
            const rawMs = Math.round(drift * 1000);
            const correctedMs = Math.round(correctedDrift * 1000);
            if (rawMs > softThreshold * 1000 && correctedMs < softThreshold * 1000) {
              log('bias_save', looping ? 'bg' : 'mv', { rawMs, biasMs, correctedMs });
            }
          }
          const biasMs = Math.round(bias * 1000);

          // Phase 1 — Memory Layer: feed new Memory objects from tick state
          try {
            driftMemory.pushDrift(rawDriftMs);
            driftMemory.setBiasMs(biasMs);
            schedulerMemory.pushTickDelta(tickDelta);
            schedulerMemory.setCpuOverloaded(cpuOverloaded);
            if (cpuOverloaded) schedulerMemory.recordLateTick();
          } catch (_) { /* memory logging must not break tick */ }

          // === STATE MACHINE: soft-seek based ===
          // Instead of PID (which depends on playbackRate — unreliable during
          // buffering), directly set video.currentTime for small drifts.
          // Soft seek = instant correction in 1 tick (30ms), no oscillation.
          // Phase 1: Use correctedDrift for decisions, raw drift for logging.
          if (state.mode === 'IDLE' || state.mode === 'LOCKED' || state.mode === 'GRACE' || state.mode === 'RECOVERY') {
              // Phase C — HOLD_TO_OBSERVE window: keep observing drift but skip
              // corrections until the adaptive hold expires.
              if (state.holdUntil && now < state.holdUntil) {
                  state.observeMs = state.holdUntil - now;
              } else {
              state.holdUntil = 0;
              state.observeMs = 0;
              // Phase 4 — Decision Engine is the sole decision path
              // Build MemorySnapshot from Memory Layer

              // Triangle synchronization: compute cross-engine drifts so the
              // Decision Engine can apply the triangle consistency gate.
              const triAudioCurrent = getAudioCurrentTime();
              const triOffset = getVideoOffset();
              const triMvCurrent = getMvCurrentTime();
              const triBgCurrent = getBgCurrentTime();
              const triangleDrifts = Number.isFinite(triBgCurrent) && Number.isFinite(triMvCurrent)
                ? {
                    hasTriangle: true,
                    audioMvMs: (triMvCurrent - (triAudioCurrent + triOffset)) * 1000,
                    audioBgMs: (triBgCurrent - (triAudioCurrent + triOffset)) * 1000,
                    mvBgMs: (triBgCurrent - triMvCurrent) * 1000,
                  }
                : null;

              const memorySnapshot = createMemorySnapshot({
                engineId: engineName,
                driftEMA: driftMemory.driftEMA,
                biasMs: driftMemory.biasMs,
                cptMs: pipelineMemory.cptMs,
                pipelineState: pipelineMemory.pipelineState,
                warmupPhase: pipelineMemory.warmupPhase,
                disturbanceCount: pipelineMemory.disturbanceCount,
                recentTickDeltas: schedulerMemory.recentTickDeltas,
                cpuOverloaded: schedulerMemory.cpuOverloaded,
                decodeLatencyHistory: decoderMemory.decodeLatencyHistory,
                droppedFrames: decoderMemory.droppedFrames,
                futileCount: learningMemory.futileCount,
                adaptiveThresholds: learningMemory.adaptiveThresholds,
                confidenceHistory: learningMemory.confidenceHistory,
                sessionQuality: 1,
                triangleDrifts,
                isPaused: getPaused(),
                isWaiting: getWaiting?.(),
                isSeeking: getSeeking(),
                isRecovering: state.seekPending || (state.lastHardSeekTime && getNow() - state.lastHardSeekTime < 3000),
                recentlyHardSeeked: state.lastHardSeekTime && getNow() - state.lastHardSeekTime < 3000,
                executionBusy: executionQueue.isInFlight(),
              });
              if (syncCore) syncCore.syncFromDriftMemory(engineName, driftMemory);
              const derivedMetrics = computeDerivedMetrics(memorySnapshot);
              const constraints = getConstraints(derivedMetrics);
              let sensorCtx = null;
              const analyzerEvidence = (() => {
                try {
                  const sensor = buildSensorSnapshot({
                    engineId: engineName,
                    videoCurrentTime: current,
                    audioCurrentTime: target,
                    driftMs: drift * 1000,
                    readyState: getReadyState(),
                    networkState: getNetworkState ? getNetworkState() : 0,
                    waiting: getWaiting ? getWaiting() : false,
                    stalled: getStalled ? getStalled() : false,
                    seeking: getSeeking(),
                    rvfcStatus: getRvfcStatus ? getRvfcStatus() : 'UNKNOWN',
                    tickDelta: tickDelta,
                    cpuOverloaded: cpuOverloaded,
                    droppedFrames: getDroppedFrames ? getDroppedFrames() : 0,
                    decodeLatencyMs: getDecodeLatencyMs ? getDecodeLatencyMs() : 0,
                    pipelineState: pipelineMemory.pipelineState,
                    cptMs: pipelineMemory.cptMs,
                  });
                  const validatedSensor = validateAndAttach(sensor);
                  sensorCtx = validatedSensor;
                  const ctx = { sensor: validatedSensor, memorySnapshot, config: {} };
                  return [
                    evaluateDriftAnalyzer(ctx),
                    evaluatePipelineAnalyzer(ctx),
                    evaluateSchedulerAnalyzer(ctx),
                    evaluateDecoderAnalyzer(ctx),
                  ];
                } catch (_) {
                  return [];
                }
              })();
              // Frame period from measured RVFC fps (fallback 33ms ~ 30fps).
              const mvFpsCur = syncCore?.mv?.fps?.current || 0;
              const bgFpsCur = syncCore?.bg?.fps?.current || 0;
              const mvFramePeriodMs = mvFpsCur > 0 ? 1000 / mvFpsCur : 33;
              const bgFramePeriodMs = bgFpsCur > 0 ? 1000 / bgFpsCur : 33;
              const decision = decide({
                derivedMetrics,
                constraints,
                evidenceList: analyzerEvidence,
                engineId: engineName,
                validatedSensor: sensorCtx,
                driftHistory: driftMemory.driftHistory,
                mvFramePeriodMs,
                bgFramePeriodMs,
              });
              if (engineName === 'mv' || engineName === 'bg') {
                analyzerEvidenceRef.current[engineName] = analyzerEvidence;
                decisionOutputRef.current[engineName] = decision;
              }
              const actionRequest = decision.actionRequest;
              if (actionRequest && actionRequest.type === 'hold' && actionRequest.params?.holdMs > 0) {
                state.holdUntil = now + actionRequest.params.holdMs;
              }
              if (actionRequest && actionRequest.type === 'hold') {
                if (syncCore) syncCore.recordDecision(engineName, 'LOCK');
              } else if (actionRequest && actionRequest.type === 'noop') {
                if (syncCore) syncCore.recordDecision(engineName, 'NOOP');
              }
              if (actionRequest && actionRequest.type !== 'noop' && actionRequest.type !== 'hold') {
                    if (actionRequest.type === 'hardSeek' && state.lastHardSeekTime && now - state.lastHardSeekTime < 1000) {
                        // Recent hard seek still settling (seek landed or is about
                        // to). Skipping prevents re-issuing every tick and fighting
                        // the browser seek pipeline while the seeked/recovery cycle
                        // completes. The 30ms decision loop then degrades into a
                        // proper 1-per-second max seek rate instead of a deadlock.
                        log('hard_seek_throttled', looping ? 'bg' : 'mv', { ageMs: Math.round(now - state.lastHardSeekTime) });
                    } else if (actionRequest.type === 'hardSeek') {
                        log('hard_seek', looping ? 'bg' : 'mv', {
                          drift: Math.round(adrift * 1000),
                          target: Math.round(target * 1000),
                          current: Math.round(current * 1000),
                        });
                        if (syncCore) syncCore.recordDecision(engineName, 'HARD');
                        if (syncCore && isValidTelemetrySample(drift * 1000, { maxAbs: 5000, minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                          syncCore.recordSeek(engineName, 'HARD', drift * 1000, engineName === 'mv' ? syncCore.mv.frameAge : syncCore.bg.frameAge);
                        }
                        executionQueue.enqueue(createActionRequest({ type: 'hardSeek', priority: 5, params: { target: audioTarget }, engineId: engineName }));
                        // Mark seek as pending to avoid multiple hard seeks while waiting for seek completion
                        state.seekPending = true;
                        state.mode = 'RECOVERY';
                        state.lastSync = now;
                        state.lockedConsecutiveTicks = 0;
                        state.stableCandidateSince = 0;
                        state.lastHardSeekTime = now;
                        state.lastHardSeekDrift = adrift;
                        state.hardSeekFutileArmed = true;
                        // Anchor timing so the seek-stuck watchdog (2 s) measures from
                        // the actual seek start, not a stale lastAnchorTime — otherwise
                        // it clears seekPending on the very next tick and re-issues a
                        // hard seek forever (30 ms deadlock).
                        state.lastAnchorTime = now;
                        state.graceUntil = now + gracePeriod;
                        if (syncCore && syncCore.recordReStabilityDisruption) syncCore.recordReStabilityDisruption(engineName, 'hard_seek');
                        if (syncCore) syncCore.setStable(false);
                  } else if (actionRequest.type === 'softSeek') {
                      state.driftBeforeSoftSeek = drift;
                      executionQueue.enqueue(createActionRequest({ type: 'softSeek', priority: 4, params: { target: target }, engineId: engineName }));
                      state.mode = 'LOCKED';
                      state.rate = 1;
                      state.seekPending = true;
                      state.softSeekPendingSince = now;
                      state.lastAnchorTime = now;
                      state.graceUntil = now + 60;
                      state.lastSync = now;
                      state.lastSoftSeekTime = now;
                      state.softSeekFutileCount = 0;
                      state.softSeekBackoffMultiplier = 1;
                      state.lockedConsecutiveTicks = 0;
                      state.stableCandidateSince = 0;
                  } else if (actionRequest.type === 'setRate') {
                      const absCorrectedDrift = Math.abs(correctedDrift);
                      const driftMs = correctedDrift * 1000;
                      // Airplane-style landing: as drift approaches 0 the rate
                      // must taper off and touch down at exactly 1.0, never
                      // carry a stale catch-up rate through the target (that
                      // felt like the correction arriving late, after overshoot).
                      // The landing zone is ~5ms — below it we coast at rate 1.0
                      // and let frames switch together, so sync settles under
                      // the 10ms target without churn.
                      const frameDeadbandMs = 5;
                      let newRate = 1;
                      if (absCorrectedDrift * 1000 > frameDeadbandMs) {
                        // correctedDrift = current - target: negative → video
                        // behind audio → play FASTER to catch up; positive →
                        // ahead → slower. Sign was reversed (behind → rate<1 →
                        // fell further behind), which made the engine avoid
                        // SET_RATE entirely. Clamped so rate stays playable
                        // while it ramps to close a large gap. Smooth cap:
                        // sub-second drift uses a barely-visible rate
                        // (|rate−1| ≤ 0.15) so the MV/BG chase feels seamless;
                        // larger gaps may use the full [0.5, 2] range.
                        const boundedDelta = Math.min(rateGain * absCorrectedDrift, rateMax);
                        const delta = Math.min(boundedDelta, absCorrectedDrift < 1.0 ? 0.15 : 2);
                        newRate = Math.max(0.5, Math.min(2, 1 - Math.sign(correctedDrift) * delta));
                      }
                      // Only enqueue when the commanded rate actually changed
                      // (prevents re-issuing the same rate every tick).
                      if (state.rate !== newRate) {
                        state.rate = newRate;
                        executionQueue.enqueue(createActionRequest({ type: 'setRate', priority: 3, params: { rate: newRate }, engineId: engineName }));
                        if (syncCore) syncCore.recordDecision(engineName, 'RATE');
                        log('set_rate', looping ? 'bg' : 'mv', {
                          rate: +newRate.toFixed(3),
                          drift: Math.round(driftMs),
                        });
                        state.lastRateAdjustAt = getNow();
                      }
                      state.driftEMA = (state.driftEMA || 0) * 0.8 + driftMs * 0.2;
                  }
              }

              // Hard-seek futility: a hard seek that has settled (seeked fired,
              // seekPending cleared) but left drift still at/beyond the adaptive
              // hard threshold snapped to a sparse keyframe (or never moved at
              // all). A successful hard seek lands within roughly a keyframe of
              // the target, so residual drift at/above the hard threshold means
              // it failed to converge. Record futile (no "improvement ≥ 10%"
              // gate — a crawl forward is still a failed landing); after 3,
              // ConstraintProvider forbids SEEK and the DecisionEngine falls
              // back to SET_RATE, which keeps the video playing and ramps rate
              // to close the gap instead of re-seeking the same region forever.
              if (state.hardSeekFutileArmed &&
                  state.lastHardSeekTime &&
                  !state.seekPending &&
                  getNow() - state.lastHardSeekTime > 1200 &&
                  getNow() - state.lastHardSeekTime < 4000 &&
                  adrift >= (activeHardThreshold || hardSeekThreshold)) {
                  learningMemory.recordFutile();
                  state.hardSeekFutileArmed = false;
              }

              // Check if previous soft seek was futile. Ignore futile telemetry if the
              // effective soft threshold is already at or past the hard threshold: further
              // backoff cannot make a soft-only fix possible.
              if (state.driftBeforeSoftSeek != null && state.mode === 'LOCKED' && !state.seekPending && ((softThreshold || 0.030) * (state.softSeekBackoffMultiplier || 1)) < activeHardThreshold) {
                const prevAbs = Math.abs(state.driftBeforeSoftSeek);
                const currAbs = Math.abs(drift);
                const improvement = prevAbs - currAbs;
                if (improvement < 0.005) {
                  state.softSeekFutileCount++;
                  if (syncCore) syncCore.recordDecision(engineName, 'FUTILE');
                  learningMemory.recordFutile();
                  if (state.softSeekFutileCount >= 3) {
                    state.softSeekBackoffMultiplier = Math.min(state.softSeekBackoffMultiplier * 2, 4);
                    state.softSeekFutileCount = 0;
                    log('soft_seek_backoff', looping ? 'bg' : 'mv', {
                      multiplier: state.softSeekBackoffMultiplier.toFixed(1),
                      prevDrift: Math.round(prevAbs * 1000),
                      currDrift: Math.round(currAbs * 1000),
                    });
                  }
                } else {
                  state.softSeekFutileCount = Math.max(0, state.softSeekFutileCount - 1);
                  if (state.softSeekFutileCount === 0 && state.softSeekBackoffMultiplier > 1) {
                    state.softSeekBackoffMultiplier = Math.max(1, state.softSeekBackoffMultiplier / 2);
                    learningMemory.resetFutile();
                  }
                }
                state.driftBeforeSoftSeek = null;
              }

              // Reset CPU overload guard when scheduler is healthy again
              if (!cpuOverloaded) {
                state.recentLateTickCount = 0;
              }

              if (state.mode !== 'RECOVERY') {
                state.mode = 'LOCKED';
                state.rate = 1;
              }

              // Stability recovery: operational stability (no pending seek, no stall,
              // no CPU overload) is what matters for warmup exit. Large drift can be
              // a permanent offset, not instability. The engine is operationally stable
              // when scheduler, decoder, and pipeline are healthy regardless of drift.
              const isOperationallyStable = !state.seekPending && !state.stalled && !cpuOverloaded;
              if (isOperationallyStable) {
                state.lockedConsecutiveTicks = (state.lockedConsecutiveTicks || 0) + 1;
                if (state.lockedConsecutiveTicks === 1) state.stableCandidateSince = now;
                if (state.lockedConsecutiveTicks >= 10 && syncCore) {
                  syncCore.setStable(true);
                  if (pipelineMemory && pipelineMemory.setStable) pipelineMemory.setStable();
                }
              } else {
                state.lockedConsecutiveTicks = 0;
                state.stableCandidateSince = 0;
                if (syncCore) syncCore.setStable(false);
              }

              // Process Execution Queue for any enqueued actions
              if (executionQueue) {
                const executed = executionQueue.process();
                if (executed.processed && executed.reasonCode === 'E005') {
                  log('execution_queue', looping ? 'bg' : 'mv', { action: executed.request.type, reasonCode: executed.reasonCode });
                }
              }
              } // end HOLD_TO_OBSERVE gate
          }
      },

      // Backward-compatible alias
      syncTick(audioTarget) {
          return this.tick(audioTarget);
      },

      onSeeked() {
          // The native `seeked` event is authoritative: the seek has completed.
          // We intentionally do NOT gate this on getSeeking(), because the
          // <video> seeking flag can lag behind the event or stay true while a
          // follow-up chase-seek is in flight; blocking here creates a deadlock
          // where seekPending survives track changes.
          state.seekPending = false;
          state.seekCompletedAt = getNow();
          state.softSeekPendingSince = 0;
          state.graceUntil = getNow() + gracePeriod;
          state.playRetryPending = false;

          // Track 0.75 — seek pipeline: seeked event
          if (state.seekPipelineLatency && !state.seekPipelineLatency.seeked) {
            state.seekPipelineLatency.seeked = performance.now();
            state.seekPipelineLatency.audioAtSeeked = getAudioCurrentTime();
            state.seekPipelineAudio = { ...state.seekPipelineAudio, seeked: getAudioCurrentTime() };
          }

          // Observe seek latency for syncCore
          if (syncCore && syncCore._seekStartTime && syncCore._seekStartTime[engineName]) {
            const seekLatMs = performance.now() - syncCore._seekStartTime[engineName];
            syncCore.observeSeekLatency(engineName, seekLatMs);
            delete syncCore._seekStartTime[engineName];
          }

          if (state.pendingAnchorTarget != null) {
              state.pendingAnchorTarget = null;
              const shouldPlay = state.pendingPlay;
              state.pendingPlay = false;
              // Re-anchor to the LIVE audio position, not the decision-time
              // target. Hard seeks are issued ~30ms before they land, but the
              // native seek can take 1-2s (buffering/waiting); re-anchoring to
              // the stale decision target leaves the video parked that far
              // behind audio — the "frame plays then gets pulled back / can't
              // keep up" loop. Landing at the current audio position lets
              // playback resume from a near-synced point and drift converges.
              const freshTarget = (getAudioCurrentTime?.() ?? 0) + (getVideoOffset?.() ?? 0);
              log('seeked', looping ? 'bg' : 'mv', { kind: 'reanchor', target: freshTarget.toFixed(3), shouldPlay });
              this.anchor({ play: shouldPlay, target: freshTarget });
              return;
          }

          if (state.pendingPlay) {
              state.pendingPlay = false;
              state.playRetryPending = true;
              // The cached stream is fully buffered, so a completed seeked means
              // the frame at the target is already available — resume immediately
              // instead of deferring 3s after every hard seek (the old justHardSeeked
              // gate left the video paused most of the time, so it fell behind audio
              // and kept re-seeking). Only skip while the decoder is actively waiting;
              // onCanPlay/onPlaying retry via playRetryPending.
              const waiting = getWaiting?.() ?? false;
              if (!waiting) {
                  playFn().catch(() => {});
              }
          }

          if (state.stalled) {
              state.stalled = false;
              state.stalledSince = 0;
              state.playRetryPending = true;
              const waiting = getWaiting?.() ?? false;
              if (!waiting) {
                  playFn().catch(() => {});
              }
          }
      },

      onPlaying() {
          const current = getCurrentTime();
          const dur = getDuration();

          // If a seek was pending, the seeked handler already cleared it.
          // Do not gate playback recovery on the native seeking flag, which
          // can remain true briefly after seeked or during chase-seeks.
          if (state.seekPending) {
              state.seekPending = false;
              state.softSeekPendingSince = 0;
              state.stalledSince = 0;
              state.stalled = false;
              state.playRetryPending = false;
              state.intentionalPause = false;
          }

          // MV recovered from a stall — resume BG if it was paused alongside MV.
          if (state.stallPausedRef && !state.seekPending) {
              state.stallPausedRef = null;
              playFn().catch(() => {});
          }

          if (state.seekPending && state.lastAnchorTarget != null && pauseIfFarFromTarget) {
              const diff = looping ? Math.abs(circularDiff(current, state.lastAnchorTarget, dur)) : Math.abs(current - state.lastAnchorTarget);
              if (diff > farThreshold) {
                  pauseFn();
                  return;
              }
          }

          state.seekPending = false;
          state.softSeekPendingSince = 0;
          state.stalledSince = 0;
          state.stalled = false;
          state.playRetryPending = false;
          state.intentionalPause = false;

          if (state.pendingAnchorTarget != null) {
              const t = state.pendingAnchorTarget;
              state.pendingAnchorTarget = null;
              const shouldPlay = state.pendingPlay;
              state.pendingPlay = false;
              this.anchor({ play: shouldPlay, target: t });
              return;
          }

          if (state.pendingPlay) {
              state.pendingPlay = false;
              state.playRetryPending = true;
              log('playing', looping ? 'bg' : 'mv', { kind: 'play' });
              playFn().catch(() => {});
          }
      },

      onCanPlay() {
          if (state.playRetryPending || state.pendingPlay) {
              state.playRetryPending = false;
              state.pendingPlay = false;
              playFn().catch(() => {});
          }
      },

      onWaiting() {
          state.stalled = true;
          state.stalledSince = getNow();
          const now = getNow();
          const hardSeekGraceMs = 3000;
          const justHardSeeked = state.lastHardSeekTime && (now - state.lastHardSeekTime) < hardSeekGraceMs;
          if (pauseOnStall && !justHardSeeked) {
              state.stallPausedRef = true;
              pauseFn();
          }
          maybeSetRate(1);
      },

      onStalled() {
          state.stalled = true;
          state.stalledSince = getNow();
          if (pauseOnStall) {
              state.stallPausedRef = true;
              pauseFn();
          }
      },

      pause() {
          pauseFn();
          state.stallPausedRef = null;
          state.pendingPlay = false;
          state.seekPending = false;
          state.softSeekPendingSince = 0;
          state.playRetryPending = false;
          state.intentionalPause = true;
          state.mode = 'IDLE';
      },


      resume(target) {
          const playing = getIsPlaying();
          if (playing) {
              maybeSetRate(1);
              if (target != null) {
                  this.anchor({ play: true, target });
              } else {
                  this.anchor({ play: true });
              }
          }
      },

      getPaused() {
          return getPaused();
      },
  };
}

export { createVideoSyncEngine };
