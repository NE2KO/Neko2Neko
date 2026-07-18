import { useEffect, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Maximize2, Heart } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { fetchBlob, getCached } from '../utils/thumbCache';
import NetworkImage from './NetworkImage';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer({ onExpand, onClose, sharedAudioRef, sharedPrevFileIdRef, audioReady, onFavoriteToggle }) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [coverUrl, setCoverUrl] = useState(null);

  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    queue,
    currentTrackIndex,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef;
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  const currentTrack = queue?.[currentTrackIndex];
  const fileId = currentTrack?.file_id;

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
    audio.currentTime = 0;
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

  // Sync play/pause state with audio element — guard against redundant calls
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (isPlaying && audio.paused) {
      audio.play().catch(() => {});
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, audioRef]);

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

  // Handle play/pause — call audio.play() directly in click handler for user gesture
  const handlePlayPause = useCallback(() => {
    const audio = audioRef?.current;
    if (isPlaying) {
      pause();
      if (audio) audio.pause();
    } else {
      play();
      if (audio) audio.play().catch(() => {});
    }
  }, [isPlaying, play, pause, audioRef]);

  // Handle close: pause + clear store + callback
  const handleClose = useCallback(() => {
    pause();
    onClose?.();
  }, [pause, onClose]);

  // Handle expand to full player
  const handleExpand = useCallback(() => {
    onExpand?.();
  }, [onExpand]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        data-debug-id="1.2"
        data-debug-name="MiniPlayer"
        data-debug-type="floating"
        className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-neutral-900/95 backdrop-blur-md border border-neutral-700/50 shadow-2xl z-40 rounded-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
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
                  className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
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
              className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800"
            >
              <SkipBack size={14} />
            </button>
            <button
              data-debug-id="1.2.1" data-debug-name="MiniPlayPause" data-debug-type="other"
              onClick={handlePlayPause}
              className="w-9 h-9 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-center hover:shadow-lg hover:shadow-indigo-500/25 transition-all hover:scale-105 flex-shrink-0"
            >
              {isPlaying ? (
                <Pause size={14} fill="currentColor" />
              ) : (
                <Play size={14} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            <button
              onClick={next}
              className="text-neutral-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-neutral-800"
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
