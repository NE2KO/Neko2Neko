import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, Minimize2, ListMusic, Heart, ChevronUp, ChevronDown, Ban, RotateCw, Trash2 } from 'lucide-react';
import MediaControls from './MediaControls';
import Carousel from './Carousel';
import QueuePanel from './QueuePanel';
import LyricsDisplay from './LyricsDisplay';
import MetadataEditor from './MetadataEditor';
import CachedVideoPlayer from './CachedVideoPlayer';
import NetworkImage from './NetworkImage';
import SpeakerOutputButton from './SpeakerOutputButton';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import { cancelSendQueueItem, retrySendQueueItem, removeSendQueueItem } from '../utils/api';

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
  const bgPendingForceSeekRef = useRef(null);
  const lastAppliedSinkIdRef = useRef(null);
  const lastResumeTargetRef = useRef(null);
  const lastResumeTimeRef = useRef(0);
  const [useBgEngine, setUseBgEngine] = useState(() => {
    try { return localStorage.getItem('mv_bg_engine') === '1'; } catch { return false; }
  });

  const syncLogRef = useRef({
    enabled: false,
    sessionId: null,
    startTime: 0,
    seekStartTime: null,
    buffer: [],
    maxBuffer: 20000,
    summary: null,
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
    if (['hard_seek', 'soft_seek', 'stall', 'large_drift', 'error'].includes(kind)) {
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

    return {
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
    pauseOnStall = true,
  }) {
    function circularDiff(a, b, duration) {
        if (!duration || !isFinite(duration) || duration <= 0) return a - b;
        let diff = a - b;
        diff = diff % duration;
        if (diff > duration / 2) diff -= duration;
        if (diff < -duration / 2) diff += duration;
        return diff;
    }

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
        mode: 'IDLE',
    };

    function resolveTarget(raw) {
        const dur = getDuration();
        if (looping && isFinite(dur) && dur > 0) {
            return ((raw % dur) + dur) % dur;
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
        syncLog('rate_change', looping ? 'bg' : 'mv', { from: prevRate, to: rate });
      }
    }

    return {
        state,

        reset() {
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
            });
        },

        anchor({ play = false, target: rawTarget } = {}) {
            const current = getCurrentTime();
            const dur = getDuration();
            const playing = getIsPlaying();
            const t = resolveTarget(rawTarget);
            syncLog('anchor', looping ? 'bg' : 'mv', { play, target: t.toFixed(3), current: current.toFixed(3), duration: dur.toFixed(3), didSeek: Math.abs(current - t) >= 0.05 });

            if (state.seekPending && state.lastAnchorTarget != null) {
                const pending = state.lastAnchorTarget;
                const delta = Math.abs(pending - t);
                if (delta < 0.5) {
                    // Small change: coalesce — just update target, keep current seek in flight.
                    if (play) state.pendingPlay = true;
                    state.lastAnchorTarget = t;
                    state.lastAnchorTime = Date.now();
                    return;
                }
                // Large change (e.g. rapid skip/seek): force new seek immediately
                // instead of queuing. Abandon the in-flight seek and re-anchor.
                syncLog('anchor_replace', looping ? 'bg' : 'mv', {
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
                if (!syncLogRef.current.seekStartTime) syncLogRef.current.seekStartTime = {};
                syncLogRef.current.seekStartTime[looping ? 'bg' : 'mv'] = performance.now();
                seek(t);
                if (!getSeeking() && Math.abs(getCurrentTime() - current) < 0.05) {
                    state.seekPending = false;
                    state.softSeekPendingSince = 0;
                    if (play) {
                        state.pendingPlay = false;
                        playFn().catch(() => {});
                        syncLog('play', looping ? 'bg' : 'mv', { kind: 'noopSeek' });
                    }
                } else {
                    state.seekPending = true;
                    state.softSeekPendingSince = 0;
                    state.lastAnchorTarget = t;
                    state.lastAnchorTime = Date.now();
                    state.pendingAnchorTarget = null;
                    if (play) {
                        state.pendingPlay = true;
                        syncLog('play', looping ? 'bg' : 'mv', { kind: 'deferred' });
                    }
                }
            } else {
                state.seekPending = false;
                state.softSeekPendingSince = 0;
                if (play && playing) {
                    playFn().catch(() => {});
                    syncLog('play', looping ? 'bg' : 'mv', { kind: 'noseek' });
                }
            }

            state.rate = 1;
            state.lastSync = 0;
            state.lastSeekTime = Date.now();
            state.graceUntil = Date.now() + gracePeriod;
            state.mode = 'RECOVERY';
            try { setRate(1); } catch (_) {}
        },

        tick(audioTarget) {
            const now = Date.now();
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
                return;
            }
            if (getPaused()) {
                if (!state.seekPending) {
                    playFn().catch(() => {});
                }
                // Mark as stalled so engine doesn't silently skip ticks
                if (!state.stalled) {
                    state.stalled = true;
                    state.stalledSince = Date.now();
                }
                return;
            }
            if (getSeeking()) {
                return;
            }
            if (getReadyState() < 3) {
                // Video metadata not loaded yet — keep trying to play
                if (!state.seekPending) {
                    playFn().catch(() => {});
                }
                return;
            }

            // Watchdog: if a seek is stuck for >2 s (no seeked/onPlaying),
            // clear it so the engine can resume normal sync instead of
            // freezing the video mid-track.
            if (state.seekPending && now - state.lastAnchorTime > 2000) {
                state.seekPending = false;
                state.softSeekPendingSince = 0;
                state.pendingAnchorTarget = null;
                state.pendingPlay = false;
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

            // === STATE MACHINE: soft-seek based ===
            // Instead of PID (which depends on playbackRate — unreliable during
            // buffering), directly set video.currentTime for small drifts.
            // Soft seek = instant correction in 1 tick (30ms), no oscillation.
            if (state.mode === 'IDLE' || state.mode === 'LOCKED' || state.mode === 'GRACE' || state.mode === 'RECOVERY') {
                // Hard seek for large drift / track boundary jump (anchor = pause + seek + play).
                if (adrift > hardSeekThreshold && now - state.lastSeekTime > seekCooldown) {
                    syncLog('hard_seek', looping ? 'bg' : 'mv', {
                      drift: Math.round(adrift * 1000),
                      target: Math.round(target * 1000),
                      current: Math.round(current * 1000),
                    });
                    this.anchor({ play: true, target: audioTarget });
                    state.mode = 'RECOVERY';
                    state.lastSync = now;
                    return;
                }
                // Hard seek for massive drift regardless of cooldown.
                if (adrift > jumpSeekThreshold) {
                    syncLog('hard_seek', looping ? 'bg' : 'mv', {
                      drift: Math.round(adrift * 1000),
                      target: Math.round(target * 1000),
                      current: Math.round(current * 1000),
                    });
                    this.anchor({ play: true, target: audioTarget });
                    state.mode = 'RECOVERY';
                    state.lastSync = now;
                    return;
                }
                // Soft seek for drift 30ms–300ms: set currentTime directly.
                // Drift < 30ms is imperceptible (≤1 frame @30fps) and cannot
                // be corrected by soft-seek because browser seek latency
                // (~20ms) means the video is always chasing a moving target.
                // After setting currentTime, mark seekPending so subsequent
                // ticks are skipped until the browser fires `seeked` (or a
                // 100 ms safety timeout clears it). Grace period is set to
                // 60 ms (2 ticks) to avoid re-firing during seek processing.
                if (adrift > 0.030) {
                    if (adrift > 0.050) {
                      syncLog('soft_seek', looping ? 'bg' : 'mv', {
                        drift: Math.round(drift * 1000),
                        target: Math.round(target * 1000),
                        current: Math.round(current * 1000),
                      });
                    }
                    seek(target);
                    state.mode = 'LOCKED';
                    state.rate = 1;
                    state.seekPending = true;
                    state.softSeekPendingSince = now;
                    state.lastAnchorTime = now;
                    state.graceUntil = now + 60;
                    state.lastSync = now;
                    return;
                }
                // Drift < 3ms: locked, no correction needed.
                state.mode = 'LOCKED';
                state.rate = 1;
            }
        },

        // Backward-compatible alias
        syncTick(audioTarget) {
            return this.tick(audioTarget);
        },

        onSeeked() {
            // Guard: if the other video is still mid-seek, leave seekPending alone
            // so we don't prematurely clear MV state while BG is wrapping.
            if (state.seekPending && getSeeking()) {
                syncLog('seeked', looping ? 'bg' : 'mv', { kind: 'skip', seeking: getSeeking() });
                return;
            }

            state.seekPending = false;
            state.softSeekPendingSince = 0;
            state.graceUntil = Date.now() + gracePeriod;
            state.playRetryPending = false;

            if (state.pendingAnchorTarget != null) {
                const t = state.pendingAnchorTarget;
                state.pendingAnchorTarget = null;
                const shouldPlay = state.pendingPlay;
                state.pendingPlay = false;
                syncLog('seeked', looping ? 'bg' : 'mv', { kind: 'reanchor', target: t.toFixed(3), shouldPlay });
                this.anchor({ play: shouldPlay, target: t });
                return;
            }

            if (state.pendingPlay) {
                state.pendingPlay = false;
                state.playRetryPending = true;
                syncLog('seeked', looping ? 'bg' : 'mv', { kind: 'play' });
                playFn().catch(() => {});
            }

            if (state.stalled) {
                state.stalled = false;
                state.stalledSince = 0;
                playFn().catch(() => {});
            }
        },

        onPlaying() {
            const current = getCurrentTime();
            const dur = getDuration();

            // Guard: if the other video is still mid-seek, leave seekPending alone
            // so we don't prematurely clear MV state while BG is wrapping.
            if (state.seekPending && getSeeking()) {
                syncLog('playing', looping ? 'bg' : 'mv', { kind: 'skip', seeking: getSeeking() });
                return;
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
                syncLog('playing', looping ? 'bg' : 'mv', { kind: 'play' });
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
            state.stalledSince = Date.now();
            if (pauseOnStall) {
                state.stallPausedRef = true;
                pauseFn();
            }
            maybeSetRate(1);
        },

        onStalled() {
            state.stalled = true;
            state.stalledSince = Date.now();
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

// === ENGINE INSTANCES ===
// MV master PID sync engine (non-looping). Controls only the main MV.
const mvEngine = useMemo(() => createVideoSyncEngine({
    getCurrentTime: () => videoRef.current?.getCurrentTime?.() ?? 0,
    getDuration: () => videoRef.current?.getDuration?.() ?? Infinity,
    getPaused: () => videoRef.current?.getPaused?.() ?? false,
    getSeeking: () => videoRef.current?.getSeeking?.() ?? false,
    getReadyState: () => videoRef.current?.getReadyState?.() ?? 4,
    seek: (t) => { videoRef.current?.forceSeek?.(t); },
    play: () => Promise.resolve(videoRef.current?.playVideo?.()),
    pause: () => { videoRef.current?.pauseVideo?.(); return Promise.resolve(); },
    setRate: (r) => { videoRef.current?.setRate?.(r); },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: false,
    hardSeekThreshold: 0.3,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    seekCooldown: 500,
    stallTimeout: 2000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
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
        // No-op if already at target (avoid flash from redundant seek).
        // Threshold lowered from 50ms to 1ms so soft-seek corrections
        // (drift 3–50ms) are not silently dropped.
        if (gap < 0.001) {
            bgSeekInProgressRef.current = false;
            return;
        }
        // Coalesce rapid seeks: if a seek is already in flight, just
        // update the pending target so the latest target wins.
        if (bgSeekInProgressRef.current) {
            bgPendingForceSeekRef.current = target;
            return;
        }
        // Small seek (<300ms): set currentTime directly, no pause.
        // The frame jump is ≤300ms (≤9 frames @30fps) — imperceptible.
        // Skipping pause eliminates the ~200ms pause→play cycle delay.
        if (gap < 0.3) {
            bg.currentTime = target;
            bgSeekInProgressRef.current = true;
            return;
        }
        // Large seek (≥300ms): pause first to prevent browser from
        // stacking or cancelling seek operations mid-flight.
        if (!bg.paused) bg.pause();
        bg.currentTime = target;
        bgSeekInProgressRef.current = true;
    },
    play: () => Promise.resolve(bgVideoRef.current?.play?.()),
    pause: () => { bgVideoRef.current?.pause?.(); return Promise.resolve(); },
    setRate: (r) => {
        if (bgVideoRef.current) bgVideoRef.current.playbackRate = r;
    },
    getIsPlaying: () => usePlaybackStore.getState().isPlaying,
    looping: true,
    hardSeekThreshold: 0.3,
    jumpSeekThreshold: 1.0,
    rateMin: 0.003,
    seekCooldown: 500,
    stallTimeout: 1000,
    gracePeriod: 10,
    pauseIfFarFromTarget: false,
    farThreshold: 0.5,
    pauseOnStall: false,
}), []);

// === SYNC EFFECTS ===
// Audio lifecycle → MV and BG engine state machine
useEffect(() => {
    if (!audioReady) return;

    const onWaiting = () => {
        audioStalledRef.current = true;
        syncLog('waiting', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
    };
    const onResume = () => {
        const wasStalled = audioStalledRef.current;
        audioStalledRef.current = false;
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('playing', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        
        // Always anchor both engines on resume — eliminates startup delay.
        // Previous de-duplication logic could skip the anchor if the target
        // was "close enough" to the last resume, but this causes MV/BG to
        // remain frozen at their old position while audio advances.
        mvEngine.anchor({ play: true, target });
        if (youtubeId) {
            try { bgEngine.anchor({ play: true, target }); } catch (_) {}
        }
    };
    const onPause = () => {
        audioStalledRef.current = false;
        const target = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
        syncLog('pause', 'audio', { currentTime: Math.round(audioRef.current?.currentTime * 1000) });
        mvEngine.pause();
        bgEngine.pause();
        bgSeekInProgressRef.current = false;
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
            try { bgEngine.anchor({ play: true, target }); } catch (_) {}
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
    const id = setInterval(() => {
        const prevPos = lastAudioPosRef.current;
        const audioTarget = audio.currentTime + (videoOffsetRef.current || 0);

         mvEngine.tick(audioTarget);
         try { bgEngine.tick(audioTarget); } catch (_) {}

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
                    try { bgEngine.anchor({ play: true, target: videoOffsetRef.current || 0 }); } catch (_) {}
                }
            }
        } catch (_) { /* ignore diag errors */ }
        lastAudioPosRef.current = audio.currentTime;

        if (syncLogRef.current.enabled) {
          const aCurrent = audio.currentTime;
          const vOff = videoOffsetRef.current || 0;

          // Throttle tick logs to every 500ms to reduce buffer/console spam
          const now = performance.now();
          if (now - lastTickLogRef.current < 500) { /* skip */ } else {
          lastTickLogRef.current = now;
          const mvCurrent = videoRef.current?.getCurrentTime?.();
          const bgCurrent = bgVideoRef.current?.currentTime;

          syncLog('tick', 'mv', {
            drift: Math.round(((mvCurrent || 0) - (aCurrent + vOff)) * 1000),
            current: Math.round((mvCurrent || 0) * 1000),
            target: Math.round((aCurrent + vOff) * 1000),
            mode: mvEngine.state.mode,
            seekPending: mvEngine.state.seekPending,
            stalled: mvEngine.state.stalled,
          });

          if (bgCurrent != null) {
            const bgDur = bgVideoRef.current?.duration;
            const bgDriftRaw = bgCurrent - (aCurrent + vOff);
            const bgDrift = (bgEngine.state.looping && isFinite(bgDur) && bgDur > 0)
              ? circularDiff(bgCurrent, aCurrent + vOff, bgDur)
              : bgDriftRaw;
            syncLog('tick', 'bg', {
              drift: Math.round(bgDrift * 1000),
              current: Math.round(bgCurrent * 1000),
              target: Math.round((aCurrent + vOff) * 1000),
              mode: bgEngine.state.mode,
              seekPending: bgEngine.state.seekPending,
              stalled: bgEngine.state.stalled,
            });
          }
          } // end throttle

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

// Reset all sync state when track/video changes
useEffect(() => {
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
    bgPendingForceSeekRef.current = null;
}, [youtubeId, videoRemountKey, mvEngine, bgEngine]);

// The MV ended (shorter than the song, or reached its own end). Wrap it
// seamlessly to the live audio position (mod MV duration) and keep playing —
// never show a black frame at the end of the clip.
const handleVideoEnded = useCallback(() => {
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
    mvEngine.reset();
    syncedRef.current = false;
    syncedOffsetRef.current = null;
    readyFiredRef.current = false;
    setVideoReady(false);
    setMetadataReady(false);
    setVideoRemountKey((k) => k + 1);
}, [mvEngine]);

// Genuine <video> error (e.g. stream hiccup / source down).
const handleVideoError = useCallback(() => {
    recoverVideo();
}, [recoverVideo]);

// If the network drops (wifi off) the YouTube MV frame goes blank and won't
// recover on its own. Remount the player when the connection returns so it
// re-fetches the iframe.
useEffect(() => {
    const onOnline = () => setVideoRemountKey((k) => k + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
}, []);

// Recovery watchdog: if the <video> stays stalled (server restart / network
// loss) past a grace window, remount + re-anchor to the current audio position.
useEffect(() => {
    if (!isVideoMode) return undefined;
    const id = setInterval(() => {
        if (mvEngine.state.stalled && Date.now() - mvEngine.state.stalledSince > 8000) {
            recoverVideo();
        }
    }, 2000);
    return () => clearInterval(id);
}, [isVideoMode, recoverVideo, mvEngine]);

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
    syncLog('seek', 'mv', { target });
    mvEngine.anchor({ play: true, target });
    if (youtubeId) {
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
          <button
            onClick={handleToggleFavorite}
            disabled={favLoading}
            className={`p-2 rounded-full transition-colors ${isFav ? 'text-red-500 hover:bg-white/20' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={20} className={isFav ? 'fill-red-500' : ''} />
          </button>
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
  }, [onClose, onMinimize, hasPlaylist, showQueuePanel, isFav, favLoading, handleToggleFavorite, displayTitle]);
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
          if (readyFiredRef.current) return;
          readyFiredRef.current = true;
          setVideoReady(true);
          mvEngine.onCanPlay?.();
          syncLog('ready', 'mv', {});
        }, [mvEngine]);

        const onVideoLoadedMetadata = useCallback(() => {
          syncLog('loadedmetadata', 'mv', {});
        }, []);
        const onVideoWaiting = useCallback(() => {
          syncLog('waiting', 'mv', {});
          mvEngine.onWaiting();
        }, [mvEngine]);
        const onVideoStalled = useCallback(() => {
          syncLog('stalled', 'mv', {});
          mvEngine.onStalled();
        }, [mvEngine]);
        const onVideoPlaying = useCallback(() => {
          syncLog('playing', 'mv', {});
          mvEngine.onPlaying();
        }, [mvEngine]);
        const onVideoSeeked = useCallback(() => {
          const latency = syncLogRef.current.seekStartTime?.mv;
          if (latency) {
            syncLog('seek_latency', 'mv', {
              latencyMs: Math.round(performance.now() - latency),
            });
            delete syncLogRef.current.seekStartTime.mv;
          }
          syncLog('seeked', 'mv', {});
          mvEngine.onSeeked();
        }, [mvEngine]);

        const onVideoPause = useCallback(() => {
          // If the MV video was paused by forceSeek but the engine says we should
          // be playing, resume immediately so the video doesn't stay frozen.
          if (usePlaybackStore.getState().isPlaying && !mvEngine.state.seekPending) {
            syncLog('video_paused_resume', 'mv', {});
            videoRef.current?.playVideo?.();
          }
        }, [mvEngine]);

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

  return (
    <div data-debug-id="1.1.9.3" data-debug-name="AudioPlayer" data-debug-type="player" className={`w-full h-full overflow-hidden max-w-full flex flex-col text-slate-100 select-none relative ${isVideoMode && youtubeId ? '' : 'bg-neutral-950'}`}>
      {/* Video background: blurred, stretched video behind all content when in video mode */}
       {youtubeId && (
       <video
         className="absolute inset-0 w-full h-full object-cover pointer-events-none"
         style={{ filter: `blur(12px) saturate(1.4) brightness(${isPlaying ? 0.85 : 0.45})`, transition: 'filter 400ms ease', transform: 'scale(1.2)', zIndex: 0, opacity: isVideoMode ? 0.45 : 0, maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 25%, transparent 70%)', maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }}
         src={`/api/video-cache/stream/${youtubeId}`}
         muted
         playsInline
         preload="auto"
          ref={(el) => {
            bgVideoRef.current = el;
            if (el) {
              if (typeof el.requestVideoFrameCallback === 'function') {
                const loop = (now, metadata) => {
                  el.requestVideoFrameCallback(loop);
                  syncLog('rvfc', 'bg', { 
                    mediaTime: metadata.mediaTime.toFixed(3), 
                    presentedFrames: metadata.presentedFrames, 
                    processingDuration: metadata.processingDuration.toFixed(3) 
                  });
                };
                el.requestVideoFrameCallback(loop);
              }
            }
          }}
          onLoadedMetadata={() => {
             const bg = bgVideoRef.current;
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
          onError={() => {
            // BG stream error is harmless — it shares the same src as the MV.
          }}
            onSeeked={() => {
               const latency = syncLogRef.current.seekStartTime?.bg;
               if (latency) {
                 syncLog('seek_latency', 'bg', {
                   latencyMs: Math.round(performance.now() - latency),
                 });
                 delete syncLogRef.current.seekStartTime.bg;
               }
               syncLog('seeked', 'bg', {});

                // Drain pending force seek (coalesced rapid seeks).
                // If another seek was queued while this one was in
                // flight, execute the latest target now.
                const nextForce = bgPendingForceSeekRef.current;
                if (nextForce !== null && bgSeekInProgressRef.current) {
                  bgPendingForceSeekRef.current = null;
                  const bg = bgVideoRef.current;
                  if (bg && Math.abs((bg.currentTime || 0) - nextForce) >= 0.001) {
                    syncLog('bg_seek_drain', 'bg', {
                      from: (bg.currentTime || 0).toFixed(3),
                      to: nextForce.toFixed(3),
                    });
                    bgSeekInProgressRef.current = true;
                    if (!bg.paused) bg.pause();
                    bg.currentTime = nextForce;
                    return; // let the subsequent seeked fire the barrier hit
                  }
                }

               bgSeekInProgressRef.current = false;

               bgEngine.onSeeked();
             }}
           onWaiting={() => { syncLog('waiting', 'bg', {}); bgEngine.onWaiting(); }}
           onStalled={() => { syncLog('stalled', 'bg', {}); bgEngine.onStalled(); }}
           onPlaying={() => { syncLog('playing', 'bg', {}); bgEngine.onPlaying(); }}
          onEnded={() => {
            if (!usePlaybackStore.getState().isPlaying) return;
            const audioTarget = audioRef.current?.currentTime + (videoOffsetRef.current || 0);
            try { bgEngine.anchor({ play: true, target: audioTarget }); } catch (_) {}
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
