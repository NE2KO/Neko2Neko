import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, Heart, Activity } from 'lucide-react';
import CachedVideoPlayer from './CachedVideoPlayer';
import { createVideoSyncEngine } from './Music';

const ENGINE_PRESETS = {
  minimal: {
    label: 'Minimal',
    description: 'Seek only, no rate, no stall handling',
    config: {
      pauseOnStall: false,
      hardSeekThreshold: 0.3,
      softSeekThreshold: null,
      rateMin: 0,
      rateGain: 0,
      rateMax: 0,
      gracePeriod: 0,
      stallTimeout: 2000,
      seekCooldown: 500,
      adaptiveThreshold: false,
      biasEnabled: false,
      playbackRateEnabled: false,
    },
  },
  graceOnly: {
    label: 'Grace Only',
    description: 'Hardseek + 3s grace period, no stall pause',
    config: {
      pauseOnStall: false,
      hardSeekThreshold: 0.3,
      softSeekThreshold: null,
      rateMin: 0,
      rateGain: 0,
      rateMax: 0,
      gracePeriod: 10,
      stallTimeout: 2000,
      seekCooldown: 500,
      adaptiveThreshold: false,
      biasEnabled: false,
      playbackRateEnabled: false,
    },
  },
  stallRecovery: {
    label: 'Stall Recovery',
    description: 'Pause on stall + recovery',
    config: {
      pauseOnStall: true,
      hardSeekThreshold: 0.3,
      softSeekThreshold: null,
      rateMin: 0,
      rateGain: 0,
      rateMax: 0,
      gracePeriod: 10,
      stallTimeout: 2000,
      seekCooldown: 500,
      adaptiveThreshold: false,
      biasEnabled: false,
      playbackRateEnabled: false,
    },
  },
  rateAdjust: {
    label: 'Rate Adjust',
    description: 'Stall recovery + rate adjustment',
    config: {
      pauseOnStall: true,
      hardSeekThreshold: 0.3,
      softSeekThreshold: 0.030,
      rateMin: 0.003,
      rateGain: 0.15,
      rateMax: 0.03,
      gracePeriod: 10,
      stallTimeout: 2000,
      seekCooldown: 500,
      adaptiveThreshold: false,
      biasEnabled: true,
      playbackRateEnabled: true,
    },
  },
  production: {
    label: 'Production',
    description: 'Full engine (current production)',
    config: {
      pauseOnStall: true,
      hardSeekThreshold: 0.3,
      softSeekThreshold: 0.030,
      rateMin: 0.003,
      rateGain: 0.15,
      rateMax: 0.03,
      gracePeriod: 10,
      stallTimeout: 2000,
      seekCooldown: 500,
      adaptiveThreshold: true,
      biasEnabled: true,
      playbackRateEnabled: true,
    },
  },
};

