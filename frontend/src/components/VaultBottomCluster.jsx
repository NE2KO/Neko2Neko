import React, { useState, useCallback, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Carousel from './Carousel';
import MediaControls from './MediaControls';
import VaultActionBar from './VaultActionBar';
import usePlaybackStore from '../store/playbackStore';

// Idle time before controls + carousel auto-hide (matches the old controls timer
// so the two fade out together).
const IDLE_MS = 3000;

// Persistent bottom cluster for the Media Vault modal. Renders the controls +
// carousel + send bar ONCE and stays mounted across video <-> audio <-> image
// swaps, so the cluster SLIDES (via transform) instead of teleporting. The
// cluster is owned by MediaModal; the players render in `embedded` mode and only
// provide their media (header + media element).
//
// Animation: the whole cluster is translated down by exactly the send-bar height
// (3.5rem = 56px) in audio mode, pushing the (empty) send-bar slot off-screen
// and dropping the carousel to the bottom. In video/image mode it sits at
// translateY(0) with the send bar visible at the bottom.
export default function VaultBottomCluster({
  type,
  files,
  currentFile,
  onSelect,
  sortBy = null,
  sortOrder = 'asc',
  activeMediaRef,
  sharedAudioRef,
  isAudioMode,
  bottomBar = null,
  onClose,
  onToggleFavorite = null,
  cacheBust = '',
}) {
  const isPlaying = usePlaybackStore((s) => type === 'video' ? s.videoPlaying : s.isPlaying);
  // Only video auto-hides its controls while playing; audio + image keep the
  // cluster visible (mirrors the standalone players' MediaLayout behavior).
  const autoHide = type === 'video' && isPlaying;

  const showCarousel = files && files.length > 1;

  // User's explicit carousel hide (persisted). Independent of auto-hide: a
  // manually hidden carousel stays hidden no matter what the mouse does.
  const [manualHidden, setManualHidden] = useState(() => {
    try { return localStorage.getItem('mv_carousel_hidden') === '1'; } catch { return false; }
  });

  // Auto-hide "active" state (idle detection). Shared by the controls and the
  // carousel so they fade in/out together. Only engages when autoHide is on
  // (video playing); otherwise everything stays visible.
  // Start visible; the idle timer (below) hides them after IDLE_MS while a
  // video plays. We never force-reveal on a transient pause, so a loop boundary
  // (which briefly pauses the element while it reloads) can't pop the cluster
  // back up with no user activity.
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!autoHide) {
      // Paused / audio / image: keep current visibility. Do NOT force-reveal on
      // a transient pause (e.g. the brief element pause while a video reloads at
      // a loop boundary) — that would pop the controls + carousel back up with no
      // user activity. A genuine user pause still reveals via the activity
      // listener below, because the pause gesture fires while still "playing".
      return undefined;
    }
    let timer;
    const onActivity = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), IDLE_MS);
    };
    timer = setTimeout(() => setActive(false), IDLE_MS);
    window.addEventListener('pointermove', onActivity);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
    };
  }, [autoHide, currentFile?.id]);

  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const carouselVisible = active && !manualHidden;
  const controlsVisible = active;

  // Controls node — fades / slides on the shared auto-hide timing. The controls
  // bind to the active media element via a ref bridge so they control the
  // correct player during a crossfade (audio uses the shared element directly).
  const controlsNode = (type === 'video' || type === 'audio') ? (
    <div className={`pointer-events-auto transition-all duration-300 ease-out ${
      controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
    }`}>
      <MediaControls
        type={type}
        mediaRef={type === 'audio' ? sharedAudioRef : activeMediaRef}
        folderFiles={files}
        currentFile={currentFile}
        onFileChange={onSelect}
        onSeek={(s) => usePlaybackStore.getState().setPosition?.(s)}
      />
    </div>
  ) : null;

  // Carousel node — collapses to zero height when hidden so the controls above
  // it drop down to the bottom.
  const carouselNode = showCarousel ? (
    <div className={`pointer-events-auto grid transition-all duration-300 ease-out ${
      carouselVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
    }`}>
      <div className="overflow-hidden">
        <Carousel
          files={files}
          currentFile={currentFile}
          onSelect={onSelect}
          sortBy={sortBy}
          sortOrder={sortOrder}
          cacheBust={cacheBust}
          onToggleFavorite={onToggleFavorite}
          autoHide={autoHide}
          hidden={!carouselVisible}
          onToggleHidden={toggleCarouselHidden}
          slide
        />
      </div>
    </div>
  ) : null;

  // Carousel hide/unhide toggle — pinned to a stable corner, only shown while
  // the overlay is active so it never floats during idle. Positioned 72px above
  // the cluster bottom so it clears the (56px) send bar in video/image mode and
  // stays ~16px above the bottom in audio mode (after the 56px slide).
  const toggleNode = showCarousel ? (
    <button
      onClick={toggleCarouselHidden}
      className="absolute right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity bottom-[72px]"
      style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
      title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
    >
      {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  ) : null;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out"
      style={{ transform: isAudioMode ? 'translateY(3.5rem)' : 'translateY(0)' }}
    >
      {controlsNode}
      {carouselNode}
      {/* Send-bar slot: always 56px tall (h-14) so the audio-mode slide pushes
          exactly this slot off-screen, landing the carousel flush at the bottom.
          In audio mode bottomBar is null → an empty slot of the same height. */}
      <div className="h-14 flex items-center justify-center">
        {bottomBar}
      </div>
      {toggleNode}
    </div>
  );
}
