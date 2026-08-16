import { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Maximize2, Heart, Shuffle, Repeat, Volume2, VolumeX } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { fetchBlob, getCached } from '../utils/thumbCache';
import { listeningTracker } from '../utils/listeningTracker.js';
import NetworkImage from './NetworkImage';
import { cancelAutoPlayPending, isAutoPlayPendingCanceled, resetAutoPlayPending } from '../utils/autoPlayPending';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer({ onExpand, onClose, sharedAudioRef, sharedPrevFileIdRef, audioReady, onFavoriteToggle, view = null }) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [coverUrl, setCoverUrl] = useState(null);
  const [mvReady, setMvReady] = useState(false);
  const [mvError, setMvError] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('audio.volume');
      return saved != null ? Number(saved) : 0.7;
    } catch {
      return 0.7;
    }
  });
  const bgVideoRef = useRef(null);

  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    queue,
    currentTrackIndex,
    shuffle,
    loopMode,
    setShuffle,
    setLoopMode,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef;
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  const currentTrack = queue?.[currentTrackIndex];
  const fileId = currentTrack?.file_id;
  const mvId = currentTrack?.youtube_id;

  const isFav = useIsFavorite(fileId, currentTrack?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(() => {
    if (!fileId || !onFavoriteToggle) return;
    onFavoriteToggle(currentTrack);
  }, [fileId, currentTrack, onFavoriteToggle]);

  const loadCover = useCallback((fid) => {
    if (!fid) {
      setCoverUrl(null);
      return;
    }
    const url = `/thumbnails/${fid}.jpg`;
    const cached = getCached(url);
    if (cached) {
      setCoverUrl(cached);
      return;
    }
    setCoverUrl(null);
    let cancelled = false;
    fetchBlob(url, { priority: 'low' }).then((u) => {
      if (!cancelled && u) setCoverUrl(u);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = loadCover(fileId);
    return cleanup;
  }, [fileId, loadCover]);

  useEffect(() => {
    setMvReady(false);
    setMvError(false);
  }, [mvId]);

  useEffect(() => {
    const audio = audioRef?.current;
    const video = bgVideoRef.current;
    if (!audio || !video || !audioReady) return;

    const offset = Number(currentTrack?.video_offset) || 0;
    const syncPosition = () => {
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const target = ((audio.currentTime || 0) + offset) % dur;
      if (Math.abs((video.currentTime || 0) - target) > 1.0) {
        try { video.currentTime = target; } catch {}
      }
    };
    const onPlay = () => { video.play().catch(() => {}); };
    const onPause = () => { video.pause(); };
    const onCanPlay = () => {
      if (!audio.paused) video.play().catch(() => {});
      syncPosition();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('seeked', syncPosition);
    audio.addEventListener('timeupdate', syncPosition);
    video.addEventListener('loadedmetadata', syncPosition);
    video.addEventListener('canplay', onCanPlay);

    if (audio.paused) video.pause(); else video.play().catch(() => {});
    syncPosition();

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('seeked', syncPosition);
      audio.removeEventListener('timeupdate', syncPosition);
      video.removeEventListener('loadedmetadata', syncPosition);
      video.removeEventListener('canplay', onCanPlay);
    };
  }, [audioRef, audioReady, mvId, currentTrack?.video_offset]);

  useEffect(() => {
    const onOnline = () => loadCover(fileId);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [fileId, loadCover]);

  useEffect(() => {
    if (!audioReady || !fileId) return;
    const audio = audioRef?.current;
    if (!audio) return;

    const isSameTrack = prevFileIdRef.current === fileId;
    prevFileIdRef.current = fileId;

    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    if (isSameTrack) {
      setDuration(audio.duration || 0);
      setCurrentTime(audio.currentTime || 0);
      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
      };
    }

    const store = usePlaybackStore.getState();
    audio.currentTime = store.position > 0 ? store.position : 0;
    audio.src = `/file/${fileId}`;
    audio.load();

    const handleCanPlay = () => {
      setDuration(audio.duration || 0);
      if (usePlaybackStore.getState().isPlaying) {
        audio.play().catch(() => {});
      }
    };

    if (audio.readyState >= 3) {
      handleCanPlay();
    } else {
      audio.addEventListener('canplay', handleCanPlay, { once: true });
    }

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [fileId, audioReady, audioRef]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady) return;
    const update = () => setAudioPlaying(!audio.paused);
    update();
    audio.addEventListener('play', update);
    audio.addEventListener('pause', update);
    audio.addEventListener('playing', update);
    return () => {
      audio.removeEventListener('play', update);
      audio.removeEventListener('pause', update);
      audio.removeEventListener('playing', update);
    };
  }, [audioRef, audioReady]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady) return;
    if (isPlaying && audio.paused) {
      audio.play().catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoPlayPending(true);
          resetAutoPlayPending();
        }
      });
    }
  }, [isPlaying, audioRef, audioReady]);

  useEffect(() => {
    if (autoPlayPending && userInteracted && audioRef?.current && !isAutoPlayPendingCanceled()) {
      audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
      resetAutoPlayPending();
    }
  }, [autoPlayPending, userInteracted, audioRef]);

  useEffect(() => {
    const mark = () => setUserInteracted(true);
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !audioReady || !fileId) return;
    const displayName = currentTrack?.display_name || currentTrack?.name || null;
    listeningTracker.attach(audio, fileId, displayName);
    return () => {
      listeningTracker.detach();
      listeningTracker.forcePersist();
    };
  }, [fileId, audioReady, audioRef, currentTrack?.display_name, currentTrack?.name]);

  const handleSeek = useCallback((e) => {
    const audio = audioRef?.current;
    if (!audio || duration === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percent * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, audioRef]);

  const handlePlayPause = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
      play();
      setAutoPlayPending(false);
      resetAutoPlayPending();
    } else {
      cancelAutoPlayPending();
      audio.pause();
      pause();
    }
  }, [play, pause, audioRef]);

  const handleClose = useCallback(() => {
    cancelAutoPlayPending();
    pause();
    if (audioRef?.current) audioRef.current.pause();
    onClose?.();
  }, [pause, onClose, audioRef]);

  const handleExpand = useCallback(() => {
    onExpand?.();
  }, [onExpand]);

  const handleVolumeChange = useCallback((e) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef?.current) {
      audioRef.current.volume = newVol;
    }
    try {
      localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
    } catch {}
  }, [audioRef]);

  const toggleMute = useCallback(() => {
    const newVol = volume > 0 ? 0 : 0.7;
    setVolume(newVol);
    if (audioRef?.current) {
      audioRef.current.volume = newVol;
    }
    try {
      localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
    } catch {}
  }, [volume, audioRef]);

  const handleShuffle = useCallback(() => {
    setShuffle(!shuffle);
  }, [shuffle, setShuffle]);

  const handleLoop = useCallback(() => {
    const modes = ['off', 'all', 'one'];
    const idx = modes.indexOf(loopMode);
    setLoopMode(modes[(idx + 1) % modes.length]);
  }, [loopMode, setLoopMode]);

  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) return;

      if (view === 'media' || view === 'sendqueue') return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;

      let handled = true;
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          handlePlayPause();
          break;
        case 'm':
        case 'M':
          next();
          break;
        case 'n':
        case 'N':
          previous();
          break;
        case 'l':
        case 'L':
          handleToggleFavorite();
          break;
        case 'b':
        case 'B':
          handleShuffle();
          break;
        case 'j':
        case 'J':
          handleLoop();
          break;
        case 'g':
        case 'G': {
          const audio = audioRef?.current;
          if (audio) audio.currentTime = Math.max(0, audio.currentTime - 5);
          break;
        }
        case 'h':
        case 'H': {
          const audio = audioRef?.current;
          if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
          break;
        }
        default:
          handled = false;
          break;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handlePlayPause, next, previous, handleToggleFavorite, handleShuffle, handleLoop, shuffle, loopMode, view]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        data-debug-id="1.2"
        data-debug-name="MiniPlayer"
        data-debug-type="floating"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,520px)] bg-neutral-900/40 backdrop-blur-md border border-neutral-700/50 shadow-2xl z-40 rounded-2xl overflow-hidden"
      >
        <div className="absolute inset-0 pointer-events-none">
          <NetworkImage
            src={coverUrl || `/thumbnails/${fileId}.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'blur(18px) brightness(0.5) saturate(1.2)', transform: 'scale(1.12)' }}
            showRetry={false}
          />
          {mvId && !mvError && (
            <video
              key={mvId}
              ref={bgVideoRef}
              src={`/api/video-cache/stream/${mvId}`}
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                opacity: mvReady ? 1 : 0,
                transition: 'opacity 300ms ease',
                filter: 'blur(12px) brightness(0.55) saturate(1.1)',
                transform: 'scale(1.08)',
              }}
              muted
              playsInline
              onLoadedData={() => setMvReady(true)}
              onError={() => { setMvError(true); setMvReady(false); }}
            />
          )}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0.15))' }} />
        </div>

        <div className="relative z-10 flex items-center gap-3 px-3 py-2">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden bg-neutral-800">
              <NetworkImage
                src={coverUrl || `/thumbnails/${fileId}.jpg`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="text-[11px] font-medium text-white truncate">
                {currentTrack?.display_name || currentTrack?.name || 'Unknown Track'}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-neutral-500">{formatTime(currentTime)}</span>
                <div
                  onClick={handleSeek}
                  className="flex-1 h-1 bg-neutral-700/60 rounded-full cursor-pointer hover:h-1.5 transition-all group relative"
                >
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-all pointer-events-none"
                    style={{ left: `calc(${progress}% - 5px)` }}
                  />
                </div>
                <span className="text-[9px] text-neutral-500">{formatTime(duration)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={handleShuffle}
              className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-0 ${shuffle ? 'text-indigo-400' : 'text-neutral-400 hover:text-white'}`}
              title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            >
              <Shuffle size={14} />
            </button>
            <button
              onClick={previous}
              className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-0"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
            >
              <SkipBack size={14} />
            </button>
            <button
              onClick={handlePlayPause}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-all flex-shrink-0 focus:outline-none focus:ring-0"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
            >
              {audioPlaying ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button
              onClick={next}
              className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-0"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
            >
              <SkipForward size={14} />
            </button>
            <button
              onClick={handleLoop}
              className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-0 ${loopMode !== 'off' ? 'text-indigo-400' : 'text-neutral-400 hover:text-white'}`}
              title={`Loop: ${loopMode}`}
            >
              <Repeat size={14} />
              {loopMode === 'one' && <span className="text-[8px] font-bold ml-0.5">1</span>}
            </button>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={toggleMute}
              className="text-neutral-400 hover:text-white transition-colors p-1 rounded hover:bg-neutral-800 focus:outline-none focus:ring-0"
              title={volume === 0 ? 'Unmute' : 'Mute'}
            >
              {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={handleVolumeChange}
              className="w-16 h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
            />
            <button
              onClick={handleExpand}
              className="text-neutral-400 hover:text-white transition-colors p-1 rounded hover:bg-neutral-800 focus:outline-none focus:ring-0"
              title="Full player"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
