// Shared Sync Core — EMA statistics, bias compensation, adaptive thresholds,
// prediction confidence, replay mode, and observability for the A/V sync engine.
//
// Core principle: All adaptive metrics (bias, prediction, threshold, playbackRate)
// ONLY learn from stable states (LOCKED / normal playback). During seeking,
// recovery, buffering, stall, or hard seek, raw data is recorded for analysis
// but NEVER used to update the adaptive model.

// ─────────────────────────────────────────────────────────────────────────────
// EMATracker — Exponential Moving Average with variance tracking
// ─────────────────────────────────────────────────────────────────────────────

export class EMATracker {
  constructor(alpha, bootstrapValue = 0) {
    this.alpha = alpha;
    this.mean = bootstrapValue;
    this.variance = 0;
    this.samples = 0;
  }

  push(newValue, alphaOverride = null) {
    const effectiveAlpha = alphaOverride != null ? alphaOverride : this.alpha;
    if (this.samples === 0) {
      this.mean = newValue;
      this.variance = 0;
    } else {
      const delta = newValue - this.mean;
      this.mean += effectiveAlpha * delta;
      this.variance = (1 - effectiveAlpha) * (this.variance + effectiveAlpha * delta * delta);
    }
    this.samples++;
    return this.mean;
  }

  get stdDev() {
    return Math.sqrt(this.variance);
  }

  get isReady() {
    return this.samples >= 20;
  }

  get isFullyAdaptive() {
    return this.samples >= 100;
  }

  get softPrediction() {
    return this.samples >= 60 ? this.mean : null;
  }

  reset() {
    this.mean = 0;
    this.variance = 0;
    this.samples = 0;
  }
}

export class RollingStats {
  constructor() {
    this.current = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = 0;
    this.count = 0;
  }

  push(val) {
    this.current = val;
    this.sum += val;
    if (val < this.min) this.min = val;
    if (val > this.max) this.max = val;
    this.count++;
  }