export default function MusicSyncSandbox({ file, onClose }) {
  const [enginePreset, setEnginePreset] = useState('production');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [engineState, setEngineState] = useState(null);
  const [events, setEvents] = useState([]);
  const [drift, setDrift] = useState(0);
  const [mode, setMode] = useState('IDLE');
  const [seekPending, setSeekPending] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [lastHardSeekTime, setLastHardSeekTime] = useState(0);
  const [playRetryPending, setPlayRetryPending] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const engineRef = useRef(null);
  const eventsRef = useRef([]);
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);

  const preset = ENGINE_PRESETS[enginePreset] || ENGINE_PRESETS.production;
  const cfg = preset.config;

  const addEvent = useCallback((type, detail = '') => {
    const now = performance.now();
    const ts = new Date(now).toLocaleTimeString();
    eventsRef.current = [...eventsRef.current.slice(-200), { ts, type, detail }];
    setEvents([...eventsRef.current]);
  }, []);

  // Build engine with selected preset
  useEffect(() => {
    if (!videoRef.current || !audioRef.current) return;

    const engine = createVideoSyncEngine({
      getCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
      getDuration: () => videoRef.current?.getDuration?.() ?? Infinity,
      getPaused: () => videoRef.current?.getPaused?.() ?? true,
      getSeeking: () => videoRef.current?.getSeeking?.() ?? false,
      getReadyState: () => videoRef.current?.getReadyState?.() ?? 0,
      seek: (t) => {
        const video = videoRef.current;
        if (!video) return;
        const current = video.getCurrentTime?.() ?? 0;
        if (Math.abs(current - t) > 0.3 && !video.paused) {
          video.pauseVideo?.();
        }
        videoRef.current?.forceSeek?.(t);
      },
      play: () => {
        addEvent('play', 'requested');
        return Promise.resolve(videoRef.current?.playVideo?.());
      },
      pause: () => {
        addEvent('pause', 'requested');
        videoRef.current?.pauseVideo?.();
        return Promise.resolve();
      },
      setRate: (r) => {
        addEvent('rate', r.toFixed(3));
        videoRef.current?.setRate?.(r);
      },
      getIsPlaying: () => isPlaying,
      looping: false,
      hardSeekThreshold: cfg.hardSeekThreshold,
      jumpSeekThreshold: 1.0,
      seekCooldown: cfg.seekCooldown,
      stallTimeout: cfg.stallTimeout,
      gracePeriod: cfg.gracePeriod,
      pauseIfFarFromTarget: false,
      farThreshold: 0.5,
      rateMin: cfg.rateMin || 0.003,
      rateGain: cfg.rateGain || 0.15,
      rateMax: cfg.rateMax || 0.03,
      pauseOnStall: cfg.pauseOnStall,
      adaptiveThreshold: cfg.adaptiveThreshold,
      getAdaptiveThresholds: null,
      syncCore: null,
      engineName: 'sandbox',
      softSeekPendingMs: 100,
      rateCooldownMs: 400,
      biasEnabled: cfg.biasEnabled,
      playbackRateEnabled: cfg.playbackRateEnabled,
      stableStdDevThreshold: 12,
      stableConsecutiveTicks: 3,
      stableMinElapsedMs: 250,
      getNetworkState: () => videoRef.current?.networkState || 0,
      getWaiting: () => videoRef.current?.waiting || false,
      getStalled: () => videoRef.current?.stalled || false,
      getRvfcStatus: () => 'UNKNOWN',
      getDroppedFrames: () => 0,
      getDecodeLatencyMs: () => 0,
      getAudioCurrentTime: () => audioRef.current?.currentTime || 0,
      getVideoPlaybackRate: () => videoRef.current?.playbackRate || 1,
      getBgPlaybackRate: () => 1,
      getVideoOffset: () => 0,
      getMvCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
      getBgCurrentTime: () => 0,
      getRvfcMvPresentationTime: () => undefined,
      getRvfcBgPresentationTime: () => undefined,
      getRvfcMvExpectedDisplayTime: () => undefined,
      getRvfcBgExpectedDisplayTime: () => undefined,
      getRvfcMvMediaTime: () => undefined,
      getRvfcBgMediaTime: () => undefined,
      log: (kind, engine, data) => {},
      seekStartTimeRef: { current: {} },
    });

    engineRef.current = engine;

    return () => {
      engineRef.current = null;
    };
  }, [enginePreset, cfg, isPlaying, addEvent]);

  // Wire video events to engine + local state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onWaiting = () => {
      addEvent('waiting', 'video waiting');
      engineRef.current?.onWaiting?.();
      syncState();
    };
    const onPlaying = () => {
      addEvent('playing', 'video playing');
      engineRef.current?.onPlaying?.();
      setIsPlaying(true);
      syncState();
    };
    const onPause = () => {
      addEvent('pause', 'video paused');
      engineRef.current?.onPause?.();
      setIsPlaying(false);
      syncState();
    };
    const onSeeked = () => {
      addEvent('seeked', `target=${video.currentTime?.toFixed(2)}`);
      engineRef.current?.onSeeked?.();
      syncState();
    };
    const onCanPlay = () => {
      addEvent('canplay', 'ready');
      engineRef.current?.onCanPlay?.();
      syncState();
    };
    const onStalled = () => {
      addEvent('stalled', 'video stalled');
      engineRef.current?.onStalled?.();
      syncState();
    };
    const onLoadedMetadata = () => {
      addEvent('loadedmetadata', `dur=${video.duration?.toFixed(2)}`);
      setDuration(video.duration || 0);
    };

    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [addEvent]);

  const syncState = useCallback(() => {
    if (!engineRef.current) return;
    const s = engineRef.current.state;
    setEngineState(s);
    setMode(s.mode || 'IDLE');
    setSeekPending(s.seekPending || false);
    setStalled(s.stalled || false);
    setLastHardSeekTime(s.lastHardSeekTime || 0);
    setPlayRetryPending(s.playRetryPending || false);
    setPendingPlay(s.pendingPlay || false);
  }, []);

  // Tick loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    let lastTick = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      const audioTarget = audioRef.current?.currentTime || 0;
      engineRef.current?.tick?.(audioTarget, dt);
      setCurrentTime(videoRef.current?.getCurrentTime?.() || 0);
      const s = engineRef.current?.state;
      if (s) {
        setMode(s.mode || 'IDLE');
        setSeekPending(s.seekPending || false);
        setStalled(s.stalled || false);
        setLastHardSeekTime(s.lastHardSeekTime || 0);
        setPlayRetryPending(s.playRetryPending || false);
        setPendingPlay(s.pendingPlay || false);
        const current = videoRef.current?.getCurrentTime?.() || 0;
        setDrift((current - audioTarget) * 1000);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      videoRef.current?.pauseVideo?.();
      audioRef.current?.pause();
    } else {
      videoRef.current?.playVideo?.();
      audioRef.current?.play?.().catch(() => {});
    }
  }, [isPlaying]);

  const handleSeek = useCallback((t) => {
    videoRef.current?.forceSeek?.(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }, []);

  const handleFileChange = useCallback((newFile) => {
    // In sandbox, file changes reload the engine
    if (engineRef.current) {
      engineRef.current.reset();
    }
    setEngineState(null);
    setEvents([]);
    eventsRef.current = [];
    setDrift(0);
    setMode('IDLE');
    setSeekPending(false);
    setStalled(false);
    setLastHardSeekTime(0);
    setPlayRetryPending(false);
    setPendingPlay(false);
  }, []);

  return (
    <div className="flex flex-col h-full bg-black text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 rounded hover:bg-neutral-800">
            <ChevronLeft size={18} />
          </button>
          <div>
            <div className="text-sm font-medium">Music Sync Sandbox</div>
            <div className="text-xs text-neutral-500">Engine: {preset.label} — {preset.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Object.keys(ENGINE_PRESETS).map((key) => (
            <button
              key={key}
              onClick={() => {
                if (engineRef.current) engineRef.current.reset();
                setEnginePreset(key);
                setEngineState(null);
                setEvents([]);
                eventsRef.current = [];
                setDrift(0);
                setMode('IDLE');
                setSeekPending(false);
                setStalled(false);
                setLastHardSeekTime(0);
                setPlayRetryPending(false);
                setPendingPlay(false);
              }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                enginePreset === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
            >
              {ENGINE_PRESETS[key].label}
            </button>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 flex items-center justify-center bg-neutral-950 relative">
            {file && (
              <CachedVideoPlayer
                ref={videoRef}
                youtubeId={null}
                coverUrl={file.coverUrl || file.thumbnail}
                onReady={() => addEvent('ready', 'video ready')}
                onWaiting={() => {}}
                onPlaying={() => {}}
                onStalled={() => {}}
                onSeeked={() => {}}
                onEnded={() => addEvent('ended', 'video ended')}
                onError={() => addEvent('error', 'video error')}
                onLoadedMetadata={() => {}}
                onPause={() => {}}
                onVideoFrame={() => {}}
              />
            )}
            {!file && (
              <div className="text-neutral-600 text-sm">Select a file to test</div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 px-4 py-3 bg-neutral-900 border-t border-neutral-800">
            <button onClick={handlePlayPause} className="p-2 rounded-full bg-white text-black">
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <div className="text-xs text-neutral-400 font-mono">
              {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
            </div>
            <div className="flex-1" />
            <div className="text-xs text-neutral-500">
              Drift: <span className={Math.abs(drift) > 500 ? 'text-red-400' : 'text-emerald-400'}>{drift.toFixed(0)}ms</span>
            </div>
          </div>
        </div>

        {/* Debug panel */}
        <div className="w-80 bg-neutral-900 border-l border-neutral-800 overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Engine State */}
            <div className="bg-neutral-800 rounded p-3">
              <div className="text-xs font-medium text-neutral-400 mb-2">ENGINE STATE</div>
              <div className="grid grid-cols-2 gap-1 text-xs font-mono">
                <div className="text-neutral-500">Mode</div>
                <div className={mode === 'RECOVERY' ? 'text-red-400' : 'text-emerald-400'}>{mode}</div>
                <div className="text-neutral-500">SeekPending</div>
                <div className={seekPending ? 'text-yellow-400' : 'text-neutral-300'}>{seekPending ? 'YES' : 'no'}</div>
                <div className="text-neutral-500">Stalled</div>
                <div className={stalled ? 'text-red-400' : 'text-neutral-300'}>{stalled ? 'YES' : 'no'}</div>
                <div className="text-neutral-500">PendingPlay</div>
                <div className="text-neutral-300">{pendingPlay ? 'YES' : 'no'}</div>
                <div className="text-neutral-500">PlayRetry</div>
                <div className="text-neutral-300">{playRetryPending ? 'YES' : 'no'}</div>
                <div className="text-neutral-500">LastHardSeek</div>
                <div className="text-neutral-300">{lastHardSeekTime ? `${((performance.now() - lastHardSeekTime) / 1000).toFixed(1)}s ago` : '—'}</div>
              </div>
            </div>

            {/* Config */}
            <div className="bg-neutral-800 rounded p-3">
              <div className="text-xs font-medium text-neutral-400 mb-2">CONFIG</div>
              <div className="grid grid-cols-2 gap-1 text-xs font-mono">
                <div className="text-neutral-500">pauseOnStall</div>
                <div className="text-neutral-300">{String(cfg.pauseOnStall)}</div>
                <div className="text-neutral-500">hardSeekThreshold</div>
                <div className="text-neutral-300">{cfg.hardSeekThreshold}s</div>
                <div className="text-neutral-500">softSeekThreshold</div>
                <div className="text-neutral-300">{cfg.softSeekThreshold != null ? `${(cfg.softSeekThreshold * 1000).toFixed(0)}ms` : 'off'}</div>
                <div className="text-neutral-500">gracePeriod</div>
                <div className="text-neutral-300">{cfg.gracePeriod}s</div>
                <div className="text-neutral-500">stallTimeout</div>
                <div className="text-neutral-300">{cfg.stallTimeout}ms</div>
                <div className="text-neutral-500">rateMax</div>
                <div className="text-neutral-300">{cfg.rateMax != null ? `±${(cfg.rateMax * 100).toFixed(1)}%` : 'off'}</div>
                <div className="text-neutral-500">adaptiveThreshold</div>
                <div className="text-neutral-300">{String(cfg.adaptiveThreshold)}</div>
                <div className="text-neutral-500">biasEnabled</div>
                <div className="text-neutral-300">{String(cfg.biasEnabled)}</div>
              </div>
            </div>

            {/* Events log */}
            <div className="bg-neutral-800 rounded p-3">
              <div className="text-xs font-medium text-neutral-400 mb-2">EVENTS</div>
              <div className="space-y-0.5 max-h-64 overflow-y-auto font-mono text-xs">
                {events.length === 0 && <div className="text-neutral-600">No events yet</div>}
                {events.slice().reverse().map((ev, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-neutral-600">{ev.ts.split(' ')[1]}</span>
                    <span className={`${
                      ev.type === 'waiting' ? 'text-yellow-400' :
                      ev.type === 'seeked' ? 'text-blue-400' :
                      ev.type === 'playing' ? 'text-emerald-400' :
                      ev.type === 'pause' ? 'text-red-400' :
                      ev.type === 'canplay' ? 'text-purple-400' :
                      ev.type === 'stalled' ? 'text-orange-400' :
                      'text-neutral-300'
                    }`}>{ev.type}</span>
                    <span className="text-neutral-500">{ev.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
