import { useState, useEffect, useRef, memo } from 'react';
import { Histogram } from '../utils/syncCore';

let _coreRef = null;
let _audioRef = null;
let _mvRef = null;
let _bgRef = null;
let _engineStateRef = null;
let _videoOffsetRef = null;
let _rvfcStatusRef = { mv: 'UNSUPPORTED', bg: 'UNSUPPORTED' };
let _videoRemountCountRef = 0;
let _replayStateRef = { active: false, frameIndex: 0, totalFrames: 0, lastFrame: null, complete: false, startTime: 0 };
let _recordingStateRef = { enabled: false, bufferLength: 0, maxBuffer: 0 };
let _analyzerEvidenceRef = { mv: [], bg: [] };
let _decisionOutputRef = { mv: null, bg: null };

export function registerSyncCore(core) { _coreRef = core; }
export function registerAudioRef(ref) { _audioRef = ref; }
export function registerMvRef(ref) { _mvRef = ref; }
export function registerBgRef(ref) { _bgRef = ref; }
export function registerEngineStateRef(mv, bg) { _engineStateRef = { mv, bg }; }
export function registerVideoOffsetRef(ref) { _videoOffsetRef = ref; }
export function registerRvfcStatusRef(ref) { _rvfcStatusRef = ref; }
export function registerVideoRemountCount(count) { _videoRemountCountRef = count; }
export function registerReplayStateRef(ref) { _replayStateRef = ref || _replayStateRef; }
export function registerRecordingState(ref) { _recordingStateRef = ref || _recordingStateRef; }
export function registerAnalyzerEvidence(ref) { _analyzerEvidenceRef = ref || _analyzerEvidenceRef; }
export function registerDecisionOutput(ref) { _decisionOutputRef = ref || _decisionOutputRef; }

const GRAPH_WIDTH = 56;

function driftColor(ms) {
  if (ms == null || !isFinite(ms)) return '#888';
  const abs = Math.abs(ms);
  if (abs < 20) return '#22c55e';
  if (abs < 50) return '#facc15';
  if (abs < 100) return '#f97316';
  return '#ef4444';
}

function fmtMs(val) {
  if (val == null || !isFinite(val)) return '\u2014';
  return Math.round(val);
}

function driftStats(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const vals = history.filter(v => v != null && isFinite(v));
  if (vals.length === 0) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const stdDev = Math.sqrt(sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n);
  // Percentile = nearest-rank, so P99 over a large window is a genuine tail
  // measure (unlike min/avg/max, which a single spike can fool).
  const pct = (q) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  return { min, max, avg, stdDev, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), n };
}

function pad(n, w = 5) {
  const s = String(n);
  return s.length < w ? ' '.repeat(w - s.length) + s : s;
}

function fmtVal(val, decimals = 0) {
  if (val == null || !isFinite(val)) return '\u2014';
  const f = 10 ** decimals;
  return String(Math.round(val * f) / f);
}

function healthColor(pct) {
  if (pct <= 5) return '#4ade80';
  if (pct <= 15) return '#facc15';
  return '#f87171';
}

function DriftGraph({ history }) {
  const max = Math.max(1, ...history.map(Math.abs));
  const mid = Math.floor(GRAPH_WIDTH / 2);
  const chars = new Array(GRAPH_WIDTH).fill(' ');
  for (let i = 0; i < history.length; i++) {
    const offset = Math.round((history[i] / max) * mid);
    const pos = mid + offset;
    if (pos >= 0 && pos < GRAPH_WIDTH) chars[pos] = history[i] >= 0 ? '\u258f' : '\u2595';
  }
  chars[mid] = '\u2502';
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 0, whiteSpace: 'pre', lineHeight: 1.2 }}>
      {chars.join('')}
    </span>
  );
}

