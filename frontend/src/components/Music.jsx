import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, Minimize2, ListMusic, Heart, ChevronUp, ChevronDown, Ban, RotateCw, Trash2, Activity } from 'lucide-react';
import MediaControls from './MediaControls';
import Carousel from './Carousel';
import QueuePanel from './QueuePanel';
import LyricsDisplay from './LyricsDisplay';
import MetadataEditor from './MetadataEditor';
import CachedVideoPlayer from './CachedVideoPlayer';
import SyncOverlay, { registerSyncCore, registerAudioRef, registerMvRef, registerBgRef, registerEngineStateRef, registerVideoOffsetRef, registerRvfcStatusRef, registerVideoRemountCount, registerReplayStateRef, registerRecordingState, registerAnalyzerEvidence, registerDecisionOutput } from './SyncOverlay';
import NetworkImage from './NetworkImage';
import SpeakerOutputButton from './SpeakerOutputButton';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import { cancelSendQueueItem, retrySendQueueItem, removeSendQueueItem } from '../utils/api';
import { SharedSyncCore } from '../utils/syncCore';
import { buildSensorSnapshot, validateAndAttach, logSensorSnapshot } from '../utils/sensor';
import { evaluateDriftAnalyzer, evaluatePipelineAnalyzer, evaluateSchedulerAnalyzer, evaluateDecoderAnalyzer, evaluateConsistencyAnalyzer } from '../utils/analyzers';
import { DriftMemory, PipelineMemory, SchedulerMemory, DecoderMemory, LearningMemory, GlobalMemory, createMemorySnapshot } from '../utils/memory';
import { computeDerivedMetrics } from '../utils/memory/DerivedMetrics.js';
import { decide, ExecutionQueue, getConstraints, createActionRequest } from '../utils/decision';

function circularDiff(a, b, duration) {
    if (!duration || !isFinite(duration) || duration <= 0) return a - b;
    let diff = a - b;
    diff = diff % duration;
    if (diff > duration / 2) diff -= duration;
    if (diff < -duration / 2) diff += duration;
    return diff;
}

function isValidTelemetrySample(value, context = {}) {
  if (!Number.isFinite(value)) return false;
  if (context.maxAbs && Math.abs(value) > context.maxAbs) return false;
  if (context.minAgeMs && performance.now() - (context.trackChangeTime || 0) < context.minAgeMs) return false;
  return true;
}

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

