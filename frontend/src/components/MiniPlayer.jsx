import { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Heart, Shuffle, Repeat, Volume2, VolumeX } from 'lucide-react';
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
  const volumeWrapRef = useRef(null);

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
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
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

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    const sync = () => setVolume(audio.volume ?? 0);
    audio.addEventListener('volumechange', sync);
    sync();
    return () => audio.removeEventListener('volumechange', sync);
  }, [audioRef]);

  // Mouse-wheel volume control on the volume bar. Non-passive so we can
  // preventDefault and stop the page from scrolling while adjusting volume.
  useEffect(() => {
    const el = volumeWrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const audio = audioRef?.current;
      const current = audio ? Math.round(audio.volume * 100) : Math.round(volume * 100);
      const step = 5;
      const next = Math.max(0, Math.min(100, current - Math.sign(e.deltaY) * step));
      handleVolumeChange({ target: { value: String(next / 100) } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [audioRef, volume, handleVolumeChange]);

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
        className="w-full flex-shrink-0 bg-black relative overflow-hidden"
      >
        <div className="relative z-10 flex items-center gap-4 p-3">
          {/* KIRI - Cover + Track Info */}
          <div className="w-72 flex-shrink-0 flex items-center gap-3">
            <div className="w-14 h-14 flex-shrink-0 rounded-xl overflow-hidden bg-neutral-800 shadow-lg">
              <NetworkImage
                src={coverUrl || `/thumbnails/${fileId}.jpg`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="text-[13px] font-medium text-white truncate">
                {currentTrack?.display_name || currentTrack?.name || 'Unknown Track'}
              </div>
              <div className="text-[11px] text-neutral-400 truncate">
                {currentTrack?.artist || currentTrack?.album || ''}
              </div>
            </div>
          </div>

          {/* TENGAH - Seek Bar + Controls */}
          <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2 w-full max-w-xl">
              <span className="text-[10px] text-neutral-500 w-8 text-right tabular-nums">{formatTime(currentTime)}</span>
              <div
                onClick={handleSeek}
                className="flex-1 h-1.5 bg-neutral-700/60 rounded-full cursor-pointer group relative"
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-all pointer-events-none"
                  style={{ left: `calc(${progress}% - 5px)` }}
                />
              </div>
              <span className="text-[10px] text-neutral-500 w-8 tabular-nums">{formatTime(duration)}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleShuffle}
                className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 ${shuffle ? '' : 'text-neutral-400 hover:text-white'}`}
                title={shuffle ? 'Shuffle on' : 'Shuffle off'}
                style={shuffle ? { color: '#8892E6' } : undefined}
              >
                <Shuffle size={14} />
              </button>
              <button
                onClick={previous}
                className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
              >
                <SkipBack size={16} />
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
                className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={handleLoop}
                className={`relative transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 ${loopMode !== 'off' ? '' : 'text-neutral-400 hover:text-white'}`}
                title={`Loop: ${loopMode}`}
                style={loopMode !== 'off' ? { color: '#8892E6' } : undefined}
              >
                <Repeat size={14} />
                {loopMode === 'one' && (
                  <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-indigo-500 text-white rounded-full w-3 h-3 flex items-center justify-center leading-none">1</span>
                )}
              </button>
            </div>
          </div>

           {/* KANAN - Volume + Actions */}
           <div className="flex items-center gap-2">
             <button
               onClick={handleToggleFavorite}
               className={`transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0 ${isFav ? 'text-red-400' : 'text-neutral-400 hover:text-red-400'}`}
               title={isFav ? 'Remove from favorites' : 'Add to favorites'}
             >
               <Heart size={14} className={isFav ? 'fill-red-400' : ''} />
             </button>
             <button
               onClick={toggleMute}
               className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0"
               title={volume === 0 ? 'Unmute' : 'Mute'}
             >
               {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
             </button>
<div className="flex-1 min-w-0 flex items-center" style={{ minWidth: 80, maxWidth: 160 }}>
                  <div ref={volumeWrapRef} className="relative w-full" style={{ height: 24 }}>
                   <div className="absolute inset-0 flex items-center">
<div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#262626' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${volume * 100}%`, background: 'linear-gradient(90deg,#0EA5E9,#8892E6)' }} />
                      </div>
                   </div>
                   <input
                     type="range"
                     min="0"
                     max="100"
                     value={Math.round(volume * 100)}
                     onChange={(e) => {
                       const newVol = parseInt(e.target.value) / 100;
                       setVolume(newVol);
                       if (audioRef?.current) {
                         audioRef.current.volume = newVol;
                       }
                       try {
                         localStorage.setItem('audio.volume', String(Math.round(newVol * 100)));
                       } catch {}
                     }}
                     className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                     title={`Volume: ${Math.round(volume * 100)}%`}
                   />
                 </div>
               </div>
<button
  onClick={handleExpand}
  className="p-1.5 rounded-lg hover:bg-neutral-700 focus:outline-none focus:ring-0 flex-shrink-0 transition-colors"
  style={{ color: '#8892E6' }}
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
