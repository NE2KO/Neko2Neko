import React, { useState, useRef, useEffect, useCallback } from 'react';
import MediaLayout from './MediaLayout';
import VaultActionBar from './VaultActionBar';
import { useSendProgress } from '../hooks/useSendProgress';
import { useWaUnsupported } from '../hooks/useWaUnsupported';
import { sendToTelegram, sendToChannel, sendToStatus, sendToAll, cancelSendQueueItem, retrySendQueueItem } from '../utils/api';
import { Ban, RotateCw, Pencil, Calendar } from 'lucide-react';
import SendProgressPills from './SendProgressPills';
import CarouselLockToggle from './CarouselLockToggle';
import WaLogo from './icons/WaLogo';
import SendStatusPill from './SendStatusPill';

function ImageViewer({ file, folderFiles, currentSortBy, currentSortOrder, onClose, onImageChange, onLoadFolderFiles, onToggleFavorite, queueMode = false, queueItem = null, onQueueChanged = null, onEditCaption = null, onReschedule = null, onSchedule = null, bottomClusterAnim = null, embedded = false, lockEnabled = true, onToggleLock = null, onRepoNext = null, onRepoPrev = null, onSend = null, isFileQueued = false, isFileSent = false, sendStatus = 'idle', sendMessage = '', sendExtraInfo = null }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastTouchRef = useRef(null);
  const initialPinchDistRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const titleRef = useRef(null);

  const currentIndex = folderFiles?.findIndex((f) => f.id === file.id) ?? -1;
  const [isFav, setIsFav] = useState(false);
  useEffect(() => { setIsFav(file?.is_favorite === 1); }, [file?.id]);

  const waUnsupported = useWaUnsupported(file);
  const sendBlocked = isFileQueued || isFileSent || waUnsupported;
  const { progress, start: startProgress } = useSendProgress();

  const handleToggleFavorite = useCallback(async () => {
    if (!file?.id || !onToggleFavorite) return;
    setIsFav(v => !v);
    try { await onToggleFavorite(file); }
    catch { setIsFav(v => !v); }
  }, [file, onToggleFavorite]);

  const handleQueueCancel = useCallback(() => {
    if (!queueItem?.qid) return;
    cancelSendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleQueueRetry = useCallback(() => {
    if (!queueItem?.qid) return;
    retrySendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleSend = useCallback(async (target) => {
    if (!file?.id) return;
    let res;
    try {
      if (target === 'telegram') res = await sendToTelegram(file.id);
      else if (target === 'channel') res = await sendToChannel(file.id);
      else if (target === 'status') res = await sendToStatus(file.id);
      else if (target === 'all') res = await sendToAll(file.id);
      if (res && res.qid) startProgress(res.qid);
    } catch {}
  }, [file?.id, startProgress]);

  const handleWheel = (e) => {
    e.preventDefault();

    const scaleFactor = 1.1;
    const newZoom = e.deltaY < 0 ? zoom * scaleFactor : zoom / scaleFactor;

    const clampedZoom = Math.min(Math.max(newZoom, 0.5), 5);

    if (clampedZoom === zoom) return;

    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;

    const containerRect = container.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const oldImageX = (containerRect.width / 2 - pan.x) / zoom;
    const oldImageY = (containerRect.height / 2 - pan.y) / zoom;

    const newImageX = (containerRect.width / 2 - pan.x) / clampedZoom;
    const newImageY = (containerRect.height / 2 - pan.y) / clampedZoom;

    setPan(prevPan => ({
      x: prevPan.x - (mouseX - containerRect.width / 2) * (clampedZoom / zoom - 1),
      y: prevPan.y - (mouseY - containerRect.height / 2) * (clampedZoom / zoom - 1)
    }));

    setZoom(clampedZoom);
  };


  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [file?.id]);

  useEffect(() => {
    if (currentIndex === -1 && file.path && onLoadFolderFiles) {
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
      const mediaRoot = '/home/CATIAA/homelab';
      const relPath = folderPath.startsWith(mediaRoot) ? folderPath.substring(mediaRoot.length + 1) : folderPath;
      onLoadFolderFiles(relPath);
    }
  }, [file.id, currentIndex, file.path, onLoadFolderFiles]);

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setIsDragging(zoom > 1);
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchDistRef.current = dist;
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (!containerRef.current || !imageRef.current) return;

    if (e.touches.length === 1 && isDragging && lastTouchRef.current) {
      const dx = e.touches[0].clientX - lastTouchRef.current.x;
      const dy = e.touches[0].clientY - lastTouchRef.current.y;
      setPan((prev) => clampPan(prev.x + dx, prev.y + dy));
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && initialPinchDistRef.current) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleChange = currentDist / initialPinchDistRef.current;

      const newZoom = Math.min(Math.max(zoom * scaleChange, 0.5), 5);

      if (newZoom !== zoom) {
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        const containerRect = containerRef.current.getBoundingClientRect();
        const mouseX = centerX - containerRect.left;
        const mouseY = centerY - containerRect.top;

        const newPanX = pan.x - (mouseX - containerRect.width / 2) * (newZoom / zoom - 1);
        const newPanY = pan.y - (mouseY - containerRect.height / 2) * (newZoom / zoom - 1);

        setPan(clampPan(newPanX, newPanY));
        setZoom(newZoom);
      }
      initialPinchDistRef.current = currentDist;

      if (lastTouchRef.current && e.touches.length === 2) {
        const dx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - lastTouchRef.current.x;
        const dy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - lastTouchRef.current.y;
        setPan((prev) => clampPan(prev.x + dx, prev.y + dy));
      }
      lastTouchRef.current = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    lastTouchRef.current = null;
    initialPinchDistRef.current = null;
    if (zoom <= 1.05) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const handleDoubleClick = () => {
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2.5);
    }
  };

  const lastMousePosRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    if (e.button === 0 && zoom > 1) {
      e.preventDefault();
      setIsDragging(true);
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const calculatePanBoundaries = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image || zoom <= 1) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    const imgWidth = image.clientWidth;
    const imgHeight = image.clientHeight;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const zoomedWidth = imgWidth * zoom;
    const zoomedHeight = imgHeight * zoom;

    const maxPanX = Math.max(0, (zoomedWidth - containerWidth) / 2);
    const maxPanY = Math.max(0, (zoomedHeight - containerHeight) / 2);

    return {
      minX: -maxPanX, maxX: maxPanX,
      minY: -maxPanY, maxY: maxPanY
    };
  }, [zoom]);

  const clampPan = useCallback((newPanX, newPanY) => {
    const { minX, maxX, minY, maxY } = calculatePanBoundaries();
    return {
      x: Math.min(Math.max(newPanX, minX), maxX),
      y: Math.min(Math.max(newPanY, minY), maxY)
    };
  }, [calculatePanBoundaries]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || zoom <= 1) return;
    e.preventDefault();

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;

    setPan(prevPan => clampPan(prevPan.x + dx, prevPan.y + dy));
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  }, [isDragging, zoom, clampPan]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleCarouselSelect = (action) => {
    if (typeof action === 'string') {
      let nextIdx = currentIndex;
      if (action === 'prev' && currentIndex > 0) nextIdx = currentIndex - 1;
      else if (action === 'next' && currentIndex < folderFiles.length - 1) nextIdx = currentIndex + 1;
      if (nextIdx !== currentIndex && folderFiles[nextIdx]) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        onImageChange(folderFiles[nextIdx]);
      }
    } else {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      onImageChange(action);
    }
  };

  const displayName = file
    ? file.display_name || file.name
    : 'Image';

  // The image player has no bottom-cluster controls (MediaControls is only
  // mounted for video/audio), so n/m keyboard listening is owned HERE. We
  // navigate through the repo (onRepoNext/onRepoPrev) exactly like the cluster
  // does for video → same behaviour, and no other handler races with it.
  useEffect(() => {
    if (!onRepoNext && !onRepoPrev) return;
    const handler = (e) => {
      if (e.type === 'global-media-next') {
        onRepoNext && onRepoNext();
      } else if (e.type === 'global-media-previous') {
        onRepoPrev && onRepoPrev();
      }
    };
    const events = ['global-media-next', 'global-media-previous'];
    events.forEach((evt) => window.addEventListener(evt, handler));
    return () => events.forEach((evt) => window.removeEventListener(evt, handler));
  }, [onRepoNext, onRepoPrev]);

  const headerNode = (
    <>
      <button
        onClick={onClose}
        className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
      <div ref={titleRef} className="flex-1 min-w-0 text-center px-2 pl-16 pointer-events-none">
        <div className="text-[10px] font-bold text-green-400 uppercase tracking-[0.2em]">Image</div>
        <div className="text-sm font-semibold text-white truncate" title={displayName}>{displayName}</div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {onToggleLock && (
          <CarouselLockToggle lockEnabled={lockEnabled} onToggleLock={onToggleLock} />
        )}
        {onSchedule && (
          <button onClick={() => onSchedule(file)} className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors text-white/70 hover:text-cyan-400 focus:outline-none focus:ring-0" title="Jadwalkan berdasarkan tanggal">
            <Calendar size={18} />
          </button>
        )}
        {queueMode ? (
          <>
            {queueItem?.status === 'pending' && (
              <>
                <button onClick={handleQueueCancel} className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors text-white/70 hover:text-red-400" title="Batalkan pengiriman">
                  <Ban size={18} />
                </button>
                {onReschedule && (
                  <button onClick={() => onReschedule(queueItem)} className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors text-white/70 hover:text-cyan-400" title="Jadwalkan ulang">
                    <Calendar size={18} />
                  </button>
                )}
                {onEditCaption && (
                  <button onClick={onEditCaption} className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors text-white/70 hover:text-cyan-400" title="Edit caption">
                    <Pencil size={16} />
                  </button>
                )}
              </>
            )}
            {queueItem?.status === 'failed' && (
              <button onClick={handleQueueRetry} className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors text-white/70 hover:text-emerald-400" title="Ulangi pengiriman">
                <RotateCw size={18} />
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={handleToggleFavorite}
              className="p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors"
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-4.35-9.5-8.5C.5 9 2 5.5 5.5 5.5 7.5 5.5 9 6.5 12 9c3-2.5 4.5-3.5 6.5-3.5 3.5 0 5 3.5 3 7-2.5 4.15-9.5 8.5-9.5 8.5z" /></svg>
            </button>
            {embedded && !queueMode && onSend && (
              <>
                  <button
                    onClick={() => !sendBlocked && onSend('status')}
                    disabled={sendBlocked}
                    className={`p-2.5 rounded-full bg-neutral-900/50 border border-white/5 active:bg-white/10 transition-colors ${sendBlocked ? 'text-neutral-500 cursor-not-allowed' : 'text-white/70 hover:text-emerald-400'}`}
                    title={isFileQueued ? 'Sudah dalam antrian' : isFileSent ? 'Sudah pernah dikirim' : waUnsupported ? 'Codec tidak didukung WhatsApp (bukan H.264)' : 'Kirim ke WhatsApp Status'}
                  >
                  <WaLogo size={16} />
                </button>
                <SendStatusPill
                  visible={!!onSend}
                  status={sendStatus}
                  message={sendMessage}
                  extraInfo={sendExtraInfo}
                  anchorRef={titleRef}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  const mainContent = (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
      onWheel={handleWheel}
    >
      <button
        onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
        </svg>
      </button>

      <button
        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
        className="absolute top-16 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35M8 11h6" />
        </svg>
      </button>

       <img
        ref={imageRef}
        src={`/file/${file.id}`}
        crossOrigin="anonymous"
        alt={file.name}
        className="absolute inset-0 w-full h-full select-none transition-transform duration-100 ease-out"
        style={{
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: zoom > 1 ? 'grab' : 'default',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        draggable={false}
      />

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/40 rounded-full text-xs text-neutral-400 z-10">
        {Math.round(zoom * 100)}%
      </div>

      {!embedded && progress && (
        <div className="absolute top-16 right-3 z-40">
          <SendProgressPills progress={progress} />
        </div>
      )}
    </div>
  );

  return (
    <div data-debug-id="1.1.9.4" data-debug-name="ImageViewer" data-debug-type="player" className="h-full">
    <MediaLayout
      header={headerNode}
      embedded={embedded}
      files={embedded ? undefined : folderFiles}
      currentFile={file}
      onSelect={handleCarouselSelect}
      sortBy={currentSortBy}
      sortOrder={currentSortOrder}
      bottomBarOverlay
      bottomClusterAnim={bottomClusterAnim}
      bottomBar={embedded ? undefined : (queueMode ? undefined : (
        <VaultActionBar
          file={file}
          isFav={isFav}
          onToggleFavorite={handleToggleFavorite}
          onSend={handleSend}
          waUnsupported={waUnsupported}
          isFileQueued={isFileQueued}
          isFileSent={isFileSent}
        />
      ))}
    >
      {mainContent}
    </MediaLayout>
   </div>
  );
}

export default ImageViewer;
