import { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Maximize2, Heart } from 'lucide-react';
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

  // Favorite status — single source of truth via the global favorites store,
  // so it stays in sync with the full player / carousel / queue list.
  const isFav = useIsFavorite(fileId, currentTrack?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(() => {
    if (!fileId || !onFavoriteToggle) return;
    onFavoriteToggle(currentTrack);
  }, [fileId, currentTrack, onFavoriteToggle]);

  // Fetch cover art when track changes
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

  // BG video source is the SAME shared MV cache as the full player
  // (`/api/video-cache/stream/:youtubeId`) — no separate download. It streams
  // directly; if the file isn't cached the video errors and we fall back to the
  // cover backdrop. The background follows the shared audio: play/pause and seek.
  useEffect(() => {
    setMvReady(false);
    setMvError(false);
  }, [mvId]);

  // Mirror the shared audio play/pause + position onto the BG video so it
  // stays roughly in sync (seek = jump, pause = freeze, resume = continue).
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

  // Re-fetch the cover if the connection returns (wifi toggled off then on)
  useEffect(() => {
    const onOnline = () => loadCover(fileId);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [fileId, loadCover]);

  // Load file when changed — shared audio, skip reload if same track
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
      // Returning from the full player: keep playing from the same position,
      // but still track progress so the seek bar keeps advancing.
      setDuration(audio.duration || 0);
      setCurrentTime(audio.currentTime || 0);
      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
      };
    }

    // New track — load and play
    const store = usePlaybackStore.getState();
    console.log('[MiniPlayer] Loading track:', fileId, 'position:', store.position, 'isPlaying:', store.isPlaying);
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

  // Play/pause is driven by the shared audio element's REAL state (not the
  // store), so the icon can never desync from what's actually audible — e.g.
  // when returning to the MiniPlayer while the audio is still playing.
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

  // Resume-only sync: if the store wants playback but the element is paused
  // (e.g. a play intent from MediaControls), retry play. Never pauses the audio
  // based on store state — the element itself is the source of truth.
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

  // Retry autoplay after user gesture
  useEffect(() => {
    if (autoPlayPending && userInteracted && audioRef?.current && !isAutoPlayPendingCanceled()) {
      audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
      resetAutoPlayPending();
    }
  }, [autoPlayPending, userInteracted, audioRef]);

  // Mark the first user gesture so a previously-blocked autoplay can resume.
  useEffect(() => {
    const mark = () => setUserInteracted(true);
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  // ListeningTracker: attach to shared audio so stats accumulate in mini player too.
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

  // Handle seek bar click
  const handleSeek = useCallback((e) => {
    const audio = audioRef?.current;
    if (!audio || duration === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percent * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, audioRef]);

  // Handle play/pause — toggle the audio element directly (user gesture)
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

  // Handle close: pause + clear store + callback
  const handleClose = useCallback(() => {
    cancelAutoPlayPending();
    pause();
    if (audioRef?.current) audioRef.current.pause();
    onClose?.();
  }, [pause, onClose, audioRef]);

  // Handle expand to full player
  const handleExpand = useCallback(() => {
    onExpand?.();
  }, [onExpand]);

  // Keyboard bindings — mirror the full player so the MiniPlayer is fully
  // controllable without the mouse (space = play/pause, m = next, n = previous,
  // l = love). The MiniPlayer only mounts when the full player is collapsed, so
  // these keys belong to it. We register in the CAPTURE phase on window (which
  // fires before App.jsx's document-capture global handler) and stopPropagation
  // so the keys are authoritative and never double-fire with the full player's
  // bindings. Switch-player key is intentionally left out for now (UI button pending).
  useEffect(() => {
    const onKey = (e) => {
      // When the user is typing in an input/textarea/contenteditable, do NOT
      // intercept keystrokes — otherwise characters like m/n/b/j/g/h/l/Space
      // never reach the field (e.g. playlist search box).
      const target = e.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) return;

      // Views that own their own full-screen media shortcuts ('media' and
      // 'sendqueue') dispatch their own custom events from App.jsx. If we
      // handle the keys here in capture phase and stopPropagation, those
      // events never fire and the video/queue controls appear broken.
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
          setShuffle(!shuffle);
          break;
        case 'j':
        case 'J': {
          const modes = ['off', 'all', 'one'];
          const idx = modes.indexOf(loopMode);
          setLoopMode(modes[(idx + 1) % modes.length]);
          break;
        }
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
  }, [handlePlayPause, next, previous, handleToggleFavorite, setShuffle, setLoopMode, shuffle, loopMode, view]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        data-debug-id="1.2"
        data-debug-name="MiniPlayer"
        data-debug-type="floating"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,480px)] bg-neutral-900/40 backdrop-blur-md border border-neutral-700/50 shadow-2xl z-40 rounded-2xl overflow-hidden"
      >
        {/* Background art: MV (if cached) over a blurred cover, never plain dark */}
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

        <div className="relative z-10 flex items-center gap-3 px-3 py-2.5">
          {/* Cover art */}
          <div className="w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden bg-neutral-800">
            <NetworkImage
              src={coverUrl || `/thumbnails/${fileId}.jpg`}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>

          {/* Track info + Progress */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div data-debug-id="1.2.4" data-debug-name="MiniTrackInfo" data-debug-type="other" className="text-[11px] font-medium text-white truncate">
              {currentTrack?.display_name || currentTrack?.name || 'Unknown Track'}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-neutral-500">{formatTime(currentTime)}</span>
              <div
                data-debug-id="1.2.2" data-debug-name="MiniSeekBar" data-debug-type="other"
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

          {/* Controls */}
          <div data-debug-id="1.2.5" data-debug-name="MiniPrevNext" data-debug-type="other" className="flex items-center gap-0.5">
            <button
              onClick={previous}
              className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-0"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
            >
              <SkipBack size={14} />
            </button>
            <button
              data-debug-id="1.2.1" data-debug-name="MiniPlayPause" data-debug-type="other"
              onClick={handlePlayPause}
              className="w-9 h-9 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-center hover:shadow-lg hover:shadow-indigo-500/25 transition-all hover:scale-105 flex-shrink-0 focus:outline-none focus:ring-0"
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
          </div>

          {/* Expand / Close */}
          <div className="flex flex-col gap-0.5 ml-0.5">
            <button
              onClick={handleToggleFavorite}
              className={`transition-colors p-1 rounded hover:bg-neutral-800 ${isFav ? 'text-red-400' : 'text-neutral-500 hover:text-red-400'}`}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={12} className={isFav ? 'fill-red-400' : ''} />
            </button>
            <button
              onClick={handleExpand}
              className="text-neutral-500 hover:text-indigo-400 transition-colors p-1 rounded hover:bg-neutral-800"
              title="Full player"
            >
              <Maximize2 size={12} />
            </button>
            <button
              onClick={handleClose}
              className="text-neutral-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-neutral-800"
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
