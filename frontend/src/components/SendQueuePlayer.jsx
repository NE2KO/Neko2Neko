import React, { useState, useCallback, useRef, useEffect } from 'react';
import VideoPlayer from './VideoPlayer';
import VaultAudioPlayer from './VaultAudioPlayer';
import ImageViewer from './ImageViewer';
import MediaControls from './MediaControls';
import Carousel from './Carousel';
import SendProgressPills from './SendProgressPills';
import CaptionEditorModal from './CaptionEditorModal';
import { useSendProgress } from '../hooks/useSendProgress';
import usePlaybackStore from '../store/playbackStore';
import {
  cancelSendQueueItem, retrySendQueueItem, removeSendQueueItem,
} from '../utils/api';
import { Ban, RotateCw, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

// Standalone player for the Send Queue modal.
//
// Layout follows the Media Vault pattern (MediaModal + VaultBottomCluster):
// the media player renders in `embedded` mode (media + header only) and the
// controls are rendered in a SEPARATE bottom cluster, so the controls never
// overlap/cover the media. This is intentionally a dedicated component so tweaks
// here never affect the main Media Vault, the Bot views, or any other surface.
//
// There is NO send / cancel / retry / remove button here — those live in the
// player header (provided by the embedded VideoPlayer / ImageViewer / audio
// header). This component only provides the media + the playback controls.
// from history) and live send-progress pills.

const IDLE_MS = 3000;

const sendBtn =
  'flex items-center gap-1.5 px-2.5 py-2 rounded-full border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';

export default function SendQueuePlayer({
  item,
  folderFiles = [],
  currentSortBy,
  currentSortOrder = 'asc',
  onClose,
  onNavigate,
  onChanged,
  onCaptionChange,
}) {
  const file = { id: item.file_id, name: item.name, type: item.type, ext: item.ext };
  const files = folderFiles.map((it) => ({ id: it.file_id || it.id, name: it.name, type: it.type, ext: it.ext, qid: it.qid, status: it.status, hold_until: it.hold_until }));

  const activeMediaRef = useRef(null);
  const sharedAudioRef = useRef(null);
  const [audioReady, setAudioReady] = useState(false);
  useEffect(() => {
    if (!sharedAudioRef.current) {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.style.cssText =
        'position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
      document.body.appendChild(audio);
      sharedAudioRef.current = audio;
      setAudioReady(true);
    }
    return () => {
      const audio = sharedAudioRef.current;
      if (audio) {
        try { audio.pause(); } catch {}
        if (audio.parentNode) audio.parentNode.removeChild(audio);
        sharedAudioRef.current = null;
      }
    };
  }, []);

  const [displayItem, setDisplayItem] = useState(item);
  const [prevItem, setPrevItem] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(true);
  const [manualHidden, setManualHidden] = useState(() => {
    try { return localStorage.getItem('sq_carousel_hidden') === '1'; } catch { return false; }
  });

  const displayFile = {
    id: displayItem.file_id || displayItem.id,
    name: displayItem.name,
    type: displayItem.type,
    ext: displayItem.ext,
    is_favorite: displayItem.is_favorite,
  };

  // `type` follows the currently displayed item so the cluster (controls /
  // action bar / audio-mode slide) stays correct across a video<->audio<->image
  // crossfade.
  const type = displayItem?.type || item.type || 'image';

useEffect(() => {
     const t = requestAnimationFrame(() => setHydrated(true));
     return () => cancelAnimationFrame(t);
   }, []);

   // Persist carousel visibility across browser tab switches
   useEffect(() => {
     let saved = false;
     try {
       saved = localStorage.getItem('sq_carousel_hidden') === '1';
     } catch {}
     setManualHidden(saved);
   }, []);

  // Crossfade on media-type change (video <-> audio <-> image), like MediaModal.
  const itemRef = useRef(item);
  const displayItemRef = useRef(displayItem);
  displayItemRef.current = displayItem;
  const transitionTimerRef = useRef(null);
  useEffect(() => () => { if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current); }, []);
  useEffect(() => {
    if (item?.qid === itemRef.current?.qid && item?.type === itemRef.current?.type) return;
    const prevType = itemRef.current?.type;
    itemRef.current = item;
    // Skip crossfade for same-type (especially video) - prevents unwanted pause on nav
    if (item?.type === prevType) {
      setPrevItem(null);
      setDisplayItem(item);
      return;
    }
    setPrevItem(displayItemRef.current);
    setDisplayItem(item);
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => setPrevItem(null), 320);
  }, [item]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.body.style.overscrollBehavior = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Idle auto-hide (controls + carousel fade out together) — only for video.
  const videoPlaying = usePlaybackStore((s) => s.videoPlaying);
  const autoHide = type === 'video' && videoPlaying;
  useEffect(() => {
    if (type !== 'video') { setActive(true); return undefined; }
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
  }, [type, displayItem?.qid]);

  const handleFileChange = useCallback((next) => {
    if (next?.id === displayItemRef.current?.id) return;
    setDisplayItem(next);
    if (onNavigate) onNavigate(next);
  }, [onNavigate]);

  // Queue status actions (cancel / retry / remove). For video + image these live
  // in the embedded player's header; for audio (VaultAudioPlayer has no queue
  // header) we render a small overlay in the top-right instead.
  const handleQueueCancel = useCallback(() => {
    if (displayItem?.qid) cancelSendQueueItem(displayItem.qid).then(() => onChanged && onChanged());
  }, [displayItem?.qid, onChanged]);
  const handleQueueRetry = useCallback(() => {
    if (displayItem?.qid) retrySendQueueItem(displayItem.qid).then(() => onChanged && onChanged());
  }, [displayItem?.qid, onChanged]);
  const handleQueueRemove = useCallback(() => {
    if (displayItem?.qid) {
      removeSendQueueItem(displayItem.qid).then(() => {
        if (onChanged) onChanged();
        if (onClose) onClose();
      });
    }
  }, [displayItem?.qid, onChanged, onClose]);

  // Caption editing
  const [showCaptionModal, setShowCaptionModal] = useState(false);
  const handleCaptionSave = useCallback(async (caption) => {
    if (!displayItem?.qid || !onCaptionChange) return;
    await onCaptionChange(displayItem, caption);
  }, [displayItem, onCaptionChange]);

  // Live send-progress pills (driven by the embedded players' own sends).
  const { progress } = useSendProgress();

  const renderPlayer = useCallback((it, startPaused = false, isCur = false) => {
    if (!it) return null;
    const f = { id: it.file_id || it.id, name: it.name, type: it.type, ext: it.ext, is_favorite: it.is_favorite };
    if (it.type === 'video') {
      return (
        <VideoPlayer
          file={f}
          folderFiles={files}
          currentSortBy={currentSortBy}
          currentSortOrder={currentSortOrder}
          onClose={onClose}
          onFileChange={handleFileChange}
          embedded
          mediaRef={isCur ? activeMediaRef : undefined}
          startPaused={startPaused}
          queueMode
          queueItem={it}
          onQueueChanged={onChanged}
          onEditCaption={() => setShowCaptionModal(true)}
        />
      );
    }
    if (it.type === 'audio') {
      return (
        <VaultAudioPlayer
          file={f}
          folderFiles={files}
          currentSortBy={currentSortBy}
          currentSortOrder={currentSortOrder}
          onClose={onClose}
          onAudioChange={handleFileChange}
          sharedAudioRef={sharedAudioRef}
          audioReady
          startPaused={startPaused}
          embedded
        />
      );
    }
    if (it.type === 'image' || it.type === 'other' || !it.type) {
      return (
        <ImageViewer
          file={f}
          folderFiles={files}
          currentSortBy={currentSortBy}
          currentSortOrder={currentSortOrder}
          onClose={onClose}
          onImageChange={handleFileChange}
          embedded
          queueMode
          queueItem={it}
          onQueueChanged={onChanged}
          onEditCaption={() => setShowCaptionModal(true)}
        />
      );
    }
    return null;
  }, [files, currentSortBy, currentSortOrder, onClose, handleFileChange, onChanged, audioReady]);

  // Controls node (video + audio only). Bound to the active media ref so the
  // same controls drive the correct element during a crossfade.
  const isAudio = type === 'audio';
  const controlsNode = (type === 'video' || type === 'audio') ? (
    <div className={`pointer-events-auto transition-all duration-300 ease-out ${
      active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
    }`}>
      <MediaControls
        type={type}
        mediaRef={isAudio ? sharedAudioRef : activeMediaRef}
        folderFiles={files}
        currentFile={displayFile}
        onFileChange={handleFileChange}
        onClose={onClose}
        onSeek={(s) => { try { const el = isAudio ? sharedAudioRef.current : activeMediaRef.current; if (el) el.currentTime = s; } catch {} }}
      />
    </div>
  ) : null;

  // Carousel (thumbnail strip) — shown when there is more than one item.
  const showCarousel = files.length >= 1;
  const carouselVisible = active && !manualHidden;
  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('sq_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const carouselNode = showCarousel ? (
    <div className={`pointer-events-auto transition-all duration-300 ease-out ${
      carouselVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
    }`}>
      <Carousel
        files={files}
        currentFile={displayFile}
        onSelect={handleFileChange}
        sortBy={currentSortBy}
        sortOrder={currentSortOrder}
        autoHide={type === 'video'}
        hidden={!carouselVisible}
        onToggleHidden={toggleCarouselHidden}
      />
    </div>
  ) : null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
      onClick={onClose}
      style={{ overscrollBehavior: 'none' }}
    >
      {!hydrated ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-neutral-500 text-xs">Membuka…</p>
        </div>
      ) : (
        <div
          className="relative w-full h-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {prevItem && (
            <div
              key={'prev-' + prevItem.type}
              className="absolute inset-0 z-0 animate-out fade-out duration-300"
              style={{ animationFillMode: 'forwards' }}
            >
              {renderPlayer(prevItem, true, false)}
            </div>
          )}
          <div
            key={'cur-' + displayItem?.type}
            className="absolute inset-0 z-10 animate-in fade-in duration-300"
          >
            {renderPlayer(displayItem, false, true)}
          </div>

          {/* Audio has no queue header (VaultAudioPlayer), so surface the
              cancel / retry / remove actions as a top-right overlay. Video +
              image already show these in their own player header. */}
          {type === 'audio' && (
            <div className="absolute top-3 right-3 z-50 flex items-center gap-1">
              {displayItem?.status === 'pending' && (
                <button
                  onClick={handleQueueCancel}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-red-400 transition-colors"
                  title="Batalkan pengiriman"
                >
                  <Ban size={20} />
                </button>
              )}
              {displayItem?.status === 'failed' && (
                <button
                  onClick={handleQueueRetry}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-emerald-400 transition-colors"
                  title="Ulangi pengiriman"
                >
                  <RotateCw size={20} />
                </button>
              )}
              <button
                onClick={handleQueueRemove}
                className="p-2 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-red-400 transition-colors"
                title="Hapus dari riwayat"
              >
                <Trash2 size={20} />
              </button>
            </div>
          )}

          {/* Persistent bottom cluster: controls + carousel, owned once by this
              component so it slides across type swaps and never overlaps the media.
              Audio mode slides down 56px (the empty send-bar slot) so the
              carousel drops flush to the bottom. */}
          <div
            className="absolute inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out"
            style={{ transform: isAudio ? 'translateY(3.5rem)' : 'translateY(0)' }}
          >
            {/* Controls sit above carousel; shift down when carousel is hidden */}
            <div className={`transition-all duration-300 ease-out ${
              carouselVisible ? '' : 'translate-y-[60px]'
            }`}>
              {controlsNode}
            </div>
            {carouselNode}
          </div>

          {/* Carousel hide/unhide toggle — only when there is a strip. */}
          {showCarousel && (
            <button
              onClick={toggleCarouselHidden}
              className="absolute right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity"
              style={{ bottom: isAudio ? '88px' : '72px', opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
              title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
            >
              {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}

          {progress && (
            <div className="absolute top-16 right-3 z-50 pointer-events-none">
              <SendProgressPills progress={progress} />
            </div>
          )}
        </div>
      )}
      <CaptionEditorModal
        open={showCaptionModal}
        caption={displayItem?.caption || ''}
        onSave={handleCaptionSave}
        onClose={() => setShowCaptionModal(false)}
      />
    </div>
  );
}