function HistogramDisplay({ histogram }) {
  if (!histogram || histogram.total === 0) return <div style={{ fontSize: 12, color: '#555' }}>No data</div>;
  const maxBarWidth = 8;
  const normalized = histogram.getNormalized();
  const maxRatio = Math.max(0.001, ...normalized);
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.4 }}>
      {Histogram.BINS.map((bin, i) => {
        const ratio = normalized[i] || 0;
        const barLen = Math.round((ratio / maxRatio) * maxBarWidth);
        const pct = Math.round(ratio * 100);
        return (
          <div key={bin.label} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span style={{ width: 48, textAlign: 'right', color: '#666', flexShrink: 0 }}>{bin.label}</span>
            <span style={{ color: ratio > 0.3 ? '#4ade80' : ratio > 0.1 ? '#facc15' : '#555', flexShrink: 0, letterSpacing: -1 }}>{'\u2588'.repeat(barLen)}</span>
            <span style={{ color: '#555', width: 28, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, valueColor = '#bbb' }) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={{ ...S.value, color: valueColor }}>{value}</span>
    </div>
  );
}

function SectionLabel({ label }) {
  return <div style={S.sectionLabel}>{label}</div>;
}

function DualCard({ title, mvContent, bgContent, sideBySide = false }) {
  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>{title}</div>
      <div style={sideBySide ? { display: 'flex', gap: 6 } : { display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={sideBySide ? { ...S.card, flex: 1, minWidth: 0 } : S.card}>
          <div style={S.cardLabel}>MV</div>
          {mvContent}
        </div>
        <div style={sideBySide ? { ...S.card, flex: 1, minWidth: 0 } : S.card}>
          <div style={S.cardLabel}>BG</div>
          {bgContent}
        </div>
      </div>
    </div>
  );
}

const SyncOverlay = memo(function SyncOverlay({ onClose }) {
  const [, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  const [driftHistoryMv, setDriftHistoryMv] = useState([]);
  const [driftHistoryBg, setDriftHistoryBg] = useState([]);
  const [driftStatsMv, setDriftStatsMv] = useState(null);
  const [driftStatsBg, setDriftStatsBg] = useState(null);
  const lastDriftRef = useRef({ mv: [], bg: [] });
  // Long window (~90s at 100ms sampling) so P95/P99 are real tail measures
  // instead of collapsing to max on a tiny buffer.
  const lastStatsRef = useRef({ mv: [], bg: [] });
  const STATS_WINDOW = 900;
  const rafFpsRef = useRef({ lastTime: 0, ema: 0, fps: 0 });

  useEffect(() => {
    let rafId;
    const rafLoop = (now) => {
      const r = rafFpsRef.current;
      if (r.lastTime > 0) {
        const dt = now - r.lastTime;
        if (dt > 0) {
          const instant = 1000 / dt;
          r.ema = r.ema === 0 ? instant : r.ema * 0.9 + instant * 0.1;
          r.fps = Math.round(r.ema);
        }
      }
      r.lastTime = now;
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    const id = setInterval(() => {
      const debug = window.__SYNC_DEBUG === true || localStorage.syncDebug === 'true';
      setVisible(debug);
      if (!debug || !_coreRef) { setTick(t => t + 1); return; }

      const mvStats = _coreRef.getStats('mv');
      const bgStats = _coreRef.getStats('bg');
      if (mvStats) {
        lastDriftRef.current.mv.push(mvStats.rawDrift);
        if (lastDriftRef.current.mv.length > GRAPH_WIDTH) lastDriftRef.current.mv.shift();
        setDriftHistoryMv([...lastDriftRef.current.mv]);
        lastStatsRef.current.mv.push(mvStats.rawDrift);
        if (lastStatsRef.current.mv.length > STATS_WINDOW) lastStatsRef.current.mv.shift();
        setDriftStatsMv(driftStats(lastStatsRef.current.mv));
      }
      if (bgStats) {
        lastDriftRef.current.bg.push(bgStats.rawDrift);
        if (lastDriftRef.current.bg.length > GRAPH_WIDTH) lastDriftRef.current.bg.shift();
        setDriftHistoryBg([...lastDriftRef.current.bg]);
        lastStatsRef.current.bg.push(bgStats.rawDrift);
        if (lastStatsRef.current.bg.length > STATS_WINDOW) lastStatsRef.current.bg.shift();
        setDriftStatsBg(driftStats(lastStatsRef.current.bg));
      }
      setTick(t => t + 1);
    }, 100);
    return () => { clearInterval(id); cancelAnimationFrame(rafId); };
  }, []);

  const handleClose = () => {
    window.__SYNC_DEBUG = false;
    try { localStorage.syncDebug = 'false'; } catch {}
    if (onClose) onClose();
  };

  if (!visible || !_coreRef) return null;

  const mv = _coreRef.getStats('mv');
  const bg = _coreRef.getStats('bg');
  const mvState = _engineStateRef?.mv;
  const bgState = _engineStateRef?.bg;
  const audioMs = Math.round((_audioRef?.current?.currentTime ?? 0) * 1000);
  const mvMs = Math.round((_mvRef?.current?.getCurrentTime?.() ?? 0) * 1000);
  const bgMs = Math.round((_bgRef?.current?.currentTime ?? 0) * 1000);
  // videoOffset is intentional (per-track offset from activeFile). The engine
  // targets audio.currentTime + offset, so the real sync error is measured
  // against that target — NOT the raw difference, which a large offset makes
  // look like a 15s failure. The raw times are still shown above for reference.
  const offsetMs = Math.round((_videoOffsetRef?.current ?? 0) * 1000);
  const audioMvDrift = mvMs - (audioMs + offsetMs);
  const audioBgDrift = bgMs - (audioMs + offsetMs);
  const mvBgDrift = bgMs - mvMs;
  // Determine if each engine is within the 10ms sync target (the scale the
  // user wants kept under). Frame period is informational; the target is what
  // counts, so "Sync OK" doesn't flip to NO merely because the decoder is
  // paused or the frame rate is low.
  const SYNC_TARGET_MS = 10;
  const mvSynced = Math.abs(audioMvDrift) <= SYNC_TARGET_MS;
  const bgSynced = Math.abs(audioBgDrift) <= SYNC_TARGET_MS;
  const mvFpsVal = mv?.stats?.fps?.current;
  const bgFpsVal = bg?.stats?.fps?.current;
  const overallSynced = mvSynced && bgSynced;
  const triangleConsistency = (() => {
    const expectedMvBg = audioBgDrift - audioMvDrift;
    const error = Math.abs(mvBgDrift - expectedMvBg);
    const maxDrift = Math.max(Math.abs(audioMvDrift), Math.abs(audioBgDrift), Math.abs(mvBgDrift));
    const score = Math.max(0, Math.min(1, 1 - error / 200)) * Math.max(0.3, 1 - maxDrift / 500);
    const absDrifts = [
      { node: 'MV', drift: Math.abs(audioMvDrift), raw: audioMvDrift },
      { node: 'BG', drift: Math.abs(audioBgDrift), raw: audioBgDrift },
    ];
    absDrifts.sort((a, b) => b.drift - a.drift);
    const outlier = absDrifts[0].drift > 40 ? absDrifts[0].node : null;
    return { score: Math.round(score * 100), outlier, maxDrift: absDrifts[0].drift, maxDriftNode: absDrifts[0].node };
  })();

  const rafFps = rafFpsRef.current.fps;
  const mvRvfc = _rvfcStatusRef?.mv ?? '\u2014';
  const bgRvfc = _rvfcStatusRef?.bg ?? '\u2014';
  const tickAvg = mv?.stats?.tickDelta?.avg;
  const tickHz = tickAvg > 0 ? (1000 / tickAvg) : null;
  const schedAvg = mv?.stats?.tickDelta?.avg;
  const schedWorst = mv?.stats?.schedulerLateness?.max;
  const totalTick = (mv?.tickCount ?? 0) + (bg?.tickCount ?? 0);
  const totalMiss = (mv?.tickMissCount ?? 0) + (bg?.tickMissCount ?? 0);
  const missPct = totalTick > 0 ? Math.round(totalMiss / totalTick * 100) : 0;
  const mvReStab = _coreRef.getReStabilitySummary?.('mv');
  const bgReStab = _coreRef.getReStabilitySummary?.('bg');
  const mvClockProv = _coreRef.getClockProvenance?.('mv');
  const bgClockProv = _coreRef.getClockProvenance?.('bg');
  const mvSpikes = (_coreRef.getSpikeRecorder?.('mv') || []).slice(-8).reverse();
  const bgSpikes = (_coreRef.getSpikeRecorder?.('bg') || []).slice(-8).reverse();
  const mvSeekPipeline = _coreRef.getSeekPipelineLatencies?.('mv') || [];
  const bgSeekPipeline = _coreRef.getSeekPipelineLatencies?.('bg') || [];
  const mvLifecycle = _coreRef.getVideoLifecycleSummary?.('mv');
  const bgLifecycle = _coreRef.getVideoLifecycleSummary?.('bg');
  const mvLifecycleDetail = _coreRef.getVideoLifecycle?.('mv');
  const bgLifecycleDetail = _coreRef.getVideoLifecycle?.('bg');
  const mvLifecycleEvents = mvLifecycleDetail?.tracker?.getEvents() || [];
  const bgLifecycleEvents = bgLifecycleDetail?.tracker?.getEvents() || [];

  return (
    <div style={S.container}>
      <div style={S.header}>
        <span>SYNC DEBUG</span>
        <button onClick={handleClose} style={S.closeBtn} title="Close">&times;</button>
      </div>

      <div style={S.timeRow}>
        <span style={{ color: '#aaa' }}>A {pad(audioMs)}ms</span>
        <span style={{ color: driftColor(mv?.rawDrift) }}>MV {pad(mvMs)}ms</span>
        <span style={{ color: driftColor(bg?.rawDrift) }}>BG {pad(bgMs)}ms</span>
      </div>
      <div style={{ ...S.timeRow, color: '#888', fontSize: 12, marginTop: -2, fontWeight: 500 }}>
        <span style={{ color: '#666' }}>Offset</span>
        <span style={{ color: '#4ade80' }}>+{pad(offsetMs)}ms</span>
        <span style={{ color: '#4ade80' }}>+{pad(offsetMs)}ms</span>
      </div>
      <div style={{ ...S.timeRow, color: '#888', fontSize: 12, marginTop: 1, fontWeight: 500 }}>
        <span style={{ color: '#666' }}>Δ Audio↔MV</span>
        <span style={{ color: driftColor(audioMvDrift) }}>{pad(audioMvDrift)}ms</span>
      </div>
      <div style={{ ...S.timeRow, color: '#888', fontSize: 12, marginTop: -1, fontWeight: 500 }}>
        <span style={{ color: '#666' }}>Δ Audio↔BG</span>
        <span style={{ color: driftColor(audioBgDrift) }}>{pad(audioBgDrift)}ms</span>
      </div>
      <div style={{ ...S.timeRow, color: '#888', fontSize: 12, marginTop: -1, fontWeight: 500 }}>
        <span style={{ color: '#666' }}>Δ MV↔BG</span>
        <span style={{ color: driftColor(mvBgDrift) }}>{pad(mvBgDrift)}ms</span>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 1, marginBottom: 2 }}>
        Consistency <span style={{ color: triangleConsistency.score > 70 ? '#4ade80' : triangleConsistency.score > 40 ? '#facc15' : '#f87171' }}>{triangleConsistency.score}%</span>
        {triangleConsistency.outlier && <span style={{ color: '#f87171', marginLeft: 6 }}>outlier: {triangleConsistency.outlier}</span>}
      </div>
      {(() => {
        const mvS = driftStatsMv;
        const bgS = driftStatsBg;
        const row1 = (label, st) => st ? (
          <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 7, marginTop: 1 }}>
            <span style={{ color: '#666', width: 26, flexShrink: 0 }}>{label}</span>
            <span>min <span style={{ color: driftColor(st.min) }}>{fmtMs(st.min)}</span>ms</span>
            <span>avg <span style={{ color: driftColor(st.avg) }}>{fmtMs(st.avg)}</span>ms</span>
            <span>&sigma; <span style={{ color: (st.stdDev ?? 99) > 12 ? '#f87171' : '#bbb' }}>{fmtVal(st.stdDev, 1)}</span>ms</span>
          </div>
        ) : null;
        const row2 = (label, st) => st ? (
          <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 7, marginTop: 1, paddingLeft: 26 }}>
            <span style={{ color: '#666' }}>P95</span>
            <span style={{ color: (st.p95 ?? 99) > 10 ? '#facc15' : '#4ade80', width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(st.p95)}ms</span>
            <span style={{ color: '#666' }}>P99</span>
            <span style={{ color: (st.p99 ?? 99) > 20 ? '#f87171' : '#facc15', width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(st.p99)}ms</span>
            <span style={{ color: '#666' }}>worst</span>
            <span style={{ color: driftColor(st.max), width: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(st.max)}ms</span>
          </div>
        ) : null;
        return mvS || bgS ? (
          <div style={{ marginTop: 1, marginBottom: 3 }}>
            {row1('MV', mvS)}
            {row2('MV', mvS)}
            {row1('BG', bgS)}
            {row2('BG', bgS)}
          </div>
        ) : null;
      })()}

      <DualCard
        title="SYNC STATUS"
        sideBySide
        mvContent={<>
          <Row label="Drift" value={`${fmtMs(mv?.rawDrift)}ms`} valueColor={driftColor(mv?.rawDrift)} />
          <Row label="Corrected" value={`${fmtMs(mv?.correctedDrift)}ms`} valueColor={driftColor(mv?.correctedDrift)} />
          <Row label="Drift Δ" value={`${fmtMs(mvState?.prevDriftDeltaMs)}ms`} valueColor={(mvState?.prevDriftDeltaMs ?? 0) > 40 ? '#f87171' : '#bbb'} />
          <Row label="Drift Δ²" value={`${fmtMs(mvState?.driftAccelerationMs)}ms`} valueColor={(mvState?.driftAccelerationMs ?? 0) > 15 ? '#f87171' : '#bbb'} />
          <Row label="Bias" value={`${fmtMs(mv?.bias)}ms`} />
        <Row label="BiasN" value={String(mv?.biasSamples ?? 0)} />
        <Row label="SoftTh" value={`${fmtMs(mv?.thresholds?.soft * 1000)}ms`} />
        <Row label="HardTh" value={`${fmtMs(mv?.thresholds?.hard * 1000)}ms`} />
        <Row label="Thresh" value={`${fmtMs(mv?.thresholds?.soft * 1000)}/${fmtMs(mv?.thresholds?.hard * 1000)}`} />
          <Row label="Mode" value={mvState?.mode ?? '\u2014'} />
          <Row label="Rate" value={(_mvRef?.current?.getRate?.() ?? 1).toFixed(3)} valueColor={Math.abs((_mvRef?.current?.getRate?.() ?? 1) - 1) > 0.01 ? '#facc15' : '#bbb'} />
          <Row label="Stable" value={mv?.stable ? '\u2705' : '\u274c'} valueColor={mv?.stable ? '#4ade80' : '#f87171'} />
          <Row label="LockTicks" value={String(mvState?.lockedConsecutiveTicks ?? 0)} />
          <Row label="Candidate" value={mvState?.stableCandidateSince ? `${fmtMs(performance.now() - mvState.stableCandidateSince)}ms` : '\u2014'} />
          <Row label="Sigma" value={`${fmtMs(mv?.driftStdDev)}ms`} valueColor={(mv?.driftStdDev ?? 0) > 12 ? '#f87171' : '#bbb'} />
          <Row label="SeekPend" value={mvState?.seekPending ? 'YES' : 'no'} valueColor={mvState?.seekPending ? '#facc15' : '#bbb'} />
          <Row label="LastSeek" value={mvState?.lastHardSeekTime ? `${fmtMs(performance.now() - mvState.lastHardSeekTime)}ms` : '\u2014'} />
          <Row label="HardArm" value={mvState?.hardSeekFutileArmed ? 'YES' : 'no'} valueColor={mvState?.hardSeekFutileArmed ? '#fb923c' : '#bbb'} />
          <Row label="Grace" value={mvState?.graceUntil ? `${Math.max(0, fmtMs(mvState.graceUntil - performance.now()))}ms` : '\u2014'} />
          <Row label="Hold" value={mvState?.holdUntil ? `${Math.max(0, fmtMs(mvState.holdUntil - performance.now()))}ms` : '\u2014'} valueColor={mvState?.holdUntil ? '#a78bfa' : '#555'} />
        </>}
        bgContent={<>
          <Row label="Drift" value={`${fmtMs(bg?.rawDrift)}ms`} valueColor={driftColor(bg?.rawDrift)} />
          <Row label="Corrected" value={`${fmtMs(bg?.correctedDrift)}ms`} valueColor={driftColor(bg?.correctedDrift)} />
          <Row label="Drift Δ" value={`${fmtMs(bgState?.prevDriftDeltaMs)}ms`} valueColor={(bgState?.prevDriftDeltaMs ?? 0) > 40 ? '#f87171' : '#bbb'} />
          <Row label="Drift Δ²" value={`${fmtMs(bgState?.driftAccelerationMs)}ms`} valueColor={(bgState?.driftAccelerationMs ?? 0) > 15 ? '#f87171' : '#bbb'} />
          <Row label="Bias" value={`${fmtMs(bg?.bias)}ms`} />
          <Row label="BiasN" value={String(bg?.biasSamples ?? 0)} />
          <Row label="SoftTh" value={`${fmtMs(bg?.thresholds?.soft * 1000)}ms`} />
          <Row label="HardTh" value={`${fmtMs(bg?.thresholds?.hard * 1000)}ms`} />
          <Row label="Thresh" value={`${fmtMs(bg?.thresholds?.soft * 1000)}/${fmtMs(bg?.thresholds?.hard * 1000)}`} />
          <Row label="Mode" value={bgState?.mode ?? '\u2014'} />
          <Row label="Rate" value={(_bgRef?.current?.playbackRate ?? 1).toFixed(3)} valueColor={Math.abs((_bgRef?.current?.playbackRate ?? 1) - 1) > 0.01 ? '#facc15' : '#bbb'} />
          <Row label="Stable" value={bg?.stable ? '\u2705' : '\u274c'} valueColor={bg?.stable ? '#4ade80' : '#f87171'} />
          <Row label="LockTicks" value={String(bgState?.lockedConsecutiveTicks ?? 0)} />
          <Row label="Candidate" value={bgState?.stableCandidateSince ? `${fmtMs(performance.now() - bgState.stableCandidateSince)}ms` : '\u2014'} />
          <Row label="Sigma" value={`${fmtMs(bg?.driftStdDev)}ms`} valueColor={(bg?.driftStdDev ?? 0) > 12 ? '#f87171' : '#bbb'} />
          <Row label="SeekPend" value={bgState?.seekPending ? 'YES' : 'no'} valueColor={bgState?.seekPending ? '#facc15' : '#bbb'} />
          <Row label="LastSeek" value={bgState?.lastHardSeekTime ? `${fmtMs(performance.now() - bgState.lastHardSeekTime)}ms` : '\u2014'} />
          <Row label="HardArm" value={bgState?.hardSeekFutileArmed ? 'YES' : 'no'} valueColor={bgState?.hardSeekFutileArmed ? '#fb923c' : '#bbb'} />
          <Row label="Grace" value={bgState?.graceUntil ? `${Math.max(0, fmtMs(bgState.graceUntil - performance.now()))}ms` : '\u2014'} />
          <Row label="Hold" value={bgState?.holdUntil ? `${Math.max(0, fmtMs(bgState.holdUntil - performance.now()))}ms` : '\u2014'} valueColor={bgState?.holdUntil ? '#a78bfa' : '#555'} />
        </>}
      />

      <div style={S.section}>
        <div style={S.sectionTitle}>PERFORMANCE</div>
        <SectionLabel label="Display" />
        <Row label="Sync OK" value={overallSynced ? 'YES' : 'NO'} valueColor={overallSynced ? '#4ade80' : '#f87171'} />
        <Row label="RAF" value={`${rafFps} FPS`} valueColor={rafFps < 30 ? '#f87171' : '#bbb'} />
        <SectionLabel label="Decoder" />
        <Row label="MV" value={`${mvFpsVal != null ? fmtVal(mvFpsVal, 1) + ' FPS' : '\u2014 FPS'} (${mvRvfc})`} valueColor={mvRvfc === 'ACTIVE' ? '#4ade80' : mvRvfc === 'UNSUPPORTED' ? '#888' : '#facc15'} />
        <Row label="BG" value={`${bgFpsVal != null ? fmtVal(bgFpsVal, 1) + ' FPS' : '\u2014 FPS'} (${bgRvfc})`} valueColor={bgRvfc === 'ACTIVE' ? '#4ade80' : bgRvfc === 'UNSUPPORTED' ? '#888' : '#facc15'} />
        <SectionLabel label="Engine" />
        <Row label="Tick" value={tickHz != null ? `${fmtVal(tickHz, 1)} Hz` : '\u2014'} />
        <Row label="Dt" value={mv?.stats?.tickDelta?.current != null ? `${fmtMs(mv.stats.tickDelta.current)}ms` : '\u2014'} />
        <SectionLabel label="Scheduler" />
        <Row label="Avg" value={schedAvg != null ? `${fmtVal(schedAvg, 0)} ms` : '\u2014'} />
        <Row label="Worst" value={schedWorst != null ? `${fmtVal(schedWorst, 0)} ms` : '\u2014'} valueColor={schedWorst > 50 ? '#f87171' : '#bbb'} />
        <Row label="Miss" value={totalTick > 0 ? `${missPct}%` : '\u2014'} valueColor={healthColor(missPct)} />
      </div>

      <DualCard
        title="DECISIONS"
        mvContent={<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 6px', fontFamily: 'monospace', fontSize: 12 }}>
          <span style={{ color: '#4ade80' }}>LOCK:{pad(mv?.decisions?.lock ?? 0, 4)}</span>
          <span style={{ color: '#60a5fa' }}>RATE:{pad(mv?.decisions?.rate ?? 0, 4)}</span>
          <span style={{ color: '#f87171' }}>HARD:{pad(mv?.decisions?.hard ?? 0, 4)}</span>
          <span style={{ color: '#888' }}>NOOP:{pad(mv?.decisions?.noop ?? 0, 4)}</span>
          <span style={{ color: '#fb923c' }}>FUTL:{pad(mv?.decisions?.futile ?? 0, 4)}</span>
          <span style={{ color: '#555', gridColumn: '1 / -1' }}>Lock%:{mv?.decisions?.lockPct ?? 0}%</span>
        </div>}
        bgContent={<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 6px', fontFamily: 'monospace', fontSize: 12 }}>
          <span style={{ color: '#4ade80' }}>LOCK:{pad(bg?.decisions?.lock ?? 0, 4)}</span>
          <span style={{ color: '#60a5fa' }}>RATE:{pad(bg?.decisions?.rate ?? 0, 4)}</span>
          <span style={{ color: '#f87171' }}>HARD:{pad(bg?.decisions?.hard ?? 0, 4)}</span>
          <span style={{ color: '#888' }}>NOOP:{pad(bg?.decisions?.noop ?? 0, 4)}</span>
          <span style={{ color: '#fb923c' }}>FUTL:{pad(bg?.decisions?.futile ?? 0, 4)}</span>
          <span style={{ color: '#555', gridColumn: '1 / -1' }}>Lock%:{bg?.decisions?.lockPct ?? 0}%</span>
        </div>}
      />

      <div style={S.section}>
        <div style={S.sectionTitle}>EXECUTED SEEKS</div>
        {['mv', 'bg'].map(eng => {
          const st = eng === 'mv' ? mv?.seekTelemetry : bg?.seekTelemetry;
          const hard = st?.hard;
          const hardLabel = hard?.count > 0
            ? `${hard.count}${hard.superseded > 0 ? ` (${hard.effective} eff, ${hard.superseded} sup)` : ''} ${hard.avgDrift}ms${hard.recovery ? ` ~${hard.recovery.p50Ms}ms` : ''}`
            : '0';
          return <Row key={eng} label={eng.toUpperCase()} value={`Hard: ${hardLabel}`} />;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>PIPELINE</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
          <span style={{ color: '#666' }}>Recording</span>
          <span style={{ color: _recordingStateRef.enabled ? '#4ade80' : '#555', marginLeft: 8 }}>
            {_recordingStateRef.enabled ? 'ON' : 'OFF'}
          </span>
          <span style={{ color: '#666', marginLeft: 12 }}>Buffer</span>
          <span style={{ color: '#bbb', marginLeft: 4 }}>
            {_recordingStateRef.bufferLength ?? 0} / {_recordingStateRef.maxBuffer ?? 0}
          </span>
        </div>
        {['mv', 'bg'].map(eng => {
          const evidences = eng === 'mv' ? _analyzerEvidenceRef.mv : _analyzerEvidenceRef.bg;
          const decision = eng === 'mv' ? _decisionOutputRef.mv : _decisionOutputRef.bg;
          return <div key={eng} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()} ANALYZERS</div>
            {evidences?.length ? evidences.map((ev, i) => (
              <div key={i} style={{ fontSize: 10, color: '#bbb', display: 'flex', gap: 4, alignItems: 'center', marginBottom: 1 }}>
                <span style={{ color: '#666', width: 80 }}>{ev.analyzerId}</span>
                <span style={{ color: ev.confidence >= 0.7 ? '#4ade80' : ev.confidence >= 0.4 ? '#facc15' : '#f87171', width: 40, textAlign: 'right' }}>
                  {Math.round(ev.confidence * 100)}%
                </span>
                <span style={{ color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.reason}>
                  {ev.reasonCode ? `${ev.reasonCode}:` : ''} {ev.reason?.slice(0, 50)}
                </span>
              </div>
            )) : <div style={{ fontSize: 10, color: '#555' }}>no analyzer evidence</div>}
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginTop: 3, marginBottom: 1 }}>{eng.toUpperCase()} JUDGE</div>
            {decision ? (
              <div style={{ fontSize: 10, color: '#bbb', display: 'flex', gap: 4, alignItems: 'center', marginBottom: 1 }}>
                <span style={{ color: '#666', width: 50 }}>Action</span>
                <span style={{ color: decision.actionRequest?.type === 'hardSeek' ? '#f87171' : decision.actionRequest?.type === 'hold' ? '#888' : '#4ade80', width: 60 }}>
                  {decision.actionRequest?.type?.toUpperCase() || '—'}
                </span>
                <span style={{ color: '#666', width: 40 }}>Conf</span>
                <span style={{ color: '#bbb', width: 30, textAlign: 'right' }}>
                  {Math.round((decision.decisionConfidence || 0) * 100)}%
                </span>
              </div>
            ) : <div style={{ fontSize: 10, color: '#555' }}>no decision yet</div>}
          </div>;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>CONFIDENCE</div>
        {['mv', 'bg'].map(eng => {
          const st = eng === 'mv' ? mv : bg;
          const blocked = st?.confidenceBlockedBy ?? 'decoder';
          const opConf = (st?.compositeConfidence ?? 0) / 30 * 100;
          const biasConf = (st?.biasConfidence ?? 0) / 10 * 100;
          const blockedLabel = blocked ? blocked.charAt(0).toUpperCase() + blocked.slice(1) : '—';
          const pct = (v) => Math.round(((v ?? 0) / 30) * 100);
          const biasPct = (v) => Math.round(((v ?? 0) / 10) * 100);
          const confColor = (v) => v >= 70 ? '#4ade80' : v >= 40 ? '#facc15' : '#f87171';
          return <div key={eng} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()}</div>
            <Row label="Op" value={`${Math.round(opConf)}% [${blockedLabel}]`} valueColor={confColor(opConf)} />
            <Row label="Bias" value={`${biasPct(st?.biasConfidence)}%`} valueColor={biasConf >= 80 ? '#4ade80' : biasConf >= 40 ? '#facc15' : '#f87171'} />
            <Row label="Decoder" value={`${pct(st?.decoderConfidence)}%`} valueColor={confColor(pct(st?.decoderConfidence))} />
            <Row label="Render" value={`${pct(st?.renderConfidence)}%`} valueColor={confColor(pct(st?.renderConfidence))} />
            <Row label="Scheduler" value={`${pct(st?.schedulerConfidence)}%`} valueColor={confColor(pct(st?.schedulerConfidence))} />
            <Row label="Clock" value={`${pct(st?.clockConfidence)}%`} valueColor={confColor(pct(st?.clockConfidence))} />
          </div>;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>HEALTH</div>
        <Row label="Lock" value={`${mv?.decisions?.lock ?? 0}/${bg?.decisions?.lock ?? 0} (${mv?.decisions?.lockPct ?? 0}%)`} />
        <Row label="Stall" value={String((mv?.schedulerStallCount ?? 0) + (bg?.schedulerStallCount ?? 0))} valueColor={((mv?.schedulerStallCount ?? 0) + (bg?.schedulerStallCount ?? 0)) > 0 ? '#f87171' : '#4ade80'} />
        <Row label="CPU" value={`${(mvState?.cpuOverloaded || bgState?.cpuOverloaded) ? 'ON' : 'OFF'} (${(mv?.cpuOverloadCount ?? 0) + (bg?.cpuOverloadCount ?? 0)})`} valueColor={(mvState?.cpuOverloaded || bgState?.cpuOverloaded) ? '#f87171' : '#4ade80'} />
        <Row label="Tick Miss" value={totalTick > 0 ? `${totalMiss} / ${totalTick} (${missPct}%)` : '0 / 0'} valueColor={healthColor(missPct)} />
        <Row label="Futile" value={String((mv?.decisions?.futile ?? 0) + (bg?.decisions?.futile ?? 0))} valueColor={((mv?.decisions?.futile ?? 0) + (bg?.decisions?.futile ?? 0)) > 0 ? '#fb923c' : '#4ade80'} />
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>RE-STABILITY</div>
        {['mv', 'bg'].map(eng => {
          const s = eng === 'mv' ? mvReStab : bgReStab;
          const cur = s?.current;
          const last = s?.events?.slice(-1)[0];
          return <div key={eng} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()}</div>
            <Row label="Trigger" value={cur?.trigger ?? '—'} />
            <Row label="Age" value={cur?.startTime ? `${fmtMs(performance.now() - cur.startTime)}ms` : '—'} valueColor={(cur?.disruptions?.length ?? 0) > 0 ? '#facc15' : '#bbb'} />
            <Row label="Disrupts" value={String(cur?.disruptions?.length ?? 0)} valueColor={(cur?.disruptions?.length ?? 0) > 0 ? '#f87171' : '#4ade80'} />
            <Row label="Total" value={String(s?.total ?? 0)} />
            <Row label="Last" value={last ? `${last.trigger} ${fmtMs(last.windowDuration)}ms ${last.gateOpened ? 'OPEN' : 'FAIL'}${last.timeToGateOpen != null ? ` (${fmtMs(last.timeToGateOpen)}ms)` : ''}` : '—'} />
          </div>;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>CLOCK PROVENANCE</div>
        {['mv', 'bg'].map(eng => {
          const ring = eng === 'mv' ? mvClockProv?.ring : bgClockProv?.ring;
          const entries = ring?.length ? ring.slice(-6).reverse() : [];
          return <div key={eng} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()} ({ring?.length ?? 0}/7)</div>
            {entries.length ? entries.map((s, i) => {
              const aD = s.audioDeltaMs != null ? `${s.audioDeltaMs >= 0 ? '+' : ''}${s.audioDeltaMs.toFixed(0)}` : '—';
              const vD = s.videoDeltaMs != null ? `${s.videoDeltaMs >= 0 ? '+' : ''}${s.videoDeltaMs.toFixed(0)}` : '—';
              const pD = s.perfDeltaMs != null ? `${s.perfDeltaMs.toFixed(0)}` : '—';
              return <div key={i} style={{ fontSize: 11, color: '#bbb', display: 'flex', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: '#666', width: 36 }}>{i === 0 ? 'now' : `-${i*30}ms`}</span>
                <span style={{ width: 52, textAlign: 'right', color: s.audioDeltaMs != null && Math.abs(s.audioDeltaMs) > 30 ? '#f87171' : '#bbb' }} title="audioDeltaMs">{aD}ms</span>
                <span style={{ width: 52, textAlign: 'right', color: s.videoDeltaMs != null && Math.abs(s.videoDeltaMs) > 30 ? '#facc15' : '#bbb' }} title="videoDeltaMs">{vD}ms</span>
                <span style={{ width: 36, textAlign: 'right', color: s.perfDeltaMs != null && s.perfDeltaMs > 50 ? '#f87171' : '#bbb' }} title="perfDeltaMs">{pD}ms</span>
              </div>;
            }) : <div style={{ fontSize: 11, color: '#555' }}>waiting for ticks…</div>}
          </div>;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>SPIKE RECORDER</div>
        {['mv', 'bg'].map(eng => {
          const spikes = eng === 'mv' ? mvSpikes : bgSpikes;
          return <div key={eng} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()}</div>
            {spikes.length ? spikes.map((sp) => {
              const c = sp.attribution?.cause ?? 'UNKNOWN';
              const badgeColor = c === 'SEEK_COMPLETE' ? '#4ade80' :
                c === 'SEEK_LATENCY' ? '#f97316' :
                c === 'SCHEDULER' ? '#f87171' :
                c === 'DECODER' ? '#facc15' :
                c === 'CLOCK_AUDIO' ? '#60a5fa' :
                c === 'CLOCK_VIDEO' ? '#fbbf24' :
                c === 'CLOCK_BOTH' ? '#c084fc' :
                c === 'RVFC_LOST' ? '#fb923c' : '#888';
              const relT = typeof performance !== 'undefined' && performance.timeOrigin
                ? new Date(performance.timeOrigin + sp.t).toLocaleTimeString()
                : `+${(sp.t/1000).toFixed(1)}s`;
              return <div key={sp.id} style={{ fontSize: 11, color: '#bbb', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 1 }}>
                <span style={{ color: '#666', fontVariantNumeric: 'tabular-nums', width: 72 }}>{relT}</span>
                <span style={{ color: driftColor(sp.rawDriftMs), fontVariantNumeric: 'tabular-nums', width: 60, textAlign: 'right' }}>{fmtMs(sp.rawDriftMs)}ms</span>
                <span style={{ color: badgeColor, fontWeight: 600 }}>{c}</span>
                <span style={{ color: '#666', fontSize: 10 }}>{sp.attribution?.confidence ?? 0}%</span>
              </div>;
            }) : <div style={{ fontSize: 11, color: '#555' }}>no spikes yet</div>}
          </div>;
        })}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>SEEK PIPELINE</div>
        {['mv', 'bg'].map(eng => {
          const pipes = eng === 'mv' ? mvSeekPipeline : bgSeekPipeline;
          const last = pipes?.slice(-1)[0];
          return <div key={eng} style={{ marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()}</div>
            {last ? <>
              <Row label="Seek→Seeked" value={`${fmtMs(last.seekStartToSeeked)}ms`} valueColor={last.seekStartToSeeked > 50 ? '#f87171' : '#4ade80'} />
              <Row label="Seek→FirstFrame" value={`${fmtMs(last.seekToFirstFrameMs)}ms`} valueColor={last.seekToFirstFrameMs == null ? '#555' : (last.seekToFirstFrameMs > 100 ? '#f87171' : '#facc15')} />
              <Row label="FirstFrame→DecodeStable" value={`${fmtMs(last.decodeStableMs)}ms`} valueColor={last.decodeStableMs == null ? '#555' : (last.decodeStableMs > 300 ? '#f87171' : '#facc15')} />
              <Row label="Seeked→Stable" value={`${fmtMs(last.seekedToStable)}ms`} valueColor={last.seekedToStable > 50 ? '#f87171' : '#bbb'} />
              <Row label="Total" value={`${fmtMs(last.totalToStable)}ms`} valueColor={last.totalToStable > 100 ? '#f87171' : '#bbb'} />
              <Row label="Audio advance" value={`${fmtMs(last.audioAdvance)}ms`} valueColor={last.audioAdvance > 50 ? '#facc15' : '#bbb'} />
              <Row label="Type" value={last.seekType} />
            </> : <div style={{ fontSize: 11, color: '#555' }}>no seeks recorded</div>}
          </div>;
        })}
      </div>

       <div style={S.section}>
         <div style={S.sectionTitle}>DECODE LIFECYCLE</div>
         {['mv', 'bg'].map(eng => {
           const summary = eng === 'mv' ? mvLifecycle : bgLifecycle;
           const events = eng === 'mv' ? mvLifecycleEvents : bgLifecycleEvents;
           const lastLoad = events.filter(e => e.type === 'loadstart').slice(-1)[0];
           const lastCanPlay = events.filter(e => e.type === 'canplay').slice(-1)[0];
           const lastPlaying = events.filter(e => e.type === 'playing').slice(-1)[0];
           const lastWaiting = events.filter(e => e.type === 'waiting').slice(-1)[0];
           const loadToCanPlay = lastLoad && lastCanPlay ? lastCanPlay.t - lastLoad.t : null;
           const loadToPlaying = lastLoad && lastPlaying ? lastPlaying.t - lastLoad.t : null;
           return <div key={eng} style={{ marginBottom: 2 }}>
             <div style={{ fontSize: 11, color: '#a78bfa', letterSpacing: 1, marginBottom: 1 }}>{eng.toUpperCase()}</div>
              <Row label="Src" value={summary?.currentSrc ? summary.currentSrc.slice(-30) : '—'} />
              <Row label="SrcChanges" value={String(summary?.sourceSetCount ?? 0)} />
              <Row label="Remounts" value={String(summary?.remountCount ?? 0)} valueColor={(_videoRemountCountRef ?? 0) > 0 ? '#facc15' : '#4ade80'} />
              <Row label="Watchdog" value={String(_videoRemountCountRef ?? 0)} valueColor={(_videoRemountCountRef ?? 0) > 0 ? '#facc15' : '#555'} />
              <Row label="Loads" value={String(summary?.loadCount ?? 0)} />
             <Row label="Load→CanPlay" value={loadToCanPlay != null ? `${fmtMs(loadToCanPlay)}ms` : '—'} valueColor={loadToCanPlay != null && loadToCanPlay > 500 ? '#facc15' : '#bbb'} />
             <Row label="Load→Playing" value={loadToPlaying != null ? `${fmtMs(loadToPlaying)}ms` : '—'} valueColor={loadToPlaying != null && loadToPlaying > 1000 ? '#facc15' : '#bbb'} />
             <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>Events: {summary?.totalEvents ?? 0} total</div>
             <div style={{ fontSize: 10, color: '#888', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
               {Object.entries(summary?.eventsByType ?? {}).map(([type, count]) => (
                 <span key={type} style={{ color: count > 5 ? '#facc15' : '#888' }}>{type}:{count}</span>
               ))}
             </div>
              {events.length > 0 && <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>
                Last: {events.slice(-5).reverse().map(e => {
                  const rel = typeof performance !== 'undefined' && performance.timeOrigin
                    ? new Date(performance.timeOrigin + e.t).toLocaleTimeString()
                    : `+${(e.t/1000).toFixed(1)}s`;
                  return `${e.type}@${rel}`;
                }).join(' ')}
              </div>}
            </div>;
          })}
        </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>DISTRIBUTION</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><HistogramDisplay histogram={mv?.histogram} /></div>
          <div style={{ flex: 1 }}><HistogramDisplay histogram={bg?.histogram} /></div>
        </div>
        <div style={{ ...S.sectionTitle, marginTop: 6 }}>DRIFT GRAPH</div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ marginBottom: 2 }}>
            <span style={{ color: '#888', fontSize: 12 }}>MV </span>
            <DriftGraph history={driftHistoryMv} />
          </div>
          <div>
            <span style={{ color: '#888', fontSize: 12 }}>BG </span>
            <DriftGraph history={driftHistoryBg} />
          </div>
        </div>
      </div>

      {(function() {
        const replay = _replayStateRef.current || _replayStateRef;
        if (!replay || !replay.active) return null;
        return (
          <div style={S.section}>
            <div style={{ ...S.sectionTitle, color: '#facc15' }}>REPLAY</div>
            <Row label="Status" value={replay.complete ? 'COMPLETE' : 'RUNNING'} valueColor={replay.complete ? '#4ade80' : '#facc15'} />
            <Row label="Frame" value={`${replay.frameIndex} / ${replay.totalFrames}`} />
            {replay.lastFrame && (
              <>
                <Row label="Engine" value={replay.lastFrame.engine || '—'} />
                <Row label="Decision" value={replay.lastFrame.decision?.actionRequest?.type || '—'} />
                <Row label="Confidence" value={`${Math.round(replay.lastFrame.decision?.decisionConfidence || 0)}%`} />
              </>
            )}
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Run: window.__SYNC_REPLAY_ASYNC__() &nbsp;|&nbsp; Stop: window.__SYNC_REPLAY_STOP__()
            </div>
          </div>
        );
      })()}
    </div>
  );
});

const S = {
  container: {
    position: 'fixed', top: 12, right: 12, zIndex: 99999,
    background: 'rgba(0, 0, 0, 0.92)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13,
    color: '#e5e5e5', width: 480, maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto', pointerEvents: 'auto', userSelect: 'text',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 14, fontWeight: 700, letterSpacing: 2, color: '#a78bfa',
    marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 5,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer',
    padding: '0 6px', lineHeight: 1, borderRadius: 4,
  },
  timeRow: {
    display: 'flex', gap: 12, fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
    padding: '4px 0', marginBottom: 4, letterSpacing: 0.5,
  },
  section: { marginBottom: 3, paddingTop: 3, borderTop: '1px solid rgba(255,255,255,0.06)' },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#a78bfa', letterSpacing: 1,
    marginBottom: 2, padding: '2px 6px', background: 'rgba(167,139,250,0.08)',
    borderRadius: 3, textTransform: 'uppercase',
  },
  sectionLabel: {
    fontSize: 10, fontWeight: 600, color: '#666', letterSpacing: 0.5,
    marginTop: 2, marginBottom: 1, paddingLeft: 2,
  },
  card: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 5, padding: '3px 6px',
  },
  cardLabel: {
    fontSize: 10, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 1,
  },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    lineHeight: 1.3, gap: 6,
  },
  label: { color: '#888', fontSize: 13, flexShrink: 0 },
  value: { fontVariantNumeric: 'tabular-nums', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' },
};

export default SyncOverlay;
