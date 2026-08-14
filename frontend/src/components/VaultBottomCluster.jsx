import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Carousel from './Carousel';
import MediaControls from './MediaControls';
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
  onClose,
  onToggleFavorite = null,
  cacheBust = '',
  onNextEnd = null,
  onPreviousEnd = null,
  repo = null,
  lockEnabled = true,
  allFiles = null,
}) {
  // Auto-hide is dropped entirely: the user reveals/hides the cluster + carousel
  // manually with the toggle button. The lock toggle only gates the 30s idle
  // re-center of the carousel (see Carousel), not the visibility timer.
  const autoHide = false;

  // When a repo is provided we always render the carousel shell (virtual mode
  // handles the empty/hydrating state internally). The old `repo.total() > 1`
  // check was racy: it fires before the async ensureIndex/prefetch completes,
  // so total() returns 0 and the carousel stays hidden permanently unless the
  // user scrolls. Let Carousel decide whether to show items.
  const showCarousel = !!repo || (files && files.length > 1);

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

  // User activity ping — bumps the idle timer that auto-hides the cluster. Shared
  // by the window listeners, the carousel's own scroll, and controls, so auto-
  // hide never fires while the user is still interacting with the strip.
  const idleTimerRef = useRef(null);
  const reportActivity = useCallback(() => {
    setActive(true);
    if (!autoHide) { clearTimeout(idleTimerRef.current); return; }
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setActive(false), IDLE_MS);
  }, [autoHide]);

  useEffect(() => {
    if (!autoHide) {
      // Paused / audio / image: keep current visibility. Do NOT force-reveal on
      // a transient pause (e.g. the brief element pause while a video reloads at
      // a loop boundary) — that would pop the controls + carousel back up with no
      // user activity. A genuine user pause still reveals via the activity
      // listener below, because the pause gesture fires while still "playing".
      clearTimeout(idleTimerRef.current);
      return undefined;
    }
    reportActivity();
    window.addEventListener('pointermove', reportActivity);
    window.addEventListener('pointerdown', reportActivity);
    window.addEventListener('keydown', reportActivity);
    window.addEventListener('touchstart', reportActivity);
    return () => {
      clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointermove', reportActivity);
      window.removeEventListener('pointerdown', reportActivity);
      window.removeEventListener('keydown', reportActivity);
      window.removeEventListener('touchstart', reportActivity);
    };
  }, [autoHide, currentFile?.id, reportActivity]);

  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const carouselVisible = active && !manualHidden;
  const controlsVisible = active && !manualHidden;

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
        folderFiles={allFiles || files}
        currentFile={currentFile}
        onFileChange={onSelect}
        onSeek={(s) => usePlaybackStore.getState().setPosition?.(s)}
        onPreviousEnd={onPreviousEnd}
        onNextEnd={onNextEnd}
        repo={repo}
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
          files={allFiles || files}
          currentFile={currentFile}
          onSelect={onSelect}
          sortBy={sortBy}
          sortOrder={sortOrder}
          cacheBust={cacheBust}
          onToggleFavorite={onToggleFavorite}
          autoHide={autoHide}
          hidden={!carouselVisible}
          onToggleHidden={toggleCarouselHidden}
          onActivity={reportActivity}
          lockEnabled={lockEnabled}
          itemSize="lg"
          slide
          repo={repo}
        />
      </div>
    </div>
  ) : null;

  // Carousel/controls hide/unhide toggle — pinned to a stable corner so you can
  // always bring the cluster back after hiding it. It stays visible even while
  // the cluster is manually hidden; when auto-hide (locked, playing video) is
  // idle it fades with the cluster.
  const toggleNode = showCarousel ? (
    <button
      onClick={toggleCarouselHidden}
      className="absolute right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity bottom-4"
      style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
      title={manualHidden ? 'Tampilkan daftar & kontrol' : 'Sembunyikan daftar & kontrol'}
    >
      {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  ) : null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-40">
      {controlsNode}
      {carouselNode}
      {toggleNode}
    </div>
  );
}