export default function MusicPlayer({
  file,
  onChangeStatus,
  folderFiles = [],
  currentSortBy,
  currentSortOrder,
  favoriteOnly = false,
  onClose,
  onMinimize,
  onAudioChange,
  onFavoriteToggle,
  playlistQueue = null,
  currentTrackIndex = 0,
  onTrackIndexChange,
  sharedAudioRef,
  sharedPrevFileIdRef,
  audioReady,
  playlistTitle = null,
  trackSort = null,
  queueMode = false,
  queueItem = null,
  onQueueChanged = null,
}) {
  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    setCurrentTrackIndex,
    setPosition: setStorePosition,
    position: storedPosition,
    currentTrackIndex: storeCurrentTrackIndex,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef || { current: null };
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);

  const [coverBlobUrl, setCoverBlobUrl] = useState(null);
  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [playerMode, setPlayerMode] = useState('cover');
  const [videoRemountKey, setVideoRemountKey] = useState(0);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [trackMetadata, setTrackMetadata] = useState(null);
  const [lyricsSynced, setLyricsSynced] = useState(null);
  const [youtubeId, setYoutubeId] = useState(null);
  const [videoSearchResults, setVideoSearchResults] = useState(null);
  const hasLyrics = !!(lyricsSynced || trackMetadata?.lyrics);
  const [coverVersion, setCoverVersion] = useState(0);
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null);
  const bgPendingTargetRef = useRef(null);
  const bgSeekInProgressRef = useRef(false);
  const bgSeekStartedAtRef = useRef(0);
  const bgPendingForceSeekRef = useRef(null);
  const lastAppliedSinkIdRef = useRef(null);
  const lastResumeTargetRef = useRef(null);
  const lastResumeTimeRef = useRef(0);
  const [useBgEngine, setUseBgEngine] = useState(() => {
    try { return localStorage.getItem('mv_bg_engine') === '1'; } catch { return false; }
  });
  const [showSyncOverlay, setShowSyncOverlay] = useState(() => {
    try { return localStorage.syncDebug === 'true'; } catch { return false; }
  });

  const syncLogRef = useRef({
    enabled: false,
    sessionId: null,
    startTime: 0,
    seekStartTime: null,
    buffer: [],
    maxBuffer: 20000,
    summary: null,
    lastConsoleLog: 0,
  });

  const recordingRef = useRef({
    enabled: false,
    buffer: [],
    maxBuffer: 50000,
  });

  const replayStateRef = useRef({
    active: false,
    frameIndex: 0,
    totalFrames: 0,
    timer: null,
    lastFrame: null,
    complete: false,
    startTime: 0,
  });

  const analyzerEvidenceRef = useRef({ mv: [], bg: [] });
  const decisionOutputRef = useRef({ mv: null, bg: null });

  const sessionsRef = useRef([]);
  const selectedRef = useRef(new Set());
  const telemetryNotesRef = useRef('');
  const prevTrackIdRef = useRef(null);
  const trackChangeTimeRef = useRef(0);
  const engineResetTimeRef = useRef(0);
  const rvfcMvLastTimeRef = useRef(0);
  const rvfcBgLastTimeRef = useRef(0);
  const rvfcStatusRef = { mv: 'UNSUPPORTED', bg: 'UNSUPPORTED' };
  // Track 0.25 — last known RVFC frame metadata per engine
  const rvfcMvDataRef = useRef(null);
  const rvfcBgDataRef = useRef(null);
  const syncSessionRef = useRef({
    sessionId: null,
    trackId: null,
    filename: null,
    notes: '',
    codec: null,
    resolution: null,
    duration: null,
    environment: null,
    startedAt: null,
    endedAt: null,
    engineVersion: 'sync-v3',
    configSnapshot: null,
  });

  const syncLog = (kind, engine, data = {}) => {
    const log = syncLogRef.current;
    if (!log.enabled) return;
    const event = {
      t: performance.now() - log.startTime,
      kind,
      engine,
      ...data,
    };
    log.buffer.push(event);
    if (log.buffer.length > log.maxBuffer) {
      log.buffer.splice(0, log.buffer.length - log.maxBuffer);
    }
    const alwaysLog = ['hard_seek', 'stall', 'error'];
    const shouldLog = alwaysLog.includes(kind) || (performance.now() - log.lastConsoleLog > 500);
    if (shouldLog && ['hard_seek', 'soft_seek', 'stall', 'large_drift', 'error'].includes(kind)) {
      log.lastConsoleLog = performance.now();
      console.log(`[SYNC ${event.t.toFixed(0)}ms] ${kind}`, engine, data);
    }
  };

  function computeSummary(events) {
    const ticks = events.filter(e => e.kind === 'tick');
    const seeks = events.filter(e => ['seek', 'hard_seek', 'soft_seek', 'anchor'].includes(e.kind));
    const stalls = events.filter(e => e.kind === 'stall');
    const modeChanges = events.filter(e => e.kind === 'mode_change');
    const seekLatencies = events.filter(e => e.kind === 'seek_latency');

    // Per-engine drift stats
    const mvTicks = ticks.filter(e => e.engine === 'mv');
    const bgTicks = ticks.filter(e => e.engine === 'bg');
    const mvDrifts = mvTicks.map(e => e.drift).filter(v => typeof v === 'number');
    const bgDrifts = bgTicks.map(e => e.drift).filter(v => typeof v === 'number');

    const driftStats = (drifts) => {
      if (!drifts.length) return { avg: 0, max: 0, p95: 0, count: 0 };
      const sorted = [...drifts].sort((a, b) => Math.abs(a) - Math.abs(b));
      const absSorted = sorted.map(Math.abs);
      return {
        avg: Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length),
        max: Math.round(Math.max(...absSorted)),
        p95: Math.round(absSorted[Math.floor(absSorted.length * 0.95)] || 0),
        count: drifts.length,
      };
    };

    const summary = {
      eventCount: events.length,
      tickCount: ticks.length,
      seekCount: seeks.length,
      hardSeekCount: events.filter(e => e.kind === 'hard_seek').length,
      anchorReplaceCount: events.filter(e => e.kind === 'anchor_replace').length,
      stallCount: stalls.length,
      modeChanges: modeChanges.map(e => ({ t: e.t, from: e.from, to: e.to })),
      seekLatency: seekLatencies.length ? {
        avgMs: Math.round(seekLatencies.reduce((a, e) => a + e.latencyMs, 0) / seekLatencies.length),
        maxMs: Math.round(Math.max(...seekLatencies.map(e => e.latencyMs))),
        count: seekLatencies.length,
      } : null,
      mv: driftStats(mvDrifts),
      bg: driftStats(bgDrifts),
    };

    const base = 100;
    const penalties = summary.hardSeekCount * 2 + summary.stallCount * 1 + summary.anchorReplaceCount * 1;
    const avgDriftMs = Math.max(summary.mv.avg, summary.bg.avg);
    const p95DriftMs = Math.max(summary.mv.p95, summary.bg.p95);
    const driftPenalty = Math.max(0, Math.ceil((avgDriftMs - 20) / 10)) + Math.max(0, Math.ceil((p95DriftMs - 40) / 10));
    summary.qualityScore = Math.max(0, base - penalties - driftPenalty);

    return summary;
  }

  const [videoOffset, setVideoOffset] = useState(0);
  const [availSize, setAvailSize] = useState({ width: 384, height: 384 });
  const mediaAreaRef = useRef(null);
  const controlsRef = useRef(null);
  const containerRef = useRef(null);
  const syncedRef = useRef(false);
  const syncedOffsetRef = useRef(null);
  const readyFiredRef = useRef(false);
  const prevModeRef = useRef(false);
  const [videoReady, setVideoReady] = useState(false);
  const [metadataReady, setMetadataReady] = useState(false);
  const isVideoMode = useMemo(() => playerMode === 'video' || playerMode === 'video-split' || playerMode === 'video-cover', [playerMode]);

  const buildEnvironment = () => {
    try {
      const ua = navigator.userAgent || '';
      return {
        userAgent: ua,
        platform: navigator.platform || null,
        hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
        deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
        language: navigator.language || null,
      };
    } catch {
      return { userAgent: null, platform: null, hardwareConcurrency: null, deviceMemory: null, language: null };
    }
  };

  const buildConfigSnapshot = () => {
    try {
      const opts = (typeof mvEngine?.getOptions === 'function' ? mvEngine.getOptions() : {}) || {};
      const adaptive = syncCore?.getAdaptiveThresholds?.('mv');
      return {
        softThreshold: adaptive?.soft ?? opts.softThreshold ?? null,
        hardThreshold: adaptive?.hard ?? opts.hardSeekThreshold ?? null,
        rateGain: typeof opts.rateGain === 'number' ? opts.rateGain : null,
        rateMax: typeof opts.rateMax === 'number' ? opts.rateMax : null,
        rateCooldown: typeof opts.rateCooldownMs === 'number' ? opts.rateCooldownMs : null,
        stdDevThreshold: typeof opts.stableStdDevThreshold === 'number' ? opts.stableStdDevThreshold : null,
        biasEnabled: typeof opts.biasEnabled === 'boolean' ? opts.biasEnabled : null,
        adaptiveThreshold: typeof opts.adaptiveThreshold === 'boolean' ? opts.adaptiveThreshold : null,
        playbackRateEnabled: typeof opts.playbackRateEnabled === 'boolean' ? opts.playbackRateEnabled : null,
      };
    } catch {
      return {};
    }
  };

  const getTelemetryPrefs = () => {
    try {
      const raw = localStorage.getItem('syncTelemetryPrefs');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { autoCollect: true, includeRawEvents: true, clearAfterExport: false };
  };

  const setTelemetryPrefs = (prefs) => {
    try { localStorage.setItem('syncTelemetryPrefs', JSON.stringify(prefs)); } catch {}
  };

  const downloadBlob = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const closeCurrentSession = () => {
    const log = syncLogRef.current;
    if (!log.enabled || !log.sessionId) return null;
    log.enabled = false;
    if (typeof window !== 'undefined') window.__SYNC_ENABLED__ = false;

    const session = {
      ...syncSessionRef.current,
      endedAt: new Date().toISOString(),
    };
    const summary = computeSummary(log.buffer);
    const closed = { session, summary, events: log.buffer.slice() };

    const prefs = getTelemetryPrefs();
    if (prefs.clearAfterExport) {
      sessionsRef.current = [];
    } else {
      sessionsRef.current.push(closed);
      try {
        const estimated = sessionsRef.current.reduce((acc, s) => acc + (s.events?.length || 0) * 150 + 500, 0);
        const MAX = 5 * 1024 * 1024;
        while (estimated > MAX && sessionsRef.current.length > 1) {
          sessionsRef.current.shift();
        }
      } catch {}
    }

    try {
      const summaries = sessionsRef.current.map(s => ({
        sessionId: s.session.sessionId,
        trackId: s.session.trackId,
        filename: s.session.filename,
        startedAt: s.session.startedAt,
        endedAt: s.session.endedAt,
        qualityScore: s.summary.qualityScore,
        mv: s.summary.mv,
        bg: s.summary.bg,
        hardSeekCount: s.summary.hardSeekCount,
        stallCount: s.summary.stallCount,
      }));
      localStorage.setItem('sync_sessions', JSON.stringify(summaries));
    } catch {}

    log.summary = summary;
    log.buffer = [];
    log.sessionId = null;
    syncSessionRef.current = {
      sessionId: null,
      trackId: null,
      filename: null,
      notes: '',
      codec: null,
      resolution: null,
      duration: null,
      environment: null,
      startedAt: null,
      endedAt: null,
      engineVersion: 'sync-v3',
      configSnapshot: null,
    };
    return closed;
  };

  const startNewSession = (trackId, filename, opts = {}) => {
    const prefs = getTelemetryPrefs();
    if (!prefs.autoCollect) return;
    const log = syncLogRef.current;
    if (log.enabled) closeCurrentSession();

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    log.enabled = true;
    if (typeof window !== 'undefined') window.__SYNC_ENABLED__ = true;
    log.sessionId = sessionId;
    log.startTime = performance.now();
    log.buffer = [];
    log.summary = null;

    syncSessionRef.current = {
      sessionId,
      trackId: trackId || null,
      filename: filename || null,
      notes: opts.notes || telemetryNotesRef.current || '',
      codec: opts.codec || null,
      resolution: opts.resolution || null,
      duration: opts.duration || null,
      environment: buildEnvironment(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      engineVersion: 'sync-v3',
      configSnapshot: buildConfigSnapshot(),
    };
  };

  // Expose unified sync telemetry toggles from console:
  //   window.__SYNC__(true)  — start session
  //   window.__SYNC_EXPORT__() — dump JSON
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__SYNC__ = (on) => {
      const log = syncLogRef.current;
      log.enabled = !!on;
      if (typeof window !== 'undefined') {
        window.__SYNC_ENABLED__ = !!on;
      }
      if (log.enabled) {
        log.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        log.startTime = performance.now();
        log.buffer = [];
        log.summary = null;
        console.log(`[Music] SYNC ${log.sessionId} ON`);
      } else {
        console.log(`[Music] SYNC ${log.sessionId || '?'} OFF`);
      }
    };
    window.__SYNC_EXPORT__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) {
        console.error('[Music] Session belum aktif! Jalankan: window.__SYNC__(true)');
        return;
      }
      const data = {
        sessionId: log.sessionId,
        startTime: log.startTime,
        events: log.buffer,
        summary: log.summary || computeSummary(log.buffer),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-${log.sessionId || 'session'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[Music] SYNC exported ${log.buffer.length} events`);
    };
    window.__SYNC_SUMMARY__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) {
        console.error('[Music] Session belum aktif! Jalankan: window.__SYNC__(true)');
        return;
      }
      const s = computeSummary(log.buffer);
      const durationSec = log.buffer.length > 0
        ? Math.round((log.buffer[log.buffer.length - 1].t) / 1000)
        : 0;

      const modeLines = s.modeChanges.length > 0
        ? s.modeChanges.slice(-5).map(m => `${m.from}→${m.to}@${Math.round(m.t)}ms`).join(' ')
        : '(none)';

      const lines = [
        `[SYNC SUMMARY] session:${log.sessionId} | ${durationSec}s | ${s.tickCount} ticks | ${s.eventCount} events`,
        `  MV: avg=${s.mv.avg}ms max=${s.mv.max}ms p95=${s.mv.p95}ms (${s.mv.count} samples)`,
        `  BG: avg=${s.bg.avg}ms max=${s.bg.max}ms p95=${s.bg.p95}ms (${s.bg.count} samples)`,
        `  Seeks: ${s.seekCount}x (hard:${s.hardSeekCount} anchor_replace:${s.anchorReplaceCount})${s.seekLatency ? ` | latency avg=${s.seekLatency.avgMs}ms max=${s.seekLatency.maxMs}ms` : ''}`,
        `  Modes: ${modeLines}`,
        `  Stalls: ${s.stallCount}`,
      ];
      console.log(lines.join('\n'));
      return s;
    };
    // Also expose with single trailing underscore for convenience
    window.__SYNC_SUMMARY = window.__SYNC_SUMMARY__;
    window.__SYNC_EXPORT = window.__SYNC_EXPORT__;

    // Phase 4 — full Evidence-Driven replay from recorded sensor_snapshot events
    window.__SYNC_REPLAY__ = () => {
      try {
        const { SyncReplayEngine } = require('../utils/replay/SyncReplayEngine');
        const log = syncLogRef.current;
        if (!log || !log.buffer || !log.buffer.length) {
          console.warn('[Music] __SYNC_REPLAY__() no recorded events available');
          return null;
        }
        const engine = new SyncReplayEngine(log.buffer);
        return engine.run();
      } catch (err) {
        console.warn('[Music] __SYNC_REPLAY__() failed:', err);
        return null;
      }
    };

    // Recording controls
    window.startRecording = () => {
      recordingRef.current.enabled = true;
      recordingRef.current.buffer = [];
      console.log('[Music] Recording started');
    };
    window.stopRecording = () => {
      const count = recordingRef.current.buffer.length;
      recordingRef.current.enabled = false;
      console.log(`[Music] Recording stopped — ${count} frames captured`);
    };
    window.__SYNC_RECORD__ = () => {
      recordingRef.current.enabled = !recordingRef.current.enabled;
      if (recordingRef.current.enabled) {
        recordingRef.current.buffer = [];
      }
      console.log(`[Music] Recording ${recordingRef.current.enabled ? 'ON' : 'OFF'}`);
    };
    window.__SYNC_RECORD = window.__SYNC_RECORD__;
    try { registerRecordingState({ enabled: recordingRef.current.enabled, bufferLength: recordingRef.current.buffer.length, maxBuffer: recordingRef.current.maxBuffer }); } catch {}

    // Async frame-by-frame replay with live overlay updates
    window.__SYNC_REPLAY_ASYNC__ = async (speed = 1) => {
      try {
        const { SyncReplayEngine } = require('../utils/replay/SyncReplayEngine');
        const log = syncLogRef.current;
        if (!log || !log.buffer || !log.buffer.length) {
          console.warn('[Music] __SYNC_REPLAY_ASYNC__() no recorded events available');
          return null;
        }
        const engine = new SyncReplayEngine(log.buffer);
        let lastResult = null;
        replayStateRef.current = {
          active: true,
          frameIndex: 0,
          totalFrames: 0,
          timer: null,
          lastFrame: null,
          complete: false,
          startTime: performance.now(),
        };
        for await (const frame of engine.runFrames(speed)) {
          lastResult = frame.result;
          replayStateRef.current = {
            active: true,
            frameIndex: frame.frameIndex,
            totalFrames: frame.totalFrames,
            timer: null,
            lastFrame: frame,
            complete: false,
            startTime: replayStateRef.current.startTime,
          };
        }
        replayStateRef.current = {
          active: false,
          frameIndex: replayStateRef.current.totalFrames,
          totalFrames: replayStateRef.current.totalFrames,
          timer: null,
          lastFrame: replayStateRef.current.lastFrame,
          complete: true,
          startTime: replayStateRef.current.startTime,
        };
        console.log(`[Music] Async replay complete — ${replayStateRef.current.totalFrames} frames`);
        return lastResult;
      } catch (err) {
        console.warn('[Music] __SYNC_REPLAY_ASYNC__() failed:', err);
        if (replayStateRef.current) replayStateRef.current.active = false;
        return null;
      }
    };
    window.__SYNC_REPLAY_STOP__ = () => {
      if (replayStateRef.current.timer) {
        clearTimeout(replayStateRef.current.timer);
        replayStateRef.current.timer = null;
      }
      replayStateRef.current.active = false;
      console.log('[Music] Async replay stopped');
    };

    window.__SYNC_GET_NOTES__ = () => { try { return telemetryNotesRef.current || ''; } catch { return ''; } };
    window.__SYNC_SET_NOTES__ = (val) => { try { telemetryNotesRef.current = String(val || ''); } catch {} };
    window.__SYNC_GET_SELECTED__ = () => [...selectedRef.current];
    window.__SYNC_SET_SELECTED__ = (arr) => { try { selectedRef.current = new Set(arr); } catch {} };
    window.__SYNC_TOGGLE_SELECT__ = (index) => {
      try {
        const set = new Set(selectedRef.current);
        if (set.has(index)) set.delete(index); else set.add(index);
        selectedRef.current = set;
      } catch {}
    };
    window.__SYNC_CLEAR_SELECTED__ = () => { try { selectedRef.current = new Set(); } catch {} };
    window.__SYNC_DOWNLOAD_CURRENT__ = () => {
      const log = syncLogRef.current;
      if (!log.enabled || !log.sessionId) { console.warn('[Music] No active session to download'); return; }
      const session = syncSessionRef.current;
      const prefs = getTelemetryPrefs();
      downloadBlob({
        session,
        summary: log.summary || computeSummary(log.buffer),
        events: prefs.includeRawEvents ? log.buffer.slice() : [],
      }, `sync-${new Date().toISOString().slice(0,10)}-${session.trackId || 'x'}-${session.sessionId || 'session'}.json`);
    };
    window.__SYNC_DOWNLOAD_SELECTED__ = () => {
      const indices = [...selectedRef.current].sort((a,b)=>a-b);
      const sessions = indices.map(i => sessionsRef.current[i]).filter(Boolean);
      if (!sessions.length) { console.warn('[Music] No sessions selected'); return; }
      const prefs = getTelemetryPrefs();
      downloadBlob(sessions.map(s => ({ session: s.session, summary: s.summary, events: prefs.includeRawEvents ? (s.events || []) : [] })), 'sync-selected-sessions.json');
    };
    window.__SYNC_DOWNLOAD_ALL__ = () => {
      if (!sessionsRef.current.length) { console.warn('[Music] No completed sessions'); return; }
      const prefs = getTelemetryPrefs();
      downloadBlob(sessionsRef.current.map(s => ({ session: s.session, summary: s.summary, events: prefs.includeRawEvents ? (s.events || []) : [] })), 'sync-all-sessions.json');
    };
    window.__SYNC_CLEAR_SESSIONS__ = () => {
      sessionsRef.current = [];
      selectedRef.current = new Set();
      try { localStorage.removeItem('sync_sessions'); } catch {}
      console.log('[Music] Sync sessions cleared');
    };
    window.__SYNC_GET_SESSIONS__ = () => {
      try { return sessionsRef.current.map(s => ({ sessionId: s.session.sessionId, trackId: s.session.trackId, filename: s.session.filename, startedAt: s.session.startedAt, endedAt: s.session.endedAt, qualityScore: s.summary.qualityScore, hardSeekCount: s.summary.hardSeekCount, stallCount: s.summary.stallCount, avgDriftMs: Math.max(s.summary.mv.avg, s.summary.bg.avg) })); } catch { return []; }
    };
    window.__SYNC_GET_PREFS__ = getTelemetryPrefs;
    window.__SYNC_SET_PREFS__ = setTelemetryPrefs;
  }, []);

  // Expose a console toggle so you can A/B test without rebuilding:
  const touchStartYRef = useRef(0);
  const isGestureActiveRef = useRef(false);
  const [volumeGesture, setVolumeGesture] = useState({ deltaY: 0, showIndicator: false });
  const volumeIndicatorTimeoutRef = useRef(null);

  // Volume gesture handlers
  const handleTouchStart = useCallback((e) => {
    if (playerMode !== 'cover') return;
    touchStartYRef.current = e.touches[0].clientY;
    isGestureActiveRef.current = true;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
}, [playerMode]);

// ---- ResizeObserver: measure available media area for the cover stage.
// We measure the large media area (mediaAreaRef), not the cover's direct parent,
// so the cover can be sized to fill the area while the cover+title+controls are
// centered together as one unit (controls stay close to the cover). ----
useEffect(() => {
  const parent = mediaAreaRef.current;
  if (!parent) return;

  const computeSize = () => {
    const controlsH = controlsRef.current ? controlsRef.current.offsetHeight : 0;
    const width = Math.max(0, parent.clientWidth - 48);
    const height = Math.max(0, parent.clientHeight - controlsH - 220);
    setAvailSize({ width, height });
  };

  computeSize();

  const ro = new ResizeObserver(computeSize);
  ro.observe(parent);
  if (controlsRef.current) ro.observe(controlsRef.current);

  return () => { ro.disconnect(); };
}, []);

  const handleTouchMove = useCallback((e) => {
    if (!isGestureActiveRef.current || playerMode !== 'cover') return;
    const deltaY = touchStartYRef.current - e.touches[0].clientY;
    if (Math.abs(deltaY) > 5) {
      const audio = audioRef?.current;
      if (audio) {
        const volumeChange = deltaY * 0.5;
        const newVolume = Math.max(0, Math.min(100, audio.volume * 100 + volumeChange));
        audio.volume = newVolume / 100;
        setVolume(newVolume);
      }
      setVolumeGesture({ deltaY });
    }
    e.preventDefault();
  }, [playerMode, audioRef]);

  const handleTouchEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
    if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    volumeIndicatorTimeoutRef.current = setTimeout(() => {
      setVolumeGesture(prev => ({ ...prev, showIndicator: false }));
    }, 800);
  }, []);

  const playlistFiles = useMemo(() => {
    if (!playlistQueue || !playlistQueue.length) return [];
    return playlistQueue.map((track, idx) => ({
      id: track.file_id || track.id || `playlist_track_${idx}`,
      name: track.display_name,
      display_name: track.display_name,
      type: track.type || 'audio',
      ext: track.ext || '.mp3',
      size: track.size || 0,
      mtime: track.mtime || 0,
      duration: track.duration || 0,
      has_thumb: 0,
      dir_path: '__playlist__',
      artist: track.artist,
      album: track.album,
      _playlistPath: track.path,
      _exists: track.exists,
      file_id: track.file_id,
      is_favorite: track.is_favorite || 0,
      youtube_id: track.youtube_id || null,
      video_offset: track.video_offset || 0,
    }));
  }, [playlistQueue]);

  const hasPlaylist = playlistFiles.length > 0;
  const carouselFiles = useMemo(() => {
    const base = hasPlaylist ? playlistFiles : folderFiles;
    if (!hasPlaylist && favoriteOnly) {
      return base.filter(f => f.is_favorite === 1);
    }
    return base;
  }, [hasPlaylist, playlistFiles, folderFiles, favoriteOnly]);
  const activeFile = hasPlaylist
    ? (playlistFiles[storeCurrentTrackIndex] || playlistFiles[0])
    : file;

  // Telemetry: auto close/open session on track change (one session per track).
  useEffect(() => {
    const trackId = activeFile?.file_id || activeFile?.id || null;
    const filename = activeFile?.display_name || activeFile?.name || null;
    const prefs = getTelemetryPrefs();

    if (prevTrackIdRef.current != null && prevTrackIdRef.current !== trackId && prefs.autoCollect) {
      trackChangeTimeRef.current = performance.now();
      if (syncLogRef.current.enabled) closeCurrentSession();
      startNewSession(trackId, filename, {
        codec: null,
        resolution: `${availSize.width}x${availSize.height}`,
        duration: typeof activeFile?.duration === 'number' ? activeFile.duration : null,
      });
    } else if (prevTrackIdRef.current == null && trackId && prefs.autoCollect && !syncLogRef.current.enabled) {
      trackChangeTimeRef.current = performance.now();
      startNewSession(trackId, filename, {
        codec: null,
        resolution: `${availSize.width}x${availSize.height}`,
        duration: typeof activeFile?.duration === 'number' ? activeFile.duration : null,
      });
    }
    prevTrackIdRef.current = trackId;
  }, [activeFile?.id, activeFile?.file_id]);

  // Context caption for the carousel so the user always knows WHICH order the
  // strip follows. The playlist carousel follows the queue order, which is now
  // the user's chosen track sort (the queue is built sorted in PlaylistView and,
  // on re-open, the backend /play endpoint re-sorts using the persisted
  // trackSort). This label tells the user exactly which order that is, so the
  // carousel never looks like it lost the sort.
  const sortLabel = useMemo(() => {
    const map = {
      created_at: 'date added',
      name: 'name',
      title: 'title',
      artist: 'artist',
      album: 'album',
      track_num: 'track #',
      track_index: 'added',
      mtime: 'modified',
      size: 'size',
      duration: 'duration',
    };
    const by = (trackSort?.by || currentSortBy || 'created_at');
    const order = trackSort?.order || currentSortOrder || 'asc';
    const label = map[by] || by;
    return `${label} ${order === 'desc' ? '↓' : '↑'}`;
  }, [trackSort, currentSortBy, currentSortOrder]);

  const carouselContextLabel = useMemo(() => {
    if (hasPlaylist) {
      const name = playlistTitle || 'Playlist';
      const by = trackSort?.by || currentSortBy;
      if (!by) return `Playlist: ${name}`;
      return `Playlist: ${name} · sorted by ${sortLabel}`;
    }
    return `In folder order · ${sortLabel}`;
  }, [hasPlaylist, playlistTitle, sortLabel, trackSort, currentSortBy]);

  const handleVideoSearch = useCallback(async () => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      const res = await fetch(`/api/video-cache/auto-detect/${fileId}`);
      const data = await res.json();
      setVideoSearchResults(data.results || []);
    } catch {
      setVideoSearchResults([]);
    }
  }, [activeFile?.file_id, activeFile?.id]);

  const handleVideoPick = useCallback(async (videoId) => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      await fetch(`/api/video-cache/save-id/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeId: videoId }),
      });
      setYoutubeId(videoId);
      setVideoSearchResults(null);
    } catch {}
  }, [activeFile?.file_id, activeFile?.id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    };
  }, []);

  // Stable cacheBust for Carousel - only changes when file ID changes
  const stableCacheBust = useMemo(() => String(coverVersion), [activeFile?.id, coverVersion]);

  // Warm the browser HTTP cache for the ±2 neighbor cover thumbnails so that the
  // cover swap on skip is instant. Uses the exact displayed URL (same coverVersion
  // cache-buster) so the request the <img> makes hits cache. `queue` is read from
  // getState() (it is not a reactive value in this component).
  useEffect(() => {
    const { queue } = usePlaybackStore.getState();
    if (!queue || queue.length === 0) return;
    const n = queue.length;
    const idx = storeCurrentTrackIndex ?? 0;
    const cv = coverVersion;
    [-2, -1, 1, 2].forEach((off) => {
      const f = queue[(idx + off + n) % n];
      const fid = f?.id || f?.file_id;
      if (fid) {
        const img = new Image();
        img.decoding = 'async';
        img.src = `/thumbnails/${fid}.jpg?v=${cv}`;
      }
    });
  }, [storeCurrentTrackIndex, coverVersion]);

  // Sync playlist queue to store — only when the queue CONTENT actually changes.
  // The click path (onPlayTrack) already sets the queue + index authoritatively
  // (store currentTrackIndex is set synchronously BEFORE the player mounts), so
  // PRESERVE the store's currentTrackIndex here instead of overwriting it with the
  // React prop. Overwriting with a stale prop index was the cause of the player
  // showing the PREVIOUS track after navigating back and re-selecting.
  const prevQueueSigRef = useRef(null);
  useEffect(() => {
    if (!hasPlaylist) return;
    const sig = playlistFiles.map(f => f.id).join('|');
    if (sig === prevQueueSigRef.current) return;
    prevQueueSigRef.current = sig;
    const st = usePlaybackStore.getState();
    st.setQueue(playlistFiles, st.currentTrackIndex);
  }, [hasPlaylist, playlistFiles]);

  // Load file when changed — shared audio, skip reload if same track
  useEffect(() => {
    if (!audioReady) return;
    const audio = audioRef?.current;
    if (!audio) return;

    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;

    const isSameTrack = prevFileIdRef.current === fileId;
    prevFileIdRef.current = fileId;

    if (isSameTrack) {
      setIsLoading(false);
      const device = getStoredDevice();
      const deviceId = device && device.deviceId ? device.deviceId : '';
      if (deviceId !== lastAppliedSinkIdRef.current) {
        lastAppliedSinkIdRef.current = deviceId;
        applySink(audio, device).then(() => {
          if (isPlaying && audio.paused) audio.play().catch(() => {});
        }).catch(() => {
          lastAppliedSinkIdRef.current = null;
        });
      } else if (isPlaying && audio.paused) {
        audio.play().catch(() => {});
      }
      const onPlay = () => play();
      const onPause = () => pause();
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      return () => {
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
      };
    }

    setIsLoading(true);
    setError(null);

    // New track — load and play. Re-apply the chosen output device and AWAIT it
    // before play() so setSinkId resolves first; otherwise the first sound
    // briefly blips to the default device.
    audio.currentTime = 0;
    audio.src = `/file/${fileId}`;
    audio.load();

    let sinkReady = false;
    let canPlayFired = false;
    const tryPlay = () => {
      audio.play().then(() => {
        setIsLoading(false);
      }).catch((err) => {
        setIsLoading(false);
        if (err?.name === 'NotAllowedError') {
          setAutoPlayPending(true);
        }
      });
    };
    // Fire play only once BOTH the sink is applied AND the audio can play
    // (race-free regardless of which event lands last).
    const maybePlay = () => {
      if (sinkReady && (canPlayFired || audio.readyState >= 3)) tryPlay();
    };
    audio.addEventListener('canplay', () => { canPlayFired = true; maybePlay(); }, { once: true });
    applySink(audio, getStoredDevice()).then(() => { sinkReady = true; maybePlay(); });

    const onPlay = () => play();
    const onPause = () => pause();
    const onError = () => {
      setIsLoading(false);
      setError('Format tidak didukung browser');
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('canplay', tryPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [activeFile?.id, activeFile?.file_id, audioReady, audioRef, play, pause]);

  // Telemetry: close final session on player unmount.
  useEffect(() => {
    return () => {
      if (syncLogRef.current.enabled) closeCurrentSession();
    };
  }, []);

  // Audio timeupdate → PlaybackStore (source of truth)
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    const sync = () => setStorePosition(audio.currentTime);
    audio.addEventListener('timeupdate', sync);
    return () => audio.removeEventListener('timeupdate', sync);
  }, [audioRef, setStorePosition]);

  // Fetch metadata + lyrics when track changes
  useEffect(() => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) {
      setTrackMetadata(null);
      setLyricsSynced(null);
      setVideoOffset(0);
      setYoutubeId(null);
      return;
    }
    // Clear content immediately so stale lyrics/cover don't flash on the new
    // track. NOTE: we intentionally do NOT reset playerMode here — keeping the
    // current mode (e.g. video) lets the MV follow when skipping next/prev.
    setTrackMetadata(null);
    setLyricsSynced(null);
    setVideoSearchResults(null);
    // Set the video identity SYNCHRONOUSLY from the queue entry so the player can
    // switch video<->cover on the same tick as the skip — no waiting on the
    // /api/metadata round-trip. This unmounts the previous <video> instantly
    // (killing the "stuck old frame") and lets the cover-fallback effect fire
    // immediately when the new track has no video. The fetch below reconciles in
    // case the DB has a newer youtube_id/offset than the cached queue value.
    setYoutubeId(activeFile?.youtube_id || null);
    setVideoOffset(Number(activeFile?.video_offset) || 0);
    let cancelled = false;
    fetch(`/api/metadata/${fileId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setTrackMetadata(data);
        setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
        setYoutubeId(data.youtube_id || null);
        setVideoOffset(Number(data.video_offset) || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFile?.file_id, activeFile?.id, storeCurrentTrackIndex]);

  // When skipping tracks while in a video mode, fall back to cover if the new
  // track's video is NOT actually cached on disk (a YouTube ID may exist but the
  // file was never downloaded). Only stay in video mode when the cached file
  // exists. A manual switch into video mode for the current track is NOT
  // overridden (prevYoutubeIdRef guard) — the user still sees the download
  // spinner rather than being bounced to cover.
  useEffect(() => {
    const videoMode =
      playerMode === 'video' || playerMode === 'video-split' || playerMode === 'video-cover';
    // Switch to cover only when the new track has no video at all.
    // CachedVideoPlayer handles its own download/cache UI when a yt_id exists
    // but the file is not yet cached (or is still downloading), so we no
    // longer force-fallback to cover on cache miss.
    if (!youtubeId && videoMode) { setPlayerMode('cover'); return; }
  }, [youtubeId, playerMode, setPlayerMode]);

  // Retry autoplay after user gesture
  useEffect(() => {
    if (autoPlayPending && userInteracted && audioRef?.current) {
      audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
    }
  }, [autoPlayPending, userInteracted, audioRef]);

// Drift correction: keep the video synced to the live audio position, but
// THROTTLED (~1s interval, not a per-frame requestAnimationFrame loop).
// The old per-frame loop re-called forceSeek()/playVideo()/pauseVideo() up to
// 60x/sec, which made playback feel heavy. Now the <video> just plays
// on its own; we only (a) pause/resume it from the audio's own
// 'waiting'/'playing' events, and (b) re-seek only on LARGE drift (>2s).
const videoOffsetRef = useRef(videoOffset);
videoOffsetRef.current = videoOffset;

// Tracks whether the <video> is currently stalled/buffering so we know a
// resume must be re-anchored. Set by native <video> event callbacks below.
const audioStalledRef = useRef(false);
const scrubbingRef = useRef(false);
const userSeekPendingRef = useRef(false);

// === GENERIC VIDEO SYNC ENGINE ===
// Single-source-of-truth controller for any <video> that must track the audio
// master clock. Works for both the main MV (non-looping, CachedVideoPlayer)
// and the blurred background video (looping, native <video>).

// Helper: signed difference between two timestamps, respecting loop boundaries.
// Used by both the engine tick and the sync log tick loop.


// === ENGINE INSTANCES ===
// Shared Sync Core — the "brain" shared between MV and BG engines.
// Created once, passed to both engines for cooperative statistics.
const syncCoreRef = useRef(null);
if (!syncCoreRef.current) {
  syncCoreRef.current = new SharedSyncCore(() => {
    const audio = audioRef.current;
    if (!audio) return 0;
    return (audio.currentTime || 0) + (videoOffsetRef.current || 0);
  });
}
const syncCore = syncCoreRef.current;

// MV master PID sync engine (non-looping). Controls only the main MV.
const mvEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getDuration: () => videoRef.current?.getDuration?.() ?? Infinity,
    getPaused: () => videoRef.current?.getPaused?.() ?? true,
    getSeeking: () => videoRef.current?.getSeeking?.() ?? false,
    getReadyState: () => videoRef.current?.getReadyState?.() ?? 0,
    seek: (t) => {
        const video = videoRef.current;
        if (!video) return;
        // No pause before the seek: pausing on every hard seek keeps the video
        // at readyState 1 (HAVE_METADATA), so it never buffers to a seekable
        // range and every seek lands at the pre-seek position — the hard-seek
        // loop around one region. forceSeek also avoids pausing; the <video>
        // pauses internally during a seek and the engine resumes on seeked/playing.
        videoRef.current?.forceSeek?.(t);
    },
    play: () => Promise.resolve(videoRef.current?.playVideo?.()),
    pause: () => { videoRef.current?.pauseVideo?.(); return Promise.resolve(); },
    setRate: (r) => { videoRef.current?.setRate?.(r); },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: false,
    hardSeekThreshold: 0.25,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    rateGain: 0.8,
    seekCooldown: 500,
    stallTimeout: 3000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    adaptiveThreshold: true,
    getAdaptiveThresholds: () => syncCore.getAdaptiveThresholds('mv'),
    getNetworkState: () => videoRef.current?.networkState || 0,
 getWaiting: () => videoRef.current?.getWaiting?.(),
 getStalled: () => videoRef.current?.getStalled?.(),
    getRvfcStatus: () => rvfcStatusRef.mv || 'UNKNOWN',
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => audioRef.current?.currentTime || 0,
    getVideoPlaybackRate: () => videoRef.current?.playbackRate || 1,
    getBgPlaybackRate: () => bgVideoRef.current?.playbackRate || 1,
    getVideoOffset: () => videoOffsetRef.current || 0,
    getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getBgCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getRvfcMvPresentationTime: () => rvfcMvDataRef.current?.presentationTime,
    getRvfcBgPresentationTime: () => rvfcBgDataRef.current?.presentationTime,
    getRvfcMvExpectedDisplayTime: () => rvfcMvDataRef.current?.expectedDisplayTime,
    getRvfcBgExpectedDisplayTime: () => rvfcBgDataRef.current?.expectedDisplayTime,
    getRvfcMvMediaTime: () => rvfcMvDataRef.current?.mediaTime,
    getRvfcBgMediaTime: () => rvfcBgDataRef.current?.mediaTime,
  log: syncLog,
      trackChangeTimeRef,
      syncCore,
      engineName: 'mv',
      analyzerEvidenceRef,
      decisionOutputRef,
  }), []);

// Independent BG PID sync engine (looping). Controls only the blurred BG,
// target = live audio time wrapped to BG duration. Decoupled from MV so BG
// buffering/stalls never fight MV corrections.
const bgEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getDuration: () => bgVideoRef.current?.duration ?? Infinity,
    getPaused: () => bgVideoRef.current?.paused ?? false,
    getSeeking: () => bgVideoRef.current?.seeking ?? false,
    getReadyState: () => bgVideoRef.current?.readyState ?? 0,
    seek: (t) => {
        const bg = bgVideoRef.current;
        if (!bg) return;
        const dur = bg.duration;
        if (!isFinite(dur) || dur <= 0) return;
        const target = ((t % dur) + dur) % dur;
        const cur = bg.currentTime || 0;
        const gap = Math.abs(cur - target);
        if (gap < 0.001) {
            bgSeekInProgressRef.current = false;
            bgSeekStartedAtRef.current = 0;
            return;
        }
        if (bgSeekInProgressRef.current) {
            // Wedge recovery: if the seeked event was missed and the flag is
            // stuck true, allow a fresh seek after 2 s instead of silently
            // dropping every subsequent seek (video frozen forever).
            if (performance.now() - bgSeekStartedAtRef.current > 2000) {
                bgSeekInProgressRef.current = false;
            } else {
                bgPendingForceSeekRef.current = target;
                return;
            }
        }
        if (gap < 0.3) {
            bg.currentTime = target;
            bgSeekInProgressRef.current = true;
            bgSeekStartedAtRef.current = performance.now();
            return;
        }
        // Do NOT pause before the seek — match MV's forceSeek. An explicit
        // pause drops BG to a low readyState and adds a pause→play recovery
        // cycle, so BG's seek lands (and resumes) visibly later than MV's.
        // Setting currentTime while playing pauses internally and resumes on
        // seeked, exactly like the main video.
        bg.currentTime = target;
        bgSeekInProgressRef.current = true;
        bgSeekStartedAtRef.current = performance.now();
    },
    play: () => Promise.resolve(bgVideoRef.current?.play?.()),
    pause: () => { bgVideoRef.current?.pause?.(); return Promise.resolve(); },
    setRate: (r) => {
        if (bgVideoRef.current) bgVideoRef.current.playbackRate = r;
    },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: true,
    hardSeekThreshold: 0.25,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    rateGain: 0.8,
    seekCooldown: 500,
    stallTimeout: 2000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    pauseOnStall: false,
    adaptiveThreshold: true,
    getAdaptiveThresholds: () => syncCore.getAdaptiveThresholds('bg'),
    getNetworkState: () => bgVideoRef.current?.networkState || 0,
    getWaiting: () => bgVideoRef.current?.waiting || false,
    getStalled: () => bgVideoRef.current?.stalled || false,
    getRvfcStatus: () => rvfcStatusRef.bg || 'UNKNOWN',
    getDroppedFrames: () => 0,
    getDecodeLatencyMs: () => 0,
    getAudioCurrentTime: () => audioRef.current?.currentTime || 0,
    getVideoPlaybackRate: () => videoRef.current?.playbackRate || 1,
    getBgPlaybackRate: () => bgVideoRef.current?.playbackRate || 1,
    getVideoOffset: () => videoOffsetRef.current || 0,
    getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getBgCurrentTime: () => bgVideoRef.current?.currentTime ?? 0,
    getRvfcMvPresentationTime: () => rvfcMvDataRef.current?.presentationTime,
    getRvfcBgPresentationTime: () => rvfcBgDataRef.current?.presentationTime,
    getRvfcMvExpectedDisplayTime: () => rvfcMvDataRef.current?.expectedDisplayTime,
    getRvfcBgExpectedDisplayTime: () => rvfcBgDataRef.current?.expectedDisplayTime,
    getRvfcMvMediaTime: () => rvfcMvDataRef.current?.mediaTime,
    getRvfcBgMediaTime: () => rvfcBgDataRef.current?.mediaTime,
  log: syncLog,
      trackChangeTimeRef,
      syncCore,
      engineName: 'bg',
      analyzerEvidenceRef,
      decisionOutputRef,
  }), []);

// === SYNC EFFECTS ===
// Audio lifecycle → MV and BG engine state machine
useEffect(() => {
    if (!audioReady) return;

    const markReStable = (cause) => {
        if (syncCore.startReStabilization) {
            syncCore.startReStabilization('mv', cause);
            syncCore.startReStabilization('bg', cause);
        }
    };
    const onWaiting = () => {
        audioStalledRef.current = true;
        syncCore.setStable(false);
        markReStable('onWaiting');
        syncLog('waiting', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
    };
    const onResume = () => {
        const wasStalled = audioStalledRef.current;
        audioStalledRef.current = false;
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('playing', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        
        syncCore.setStable(false);
        markReStable('onResume');
        // Always anchor both engines on resume — eliminates startup delay.
        mvEngine.anchor({ play: true, target });
        if (youtubeId) {
            setTimeout(() => {
                try { bgEngine.anchor({ play: true, target }); } catch (_) {}
            }, 100);
        }
    };
    const onPause = () => {
        audioStalledRef.current = false;
        syncCore.setStable(false);
        markReStable('onPause');
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('pause', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        mvEngine.pause();
        bgEngine.pause();
        bgSeekInProgressRef.current = false;
        bgSeekStartedAtRef.current = 0;
        bgPendingForceSeekRef.current = null;
    };

    const audio = audioRef?.current;
    if (!audio) return;

    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onResume);
    audio.addEventListener('pause', onPause);

    return () => {
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('playing', onResume);
        audio.removeEventListener('pause', onPause);
    };
}, [audioReady, audioRef, mvEngine, bgEngine, youtubeId]);

// Tab refocus → re-anchor MV and mirror BG
useEffect(() => {
    const onVisibility = () => {
        if (!document.hidden && usePlaybackStore.getState().isPlaying) {
            const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
            mvEngine.anchor({ play: true, target });
            setTimeout(() => {
                try { bgEngine.anchor({ play: true, target }); } catch (_) {}
            }, 100);
        }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
}, [mvEngine, bgEngine]);

// Periodic drift correction for MV and BG (30 ms)
useEffect(() => {
    if (!audioReady) return;
    const audio = audioRef.current;
    if (!audio) return;
    const lastAudioPosRef = { current: audio.currentTime };
    const lastTickLogRef = { current: 0 };
    const lastTickTimeRef = { current: performance.now() };
    const id = setInterval(() => {
        const prevPos = lastAudioPosRef.current;
        const audioTarget = audio.currentTime + (videoOffsetRef.current || 0);
        const now = performance.now();
        const tickDelta = now - lastTickTimeRef.current;
        lastTickTimeRef.current = now;

         if (videoRef.current) {
             mvEngine.tick(audioTarget, tickDelta);
         }
         if (bgVideoRef.current) {
             try { bgEngine.tick(audioTarget, tickDelta); } catch (_) {}
         }

        // Loop boundary jump: audio wrapped from near-duration → near-0 (track repeat).
        // Without this, PID slowly chases the 0-target and the gap can spike to ~100 ms.
        // Detect only large backward jumps that exceed half of any known video duration.
        try {
            const bgDur = bgVideoRef.current?.duration;
            const mvDur = videoRef.current?.getDuration?.();
            const knownDur = (isFinite(mvDur) && mvDur > 0 ? mvDur : (isFinite(bgDur) && bgDur > 0 ? bgDur : Infinity));
            const backwardJump = prevPos - audio.currentTime;
            if (usePlaybackStore.getState().isPlaying &&
                backwardJump > knownDur * 0.4 &&
                !mvEngine.state.seekPending) {
                mvEngine.anchor({ play: true, target: videoOffsetRef.current || 0 });
                if (youtubeId) {
                    setTimeout(() => {
                        try { bgEngine.anchor({ play: true, target: videoOffsetRef.current || 0 }); } catch (_) {}
                    }, 100);
                }
            }
        } catch (_) { /* ignore diag errors */ }
        lastAudioPosRef.current = audio.currentTime;

        if (syncLogRef.current.enabled || recordingRef.current.enabled) {
          const aCurrent = audio.currentTime;
          const vOff = videoOffsetRef.current || 0;

          // Throttle tick logs to every 500ms to reduce buffer/console spam
          const now = performance.now();
          if (now - lastTickLogRef.current < 500 && recordingRef.current.enabled) { /* skip */ } else {
          lastTickLogRef.current = now;
          const mvCurrent = videoRef.current?.getCurrentTime?.();
          const bgCurrent = bgVideoRef.current?.currentTime;
          const audioMvDrift = (mvCurrent || 0) - (aCurrent + vOff);
          const audioBgDrift = bgCurrent != null ? bgCurrent - (aCurrent + vOff) : null;
          const mvBgDrift = bgCurrent != null && mvCurrent != null ? bgCurrent - mvCurrent : null;

          if (syncLogRef.current.enabled) {
            syncLog('tick', 'mv', {
              drift: Math.round(audioMvDrift * 1000),
              current: Math.round((mvCurrent || 0) * 1000),
              target: Math.round((aCurrent + vOff) * 1000),
              mode: mvEngine.state.mode,
              seekPending: mvEngine.state.seekPending,
              stalled: mvEngine.state.stalled,
            });
            if (bgCurrent != null) {
              syncLog('triangle', 'system', {
                audioMvMs: Math.round(audioMvDrift * 1000),
                audioBgMs: Math.round(audioBgDrift * 1000),
                mvBgMs: Math.round(mvBgDrift * 1000),
                audioMs: Math.round(aCurrent * 1000),
                mvMs: Math.round((mvCurrent || 0) * 1000),
                bgMs: Math.round((bgCurrent || 0) * 1000),
              });
            }
          }

          // Update recording state ref for overlay
          try {
            if (typeof registerRecordingState === 'function') {
              registerRecordingState({
                enabled: recordingRef.current.enabled,
                bufferLength: recordingRef.current.buffer.length,
                maxBuffer: recordingRef.current.maxBuffer,
              });
            }
          } catch (_) {}

          // Phase 0 — Sensor Layer: log sensor snapshot for replay/observability
          try {
            const mvVideo = videoRef.current;
            const mvDriftMs = Math.round(((mvCurrent || 0) - (aCurrent + vOff)) * 1000);
            const mvSnapshot = buildSensorSnapshot({
              engineId: 'mv',
              videoCurrentTime: mvCurrent || 0,
              audioCurrentTime: aCurrent + vOff,
              driftMs: mvDriftMs,
              readyState: mvVideo?.readyState || 0,
              networkState: mvVideo?.networkState || 0,
              waiting: mvVideo?.waiting || false,
              stalled: mvVideo?.stalled || false,
              seeking: mvVideo?.seeking || false,
              rvfcStatus: rvfcStatusRef.mv || 'UNKNOWN',
              tickDelta: tickDelta,
              cpuOverloaded: mvEngine.state.cpuOverloaded || false,
              droppedFrames: 0,
              decodeLatencyMs: 0,
              pipelineState: 'UNKNOWN',
              cptMs: 0,
            });
            const mvValidated = validateAndAttach(mvSnapshot);
            if (syncLogRef.current.enabled) logSensorSnapshot(syncLog, mvValidated);
            if (recordingRef.current.enabled) {
              recordingRef.current.buffer.push({
                kind: 'sensor_snapshot',
                engine: 'mv',
                ts: performance.now(),
                data: mvValidated.data,
                validationResult: mvValidated.validationResult,
              });
              if (recordingRef.current.buffer.length > recordingRef.current.maxBuffer) {
                recordingRef.current.buffer.splice(0, recordingRef.current.buffer.length - recordingRef.current.maxBuffer);
              }
            }

            // Phase 1 — Analyzer Layer: run analyzers in parallel, log evidence (no behavior change)
            try {
              const mvMemorySnapshot = createMemorySnapshot({
                engineId: 'mv',
                driftEMA: syncCore ? { value: syncCore.mv.rawDriftEMA?.mean || 0, sigma: syncCore.mv.rawDriftEMA?.stdDev || 0, count: syncCore.mv.rawDriftEMA?.samples || 0 } : null,
                biasMs: syncCore ? (syncCore.getBias('mv') || 0) * 1000 : 0,
                cptMs: 0,
                pipelineState: 'UNKNOWN',
                warmupPhase: mvEngine.pipelineMemory?.warmupPhase || false,
                disturbanceCount: 0,
                recentTickDeltas: state.recentTickDeltas || [],
                cpuOverloaded: state.cpuOverloaded || false,
                decodeLatencyHistory: [],
                droppedFrames: 0,
                futileCount: state.softSeekFutileCount || 0,
                adaptiveThresholds: { softMs: (softThreshold || 0.030) * 1000, hardMs: (activeHardThreshold || hardSeekThreshold) * 1000 },
                confidenceHistory: [],
                sessionQuality: 1,
                triangleDrifts: bgCurrent != null ? { hasTriangle: true, audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 } : null,
              });
              const mvCtx = { sensor: mvValidated, memorySnapshot: mvMemorySnapshot, config: {} };
              const mvDriftEvidence = evaluateDriftAnalyzer(mvCtx);
              const mvPipelineEvidence = evaluatePipelineAnalyzer(mvCtx);
              const mvSchedulerEvidence = evaluateSchedulerAnalyzer(mvCtx);
              const mvDecoderEvidence = evaluateDecoderAnalyzer(mvCtx);
              const mvConsistencyEvidence = bgCurrent != null ? evaluateConsistencyAnalyzer({ sensor: { data: { engineId: 'mv', audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 }, ts: performance.now() }, memorySnapshot: mvMemorySnapshot, config: {} }) : null;
              syncLog('analyzer_evidence', 'mv', { drift: mvDriftEvidence, pipeline: mvPipelineEvidence, scheduler: mvSchedulerEvidence, decoder: mvDecoderEvidence, consistency: mvConsistencyEvidence });
            } catch (_) { /* analyzer logging must not break tick */ }
          } catch (_) { /* sensor logging must not break tick */ }

          if (bgCurrent != null) {
            const bgDur = bgVideoRef.current?.duration;
            const bgDriftRaw = bgCurrent - (aCurrent + vOff);
            const bgDrift = (bgEngine.state.looping && isFinite(bgDur) && bgDur > 0)
              ? circularDiff(bgCurrent, aCurrent + vOff, bgDur)
              : bgDriftRaw;
            if (syncLogRef.current.enabled) {
              syncLog('tick', 'bg', {
                drift: Math.round(bgDrift * 1000),
                current: Math.round((bgCurrent || 0) * 1000),
                target: Math.round((aCurrent + vOff) * 1000),
                mode: bgEngine.state.mode,
                seekPending: bgEngine.state.seekPending,
                stalled: bgEngine.state.stalled,
              });
            }

            // Phase 0 — Sensor Layer: log sensor snapshot for replay/observability
            try {
              const bgVideo = bgVideoRef.current;
              const bgDriftMs = Math.round(bgDrift * 1000);
              const bgSnapshot = buildSensorSnapshot({
                engineId: 'bg',
                videoCurrentTime: bgCurrent || 0,
                audioCurrentTime: aCurrent + vOff,
                driftMs: bgDriftMs,
                readyState: bgVideo?.readyState || 0,
                networkState: bgVideo?.networkState || 0,
                waiting: bgVideo?.waiting || false,
                stalled: bgVideo?.stalled || false,
                seeking: bgVideo?.seeking || false,
                rvfcStatus: rvfcStatusRef.bg || 'UNKNOWN',
                tickDelta: tickDelta,
                cpuOverloaded: bgEngine.state.cpuOverloaded || false,
                droppedFrames: 0,
                decodeLatencyMs: 0,
                pipelineState: 'UNKNOWN',
                cptMs: 0,
              });
              const bgValidated = validateAndAttach(bgSnapshot);
              if (syncLogRef.current.enabled) logSensorSnapshot(syncLog, bgValidated);
              if (recordingRef.current.enabled) {
                recordingRef.current.buffer.push({
                  kind: 'sensor_snapshot',
                  engine: 'bg',
                  ts: performance.now(),
                  data: bgValidated.data,
                  validationResult: bgValidated.validationResult,
                });
                if (recordingRef.current.buffer.length > recordingRef.current.maxBuffer) {
                  recordingRef.current.buffer.splice(0, recordingRef.current.buffer.length - recordingRef.current.maxBuffer);
                }
              }

              // Phase 1 — Analyzer Layer: run analyzers in parallel, log evidence (no behavior change)
              try {
                const bgMemorySnapshot = createMemorySnapshot({
                  engineId: 'bg',
                  driftEMA: syncCore ? { value: syncCore.bg.rawDriftEMA?.mean || 0, sigma: syncCore.bg.rawDriftEMA?.stdDev || 0, count: syncCore.bg.rawDriftEMA?.samples || 0 } : null,
                  biasMs: syncCore ? (syncCore.getBias('bg') || 0) * 1000 : 0,
                  cptMs: 0,
                  pipelineState: 'UNKNOWN',
                  warmupPhase: bgEngine.pipelineMemory?.warmupPhase || false,
                  disturbanceCount: 0,
                  recentTickDeltas: bgEngine.state.recentTickDeltas || [],
                  cpuOverloaded: bgEngine.state.cpuOverloaded || false,
                  decodeLatencyHistory: [],
                  droppedFrames: 0,
                  futileCount: bgEngine.state.softSeekFutileCount || 0,
                  adaptiveThresholds: { softMs: (softThreshold || 0.030) * 1000, hardMs: (activeHardThreshold || hardSeekThreshold) * 1000 },
                  confidenceHistory: [],
                  sessionQuality: 1,
                  triangleDrifts: { hasTriangle: true, audioMvMs: audioMvDrift * 1000, audioBgMs: audioBgDrift * 1000, mvBgMs: mvBgDrift * 1000 },
                });
                const bgCtx = { sensor: bgValidated, memorySnapshot: bgMemorySnapshot, config: {} };
                const bgDriftEvidence = evaluateDriftAnalyzer(bgCtx);
                const bgPipelineEvidence = evaluatePipelineAnalyzer(bgCtx);
                const bgSchedulerEvidence = evaluateSchedulerAnalyzer(bgCtx);
                const bgDecoderEvidence = evaluateDecoderAnalyzer(bgCtx);
                syncLog('analyzer_evidence', 'bg', { drift: bgDriftEvidence, pipeline: bgPipelineEvidence, scheduler: bgSchedulerEvidence, decoder: bgDecoderEvidence });
              } catch (_) { /* analyzer logging must not break tick */ }
            } catch (_) { /* sensor logging must not break tick */ }
          }
          } // end throttle

          // Large-drift warnings — throttled to 500ms (same as tick log)
          if (now - lastTickLogRef.current >= 500) {
            const newMvDrift = Math.abs(((videoRef.current?.getCurrentTime?.() || 0) - (aCurrent + vOff)));
            if (newMvDrift > 0.2) {
              syncLog('large_drift', 'mv', { driftMs: Math.round(newMvDrift * 1000) });
            }

            if (bgVideoRef.current?.currentTime != null) {
              const bgDur2 = bgVideoRef.current?.duration;
              const bgCur = bgVideoRef.current.currentTime;
              const newBgDrift = Math.abs(
                (bgEngine.state.looping && isFinite(bgDur2) && bgDur2 > 0)
                  ? circularDiff(bgCur, aCurrent + vOff, bgDur2)
                  : bgCur - (aCurrent + vOff)
              );
              if (newBgDrift > 0.2) {
                syncLog('large_drift', 'bg', { driftMs: Math.round(newBgDrift * 1000) });
              }
            }
          }
        }
    }, 30);
    return () => clearInterval(id);
}, [audioReady, audioRef, mvEngine, bgEngine]);


// Audio seeked event — single source of truth for seek-driven re-anchor.
// `audio.timeupdate` no longer drives anchor here to avoid double-anchor;
// the 30 ms PID tick handles small post-seek drift.
useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;

    const onSeeked = () => {
        const now = audio.currentTime;
        syncLog('seeked', 'audio', { currentTime: Math.round(now * 1000) });

        // While the user is scrubbing the progress bar, handleScrubChange owns
        // the video position (paused preview). Do NOT re-anchor with play:true
        // here — it un-pauses the video and lets it run ahead of the drag, and
        // then handleSeekSync yanks it back to the exact target on release
        // (the visible "plays 100→102, pulled back to 100"). Skip until the
        // scrub ends.
        if (scrubbingRef.current) return;

        // If this seek was triggered by user interaction (progress bar / skip),
        // handleSeekSync already anchored both engines. But always ensure BG
        // is at the correct position — BG seek can silently fail if
        // bgSeekInProgressRef is stale or bg duration isn't loaded.
        if (userSeekPendingRef.current) {
            userSeekPendingRef.current = false;
            if (youtubeId) {
                try { bgEngine.anchor({ play: true, target: now + (videoOffsetRef.current || 0) }); } catch (_) {}
            }
            return;
        }

        const target = now + (videoOffsetRef.current || 0);
        mvEngine.anchor({ play: true, target });
        if (youtubeId) {
            try { bgEngine.anchor({ play: true, target }); } catch (_) {}
        }
        syncedRef.current = false;
    };

    audio.addEventListener('seeked', onSeeked);
    return () => {
        audio.removeEventListener('seeked', onSeeked);
    };
}, [audioRef, mvEngine, bgEngine, youtubeId]);

// On mode switch TO video mode, force a fresh anchor from the live audio position
// so BG follows the current offset and MV does not stay stuck on its old/anchorless position / poster.
useEffect(() => {
    const justEnteredVideo = isVideoMode && !prevModeRef.current;
    prevModeRef.current = isVideoMode;

    if (justEnteredVideo) {
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        const playing = usePlaybackStore.getState().isPlaying;
        mvEngine.anchor({ play: playing, target });

        // Ensure BG is also positioned and playing when entering video mode.
        // The BG <video> is rendered as long as youtubeId exists, but it can be
        // left paused/stale from cover mode; explicitly seek+play it here.
        const bg = bgVideoRef.current;
        if (bg && youtubeId) {
            const dur = bg.duration;
            const bgTarget = (isFinite(dur) && dur > 0)
                ? ((target % dur) + dur) % dur
                : target;
            bg.currentTime = bgTarget;
            if (playing) {
                bg.play().catch(() => {});
            }
            bgEngine.reset();
        }
    }
}, [isVideoMode, mvEngine, bgEngine, youtubeId]);

// One-time sync: position the video at the offset target as soon as it becomes
// ready. This runs again if videoOffset arrives/changes AFTER the first pass.
useEffect(() => {
    if (!(videoReady || metadataReady)) return;
    if (syncedRef.current && syncedOffsetRef.current === videoOffset) return;
    const seekTarget = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
    if (usePlaybackStore.getState().isPlaying) {
        syncLog('anchor', 'mv', { target: seekTarget });
        mvEngine.anchor({ play: true, target: seekTarget });
        if (youtubeId) {
            try { bgEngine.anchor({ play: true, target: seekTarget }); } catch (_) {}
        }
    } else {
        const videoTime = videoRef.current?.getCurrentTime?.() ?? 0;
        if (Math.abs(seekTarget - videoTime) >= 0.1) mvEngine.anchor({ play: false, target: seekTarget });
        if (youtubeId) {
            try { bgEngine.anchor({ play: false, target: seekTarget }); } catch (_) {}
        }
    }
    syncedRef.current = true;
    syncedOffsetRef.current = videoOffset;
}, [videoReady, metadataReady, videoOffset, mvEngine, bgEngine, youtubeId]);

// Track MV video element remount (decode pipeline reset)
useEffect(() => {
  if (syncCore) syncCore.setVideoRemountKey('mv', videoRemountKey);
}, [videoRemountKey, syncCore]);

// Reset all sync state when track/video changes
useEffect(() => {
    if (syncCore) syncCore.reset();
    mvEngine.reset();
    bgEngine.reset();
    syncedRef.current = false;
    syncedOffsetRef.current = null;
    readyFiredRef.current = false;
    lastResumeTargetRef.current = null;
    lastResumeTimeRef.current = 0;
    setVideoReady(false);
    setMetadataReady(false);
    bgPendingTargetRef.current = null;
    bgSeekInProgressRef.current = false;
    bgSeekStartedAtRef.current = 0;
    bgPendingForceSeekRef.current = null;
    if (videoRef.current?.resetSeekState) {
        videoRef.current.resetSeekState();
    }
}, [youtubeId, activeFile?.id, mvEngine, bgEngine]);

// The MV ended (shorter than the song, or reached its own end). Wrap it
// seamlessly to the live audio position (mod MV duration) and keep playing —
// never show a black frame at the end of the clip.
const handleVideoEnded = useCallback(() => {
    const video = videoRef.current;
    if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'ended', video);
    if (!usePlaybackStore.getState().isPlaying) return;
    const audioEl = audioRef?.current;
    if (!audioEl) return;
    const player = videoRef.current;
    if (!player?.forceSeek) return;
    const mvDur = player.getDuration?.() || 0;
    const target = mvDur > 0
        ? ((audioEl.currentTime + (videoOffsetRef.current || 0)) % mvDur)
        : (videoOffsetRef.current || 0);
    mvEngine.anchor({ play: true, target });
}, [audioRef, mvEngine]);

// Recover the MV after a source outage (server restart / network loss).
const lastRecoveryRef = useRef(0);
const recoverVideo = useCallback(() => {
    const now = Date.now();
    if (now - lastRecoveryRef.current < 10000) return;
    lastRecoveryRef.current = now;
    if (syncCore) syncCore.recordVideoLifecycleEvent('mv', 'watchdog-hard', videoRef.current);
    mvEngine.reset();
    syncedRef.current = false;
    syncedOffsetRef.current = null;
    readyFiredRef.current = false;
    setVideoReady(false);
    setMetadataReady(false);
    videoRemountCountRef.current += 1;
    try { registerVideoRemountCount(videoRemountCountRef.current); } catch {}
    setVideoRemountKey((k) => k + 1);
}, [mvEngine, syncCore, registerVideoRemountCount]);

// Genuine <video> error (e.g. stream hiccup / source down).
const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'error', video);
    recoverVideo();
}, [recoverVideo]);

// If the network drops, the stream may stall. On reconnection try a soft
// reload first instead of a full remount — the player can usually recover
// without reinitializing the hardware decoder or clearing learned bias.
useEffect(() => {
    const onOnline = () => {
        if (videoRef.current && typeof videoRef.current.reload === 'function') {
            try { videoRef.current.reload(); } catch {}
        }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
}, []);

// Recovery watchdog: if the <video> stays stalled past a grace window, escalate
// through soft recovery → full remount. Tier 1 (≤12 s): log only and let
// Chromium self-heal. Tier 2 (12–20 s): nudge the <video> via play/pause or
// load() without remounting the component. Tier 3 (≥20 s or explicit error):
// full recoverVideo() remount (syncCore state is preserved across remounts).
const WATCHDOG_INTERVAL = 5000;
const STALL_SOFT_MS = 12000;
const STALL_HARD_MS = 20000;

const videoRemountCountRef = useRef(0);
const softRecoveryRef = useRef(null);
const lastRecoveryTierRef = useRef(0);

const softRecoverVideo = useCallback(() => {
  const video = videoRef.current;
  if (!video) return;
  const now = Date.now();
  if (softRecoveryRef.current && now - softRecoveryRef.current < 8000) return;
  softRecoveryRef.current = now;
  if (syncCore) syncCore.recordVideoLifecycleEvent('mv', 'watchdog-soft', videoRef.current);
  try {
    if (typeof video.reload === 'function') {
      video.reload();
    } else {
      const wasPaused = video.getPaused?.();
      video.pauseVideo?.();
      setTimeout(() => { try { video.playVideo?.(); } catch {} }, 200);
    }
  } catch (_) {}
}, [syncCore]);

useEffect(() => {
  if (!isVideoMode) return undefined;
  const id = setInterval(() => {
    if (!mvEngine.state.stalled) { lastRecoveryTierRef.current = 0; return; }
    const elapsed = Date.now() - mvEngine.state.stalledSince;
    const lastTier = lastRecoveryTierRef.current;
    if (elapsed >= STALL_HARD_MS && lastTier < 3) {
      recoverVideo();
      lastRecoveryTierRef.current = 3;
    } else if (elapsed >= STALL_SOFT_MS && lastTier < 2) {
      softRecoverVideo();
      lastRecoveryTierRef.current = 2;
    }
  }, WATCHDOG_INTERVAL);
  return () => { clearInterval(id); lastRecoveryTierRef.current = 0; };
}, [isVideoMode, mvEngine, recoverVideo, softRecoverVideo]);

// Scrub start: pause the video so it can't run as a second, parallel timeline
// while the audio clock jumps around. The video is re-anchored on scrub-end.
const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true;
    mvEngine.pause();
}, [mvEngine]);

// Scrub move: soft/coalesced seek so the paused video frame tracks the drag
// in real time (preview), without jank or a parallel playback clock.
// Routed through mvEngine so seekPending/lastAnchorTarget stay accurate.
const handleScrubChange = useCallback((val) => {
    const rawTarget = val + (videoOffsetRef.current || 0);
    mvEngine.anchor({ play: false, target: rawTarget });
}, [mvEngine]);

// Seek synchronization from progress bar – fires for ALL video modes. On
// release we clear the scrub flag and re-anchor the video to the live audio
// position through the single consolidated path (resuming clean sync).
const handleSeekSync = useCallback((seconds) => {
    userSeekPendingRef.current = true;
    scrubbingRef.current = false;
    setStorePosition(seconds);
    const target = seconds + (videoOffsetRef.current || 0);
    const currentVideoTime = videoRef.current?.getCurrentTime?.() ?? 0;
    const diff = target - currentVideoTime;
    const playing = usePlaybackStore.getState().isPlaying;
    syncLog('seek', 'mv', { target, current: currentVideoTime.toFixed(3), diff: diff.toFixed(3) });
    // Seamless seek: after a scrub the video is already parked at/near the
    // target (handleScrubChange tracked it). Force-seeking it back to the
    // exact target after it landed (and possibly advanced a few frames) is a
    // visible yank back. Skip the hard re-anchor when within tolerance; resume
    // playback and let SET_RATE absorb the small residual drift invisibly.
    // Genuine jumps still hard-seek.
    if (Math.abs(diff) <= 0.5) {
        if (playing) mvEngine.resume();
        if (youtubeId) {
            const bgCurrent = bgVideoRef.current?.currentTime ?? 0;
            if (Math.abs(target - bgCurrent) > 0.5) {
                try { bgEngine.anchor({ play: true, target }); } catch (_) {}
            }
        }
        return;
    }
    mvEngine.anchor({ play: true, target });
    if (youtubeId) {
        // Issue BG's seek in the SAME tick as MV so both start together and
        // land as close together as their sources allow. The old 150ms delay
        // on large backward seeks made BG start later and finish visibly after
        // MV (MV lands + resumes, BG still seeking).
        try { bgEngine.anchor({ play: true, target }); } catch (_) {}
    }
}, [mvEngine, bgEngine, setStorePosition]);

  const [favLoading, setFavLoading] = useState(false);
  const isFav = useIsFavorite(activeFile?.file_id || activeFile?.id, activeFile?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(async () => {
    if (!activeFile?.id || favLoading) return;
    setFavLoading(true);
    try {
      await onFavoriteToggle(activeFile);
    } catch {}
    setFavLoading(false);
  }, [activeFile, favLoading, onFavoriteToggle]);

  const displayName = activeFile
    ? activeFile.display_name || activeFile.name
    : 'Memutar Audio...';

  const displayTitle = displayName;

  const handleQueueCancel = useCallback(() => {
    if (queueItem?.qid) cancelSendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleQueueRetry = useCallback(() => {
    if (queueItem?.qid) retrySendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleQueueRemove = useCallback(() => {
    if (queueItem?.qid) {
      removeSendQueueItem(queueItem.qid).then(() => { if (onQueueChanged) onQueueChanged(); if (onClose) onClose(); });
    }
  }, [queueItem?.qid, onQueueChanged, onClose]);

  const handleToggleSyncOverlay = useCallback(() => {
    setShowSyncOverlay(prev => {
      const next = !prev;
      try { localStorage.syncDebug = next ? 'true' : 'false'; } catch {}
      window.__SYNC_DEBUG = next;
      return next;
    });
  }, []);

  const handleToggleEngine = useCallback(() => {
    setUseBgEngine(prev => {
      const next = !prev;
      try { localStorage.setItem('mv_bg_engine', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const headerNode = useMemo(() => {
    return (
      <>
        <div className="relative flex items-center justify-between w-full">
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/20 transition-colors"
            title="Close player"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none px-2 max-w-[70%]">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-[0.2em]">Now Playing</span>
            <div className="text-base font-semibold text-white truncate">{displayTitle}</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
          {queueMode ? (
            <>
              {queueItem?.status === 'pending' && (
                <button onClick={handleQueueCancel} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-red-400" title="Batalkan pengiriman">
                  <Ban size={20} />
                </button>
              )}
              {queueItem?.status === 'failed' && (
                <button onClick={handleQueueRetry} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-emerald-400" title="Ulangi pengiriman">
                  <RotateCw size={20} />
                </button>
              )}
              <button onClick={handleQueueRemove} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-red-400" title="Hapus dari riwayat">
                <Trash2 size={20} />
              </button>
            </>
           ) : (
           <>
             <button
               onClick={handleToggleSyncOverlay}
               className={`p-2 rounded-full transition-colors ${showSyncOverlay ? 'bg-white/20 text-purple-400' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
               title={showSyncOverlay ? 'Hide sync overlay' : 'Show sync overlay'}
             >
               <Activity size={20} />
             </button>
             <button
               onClick={handleToggleEngine}
               className={`p-2 rounded-full transition-colors ${useBgEngine ? 'bg-white/20 text-emerald-400' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
               title={useBgEngine ? 'Switch to MV only' : 'Switch to MV + BG'}
             >
               <span className="text-xs font-bold">{useBgEngine ? 'BG' : 'MV'}</span>
             </button>
             <button
               onClick={handleToggleFavorite}
               disabled={favLoading}
               className={`p-2 rounded-full transition-colors ${isFav ? 'text-red-500 hover:bg-white/20' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
               title={isFav ? 'Remove from favorites' : 'Add to favorites'}
             >
               <Heart size={20} className={isFav ? 'fill-red-500' : ''} />
             </button>
            </>
           )}
          {hasPlaylist && (
            <button
              onClick={() => setShowQueuePanel(p => !p)}
              className={`p-2 rounded-full transition-colors ${showQueuePanel ? 'bg-white/20 text-white' : 'hover:bg-white/20 text-white/60'}`}
              title="Queue"
            >
              <ListMusic className="w-5 h-5" />
            </button>
          )}
          <SpeakerOutputButton audioRef={audioRef} />
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="p-2 rounded-full hover:bg-white/20 transition-colors"
              title="Mini player"
            >
              <Minimize2 className="w-5 h-5 text-white" />
            </button>
          )}
          </div>
        </div>
      </>
    );
  }, [onClose, onMinimize, hasPlaylist, showQueuePanel, isFav, favLoading, handleToggleFavorite, handleToggleSyncOverlay, handleToggleEngine, showSyncOverlay, useBgEngine, displayTitle]);
        const handleClick = useCallback((e) => {
          if (e.button !== 0 && e.button !== 1) return;   // left / middle only
          e.preventDefault();

          if (!youtubeId) {
            // No video: simple cover <-> lyrics toggle.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
            return;
          }

          if (isVideoMode) {
            // Left-click anywhere in video mode returns to the main cover view
            // (video disappears). The side panel is driven by RIGHT-click.
            setPlayerMode('cover');
          } else {
            // Cover / lyrics mode (a track with a video): left-click cycles cover <-> lyrics.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleContextMenu = useCallback((e) => {
          e.preventDefault();
          if (!youtubeId) return;             // nothing video-related to cycle
          const area = e.target.closest('[data-area]')?.getAttribute('data-area');

          if (!isVideoMode) {
            // Cover / lyrics mode: right-click enters VIDEO mode (pure video first);
            // further right-clicks reveal the side panel (cover/lyrics).
            setPlayerMode('video');
            return;
          }

          // Inside a video mode, the right-click target decides the action:
          //  - clicking the VIDEO closes the side panel back to pure video;
          //  - clicking the SIDE PANEL swaps lyrics <-> cover (the user's intent);
          //  - a click that lands on the container margin falls back to pure video.
          if (playerMode === 'video') {
            setPlayerMode(hasLyrics ? 'video-split' : 'video-cover');
          } else if (playerMode === 'video-split') {
            if (area === 'lyrics') {
              setPlayerMode('video-cover');     // swap panel: lyrics -> cover
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          } else if (playerMode === 'video-cover') {
            if (area === 'cover-box') {
              setPlayerMode(hasLyrics ? 'video-split' : 'video-cover'); // swap -> lyrics
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleVideoReady = useCallback(() => {
          if (!readyFiredRef.current) {
            readyFiredRef.current = true;
            setVideoReady(true);
          }
          mvEngine.onCanPlay?.();
          const video = videoRef.current;
          if (syncCore && video) {
            syncCore.setVideoSrc('mv', video.src || video.currentSrc);
            syncCore.recordVideoLifecycleEvent('mv', 'canplay', video);
          }
          syncLog('ready', 'mv', {});
        }, [mvEngine]);

        const onVideoLoadedMetadata = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) {
            syncCore.setVideoSrc('mv', video.src || video.currentSrc);
            syncCore.recordVideoLifecycleEvent('mv', 'loadedmetadata', video);
          }
          // Position the video at the offset target the moment it loads, so the
          // FIRST presented frame is the offset frame — not frame 00:00 (which
          // briefly flashes when entering video mode before the engine's first
          // anchor lands). Only when the video is still parked at the start.
          if (video && (video.currentTime || 0) < 0.05) {
            const t = (audioRef.current?.currentTime ?? 0) + (videoOffsetRef.current || 0);
            if (t > 0.05) video.forceSeek?.(t);
          }
          syncLog('loadedmetadata', 'mv', {});
        }, []);
        const onVideoWaiting = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'waiting', video);
          syncLog('waiting', 'mv', {});
          mvEngine.onWaiting();
        }, [mvEngine]);
        const onVideoStalled = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'stalled', video);
          syncLog('stalled', 'mv', {});
          mvEngine.onStalled();
        }, [mvEngine]);
        const onVideoPlaying = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'playing', video);
          syncLog('playing', 'mv', {});
          mvEngine.onPlaying();
        }, [mvEngine]);
        const onVideoSeeked = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'seeked', video);
          syncLog('seeked', 'mv', {});
          mvEngine.onSeeked();
        }, [mvEngine]);

        const onVideoPause = useCallback(() => {
          const video = videoRef.current;
          if (syncCore && video) syncCore.recordVideoLifecycleEvent('mv', 'pause', video);
          if (usePlaybackStore.getState().isPlaying && !mvEngine.state.intentionalPause && !mvEngine.state.seekPending) {
            syncLog('video_paused_resume', 'mv', {});
            videoRef.current?.playVideo?.();
          }
        }, [mvEngine]);

        const onMvVideoFrame = useCallback((frame) => {
          rvfcMvLastTimeRef.current = performance.now();
          // Track 0.25 — preserve latest RVFC metadata for clock provenance
          rvfcMvDataRef.current = {
            presentationTime: frame.presentationTime ?? null,
            expectedDisplayTime: frame.expectedDisplayTime ?? null,
            mediaTime: frame.mediaTime ?? null,
            processingDuration: frame.processingDuration ?? null,
          };
          if (syncCore && frame.expectedDisplayTime != null && frame.presentationTime != null) {
            const presLatMs = frame.expectedDisplayTime - frame.presentationTime;
            if (isValidTelemetrySample(presLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observePresentationLatency('mv', presLatMs);
            }
            const frameAgeMs = (performance.now() - frame.presentationTime);
            if (isValidTelemetrySample(frameAgeMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observeFrameAge('mv', frameAgeMs);
            }
          }
          if (syncCore && frame.processingDuration != null) {
            const decodeLatMs = frame.processingDuration;
            if (isValidTelemetrySample(decodeLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
              syncCore.observeDecodeLat('mv', decodeLatMs);
            }
          }
          if (syncCore) syncCore.observeFrame('mv', performance.now());
        }, []);

        useEffect(() => {
          const el = bgVideoRef.current;
          if (!el || typeof el.requestVideoFrameCallback !== 'function') return;
          let running = true;
          const loop = (now, metadata) => {
            if (!running) return;
            rvfcBgLastTimeRef.current = now;
            // Track 0.25 — preserve latest RVFC metadata for clock provenance
            rvfcBgDataRef.current = {
              presentationTime: metadata.presentationTime ?? null,
              expectedDisplayTime: metadata.expectedDisplayTime ?? null,
              mediaTime: metadata.mediaTime ?? null,
              processingDuration: metadata.processingDuration ?? null,
            };
            el.requestVideoFrameCallback(loop);
            if (syncCore && metadata.expectedDisplayTime != null && metadata.presentationTime != null) {
              const presLatMs = metadata.expectedDisplayTime - metadata.presentationTime;
              if (isValidTelemetrySample(presLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observePresentationLatency('bg', presLatMs);
              }
              const frameAgeMs = (now - metadata.presentationTime);
              if (isValidTelemetrySample(frameAgeMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observeFrameAge('bg', frameAgeMs);
              }
            }
            if (syncCore && metadata.processingDuration != null) {
              const decodeLatMs = metadata.processingDuration;
              if (isValidTelemetrySample(decodeLatMs, { minAgeMs: 500, trackChangeTime: trackChangeTimeRef.current })) {
                syncCore.observeDecodeLat('bg', decodeLatMs);
              }
            }
            if (syncCore) syncCore.observeFrame('bg', now);
            syncLog('rvfc', 'bg', {
              mediaTime: metadata.mediaTime?.toFixed(3) ?? 'null',
              presentedFrames: metadata.presentedFrames,
              processingDuration: metadata.processingDuration?.toFixed(3) ?? 'null'
            });
          };
          el.requestVideoFrameCallback(loop);
          return () => { running = false; };
        }, []);

  // Play audio within user gesture context (click handler) to bypass autoplay policy
  const playFileInGesture = useCallback(async (fileId) => {
    const audio = audioRef?.current;
    if (!audio || !fileId) return;
    const newSrc = `/file/${fileId}`;
    audio.currentTime = 0;
     if (audio.src !== window.location.origin + newSrc) {
      audio.src = newSrc;
      audio.load();
    }
    prevFileIdRef.current = fileId;
    // Apply the output device and AWAIT it before play so sound starts on the
    // chosen device, never the default.
    await applySink(audio, getStoredDevice());
    audio.play().then(() => {
      play();
      setIsLoading(false);
    }).catch(() => {});
  }, [audioRef, play]);

  const handleCarouselSelect = useCallback((selectedFile) => {
    const fileId = selectedFile?.file_id || selectedFile?.id;
    if (fileId) playFileInGesture(fileId);
    if (hasPlaylist) {
      const idx = playlistFiles.findIndex(f => f.id === selectedFile.id);
      if (idx !== -1) {
        setCurrentTrackIndex(idx);
        onTrackIndexChange?.(idx);
      }
    } else {
      onAudioChange?.(selectedFile);
    }
  }, [hasPlaylist, playlistFiles, playFileInGesture, setCurrentTrackIndex, onAudioChange, onTrackIndexChange]);

  // Scrub start: pause the video so it can't run as a second, parallel timeline
  // while the audio clock jumps around. The video is re-anchored on scrub-end.
  const handleNext = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === prev.queue.length - 1) return;
    next();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const nextFile = st.queue[st.currentTrackIndex];
    if (nextFile) {
      const fid = nextFile.file_id || nextFile.id;
      if (fid) playFileInGesture(fid);
      // Keep the `file` prop (and thus the cover/MV metadata) in sync so the
      // video follows the skip even when there is no playlist queue.
      onAudioChange?.(nextFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [next, playFileInGesture, hasPlaylist, onTrackIndexChange, onAudioChange]);

  const handlePrevious = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === 0) return;
    previous();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const prevFile = st.queue[st.currentTrackIndex];
    if (prevFile) {
      const fid = prevFile.file_id || prevFile.id;
      if (fid) playFileInGesture(fid);
      onAudioChange?.(prevFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [previous, playFileInGesture, hasPlaylist, onTrackIndexChange, onAudioChange]);

    const mainContent = useMemo(() => {
     // --- Fit cover/video into the available media area (excludes title) ---
    const aW = availSize.width || 384;
    const aH = availSize.height || 384;
    const COVER_MAX = 384; // 24rem
    const coverBox = Math.min(aW, aH, COVER_MAX);

    const isSplit = playerMode === 'video-split' || playerMode === 'video-cover';
    const hasVideo = !!youtubeId;
    const isVideo = isVideoMode && hasVideo;

    const baseVidW = coverBox * 16 / 9;
    const baseVidH = coverBox;
    const vScale = Math.min(1, aW / baseVidW, aH / baseVidH);

    const GAP = 16;
    const basePanel = baseVidH;
    const sScale = Math.min(1, aW / (baseVidW + GAP + basePanel), aH / baseVidH);

    const curVidW = isSplit ? baseVidW * sScale : baseVidW * vScale;
    const curVidH = isSplit ? baseVidH * sScale : baseVidH * vScale;
    const panelW = isSplit ? basePanel * sScale : 0;
    const panelH = isSplit ? curVidH : 0;

    // In split (video-split / video-cover) mode, center the COMBINED
    // video + panel block so the video nudges left and the panel sits to its
    // right with equal left/right margins — instead of the video being
    // hard-centered with the panel hanging off the right edge.
    const totalBlockW = isSplit ? curVidW + GAP + panelW : curVidW;
    const videoLeft = Math.max(0, (aW - totalBlockW) / 2);
    const videoTop  = Math.max(0, (aH - curVidH) / 2);

    const panelLeft = videoLeft + curVidW + GAP;
    const panelTop  = videoTop;

    const coverLeft = Math.max(0, (aW - coverBox) / 2);
    const coverTop  = Math.max(0, (aH - coverBox) / 2);

    // Breathing (play/pause) pulse only for cover/lyrics. In any video mode we
    // keep scale = 1 so the 1.04 grow never eats the gap and makes the side
    // panel overlap the video in split (video-split / video-cover) layouts.
    const coverScale = isVideo ? 1 : (isPlaying ? 1.04 : 0.9);
    const breath = `scale(${coverScale})`;

    const containerTransition = 'width 400ms ease, height 400ms ease, opacity 400ms ease';

       const containerH = aH + 8;
      const containerStyle = {
        width: aW + 'px',
        height: containerH + 'px',
        maxWidth: '100%',
        transition: containerTransition,
        opacity: isPlaying ? 1 : 0.5,
      };

    let regionLeft, regionTop, regionW, regionH;
    if (isVideo) {
      regionLeft = videoLeft;
      regionTop  = videoTop;
      regionW    = curVidW;
      regionH    = curVidH;
    } else {
      regionLeft = coverLeft;
      regionTop  = coverTop;
      regionW    = coverBox;
      regionH    = coverBox;
    }

    const stageStyle = {
      position: 'absolute',
      left: regionLeft + 'px',
      top: regionTop + 'px',
      width: regionW + 'px',
      height: regionH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
      transform: breath,
      transformOrigin: 'center center',
      transition: 'left 400ms ease, top 400ms ease, width 400ms ease, height 400ms ease, transform 400ms ease, opacity 400ms ease',
      zIndex: 2,
    };

    const lyricsPanelStyle = {
      position: 'absolute',
      left: panelLeft + 'px',
      top: panelTop + 'px',
      width: panelW + 'px',
      height: panelH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      transform: breath,
      transformOrigin: 'center center',
      opacity: isSplit ? 1 : 0,
      pointerEvents: isSplit ? 'auto' : 'none',
      transition: 'width 400ms ease, height 400ms ease, opacity 400ms ease, left 400ms ease, top 400ms ease, transform 400ms ease',
      zIndex: 1,
    };

    return (
      <div className="flex flex-col items-center w-full">
        <div
          ref={containerRef}
          className="relative w-full cursor-pointer overflow-hidden rounded-2xl"
          style={containerStyle}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          {/* SINGLE MORPHING STAGE: cover / video / lyrics (1:1 <-> 16:9).
              Satu kontainer rounded yang ukuran/posisinya morph; anak-anak isi penuh
              (inset:0) dan di-crossfade opacity sehingga transisi cover<->video tanpa peek. */}
        <div
          data-area={isVideo ? 'video' : (playerMode === 'lyrics' ? 'lyrics' : 'cover')}
          className="absolute"
          style={stageStyle}
        >
          {/* Cover child — fills the square clip region */}
          <div
            className="absolute inset-0"
            style={{
              // Stage clips to a rounded 1rem container, so the image is always
              // rounded; borderRadius/overflow below are a harmless safeguard.
              borderRadius: '1rem',
              overflow: 'hidden',
              opacity: (!isVideo && playerMode !== 'lyrics') ? 1 : 0,
              pointerEvents: (!isVideo && playerMode !== 'lyrics') ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            {activeFile ? (
              <NetworkImage
                src={coverBlobUrl || `/thumbnails/${activeFile.id}.jpg?v=${coverVersion}`}
                alt="Cover"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-800 to-sky-900 flex items-center justify-center">
                <svg className="w-20 h-20 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            {isLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
              </div>
            )}
            {playerMode === 'cover' && (
              <div className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMetadataEditor(true); }}
                  className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white/70 hover:text-white transition-colors"
                  title="Edit metadata"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Video child — fills the 16:9 clip region */}
          {youtubeId && (
            <div
              className="absolute inset-0"
              style={{
                opacity: isVideo ? 1 : 0,
                pointerEvents: isVideo ? 'auto' : 'none',
                transition: 'opacity 400ms ease, transform 400ms ease',
                transform: isVideo ? (isPlaying ? 'scale(1.01)' : 'scale(0.99)') : 'scale(1)',
                transformOrigin: 'center center',
              }}
            >
                <CachedVideoPlayer
                  key={videoRemountKey}
                  ref={videoRef}
                  youtubeId={youtubeId}
                  coverUrl={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
                  muted
                  onReady={handleVideoReady}
                  onLoadedMetadata={onVideoLoadedMetadata}
                  onWaiting={onVideoWaiting}
                  onStalled={onVideoStalled}
                  onPlaying={onVideoPlaying}
                  onSeeked={onVideoSeeked}
                  onPause={onVideoPause}
                  onEnded={handleVideoEnded}
                   onError={handleVideoError}
                   onVideoFrame={onMvVideoFrame}
                />
            </div>
          )}

          {/* Lyrics child — fills the square clip region (blurred cover + lyrics) */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: '1rem',
              overflow: 'hidden',
              opacity: playerMode === 'lyrics' ? 1 : 0,
              pointerEvents: playerMode === 'lyrics' ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-neutral-900 to-sky-900" />
            <NetworkImage
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(28px) brightness(0.7) saturate(1.25)', transform: 'scale(1.15)' }}
              showRetry={false}
            />
            <div className="absolute inset-0 bg-black/15" />
            <div
              className="absolute inset-0"
              style={{ background: 'radial-gradient(circle at center, rgba(10,10,10,0) 38%, rgba(10,10,10,0.6) 100%)' }}
            />
            <div className="relative z-10 w-full h-full overflow-y-auto p-4 sm:p-6">
              <LyricsDisplay
                lyrics={lyricsSynced || trackMetadata?.lyrics}
                audioRef={audioRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>

        {/* SPLIT BLOCK (video-split: lyrics, video-cover: cover art).
            Kedua konten dirender sekaligus dan di-crossfade opacity agar
            transisi cover<->lyrics tidak "loncat". Posisi di-animasikan via
            transform (style lyricsPanelStyle); video layer z-index lebih tinggi
            sehingga panel tidak menutupi video saat transisi. */}
        <div
          data-area={playerMode === 'video-cover' ? 'cover-box' : 'lyrics'}
          className="rounded-2xl overflow-hidden"
          style={lyricsPanelStyle}
        >
          {/* Child A: cover art (video-cover) */}
          <div
            className="absolute inset-0"
            style={{ opacity: playerMode === 'video-cover' ? 1 : 0, transition: 'opacity 300ms ease' }}
          >
            <NetworkImage
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt="Cover"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
          {/* Child B: lyrics (video-split) */}
          <div
            className="absolute inset-0"
            style={{
              opacity: playerMode === 'video-split' ? 1 : 0,
              transition: 'opacity 300ms ease',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-neutral-900 to-sky-900" />
            <NetworkImage
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(22px) brightness(0.75) saturate(1.2)', transform: 'scale(1.1)' }}
              showRetry={false}
            />
            <div className="absolute inset-0 bg-black/15" />
            <div className="relative z-10 w-full h-full">
              <LyricsDisplay
                lyrics={lyricsSynced || trackMetadata?.lyrics}
                audioRef={audioRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>

        {/* VIDEO SEARCH PICKER */}
        {playerMode === 'video' && !youtubeId && videoSearchResults && (
          <div className="absolute inset-0 bg-black/90 rounded-2xl overflow-y-auto z-20 p-3">
            <p className="text-white/60 text-[10px] mb-2">Pilih video:</p>
            <div className="space-y-2">
              {videoSearchResults && videoSearchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={(e) => { e.stopPropagation(); handleVideoPick(r.id); }}
                  className="w-full flex gap-2 items-start p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <img src={r.thumbnail} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white text-[11px] font-medium leading-tight truncate">{r.title}</p>
                    <p className="text-white/40 text-[10px] truncate">{r.channel}</p>
                  </div>
                </button>
              ))}
              {videoSearchResults.length === 0 && (
                <p className="text-white/30 text-xs text-center py-4">No results found</p>
              )}
             </div>
           </div>
      )}
 
         </div>
       </div>
    );
  }, [activeFile?.id, coverBlobUrl, coverVersion, isLoading, error, isPlaying, playerMode, lyricsSynced, trackMetadata, youtubeId, videoSearchResults, audioRef, pause, play, handleVideoSearch, handleVideoPick, availSize]);

  const handleQueueSelect = useCallback((index) => {
    const queueFile = playlistFiles[index];
    if (queueFile) {
      const fid = queueFile.file_id || queueFile.id;
      if (fid) playFileInGesture(fid);
    }
    setCurrentTrackIndex(index);
    if (hasPlaylist) onTrackIndexChange?.(index);
  }, [playlistFiles, playFileInGesture, setCurrentTrackIndex, hasPlaylist, onTrackIndexChange]);

  // Dedicated Music UI (no MediaLayout / media-vault shared chrome): show the
  // carousel only when there are siblings, and let the user hide it (persisted).
  const showCarousel = carouselFiles.length > 1;
  const [manualHidden, setManualHidden] = useState(() => {
    try { return localStorage.getItem('mv_carousel_hidden') === '1'; } catch { return false; }
  });
  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Register refs for SyncOverlay (Phase 0 observability)
  useEffect(() => {
    registerSyncCore(syncCore);
    registerAudioRef(audioRef);
    registerMvRef(videoRef);
    registerBgRef(bgVideoRef);
    registerEngineStateRef(mvEngine.state, bgEngine.state);
    registerVideoOffsetRef(videoOffsetRef);
    registerRvfcStatusRef(rvfcStatusRef);
    registerVideoRemountCount(videoRemountCountRef.current);
    registerReplayStateRef(replayStateRef);
    registerRecordingState({
      enabled: recordingRef.current.enabled,
      bufferLength: recordingRef.current.buffer.length,
      maxBuffer: recordingRef.current.maxBuffer,
    });
    registerAnalyzerEvidence(analyzerEvidenceRef.current);
    registerDecisionOutput(decisionOutputRef.current);
    window.__replayStateRef = replayStateRef;
  }, [syncCore, mvEngine, bgEngine]);

  // __SYNC_DEBUG toggle: window.__SYNC_DEBUG = true or localStorage.syncDebug = 'true'
  useEffect(() => {
    const check = () => {
      const debug = window.__SYNC_DEBUG === true || localStorage.syncDebug === 'true';
      if (debug) {
        window.__SYNC_DEBUG = true;
        try { localStorage.syncDebug = 'true'; } catch {}
      }
    };
    check();

    // Expose replay API
    window.__SYNC_REPLAY = (config) => {
      const { SyncReplay } = require('../utils/syncCore');
      const replay = new SyncReplay(syncCore.getReplayLog());
      return replay.runWithConfig(config || {});
    };
    window.__SYNC_REPLAY_COMPARE = (configA, configB) => {
      const { SyncReplay } = require('../utils/syncCore');
      const replay = new SyncReplay(syncCore.getReplayLog());
      return replay.compareConfigs(configA || {}, configB || {});
    };
    window.__SYNC_CORE = syncCore;

    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

   // RVFC status tracking
   useEffect(() => {
     const update = () => {
       const now = performance.now();
       const bgVideo = bgVideoRef.current;
       const bgPaused = bgVideo ? bgVideo.paused : true;

       // MV: CachedVideoPlayer wraps the <video>, so we detect RVFC activity
       // via rvfcMvLastTimeRef (updated by onVideoFrame callback) rather than
       // checking requestVideoFrameCallback on the component instance.
       const mvSupported = rvfcMvLastTimeRef.current > 0;
       const mvPaused = videoRef.current?.getPaused?.() ?? true;
       if (mvSupported) {
         if (mvPaused) {
           rvfcStatusRef.mv = 'PAUSED';
         } else if (now - rvfcMvLastTimeRef.current > 1000) {
           rvfcStatusRef.mv = 'TIMEOUT';
         } else {
           rvfcStatusRef.mv = 'ACTIVE';
         }
       } else {
         rvfcStatusRef.mv = 'UNSUPPORTED';
       }

       if (typeof bgVideo?.requestVideoFrameCallback === 'function') {
         if (bgPaused) {
           rvfcStatusRef.bg = 'PAUSED';
         } else if (now - rvfcBgLastTimeRef.current > 1000) {
           rvfcStatusRef.bg = 'TIMEOUT';
         } else {
           rvfcStatusRef.bg = 'ACTIVE';
         }
       } else if (bgVideo) {
         rvfcStatusRef.bg = 'UNSUPPORTED';
       }
     };
     const id = setInterval(update, 500);
     update();
     return () => clearInterval(id);
   }, []);

  return (
    <div data-debug-id="1.1.9.3" data-debug-name="AudioPlayer" data-debug-type="player" className={`w-full h-full overflow-hidden max-w-full flex flex-col text-slate-100 select-none relative ${isVideoMode && youtubeId ? '' : 'bg-neutral-950'}`}>
      {/* Sync debug overlay — toggle with window.__SYNC_DEBUG = true */}
      <SyncOverlay onClose={() => setShowSyncOverlay(false)} />
       {/* Video background: blurred, stretched video behind all content when in video mode */}
        {youtubeId && useBgEngine && (
        <video
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ filter: `blur(12px) saturate(1.4) brightness(${isPlaying ? 0.85 : 0.45})`, transition: 'filter 400ms ease', transform: 'scale(1.2)', zIndex: 0, opacity: isVideoMode ? 0.45 : 0, maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }}
          src={`/api/video-cache/stream/${youtubeId}`}
          muted
          playsInline
          preload="auto"
          ref={(el) => { bgVideoRef.current = el; }}
          onLoadStart={() => {
            const bg = bgVideoRef.current;
            if (syncCore && bg) {
              syncCore.setVideoSrc('bg', bg.src || bg.currentSrc);
              syncCore.recordVideoLifecycleEvent('bg', 'loadstart', bg);
            }
          }}
          onLoadedData={() => {
            const bg = bgVideoRef.current;
            if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'loadeddata', bg);
          }}
          onLoadedMetadata={() => {
            const bg = bgVideoRef.current;
            if (syncCore && bg) {
              syncCore.setVideoSrc('bg', bg.src || bg.currentSrc);
              syncCore.recordVideoLifecycleEvent('bg', 'loadedmetadata', bg);
            }
            if (bg && isFinite(bg.duration) && bg.duration > 0) {
                const mvReady = videoReady || metadataReady;
                const audio = audioRef.current;
                let t;
                let pendingT = 0;
                if (audio && isFinite(audio.currentTime)) {
                  pendingT = audio.currentTime;
                }
                if (bgPendingTargetRef.current != null && mvReady) {
                  t = bgPendingTargetRef.current;
                  bgPendingTargetRef.current = null;
                } else {
                  t = 0;
                  if (audio && isFinite(audio.currentTime)) {
                    t = ((pendingT % bg.duration) + bg.duration) % bg.duration;
                  }
                  bgPendingTargetRef.current = pendingT;
                }
                bgEngine.anchor({ play: false, target: t });
              }
            }}
           onCanPlay={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'canplay', bg);
             bgEngine.onCanPlay?.(); 
           }}
           onWaiting={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'waiting', bg);
             syncLog('waiting', 'bg', {}); 
             bgEngine.onWaiting(); 
           }}
           onStalled={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'stalled', bg);
             syncLog('stalled', 'bg', {}); 
             bgEngine.onStalled(); 
           }}
           onPlaying={() => { 
             const bg = bgVideoRef.current;
             if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'playing', bg);
             syncLog('playing', 'bg', {}); 
             bgEngine.onPlaying(); 
           }}
            onSeeked={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'seeked', bg);
              syncLog('seeked', 'bg', {});

              bgSeekInProgressRef.current = false;
              bgSeekStartedAtRef.current = 0;
              // A seek issued while another was in flight was parked here; it is
              // now superseded by onSeeked's live re-anchor, so drop it instead
              // of re-applying a stale position.
              bgPendingForceSeekRef.current = null;

              bgEngine.onSeeked();
            }}
            onEnded={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'ended', bg);
              if (!usePlaybackStore.getState().isPlaying) return;
              const audioTarget = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
              try { bgEngine.anchor({ play: true, target: audioTarget }); } catch (_) {}
            }}
            onPlay={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'play', bg);
            }}
            onError={() => {
              const bg = bgVideoRef.current;
              if (syncCore && bg) syncCore.recordVideoLifecycleEvent('bg', 'error', bg);
              // BG stream error is harmless — it shares the same src as the MV.
            }}
        />
      )}
      <div className="relative flex flex-col flex-1 min-h-0" style={{ zIndex: 1 }}>
      <div className="relative flex-none flex flex-col border-b border-white/5 px-4 py-1.5">
        {headerNode}
      </div>

      {/* Media area: cover + title + controls grouped and centered as ONE unit, so
          the media controls stay close to the cover/title even when the window is tall
          (instead of being pushed to the very bottom by a greedy flex child). */}
      <div ref={mediaAreaRef} className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-8">
        <div className="flex flex-col items-center w-full">
           {mainContent}
           <div ref={controlsRef} className="w-full max-w-3xl">
            <MediaControls
              type="audio"
              mediaRef={audioRef}
              folderFiles={carouselFiles}
              currentFile={activeFile}
              onFileChange={handleCarouselSelect}
              onSeek={handleSeekSync}
              onSeekStart={handleScrubStart}
              onSeekChange={handleScrubChange}
              playlistMode={hasPlaylist}
              onNext={hasPlaylist ? handleNext : undefined}
              onPrevious={hasPlaylist ? handlePrevious : undefined}
            />
          </div>
        </div>
      </div>

      {/* Playlist / queue strip pinned to the bottom, large thumbnails, with a
          hide toggle. Uses its own collapse so it never overlaps the audio UI. */}
      {showCarousel && (
        <div className="w-full relative">
          <div className={`grid transition-all duration-300 ease-out ${manualHidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
            <div className="overflow-hidden">
               <Carousel
                 files={carouselFiles}
                 currentFile={activeFile}
                 onSelect={handleCarouselSelect}
                 sortBy={currentSortBy}
                 sortOrder={currentSortOrder}
                 cacheBust={stableCacheBust}
                 onToggleFavorite={onFavoriteToggle}
                 contextLabel={carouselContextLabel}
                 itemSize="lg"
                 restoreScrollKey={hasPlaylist ? `playlist-${playlistTitle || 'unknown'}` : file ? `folder-${file.dir_path || 'root'}` : null}
               />
            </div>
          </div>
          <button
            onClick={toggleCarouselHidden}
            className="absolute -top-9 right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity"
            title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
          >
            {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      )}

      <QueuePanel
        isOpen={showQueuePanel}


        onClose={() => setShowQueuePanel(false)}
        tracks={playlistFiles}
        currentTrackIndex={storeCurrentTrackIndex}
        onTrackSelect={handleQueueSelect}
        onFavoriteToggle={onFavoriteToggle}
      />
    {showMetadataEditor && activeFile?.id && (
      <MetadataEditor
        fileId={activeFile.id}
        onSaved={() => {
          fetch(`/api/metadata/${activeFile.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
        onCoverChanged={() => setCoverVersion(v => v + 1)}
        onClose={() => {
          setShowMetadataEditor(false);
          fetch(`/api/metadata/${activeFile.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
      />
    )}
    </div>
    </div>
  );
}
