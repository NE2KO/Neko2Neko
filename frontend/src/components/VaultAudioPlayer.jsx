import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, Heart } from 'lucide-react';
import MediaLayout from './MediaLayout';
import MediaControls from './MediaControls';
import NetworkImage from './NetworkImage';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import usePlaybackStore from '../store/playbackStore';

// Dedicated, INDEPENDENT audio player for the Media Vault.
// It intentionally does NOT share the Music `MusicPlayer` component so that UI
// work on one surface can never leak into the other. It only plays plain audio
// (cover + controls + carousel) and reuses the SAME shared chrome as the vault
// video/image players via `MediaLayout` (overlay=false) so all three vault
// surfaces share one consistent style.
export default function VaultAudioPlayer({
  file,
  folderFiles = [],
  currentSortBy = null,
  currentSortOrder = 'asc',
  favoriteOnly = false,
  onClose,
  onAudioChange,
  onToggleFavorite,
  sharedAudioRef,
  sharedPrevFileIdRef,
  audioReady,
  startPaused = false,
  embedded = false,
}) {
  const { isPlaying, play, pause } = usePlaybackStore();
  const [activeFile, setActiveFile] = useState(file);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);

  const audioRef = sharedAudioRef || { current: null };
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };

  // Keep activeFile synced to the prop when it changes from the outside.
  useEffect(() => {
    if (file?.id !== activeFile?.id) setActiveFile(file);
  }, [file, activeFile?.id]);

  // Load + play the selected audio file into the shared audio element. Mirrors
  // the stable audio-loading path from MusicPlayer (audio-only, no video sync).
  useEffect(() => {
    if (!audioReady) return;
    const audio = audioRef?.current;
    if (!audio) return;
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;

    const isSameTrack = prevFileIdRef.current === fileId;
    prevFileIdRef.current = fileId;

    if (isSameTrack) {
      if (isPlaying && audio.paused) audio.play().catch(() => {});
      else if (!isPlaying && !audio.paused) audio.pause();
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
    audio.currentTime = 0;
    audio.src = `/file/${fileId}`;
    audio.load();
    // Re-apply chosen output device during buffering so setSinkId resolves
    // before 'playing' — avoids a brief blip to the default device.
    applySink(audio, getStoredDevice());

    const onPlay = () => play();
    const onPause = () => pause();
    const onError = () => { setIsLoading(false); setError('Format tidak didukung browser'); };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    // Outgoing copy during a crossfade: load so the UI still renders, but do
    // NOT auto-play — otherwise the previous track keeps sounding in the
    // background while it fades away.
    if (startPaused) {
      try { audio.pause(); } catch {}
      setIsLoading(false);
      return () => {
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('error', onError);
      };
    }

    const tryPlay = () => {
      audio.play().then(() => setIsLoading(false)).catch((err) => {
        setIsLoading(false);
        if (err?.name === 'NotAllowedError') setAutoPlayPending(true);
      });
    };
    if (audio.readyState >= 3) tryPlay();
    else audio.addEventListener('canplay', tryPlay, { once: true });

    return () => {
      audio.removeEventListener('canplay', tryPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [activeFile?.id, activeFile?.file_id, audioReady, audioRef, play, pause, startPaused]);

  // Stop playback when leaving the vault audio player (e.g. back button) so the
  // shared audio element doesn't keep playing in the background.
  useEffect(() => {
    return () => {
      const audio = audioRef?.current;
      if (audio && !audio.paused) audio.pause();
      try { pause(); } catch {}
    };
  }, [audioRef, pause]);

  // If autoplay was blocked by the browser (autoplay policy), resume on the
  // very next user interaction anywhere (click/key), not just the cover tap.
  // This makes "open audio → it starts playing" reliable even when the open
  // gesture doesn't count as a direct media activation.
  useEffect(() => {
    if (!autoPlayPending) return undefined;
    const resume = () => {
      if (audioRef?.current) audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
      setUserInteracted(true);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [autoPlayPending, audioRef]);

  const carouselFiles = favoriteOnly ? folderFiles.filter(f => f.is_favorite === 1) : folderFiles;

  const handleCarouselSelect = useCallback((selectedFile) => {
    const fileId = selectedFile?.file_id || selectedFile?.id;
    if (fileId) setActiveFile(selectedFile);
    if (onAudioChange) onAudioChange(selectedFile);
  }, [onAudioChange]);

  const handleClick = useCallback(() => {
    setUserInteracted(true);
    if (!activeFile) return;
  }, [activeFile]);

  const handleToggleFavorite = useCallback(async () => {
    if (!activeFile?.id || !onToggleFavorite) return;
    try { await onToggleFavorite(activeFile); } catch {}
  }, [activeFile, onToggleFavorite]);

  const displayName = activeFile
    ? activeFile.display_name || activeFile.name
    : 'Memutar Audio...';
  const displayTitle = activeFile?.title || displayName;

  // Subtle breathing pulse only (transform-only, no layout/width animation) so
  // the player never "widens" from a measured size transition.
  const coverScale = isPlaying ? 1.04 : 0.9;
  const COVER = 'min(64vmin, 360px)';

  // Header: close (left) + Now Playing (center) + Love (right, kept on top).
  const headerNode = (
    <>
      <button
        onClick={onClose}
        className="p-2 rounded-full hover:bg-white/20 transition-colors"
        title="Close player"
      >
        <ChevronLeft className="w-5 h-5 text-white" />
      </button>
      <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-[0.2em]">Now Playing</span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={handleToggleFavorite}
          className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-white"
          title="Add to favorites"
        >
          <Heart size={20} className={activeFile?.is_favorite ? 'fill-red-500 text-red-500' : ''} />
        </button>
      </div>
    </>
  );

  const coverNode = (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-4 sm:px-8">
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl cursor-pointer"
        style={{
          width: COVER,
          height: COVER,
          transform: `scale(${coverScale})`,
          transformOrigin: 'center center',
          transition: 'transform 400ms ease, opacity 400ms ease',
          opacity: isPlaying ? 1 : 0.5,
        }}
        onClick={handleClick}
      >
        <NetworkImage
          src={activeFile?.id ? `/thumbnails/${activeFile.id}.jpg?v=${coverVersion}` : ''}
          alt="Cover"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-red-300 text-xs font-medium text-center px-3">{error}</p>
          </div>
        )}
      </div>

      <div className="w-full max-w-xl px-2 text-center">
        <h2 className="text-lg sm:text-2xl font-bold text-white truncate px-4">
          {displayTitle}
        </h2>
        <p className="text-purple-400/60 text-xs sm:text-sm mt-1 font-medium tracking-wide">
          {activeFile?.artist || 'Digital Audio Stream'}
        </p>
      </div>
    </div>
  );

  return (
    <MediaLayout
      overlay={false}
      embedded={embedded}
      header={headerNode}
      files={embedded ? undefined : carouselFiles}
      currentFile={activeFile}
      onSelect={handleCarouselSelect}
      sortBy={currentSortBy}
      sortOrder={currentSortOrder}
      onToggleFavorite={onToggleFavorite}
      controls={embedded ? undefined : (
        <MediaControls
          type="audio"
          mediaRef={audioRef}
          folderFiles={carouselFiles}
          currentFile={activeFile}
          onFileChange={handleCarouselSelect}
          onSeek={(s) => usePlaybackStore.getState().setPosition?.(s)}
        />
      )}
    >
      {coverNode}
    </MediaLayout>
  );
}