  get avg() {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  reset() {
    this.current = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = 0;
    this.count = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Histogram — fixed-bin histogram for drift distribution
// ─────────────────────────────────────────────────────────────────────────────

export class Histogram {
  // Bins: [0-2, 2-5, 5-10, 10-20, 20-30, 30-50, 50-100, 100+]
  static BINS = [
    { label: '0-2', min: 0, max: 2 },
    { label: '2-5', min: 2, max: 5 },
    { label: '5-10', min: 5, max: 10 },
    { label: '10-20', min: 10, max: 20 },
    { label: '20-30', min: 20, max: 30 },
    { label: '30-50', min: 30, max: 50 },
    { label: '50-100', min: 50, max: 100 },
    { label: '100+', min: 100, max: Infinity },
  ];

  constructor() {
    this.counts = new Array(Histogram.BINS.length).fill(0);
    this.total = 0;
  }

  record(absDriftMs) {
    for (let i = 0; i < Histogram.BINS.length; i++) {
      if (absDriftMs >= Histogram.BINS[i].min && absDriftMs < Histogram.BINS[i].max) {
        this.counts[i]++;
        this.total++;
        return;
      }
    }
    // Fallback to last bin
    this.counts[this.counts.length - 1]++;
    this.total++;
  }

  getBar(binIndex, maxWidth = 20) {
    if (this.total === 0) return '';
    const count = this.counts[binIndex];
    const ratio = count / this.total;
    const width = Math.round(ratio * maxWidth);
    return '█'.repeat(width);
  }

  getNormalized() {
    if (this.total === 0) return Histogram.BINS.map(() => 0);
    return this.counts.map(c => c / this.total);
  }

  reset() {
    this.counts.fill(0);
    this.total = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DecisionCounter — tracks how often each decision is made
// ─────────────────────────────────────────────────────────────────────────────

export class DecisionCounter {
  constructor() {
    this.reset();
  }

  reset() {
    this.lock = 0;
    this.rate = 0;
    this.softSeek = 0;
    this.hardSeek = 0;
    this.noOp = 0;
    this.futile = 0;
    this.total = 0;
  }

  record(decision) {
    this.total++;
    switch (decision) {
      case 'LOCK': this.lock++; break;
      case 'RATE': this.rate++; break;
      case 'SOFT': this.softSeek++; break;
      case 'HARD': this.hardSeek++; break;
      case 'NOOP': this.noOp++; break;
      case 'FUTILE': this.futile++; break;
    }
  }

  getSummary() {
    return {
      lock: this.lock,
      rate: this.rate,
      soft: this.softSeek,
      hard: this.hardSeek,
      noop: this.noOp,
      futile: this.futile,
      total: this.total,
      lockPct: this.total > 0 ? Math.round(this.lock / this.total * 100) : 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SeekTelemetry — per-seek-type statistics for soft vs hard seek analysis
// ─────────────────────────────────────────────────────────────────────────────

export class SeekTelemetry {
  constructor(maxRecoveryBuffer = 100) {
    this._maxRecoveryBuffer = maxRecoveryBuffer;
    this.soft = { count: 0, driftSum: 0, frameAgeSum: 0, superseded: 0, recoveryTimes: [] };
    this.hard = { count: 0, driftSum: 0, frameAgeSum: 0, superseded: 0, recoveryTimes: [] };
  }

  record(type, driftMs, frameAgeMs) {
    const entry = type === 'HARD' ? this.hard : this.soft;
    entry.count++;
    entry.driftSum += Math.abs(driftMs);
    if (frameAgeMs != null) entry.frameAgeSum += frameAgeMs;
  }

  recordRecovery(type, recoveryMs) {
    const entry = type === 'HARD' ? this.hard : this.soft;
    entry.recoveryTimes.push(recoveryMs);
    if (entry.recoveryTimes.length > this._maxRecoveryBuffer) entry.recoveryTimes.shift();
  }

  markSuperseded(type) {
    const entry = type === 'HARD' ? this.hard : this.soft;
    entry.superseded++;
  }

  getSummary() {
    const build = (entry) => {
      if (entry.count === 0) return { count: 0, avgDrift: 0, avgFrameAge: 0, effective: 0, superseded: 0, recovery: null };
      const effective = entry.count - entry.superseded;
      let recovery = null;
      if (entry.recoveryTimes.length > 0) {
        const sorted = [...entry.recoveryTimes].sort((a, b) => a - b);
        const len = sorted.length;
        recovery = {
          count: len,
          avgMs: Math.round(sorted.reduce((a, b) => a + b, 0) / len),
          p50Ms: Math.round(sorted[Math.floor(len * 0.5)]),
          p95Ms: Math.round(sorted[Math.floor(len * 0.95)] || sorted[len - 1]),
        };
      }
      return {
        count: entry.count,
        avgDrift: Math.round(entry.driftSum / entry.count),
        avgFrameAge: Math.round(entry.frameAgeSum / entry.count),
        effective,
        superseded: entry.superseded,
        recovery,
      };
    };
    return { soft: build(this.soft), hard: build(this.hard) };
  }

  reset() {
    this.soft = { count: 0, driftSum: 0, frameAgeSum: 0, superseded: 0, recoveryTimes: [] };
    this.hard = { count: 0, driftSum: 0, frameAgeSum: 0, superseded: 0, recoveryTimes: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoLifecycleTracker — records browser <video> lifecycle events per engine
// to correlate with external decode-usage measurements (e.g. intel_gpu_top).
// Browser DOES NOT expose GPU decode %, so we timestamp decode-relevant events
// and let the operator correlate them with external monitoring.
// ─────────────────────────────────────────────────────────────────────────────

export class VideoLifecycleTracker {
  constructor(maxBuffer = 200) {
    this._maxBuffer = maxBuffer;
    this._events = [];
    this._sourceSetCount = 0;
    this._loadCount = 0;
    this._remountCount = 0;
    this._playingDuration = 0;
    this._wasPlayingAtEvent = false;
    this._wasSeekingAtEvent = false;
    this._readyStateAtEvent = 0;
    this._networkStateAtEvent = 0;
    this._currentSrc = null;
  }

  _record(type, context = {}) {
    const entry = {
      t: performance.now(),
      type,
      wasPlaying: this._wasPlayingAtEvent,
      wasSeeking: this._wasSeekingAtEvent,
      readyState: this._readyStateAtEvent,
      networkState: this._networkStateAtEvent,
      sourceSetCount: this._sourceSetCount,
      loadCount: this._loadCount,
      remountCount: this._remountCount,
      ...context,
    };
    this._events.push(entry);
    if (this._events.length > this._maxBuffer) this._events.shift();
    return entry;
  }

  setSrc(src) {
    const changed = this._currentSrc !== src;
    this._currentSrc = src;
    if (changed) this._sourceSetCount++;
    return changed;
  }

  markLoad() {
    this._loadCount++;
  }

  markRemount() {
    this._remountCount++;
  }

  updateState(video) {
    if (!video) return;
    this._wasPlayingAtEvent = !video.paused;
    this._wasSeekingAtEvent = video.seeking;
    this._readyStateAtEvent = video.readyState;
    this._networkStateAtEvent = video.networkState;
  }

  onLoadStart(video) {
    this.updateState(video);
    this._record('loadstart');
  }

  onLoadedMetadata(video) {
    this.updateState(video);
    this._record('loadedmetadata', { duration: video.duration, readyState: video.readyState });
  }

  onLoadedData(video) {
    this.updateState(video);
    this._record('loadeddata', { readyState: video.readyState });
  }

  onCanPlay(video) {
    this.updateState(video);
    this._record('canplay', { readyState: video.readyState });
  }

  onPlaying(video) {
    this.updateState(video);
    this._record('playing', { currentTime: video.currentTime, readyState: video.readyState });
  }

  onWaiting(video) {
    this.updateState(video);
    this._record('waiting', { currentTime: video.currentTime, readyState: video.readyState });
  }

  onStalled(video) {
    this.updateState(video);
    this._record('stalled', { currentTime: video.currentTime, readyState: video.readyState });
  }

  onSeeked(video) {
    this.updateState(video);
    this._record('seeked', { currentTime: video.currentTime, readyState: video.readyState });
  }

  onEnded(video) {
    this.updateState(video);
    this._record('ended', { currentTime: video.currentTime, readyState: video.readyState });
  }

  onError(video) {
    this.updateState(video);
    this._record('error', { readyState: video.readyState, networkState: video.networkState });
  }

  onPause(video) {
    this.updateState(video);
    this._record('pause', { currentTime: video.currentTime, readyState: video.readyState });
  }

  getEvents() {
    return this._events.slice(-30);
  }

  getSummary() {
    const types = {};
    for (const e of this._events) {
      types[e.type] = (types[e.type] || 0) + 1;
    }
    return {
      totalEvents: this._events.length,
      sourceSetCount: this._sourceSetCount,
      loadCount: this._loadCount,
      remountCount: this._remountCount,
      currentSrc: this._currentSrc,
      eventsByType: types,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SharedSyncCore — the "brain" shared between MV and BG engines
// ─────────────────────────────────────────────────────────────────────────────

export class SharedSyncCore {
  constructor(masterTimeFn) {
    this.masterTime = masterTimeFn;

    // Per-engine statistics
    this.mv = this._createEngineStats();
    this.bg = this._createEngineStats();

    // Prediction confidence (0-100)
    this.mv.confidence = 0;
    this.bg.confidence = 0;

    // Shared confidence signals (scheduler + clock are system-wide)
    this._sharedConfidence = {
      schedulerConfidence: 0,
      clockConfidence: 0,
      rawSchedulerConfidence: 0,
      rawClockConfidence: 0,
    };

    // Decision counters
    this.mvDecisions = new DecisionCounter();
    this.bgDecisions = new DecisionCounter();

    // Seek telemetry
    this.mvSeekTelemetry = new SeekTelemetry();
    this.bgSeekTelemetry = new SeekTelemetry();

    // Frame age (for RVFC)
    this.mv.frameAge = null;
    this.bg.frameAge = null;

    // Replay event log (always records, independent of __SYNC_ENABLED__)
    this.replayLog = [];
    this.replayMaxBuffer = 100000;

    // Stable-state gate: only learn when this flag is true
    this._isStable = true;
  }

  _createEngineStats() {
    return {
      // Split drift tracking (per user feedback)
      rawDriftEMA: new EMATracker(0.02, 0),         // raw drift before any correction
      rawDrift: new RollingStats(),                 // rolling stats for overlay
      correctedDriftEMA: new EMATracker(0.02, 0),    // drift after bias/prediction applied
      correctedDrift: new RollingStats(),            // rolling stats for overlay

      // Bias: learn VERY slowly (α=0.005), only when stable
      biasEMA: new EMATracker(0.005, 0),

      // Presentation latency from RVFC
      presLatEMA: new EMATracker(0.02, 15), // bootstrap 15ms
      presLat: new RollingStats(),

      // Seek latency (seek start → seeked event)
      seekLatEMA: new EMATracker(0.05, 15), // bootstrap 15ms
      seekLat: new RollingStats(),

      // Decode latency from RVFC processingDuration
      decodeLatEMA: new EMATracker(0.02, 0),
      decodeLat: new RollingStats(),

      // Processing duration stability (for decoderConfidence)
      processingDuration: new RollingStats(),

      // Frame age (for RVFC)
      frameAge: new RollingStats(),
      lastFrameAge: null,

      // FPS from RVFC frame intervals
      fps: new RollingStats(),
      lastFrameTime: 0,

      // RVFC interval stability (for renderConfidence)
      rvfcIntervalEMA: new EMATracker(0.1, 0),
      presentedFrames: 0,
      frameDrops: 0,

      // Tick timing / scheduler awareness
      tickDelta: new RollingStats(),
      schedulerLateness: new RollingStats(),

      // Counters
      schedulerStallCount: 0,
      cpuOverloadCount: 0,
      tickMissCount: 0,
      tickCount: 0,

      // Histogram
      histogram: new Histogram(),

      // Last raw values for overlay
      lastRawDrift: 0,
      lastCorrectedDrift: 0,
      lastBias: 0,
      lastPresLat: 15,
      lastSeekLat: 15,
      lastDecodeLat: null,

      // Pending seek for recovery tracking
      _pendingSeek: null,
      // First RVFC frame after seek (null until first frame arrives post-seek)
      _pendingSeekFirstFrame: null,

      // Re-stabilization window tracking
      reStabilityEvents: [],
      currentReStabilityEvent: null,

      // Clock provenance ring buffer (Track 0.25)
      clockProvenanceRing: [],
      prevClockSnapshot: null,
      // Spike recorder (Track 0.25)
      spikeRecorder: [],

      // Seek pipeline instrumentation (Track 0.75)
      _seekPipeline: null,
      seekPipelineLatencies: [],

      // Video lifecycle tracking (decode pipeline investigation)
      videoLifecycle: new VideoLifecycleTracker(),
      videoSrc: null,
      videoRemountKey: 0,

      // Confidence-Graduated Startup (measurement confidence, not timer)
      decoderConfidence: 0,
      renderConfidence: 0,
      biasConfidence: 0,
      compositeConfidence: 0,
      rawCompositeConfidence: 0,
      confidenceBlockedBy: 'decoder',
    };
  }

  startReStabilization(engine, trigger) {
    const stats = this[engine];
    if (!stats) return;
    if (stats.currentReStabilityEvent) {
      this.completeReStabilization(engine, false, false);
    }
    stats.currentReStabilityEvent = {
      trigger,
      startTime: performance.now(),
      startTickCount: stats.tickCount,
      disruptions: [],
      gateOpened: false,
      stdDevBlocked: false,
      tickCount: 0,
      windowDuration: 0,
      timeToGateOpen: null,
    };
    this._recordReplay(engine, 'restab_start', { trigger });
  }

  recordReStabilityDisruption(engine, type) {
    const stats = this[engine];
    if (!stats || !stats.currentReStabilityEvent) return;
    stats.currentReStabilityEvent.disruptions.push({
      t: performance.now(),
      type,
    });
    this._recordReplay(engine, 'restab_disrupt', { type });
  }

  completeReStabilization(engine, gateOpened, stdDevBlocked) {
    const stats = this[engine];
    if (!stats || !stats.currentReStabilityEvent) return;
    const evt = stats.currentReStabilityEvent;
    const now = performance.now();
    evt.gateOpened = gateOpened;
    evt.stdDevBlocked = stdDevBlocked;
    evt.windowDuration = now - evt.startTime;
    evt.tickCount = stats.tickCount - evt.startTickCount;
    if (gateOpened) {
      evt.timeToGateOpen = evt.windowDuration;
    } else {
      evt.timeToGateOpen = null;
    }
    stats.reStabilityEvents.push(evt);
    if (stats.reStabilityEvents.length > 200) stats.reStabilityEvents.shift();
    stats.currentReStabilityEvent = null;
    this._recordReplay(engine, 'restab_end', {
      trigger: evt.trigger,
      gateOpened,
      stdDevBlocked,
      windowDuration: evt.windowDuration,
      tickCount: evt.tickCount,
      disruptionCount: evt.disruptions.length,
      timeToGateOpen: evt.timeToGateOpen,
    });
  }

  getReStabilitySummary(engine) {
    const stats = this[engine];
    if (!stats) return null;
    return {
      current: stats.currentReStabilityEvent,
      events: stats.reStabilityEvents.slice(-20),
      total: stats.reStabilityEvents.length,
    };
  }

  // ── Stable-state gate ──────────────────────────────────────────────────
  // Call with true when engine is LOCKED and playback is stable.
  // Call with false during seek, recovery, stall, buffering.

  setStable(isStable) {
    this._isStable = isStable;
  }

  // ── Observe drift (called every tick) ──────────────────────────────────

  observeDrift(engine, driftMs, state = {}) {
    const stats = this[engine];
    if (!stats) return;

    if (!Number.isFinite(driftMs) || Math.abs(driftMs) > 5000) return;

    const absDrift = Math.abs(driftMs);

    // Always record raw drift
    stats.rawDriftEMA.push(driftMs);
    stats.rawDrift.push(driftMs);
    stats.lastRawDrift = driftMs;

    // Histogram always records
    stats.histogram.record(absDrift);

    // Only update adaptive models when STABLE
    if (this._isStable && state.mode === 'LOCKED') {
      // Bias learns from raw drift (very slowly), with alpha graduated by confidence
      const c = stats.compositeConfidence || 0;
      const learningRate = c < 20 ? 0 : c < 50 ? 0.02 : c < 80 ? 0.1 : 1.0;
      if (learningRate > 0) {
        const effectiveAlpha = 0.005 * learningRate;
        stats.biasEMA.push(driftMs, effectiveAlpha);
        stats.lastBias = stats.biasEMA.mean;
      }
    }

    // Corrected drift (after bias applied) — always record for comparison
    const bias = stats.biasEMA.samples >= 20 ? stats.biasEMA.mean : 0;
    const correctedDrift = driftMs - bias;
    stats.correctedDriftEMA.push(correctedDrift);
    stats.correctedDrift.push(correctedDrift);
    stats.lastCorrectedDrift = correctedDrift;

    // Update confidence
    this._updateConfidence(engine);

    // Recovery tracking: check if pending seek has recovered
    const pending = stats._pendingSeek;
    if (pending) {
      const elapsed = performance.now() - pending.timestamp;
      const RECOVERY_THRESHOLD_MS = 10;
      if (absDrift < RECOVERY_THRESHOLD_MS) {
        const telemetry = engine === 'mv' ? this.mvSeekTelemetry : this.bgSeekTelemetry;
        telemetry.recordRecovery(pending.type, elapsed);
        stats._pendingSeek = null;
        stats._pendingSeekFirstFrame = null;
      } else if (elapsed > 5000) {
        stats._pendingSeek = null;
        stats._pendingSeekFirstFrame = null;
      }
    }

    // Record to replay log
    this._recordReplay(engine, 'drift', {
      raw: driftMs,
      corrected: correctedDrift,
      bias: stats.biasEMA.mean,
      mode: state.mode || 'UNKNOWN',
      stable: this._isStable,
      schedulerStall: !!state.schedulerStall,
    });
  }

  // ── Observe presentation latency (from RVFC) ──────────────────────────

  observePresentationLatency(engine, latencyMs) {
    const stats = this[engine];
    if (!stats || !Number.isFinite(latencyMs)) return;

    stats.presLatEMA.push(latencyMs);
    stats.lastPresLat = stats.presLatEMA.mean;
    stats.presLat.push(latencyMs);

    this._recordReplay(engine, 'presLat', { latencyMs });
  }

  // ── Observe frame age (from RVFC metadata) ────────────────────────────

  observeFrameAge(engine, frameAgeMs) {
    const stats = this[engine];
    if (!stats || !Number.isFinite(frameAgeMs)) return;
    if (!stats.frameAge) return;
    stats.frameAge.push(frameAgeMs);
    stats.lastFrameAge = frameAgeMs;
  }

  // ── Observe decode latency (from RVFC processingDuration) ─────────────

  observeDecodeLat(engine, latencyMs) {
    const stats = this[engine];
    if (!stats || !Number.isFinite(latencyMs)) return;

    // Record decode recovery: first time decode latency drops below baseline
    // after a seek spike — indicates decoder no longer in burst mode.
    if (stats._pendingSeekFirstFrame && !stats._pendingSeekFirstFrame.decodeStableRecorded) {
      const baseline = stats._pendingSeekFirstFrame.decodeBaseline;
      if (latencyMs < baseline) {
        const now = performance.now();
        stats._pendingSeekFirstFrame.decodeStableAt = now;
        stats._pendingSeekFirstFrame.decodeStableLatency = now - stats._pendingSeekFirstFrame.seekStart;
        stats._pendingSeekFirstFrame.decodeStableRecorded = true;
      }
    }

    stats.decodeLatEMA.push(latencyMs);
    stats.lastDecodeLat = stats.decodeLatEMA.mean;
    stats.decodeLat.push(latencyMs);
    stats.processingDuration.push(latencyMs);

    this._recordReplay(engine, 'decodeLat', { latencyMs });
  }

  // ── Observe seek latency ───────────────────────────────────────────────

  observeSeekLatency(engine, latencyMs) {
    const stats = this[engine];
    if (!stats || !Number.isFinite(latencyMs)) return;

    stats.seekLatEMA.push(latencyMs);
    stats.lastSeekLat = stats.seekLatEMA.mean;
    stats.seekLat.push(latencyMs);

    this._recordReplay(engine, 'seekLat', { latencyMs });
  }

  // ── Observe RVFC frame for FPS and decode latency ─────────────────────

  observeFrame(engine, timestamp) {
    const stats = this[engine];
    if (!stats || !Number.isFinite(timestamp) || timestamp <= 0) return;

    // Capture first decoded frame after seek for decoder recovery timing
    if (stats._pendingSeekFirstFrame && !stats._pendingSeekFirstFrame.firstFrameRecorded) {
      const now = performance.now();
      stats._pendingSeekFirstFrame.firstFrameAt = now;
      stats._pendingSeekFirstFrame.firstFrameLatency = now - stats._pendingSeekFirstFrame.seekStart;
      stats._pendingSeekFirstFrame.firstFrameRecorded = true;
    }

    if (stats.lastFrameTime > 0) {
      const interval = timestamp - stats.lastFrameTime;
      if (interval > 0) {
        stats.fps.push(1000 / interval);
        stats.rvfcIntervalEMA.push(interval);
        stats.presentedFrames++;
        // Frame drop heuristic: interval > 2x expected (33ms for 30fps, 16ms for 60fps)
        if (interval > 50) stats.frameDrops++;
      }
    }
    stats.lastFrameTime = timestamp;
  }

  // ── Observe tick timing from engine.tick() ─────────────────────────────

  observeTickDelta(engine, tickDelta) {
    const stats = this[engine];
    if (!stats) return;
    stats.tickDelta.push(tickDelta);
  }

  observeSchedulerLateness(engine, lateness) {
    const stats = this[engine];
    if (!stats) return;
    stats.schedulerLateness.push(lateness);
  }

  // ── Counter increments ────────────────────────────────────────────────

  incTickCount(engine) {
    const stats = this[engine];
    if (!stats) return;
    stats.tickCount++;
  }

  incTickMisses(engine) {
    const stats = this[engine];
    if (!stats) return;
    stats.tickMissCount++;
  }

  incSchedulerStalls(engine) {
    const stats = this[engine];
    if (!stats) return;
    stats.schedulerStallCount++;
  }

  incCpuOverloads(engine) {
    const stats = this[engine];
    if (!stats) return;
    stats.cpuOverloadCount++;
  }

  // ── Clock Provenance (Track 0.25) ─────────────────────────────────────

  recordClockSnapshot(engine, snapshot) {
    const stats = this[engine];
    if (!stats) return;

    const derived = { ...snapshot };
    if (stats.prevClockSnapshot) {
      const prev = stats.prevClockSnapshot;
      derived.audioDeltaMs = (snapshot.audioCurrentTime - prev.audioCurrentTime) * 1000;
      derived.videoDeltaMs = (snapshot.videoCurrentTime - prev.videoCurrentTime) * 1000;
      derived.perfDeltaMs = snapshot.t - prev.t;
      if (
        snapshot.rvfcPresentationTime != null &&
        prev.rvfcPresentationTime != null
      ) {
        derived.rvfcDeltaMs =
          (snapshot.rvfcPresentationTime - prev.rvfcPresentationTime) * 1000;
      }
    } else {
      derived.audioDeltaMs = null;
      derived.videoDeltaMs = null;
      derived.perfDeltaMs = null;
      derived.rvfcDeltaMs = null;
    }

    stats.prevClockSnapshot = snapshot;
    stats.clockProvenanceRing.push(derived);
    if (stats.clockProvenanceRing.length > 7) stats.clockProvenanceRing.shift();
  }

  captureSpike(engine, rawDriftMs, state = {}) {
    const stats = this[engine];
    if (!stats) return null;

    const now = performance.now();
    const window = [...stats.clockProvenanceRing];
    const attribution = this._attributeSpikeCause(engine, window, rawDriftMs, state);

    const prevRaw = state.prevRawDriftMs != null ? state.prevRawDriftMs : null;
    const driftDeltaMs = state.driftDeltaMs != null ? state.driftDeltaMs : (prevRaw != null ? Math.abs(rawDriftMs - prevRaw) : null);
    const driftAccelerationMs = state.driftAccelerationMs != null ? state.driftAccelerationMs : null;
    const entry = {
      id: now,
      t: now,
      engine,
      rawDriftMs,
      prevRawDriftMs: prevRaw,
      deltaDriftMs: driftDeltaMs,
      driftAccelerationMs,
      window,
      attribution,
    };

    stats.spikeRecorder.push(entry);
    if (stats.spikeRecorder.length > 200) stats.spikeRecorder.shift();

    this._recordReplay(engine, 'spike_snapshot', {
      t: now,
      engine,
      rawDriftMs,
      cause: attribution.cause,
      confidence: attribution.confidence,
      evidence: attribution.evidence,
      deltaDriftMs: entry.deltaDriftMs,
      driftAccelerationMs,
    });

    return entry;
  }

  _attributeSpikeCause(engine, window, rawDriftMs, state) {
    if (!window || window.length === 0) {
      return { cause: 'UNKNOWN', confidence: 0, evidence: 'no clock window data' };
    }

    const last = window[window.length - 1];
    const perfDelta = last.perfDeltaMs || 0;
    const audioDelta = last.audioDeltaMs || 0;
    const videoDelta = last.videoDeltaMs || 0;
    const rvfcStatus = state.rvfcStatus || 'UNKNOWN';
    const schedulerLateness = state.schedulerLateness || 0;
    const hidden = state.hidden || false;

    // 1. SEEK_COMPLETE / SEEK_LATENCY
    if (state.seekJustCompleted) {
      const isBgSeekLatency =
        engine === 'bg' &&
        Math.abs(videoDelta) > Math.abs(audioDelta) * 2 &&
        Math.abs(videoDelta) > 20;
      if (isBgSeekLatency) {
        return {
          cause: 'SEEK_LATENCY',
          confidence: 90,
          evidence: `BG seek pipeline latency: videoDelta=${videoDelta.toFixed(1)}ms, audioDelta=${audioDelta.toFixed(1)}ms`,
        };
      }
      return {
        cause: 'SEEK_COMPLETE',
        confidence: 95,
        evidence: `seek completed within 100ms, videoDelta=${videoDelta.toFixed(1)}ms`,
      };
    }

    // 2. SCHEDULER
    if (perfDelta > 50 || schedulerLateness > 50) {
      return {
        cause: 'SCHEDULER',
        confidence: 85,
        evidence: `perfDelta=${perfDelta.toFixed(1)}ms, schedulerLateness=${schedulerLateness}ms`,
      };
    }

    // 3. DECODER / RVFC stall (single-sided or pipeline freeze)
    if (
      Math.abs(videoDelta) < 5 && Math.abs(audioDelta) > 15 ||
      Math.abs(audioDelta) < 5 && Math.abs(videoDelta) > 15
    ) {
      const stallSide = Math.abs(videoDelta) < 5 && Math.abs(audioDelta) > 15 ? 'video stall' : 'audio stall';
      return {
        cause: 'DECODER',
        confidence: 75,
        evidence: `${stallSide}: audioDelta=${audioDelta.toFixed(1)}ms, videoDelta=${videoDelta.toFixed(1)}ms`,
      };
    }
    if (rvfcStatus === 'TIMEOUT' || rvfcStatus === 'PAUSED') {
      return {
        cause: 'DECODER',
        confidence: 80,
        evidence: `rvfcStatus=${rvfcStatus}, pipeline stall`,
      };
    }

    // 4. DRIFT_ACCUMULATION — both clocks slowly advancing but drift growing tick by tick
    if (
      Math.abs(rawDriftMs) > 20 &&
      Math.abs(audioDelta) < 20 &&
      Math.abs(videoDelta) < 20
    ) {
      return {
        cause: 'DRIFT_ACCUMULATION',
        confidence: 65,
        evidence: `slow accumulation: audioDelta=${audioDelta.toFixed(1)}ms, videoDelta=${videoDelta.toFixed(1)}ms, drift=${rawDriftMs.toFixed(1)}ms`,
      };
    }

    // 5. CLOCK_AUDIO (audio clock jumped more than video)
    if (Math.abs(audioDelta) > Math.abs(videoDelta) * 1.5 && Math.abs(audioDelta) > 20) {
      return {
        cause: 'CLOCK_AUDIO',
        confidence: 70,
        evidence: `audioDelta=${audioDelta.toFixed(1)}ms, videoDelta=${videoDelta.toFixed(1)}ms`,
      };
    }

    // 6. CLOCK_VIDEO (video clock jumped more than audio)
    if (Math.abs(videoDelta) > Math.abs(audioDelta) * 1.5 && Math.abs(videoDelta) > 20) {
      return {
        cause: 'CLOCK_VIDEO',
        confidence: 70,
        evidence: `videoDelta=${videoDelta.toFixed(1)}ms, audioDelta=${audioDelta.toFixed(1)}ms`,
      };
    }

    // 7. CLOCK_BOTH (both moved together, offset changed)
    if (
      Math.abs(audioDelta - videoDelta) < 20 &&
      Math.abs(audioDelta) > 20 &&
      Math.abs(videoDelta) > 20
    ) {
      return {
        cause: 'CLOCK_BOTH',
        confidence: 65,
        evidence: `audioDelta=${audioDelta.toFixed(1)}ms, videoDelta=${videoDelta.toFixed(1)}ms (offset change)`,
      };
    }

    // 8. Background / tab hidden
    if (hidden) {
      return {
        cause: 'UNKNOWN',
        confidence: 40,
        evidence: 'tab hidden',
      };
    }

    // 9. Default
    return {
      cause: 'UNKNOWN',
      confidence: 30,
      evidence: `audioDelta=${audioDelta.toFixed(1)}ms, videoDelta=${videoDelta.toFixed(1)}ms, perfDelta=${perfDelta.toFixed(1)}ms`,
    };
  }

  getClockProvenance(engine) {
    const stats = this[engine];
    if (!stats) return null;
    return {
      ring: stats.clockProvenanceRing,
      prev: stats.prevClockSnapshot,
    };
  }

  getSpikeRecorder(engine) {
    const stats = this[engine];
    if (!stats) return [];
    return stats.spikeRecorder;
  }

  getSeekPipelineLatencies(engine) {
    const stats = this[engine];
    if (!stats) return [];
    return stats.seekPipelineLatencies.slice(-20);
  }

  // ── Video Lifecycle (decode pipeline investigation) ───────────────────

  setVideoSrc(engine, src) {
    const stats = this[engine];
    if (!stats) return false;
    return stats.videoLifecycle.setSrc(src);
  }

  setVideoRemountKey(engine, key) {
    const stats = this[engine];
    if (!stats) return;
    const prev = stats.videoRemountKey || 0;
    stats.videoRemountKey = key;
    if (key > prev) {
      stats.videoLifecycle.markRemount();
    }
  }

  recordVideoLifecycleEvent(engine, type, video) {
    const stats = this[engine];
    if (!stats || !stats.videoLifecycle) return;
    stats.videoLifecycle.updateState(video);
    const methodMap = {
      loadstart: 'onLoadStart',
      loadedmetadata: 'onLoadedMetadata',
      loadeddata: 'onLoadedData',
      canplay: 'onCanPlay',
      canplaythrough: 'onCanPlay',
      playing: 'onPlaying',
      waiting: 'onWaiting',
      stalled: 'onStalled',
      seeked: 'onSeeked',
      ended: 'onEnded',
      error: 'onError',
      pause: 'onPause',
      play: 'onPlaying',
    };
    const method = methodMap[type];
    if (method) {
      stats.videoLifecycle[method](video);
    }
  }

  getVideoLifecycle(engine) {
    const stats = this[engine];
    if (!stats) return null;
    return {
      tracker: stats.videoLifecycle,
      src: stats.videoSrc,
      remountKey: stats.videoRemountKey,
    };
  }

  getVideoLifecycleSummary(engine) {
    const stats = this[engine];
    if (!stats || !stats.videoLifecycle) return null;
    return stats.videoLifecycle.getSummary();
  }

  // ── Record decision ────────────────────────────────────────────────────

  recordDecision(engine, decision) {
    const counter = engine === 'mv' ? this.mvDecisions : this.bgDecisions;
    counter.record(decision);

    this._recordReplay(engine, 'decision', { decision });
  }

  recordSeek(engine, type, driftMs, frameAgeMs) {
    if (!Number.isFinite(driftMs) || Math.abs(driftMs) > 5000) return;
    const stats = this[engine];
    const telemetry = engine === 'mv' ? this.mvSeekTelemetry : this.bgSeekTelemetry;

    // If a soft seek is pending and a hard seek arrives, the soft was superseded
    if (stats._pendingSeek && stats._pendingSeek.type === 'SOFT' && type === 'HARD') {
      telemetry.markSuperseded('SOFT');
      stats._pendingSeek = null;
      stats._pendingSeekFirstFrame = null;
    }

    telemetry.record(type, driftMs, frameAgeMs);

    // Start recovery + first-frame tracking
    const seekStart = performance.now();
    stats._pendingSeek = {
      type,
      driftMs,
      timestamp: seekStart,
    };
    // Snapshot decode latency EMA at seek start so we can detect recovery
    // even while the EMA itself is biased high by the seek spike.
    const preSeekDecodeBaseline = Math.max(10, stats.decodeLatEMA.mean || 10);
    stats._pendingSeekFirstFrame = {
      seekStart,
      firstFrameAt: null,
      firstFrameLatency: null,
      firstFrameRecorded: false,
      decodeStableAt: null,
      decodeStableLatency: null,
      decodeStableRecorded: false,
      decodeBaseline: preSeekDecodeBaseline,
    };
  }

  // Track 0.75 — seek pipeline instrumentation
  recordSeekPipelineComplete(engine, pipeline) {
    const stats = this[engine];
    if (!stats || !pipeline) return;
    const seekStart = pipeline.seekStart || performance.now();
    const seeked = pipeline.seeked || seekStart;
    const stable = pipeline.stable || performance.now();
    const firstFrameData = stats._pendingSeekFirstFrame;
    const entry = {
      engine,
      seekType: pipeline.seekType || 'HARD',
      seekStartToSeeked: seeked - seekStart,
      seekedToStable: stable - seeked,
      totalToStable: stable - seekStart,
      audioAdvance: pipeline.audioAtSeeked - pipeline.audioAtSeekStart,
      audioAtSeekStart: pipeline.audioAtSeekStart,
      audioAtSeeked: pipeline.audioAtSeeked,
      audioAtStable: pipeline.audioAtStable,
      seekToFirstFrameMs: firstFrameData?.firstFrameLatency ?? null,
      decodeStableMs: firstFrameData?.decodeStableLatency ?? null,
      ts: performance.now(),
    };
    stats.seekPipelineLatencies.push(entry);
    if (stats.seekPipelineLatencies.length > 100) stats.seekPipelineLatencies.shift();
    this._recordReplay(engine, 'seek_pipeline', entry);
    // Clear first-frame tracking for next seek
    stats._pendingSeekFirstFrame = null;
  }

  getSeekPipelineLatencies(engine) {
    const stats = this[engine];
    if (!stats) return [];
    return stats.seekPipelineLatencies.slice(-20);
  }

  getSeekTelemetry(engine) {
    const telemetry = engine === 'mv' ? this.mvSeekTelemetry : this.bgSeekTelemetry;
    return telemetry.getSummary();
  }

  // ── Confidence calculation ─────────────────────────────────────────────

  _updateConfidence(engine) {
    const stats = this[engine];
    if (!stats) return;

    // ── decoderConfidence (max 30) ────────────────────────────────────────
    let decoderConf = 0;
    if (stats.decodeLatEMA.stdDev < 5) decoderConf += 15;
    if (stats.decodeLatEMA.stdDev < 10) decoderConf += 5;
    if (stats.processingDuration != null && stats.processingDuration.stdDev < 2) decoderConf += 5;
    if (stats.videoLifecycle && stats.videoLifecycle._events.some(e => e.type === 'canplay')) decoderConf += 5;

    // ── renderConfidence (max 30) ────────────────────────────────────────
    let renderConf = 0;
    if (stats.rvfcIntervalEMA.stdDev != null && stats.rvfcIntervalEMA.stdDev < 16) renderConf += 15;
    if (stats.frameDrops == null || stats.frameDrops === 0) renderConf += 10;
    if (stats.presentedFrames != null && stats.presentedFrames >= 10) renderConf += 5;

    // ── Compute shared scheduler + clock confidence from both engines ──────
    const otherEngine = engine === 'mv' ? 'bg' : 'mv';
    const otherStats = this[otherEngine];
    const engines = otherStats ? [stats, otherStats] : [stats];

    let schedulerConf = 30;
    let clockConf = 30;

    for (const s of engines) {
      // schedulerConfidence (max 30)
      let sConf = 0;
      if (s.schedulerLateness.avg < 20) sConf += 15;
      else if (s.schedulerLateness.avg < 40) sConf += 10;
      if (s.tickDelta.count >= 5) {
        const variance = Math.abs(s.tickDelta.current - s.tickDelta.avg);
        if (variance < 10) sConf += 5;
      }
      schedulerConf = Math.min(schedulerConf, sConf);

      // clockConfidence (max 30)
      let cConf = 0;
      if (s.rawDriftEMA.stdDev < 10) cConf += 20;
      else if (s.rawDriftEMA.stdDev < 20) cConf += 10;
      clockConf = Math.min(clockConf, cConf);
    }

    // Store shared values
    this._sharedConfidence.schedulerConfidence = schedulerConf;
    this._sharedConfidence.clockConfidence = clockConf;

    // ── biasConfidence (max 10) ──────────────────────────────────────────
    let biasConf = 0;
    if (stats.biasEMA.samples >= 10 && stats.biasEMA.stdDev < 15) biasConf += 5;
    if (stats.biasEMA.samples >= 20 && stats.biasEMA.stdDev < 10) biasConf += 5;

    // ── Composite (operational) — min of decoder, render, scheduler, clock ──
    const operationalRaw = Math.min(decoderConf, renderConf, schedulerConf, clockConf);
    const operationalSmoothed = operationalRaw * 0.8 + (stats.compositeConfidence || 0) * 0.2;

    // Blocked-by reason
    const subValues = { decoder: decoderConf, render: renderConf, scheduler: schedulerConf, clock: clockConf };
    const blockedBy = Object.entries(subValues).sort((a, b) => a[1] - b[1])[0][0];

    stats.decoderConfidence = decoderConf;
    stats.renderConfidence = renderConf;
    stats.biasConfidence = biasConf;
    stats.rawCompositeConfidence = operationalRaw;
    stats.compositeConfidence = operationalSmoothed;
    stats.confidenceBlockedBy = blockedBy;

    // Legacy field for backward compatibility
    stats.confidence = operationalSmoothed;
  }

  // ── Get predicted target (bias + prediction correction) ────────────────

  getPredictedTarget(engine) {
    const base = this.masterTime();
    const stats = this[engine];
    if (!stats) return base;

    // Only use prediction if confidence > 80
    if (stats.confidence < 80) return base;

    const bias = stats.biasEMA.softPrediction;
    const presLat = stats.presLatEMA.softPrediction;

    let correction = 0;
    // Bias: subtract (we want to preempt the constant drift)
    if (bias !== null) correction -= bias;
    // Presentation latency: add (we want to seek ahead to compensate)
    if (presLat !== null && engine === 'mv') {
      // Only add presLat for MV if confidence is high
      // BG uses its own presLat independently
    }

    return base + correction;
  }

  // ── Bias compensation API ──────────────────────────────────────────────

  getBias(engine) {
    const stats = this[engine];
    if (!stats || stats.biasEMA.samples < 20) return 0;
    return stats.biasEMA.mean;
  }

  getBiasReady(engine) {
    const stats = this[engine];
    return stats && stats.biasEMA.samples >= 20;
  }

  // ── Bridge from DriftMemory (Phase 4) ──────────────────────────────────
  // Updates overlay display stats from Memory Layer after observeDrift was
  // removed from tick(). DriftMemory is now the canonical drift tracker.

  syncFromDriftMemory(engine, driftMemory) {
    const stats = this[engine];
    if (!stats || !driftMemory) return;

    const driftEMA = driftMemory.driftEMA || { value: 0, sigma: 0, count: 0 };
    const biasMs = driftMemory.biasMs || 0;
    const rawDrift = Number(driftEMA.value || 0);
    const correctedDrift = rawDrift - biasMs;

    stats.rawDrift.push(rawDrift);
    stats.rawDriftEMA.mean = rawDrift;
    stats.rawDriftEMA.variance = Number(driftEMA.sigma || 0);
    stats.rawDriftEMA.samples = Number(driftEMA.count || 0);
    stats.lastRawDrift = rawDrift;

    stats.correctedDrift.push(correctedDrift);
    stats.correctedDriftEMA.mean = correctedDrift;
    stats.correctedDriftEMA.samples = Number(driftEMA.count || 0);
    stats.lastCorrectedDrift = correctedDrift;
    stats.lastBias = biasMs;

    stats.histogram.record(Math.abs(rawDrift));
    this._updateConfidence(engine);
  }

  // ── Adaptive thresholds ────────────────────────────────────────────────

  getAdaptiveThresholds(engine) {
    const stats = this[engine];
    if (!stats || !stats.rawDriftEMA.isReady) {
      // Fallback: static (seconds)
      return { soft: 0.030, hard: 0.300 };
    }

    // sigma is in ms (from rawDriftEMA which stores driftMs values)
    // Convert to seconds for comparison against drift (seconds) in tick()
    const sigmaMs = stats.rawDriftEMA.stdDev;
    const sigma = sigmaMs / 1000;

    if (stats.rawDriftEMA.isFullyAdaptive) {
      return {
        // Full adaptive: 2σ, clamped [8ms, 40ms]
        soft: Math.max(0.008, Math.min(0.040, 2 * sigma)),
        // Hard: 4σ, clamped [200ms, 500ms]
        hard: Math.max(0.200, Math.min(0.500, 4 * sigma)),
      };
    }

    // Soft prediction (20-60 samples): wider bounds
    return {
      soft: Math.max(0.020, Math.min(0.040, 2 * sigma)),
      hard: Math.max(0.250, Math.min(0.500, 4 * sigma)),
    };
  }

  // ── Get engine stats snapshot for overlay ──────────────────────────────

  getStats(engine) {
    const stats = this[engine];
    if (!stats) return null;

    const fmt = (s, decimals = 0) => {
      if (!s || s.count === 0) return null;
      const factor = 10 ** decimals;
      const r = (v) => v == null || !isFinite(v) ? null : Math.round(v * factor) / factor;
      return {
        current: r(s.current),
        avg: r(s.avg),
        min: s.min === Infinity ? null : r(s.min),
        max: r(s.max),
      };
    };

    return {
      rawDrift: stats.lastRawDrift,
      correctedDrift: stats.lastCorrectedDrift,
      bias: stats.lastBias,
      presLat: stats.lastPresLat,
      seekLat: stats.lastSeekLat,
      decodeLat: stats.decodeLatEMA.samples > 0 ? stats.lastDecodeLat : null,
      frameAge: stats.lastFrameAge,
      confidence: stats.confidence,
      stable: this._isStable,
      driftStdDev: stats.rawDriftEMA.stdDev,
      driftSamples: stats.rawDriftEMA.samples,
      biasReady: stats.biasEMA.samples >= 20,
      biasSamples: stats.biasEMA.samples,
      histogramReady: stats.histogram.total > 0,
      histogram: stats.histogram,
      decisions: engine === 'mv' ? this.mvDecisions.getSummary() : this.bgDecisions.getSummary(),
      seekTelemetry: engine === 'mv' ? this.mvSeekTelemetry.getSummary() : this.bgSeekTelemetry.getSummary(),
      thresholds: this.getAdaptiveThresholds(engine),
      stats: {
        tickDelta: fmt(stats.tickDelta),
        schedulerLateness: fmt(stats.schedulerLateness),
        decodeLat: fmt(stats.decodeLat),
        frameAge: fmt(stats.frameAge),
        presLat: fmt(stats.presLat),
        seekLat: fmt(stats.seekLat),
        fps: fmt(stats.fps, 1),
        rawDrift: fmt(stats.rawDrift),
        correctedDrift: fmt(stats.correctedDrift),
      },
      schedulerStallCount: stats.schedulerStallCount,
      cpuOverloadCount: stats.cpuOverloadCount,
      tickMissCount: stats.tickMissCount,
      tickCount: stats.tickCount,
      // Confidence-Graduated Startup fields
      decoderConfidence: stats.decoderConfidence,
      renderConfidence: stats.renderConfidence,
      schedulerConfidence: this._sharedConfidence.schedulerConfidence,
      clockConfidence: this._sharedConfidence.clockConfidence,
      biasConfidence: stats.biasConfidence,
      compositeConfidence: stats.compositeConfidence,
      rawCompositeConfidence: stats.rawCompositeConfidence,
      confidenceBlockedBy: stats.confidenceBlockedBy,
    };
  }

  // ── Replay recording ───────────────────────────────────────────────────

  _recordReplay(engine, kind, data) {
    if (this.replayLog.length >= this.replayMaxBuffer) {
      // Ring buffer: drop oldest 10%
      this.replayLog.splice(0, Math.floor(this.replayMaxBuffer * 0.1));
    }
    this.replayLog.push({
      t: performance.now(),
      engine,
      kind,
      ...data,
    });
  }

  getReplayLog() {
    return this.replayLog;
  }

  // ── Per-Track Profile Methods ────────────────────────────────────────────

  applyProfile(engine, profile) {
    const stats = this[engine];
    if (!stats || !profile) return;

    const weight = profile.confidence || 0;

    if (profile.biasMs) {
      stats.biasEMA.mean = weight * profile.biasMs.mean + (1 - weight) * 0;
      stats.biasEMA.variance = profile.biasMs.variance || 0;
      stats.biasEMA.samples = profile.biasMs.samples || 0;
      stats.lastBias = stats.biasEMA.mean;
    }

    if (profile.decodeLatMs) {
      stats.decodeLatEMA.mean = weight * profile.decodeLatMs.mean + (1 - weight) * 0;
      stats.decodeLatEMA.variance = profile.decodeLatMs.variance || 0;
      stats.decodeLatEMA.samples = profile.decodeLatMs.samples || 0;
      stats.lastDecodeLat = stats.decodeLatEMA.mean;
    }

    if (profile.seekLatMs) {
      stats.seekLatEMA.mean = weight * profile.seekLatMs.mean + (1 - weight) * 15;
      stats.seekLatEMA.variance = profile.seekLatMs.variance || 0;
      stats.seekLatEMA.samples = profile.seekLatMs.samples || 0;
      stats.lastSeekLat = stats.seekLatEMA.mean;
    }

    if (profile.presLatMs) {
      stats.presLatEMA.mean = weight * profile.presLatMs.mean + (1 - weight) * 15;
      stats.presLatEMA.variance = profile.presLatMs.variance || 0;
      stats.presLatEMA.samples = profile.presLatMs.samples || 0;
      stats.lastPresLat = stats.presLatEMA.mean;
    }

    stats.compositeConfidence = profile.confidence || 0;
  }

  captureProfile(engine) {
    const stats = this[engine];
    if (!stats) return null;

    return {
      biasMs: {
        mean: stats.biasEMA.mean,
        variance: stats.biasEMA.variance,
        samples: stats.biasEMA.samples,
      },
      decodeLatMs: {
        mean: stats.decodeLatEMA.mean,
        variance: stats.decodeLatEMA.variance,
        samples: stats.decodeLatEMA.samples,
      },
      seekLatMs: {
        mean: stats.seekLatEMA.mean,
        variance: stats.seekLatEMA.variance,
        samples: stats.seekLatEMA.samples,
      },
      presLatMs: {
        mean: stats.presLatEMA.mean,
        variance: stats.presLatEMA.variance,
        samples: stats.presLatEMA.samples,
      },
      confidence: stats.compositeConfidence,
      sampleCount: stats.tickCount,
      updatedAt: performance.now(),
    };
  }

  updateProfileFromLive(engine, profile) {
    const stats = this[engine];
    if (!stats || !profile) return;

    if (stats.biasEMA.samples > 0) {
      profile.biasMs = {
        mean: stats.biasEMA.mean,
        variance: stats.biasEMA.variance,
        samples: stats.biasEMA.samples,
      };
    }

    if (stats.decodeLatEMA.samples > 0) {
      profile.decodeLatMs = {
        mean: stats.decodeLatEMA.mean,
        variance: stats.decodeLatEMA.variance,
        samples: stats.decodeLatEMA.samples,
      };
    }

    if (stats.seekLatEMA.samples > 0) {
      profile.seekLatMs = {
        mean: stats.seekLatEMA.mean,
        variance: stats.seekLatEMA.variance,
        samples: stats.seekLatEMA.samples,
      };
    }

    if (stats.presLatEMA.samples > 0) {
      profile.presLatMs = {
        mean: stats.presLatEMA.mean,
        variance: stats.presLatEMA.variance,
        samples: stats.presLatEMA.samples,
      };
    }

    profile.confidence = stats.compositeConfidence;
    profile.sampleCount = stats.tickCount;
    profile.updatedAt = performance.now();
  }

  clearObservability() {
    this.mv.spikeRecorder = [];
    this.mv.clockProvenanceRing = [];
    this.mv.seekPipelineLatencies = [];
    this.mv.reStabilityEvents = [];
    this.mv.currentReStabilityEvent = null;
    this.mvDecisions.reset();
    this.mvSeekTelemetry.reset();

    this.bg.spikeRecorder = [];
    this.bg.clockProvenanceRing = [];
    this.bg.seekPipelineLatencies = [];
    this.bg.reStabilityEvents = [];
    this.bg.currentReStabilityEvent = null;
    this.bgDecisions.reset();
    this.bgSeekTelemetry.reset();

    this.replayLog = [];
  }

  reset() {
    this.mv = this._createEngineStats();
    this.bg = this._createEngineStats();
    this.mvDecisions.reset();
    this.bgDecisions.reset();
    this.mvSeekTelemetry.reset();
    this.bgSeekTelemetry.reset();
    this.replayLog = [];
    this._isStable = true;
    if (this._sharedConfidence) {
      this._sharedConfidence.schedulerConfidence = 0;
      this._sharedConfidence.clockConfidence = 0;
      this._sharedConfidence.rawSchedulerConfidence = 0;
      this._sharedConfidence.rawClockConfidence = 0;
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SyncReplay — offline simulator for comparing configs
// ─────────────────────────────────────────────────────────────────────────────

export class SyncReplay {
  constructor(events) {
    this.events = events;
  }

  runWithConfig(config) {
    const {
      alphaBias = 0.005,
      alphaDrift = 0.02,
      alphaPresLat = 0.02,
      alphaSeekLat = 0.05,
      bootstrapPresLat = 15,
      bootstrapSeekLat = 15,
      softThresholdMs = 30,
      hardThresholdMs = 300,
      rateGain = 0.003,
      rateMax = 0.005,
      biasLearningEnabled = true,
      predictionEnabled = true,
      confidenceThreshold = 80,
    } = config;

    // Simulate EMAs
    const biasMv = new EMATracker(alphaBias, 0);
    const biasBg = new EMATracker(alphaBias, 0);
    const driftMv = new EMATracker(alphaDrift, 0);
    const driftBg = new EMATracker(alphaDrift, 0);

    let hardSeekCount = 0;
    let softSeekCount = 0;
    let rateCount = 0;
    let lockCount = 0;
    const drifts = [];

    for (const event of this.events) {
      if (event.kind !== 'drift') continue;

      const bias = event.engine === 'mv' ? biasMv : biasBg;
      const driftEma = event.engine === 'mv' ? driftMv : driftBg;

      driftEma.push(event.raw);

      // Bias learning (only when stable + LOCKED)
      if (biasLearningEnabled && event.stable && event.mode === 'LOCKED') {
        bias.push(event.raw);
      }

      const correctedDrift = event.raw - bias.mean;
      drifts.push(correctedDrift);
      const absDrift = Math.abs(correctedDrift);

      // Decision — all values in ms: correctedDrift (ms), thresholds (ms)
      if (absDrift > hardThresholdMs) {
        hardSeekCount++;
      } else if (absDrift > softThresholdMs) {
        softSeekCount++;
      } else if (absDrift > rateGain) {
        rateCount++;
      } else {
        lockCount++;
      }
    }

    const total = drifts.length;
    const absDrifts = drifts.map(Math.abs).sort((a, b) => a - b);
    const mean = total > 0 ? drifts.reduce((a, b) => a + b, 0) / total : 0;
    // drifts are already in ms — no conversion needed
    const p50 = total > 0 ? absDrifts[Math.floor(total * 0.5)] : 0;
    const p95 = total > 0 ? absDrifts[Math.floor(total * 0.95)] : 0;
    const p99 = total > 0 ? absDrifts[Math.floor(total * 0.99)] : 0;
    const max = total > 0 ? absDrifts[total - 1] : 0;

    return {
      meanMs: Math.round(mean),
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
      p99Ms: Math.round(p99),
      maxMs: Math.round(max),
      hardSeekCount,
      softSeekCount,
      rateCount,
      lockCount,
      total,
      biasMv: biasMv.mean,
      biasBg: biasBg.mean,
    };
  }

  compareConfigs(configA, configB) {
    const resultA = this.runWithConfig(configA);
    const resultB = this.runWithConfig(configB);
    return {
      configA: resultA,
      configB: resultB,
      delta: {
        p95: resultB.p95Ms - resultA.p95Ms,
        max: resultB.maxMs - resultA.maxMs,
        hardSeeks: resultB.hardSeekCount - resultA.hardSeekCount,
        softSeeks: resultB.softSeekCount - resultA.softSeekCount,
      }
    };
  }
}

// ── App-wide singleton core ────────────────────────────────────────────────
// One SharedSyncCore shared by every A/V surface (full player MV/BG, MiniPlayer
// background, NowPlaying panel). All surfaces must pass an equivalent
// masterTimeFn reading the SAME shared audio element, so whichever surface
// creates the instance first yields identical behavior for the others.
let _sharedCoreInstance = null;
export function getSharedSyncCore(masterTimeFn) {
  if (!_sharedCoreInstance) {
    _sharedCoreInstance = new SharedSyncCore(masterTimeFn || (() => 0));
  }
  return _sharedCoreInstance;
}
