// SyncReplayEngine — replays recorded sensor_snapshot events through the full
// Evidence-Driven Decision Engine pipeline.
// Used by __SYNC_REPLAY__() for offline validation and tuning.

import { createSensorSnapshot } from '../sensor/SensorSnapshot.js';
import { validateSensorSnapshot } from '../validation/SensorValidator.js';
import {
  evaluateDriftAnalyzer,
  evaluatePipelineAnalyzer,
  evaluateSchedulerAnalyzer,
  evaluateDecoderAnalyzer,
} from '../analyzers';
import {
  DriftMemory,
  PipelineMemory,
  SchedulerMemory,
  DecoderMemory,
  LearningMemory,
  createMemorySnapshot,
} from '../memory';
import { computeDerivedMetrics } from '../memory/DerivedMetrics.js';
import { decide, getConstraints } from '../decision';

export class SyncReplayEngine {
  constructor(events) {
    this.events = events || [];
  }

  _initResults() {
    return {
      total: 0,
      decisions: { hardSeek: 0, softSeek: 0, setRate: 0, hold: 0, noop: 0 },
      drifts: [],
      derivedMetricsHistory: [],
      decisionHistory: [],
      analyzerEvidenceHistory: [],
      constraintViolations: {},
    };
  }

  _initMemories() {
    return {
      mv: {
        drift: new DriftMemory('mv'),
        pipeline: new PipelineMemory('mv'),
        scheduler: new SchedulerMemory('mv'),
        decoder: new DecoderMemory('mv'),
        learning: new LearningMemory('mv'),
      },
      bg: {
        drift: new DriftMemory('bg'),
        pipeline: new PipelineMemory('bg'),
        scheduler: new SchedulerMemory('bg'),
        decoder: new DecoderMemory('bg'),
        learning: new LearningMemory('bg'),
      },
    };
  }

  _processFrame(event, memories, results) {
    const engineId = event.engine || event.data?.engineId || 'mv';
    const mem = memories[engineId] || memories.mv;
    const data = event.data || {};

    const snapshot = createSensorSnapshot({
      ...data,
      ts: event.ts || 0,
    });
    const validationResult = validateSensorSnapshot(snapshot);

    const rawDriftMs = Number(data.driftMs || 0);
    mem.drift.pushDrift(rawDriftMs);
    // NOTE: bias is updated via updateProfileFromLive() in videoSyncEngine,
    // not reset per-frame. This preserves realistic bias evolution for replay.
    mem.pipeline.setCptMs(Number(data.cptMs || 0));
    mem.scheduler.pushTickDelta(Number(data.tickDelta || 0));
    mem.scheduler.setCpuOverloaded(Boolean(data.cpuOverloaded));
    if (Boolean(data.cpuOverloaded)) mem.scheduler.recordLateTick();
    mem.decoder.pushDecodeLatency(Number(data.decodeLatencyMs || 0));
    mem.decoder.recordDroppedFrames(Number(data.droppedFrames || 0));
    mem.decoder.setRvfcStatus(String(data.rvfcStatus || 'UNKNOWN'));

    const memorySnapshot = createMemorySnapshot({
      engineId,
      driftEMA: mem.drift.driftEMA,
      biasMs: mem.drift.biasMs,
      cptMs: mem.pipeline.cptMs,
      pipelineState: mem.pipeline.pipelineState,
      warmupPhase: mem.pipeline.warmupPhase,
      disturbanceCount: mem.pipeline.disturbanceCount,
      recentTickDeltas: mem.scheduler.recentTickDeltas,
      cpuOverloaded: mem.scheduler.cpuOverloaded,
      decodeLatencyHistory: mem.decoder.decodeLatencyHistory,
      droppedFrames: mem.decoder.droppedFrames,
      futileCount: mem.learning.futileCount,
      adaptiveThresholds: mem.learning.adaptiveThresholds,
      confidenceHistory: mem.learning.confidenceHistory,
      sessionQuality: 1,
    });

    let analyzerEvidence = [];
    try {
      const ctx = { sensor: snapshot, memorySnapshot, config: {} };
      analyzerEvidence = [
        evaluateDriftAnalyzer(ctx),
        evaluatePipelineAnalyzer(ctx),
        evaluateSchedulerAnalyzer(ctx),
        evaluateDecoderAnalyzer(ctx),
      ];
    } catch (_) {
      // analyzer failures must not break replay
    }

    const derivedMetrics = computeDerivedMetrics(memorySnapshot);
    const constraints = getConstraints(derivedMetrics);
    const decision = decide({ derivedMetrics, constraints, evidenceList: analyzerEvidence });

    results.total++;
    results.drifts.push(rawDriftMs);
    results.derivedMetricsHistory.push(derivedMetrics);
    results.decisionHistory.push(decision);
    results.analyzerEvidenceHistory.push(analyzerEvidence);

    if (decision.actionRequest) {
      const type = decision.actionRequest.type;
      if (type === 'hardSeek') results.decisions.hardSeek++;
      else if (type === 'softSeek') results.decisions.softSeek++;
      else if (type === 'setRate') results.decisions.setRate++;
      else if (type === 'hold') results.decisions.hold++;
      else if (type === 'noop') results.decisions.noop++;
    }

    for (const code of decision.constraintsViolated || []) {
      results.constraintViolations[code] = (results.constraintViolations[code] || 0) + 1;
    }

    return {
      engineId,
      snapshot,
      validationResult,
      memorySnapshot,
      analyzerEvidence,
      derivedMetrics,
      decision,
      rawDriftMs,
    };
  }

  run() {
    const results = this._initResults();
    const memories = this._initMemories();
    const snapshots = this.events.filter((e) => e.kind === 'sensor_snapshot');

    for (const event of snapshots) {
      this._processFrame(event, memories, results);
    }

    return results;
  }

  async *runFrames(speed = 1) {
    const results = this._initResults();
    const memories = this._initMemories();
    const snapshots = this.events.filter((e) => e.kind === 'sensor_snapshot');

    for (let i = 0; i < snapshots.length; i++) {
      const event = snapshots[i];
      const frameResult = this._processFrame(event, memories, results);

      yield {
        frameIndex: i,
        totalFrames: snapshots.length,
        result: {
          total: results.total,
          decisions: { ...results.decisions },
          drifts: [...results.drifts],
          constraintViolations: { ...results.constraintViolations },
        },
        engine: frameResult.engineId,
        decision: frameResult.decision,
        evidence: frameResult.analyzerEvidence,
        derivedMetrics: frameResult.derivedMetrics,
        rawDriftMs: frameResult.rawDriftMs,
      };

      if (i < snapshots.length - 1) {
        const nextEvent = snapshots[i + 1];
        const delay = Math.max(0, (nextEvent.ts - event.ts) * speed);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  static compareConfigs(events, configA, configB) {
    const engineA = new SyncReplayEngine(events);
    const engineB = new SyncReplayEngine(events);
    const resultA = engineA.run();
    const resultB = engineB.run();
    return {
      configA: resultA,
      configB: resultB,
      delta: {
        hardSeeks: (resultB.decisions.hardSeek || 0) - (resultA.decisions.hardSeek || 0),
        softSeeks: (resultB.decisions.softSeek || 0) - (resultA.decisions.softSeek || 0),
        setRates: (resultB.decisions.setRate || 0) - (resultA.decisions.setRate || 0),
        total: resultB.total - resultA.total,
      },
    };
  }
}
