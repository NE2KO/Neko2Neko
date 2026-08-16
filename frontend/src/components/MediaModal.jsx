import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import VideoPlayer from './VideoPlayer';
import VaultAudioPlayer from './VaultAudioPlayer';
import ImageViewer from './ImageViewer';
import VaultBottomCluster from './VaultBottomCluster';
import SendProgressPills from './SendProgressPills';
import RescheduleModal from './RescheduleModal';
import { useVaultMediaActions } from '../hooks/useVaultMediaActions';
import { enqueueSendItem, rescheduleQueueItem, unpinQueueItem, getSendQueue, getSendQueueStatuses } from '../utils/api';

const WINDOW_RADIUS = 60;

function MediaModal({ file, folderFiles, currentFilter, currentSortBy, currentSortOrder = 'asc', favoriteOnly = false, onClose, onFileChange, onLoadFolderFiles, onToggleFavorite, sharedAudioRef, audioReady, onPreviousEnd, onNextEnd, mediaRepo = null, folderScope = null }) {
   const [displayFile, setDisplayFile] = useState(file);
   const [prevFile, setPrevFile] = useState(null);
   const touchStartX = useRef(0);
   const [hydrated, setHydrated] = useState(false);
   const hydratingRef = useRef(false);

   // Carousel "lock": with lock ON the strip auto-re-centers to the active item
   // after 30s idle; OFF keeps it wherever the user scrolled. Persisted.
   const [carouselLock, setCarouselLock] = useState(() => {
     try { return localStorage.getItem('mv_carousel_lock') !== '0'; } catch { return true; }
   });
   const toggleCarouselLock = useCallback(() => {
     setCarouselLock((prev) => {
       const next = !prev;
       try { localStorage.setItem('mv_carousel_lock', next ? '1' : '0'); } catch {}
       return next;
     });
   }, []);

   // Lazy hydration: mount shell immediately, hydrate async
   useEffect(() => {
     if (hydratingRef.current) return;
     hydratingRef.current = true;
     requestAnimationFrame(() => {
       setHydrated(true);
     });
   }, []);

   // Refs to bridge state to event listeners (anti-stale closure)
   const folderFilesRef = useRef(folderFiles);
   const currentSortByRef = useRef(currentSortBy);
   const currentSortOrderRef = useRef(currentSortOrder);
   useEffect(() => {
     folderFilesRef.current = folderFiles;
     currentSortByRef.current = currentSortBy;
     currentSortOrderRef.current = currentSortOrder;
   });

   // Drive the displayed file from the prop. When the MEDIA TYPE changes
   // (video <-> audio <-> image) we crossfade: the old player animates OUT
   // (fade + slide down) while the new one animates IN (fade + slide up). This
   // makes the carousel cross-dissolve instead of snapping, and the send bar
   // below the carousel animates out/in. Same-type skips (e.g. video->video via
   // the carousel) stay seamless — no transition, no remount.
   const fileRef = useRef(file);
   const displayFileRef = useRef(displayFile);
   displayFileRef.current = displayFile;
   const transitionTimerRef = useRef(null);
   useEffect(() => () => {
     if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
   }, []);
   useEffect(() => {
     if (file?.id === fileRef.current?.id && file?.type === fileRef.current?.type) return;
     const prevType = fileRef.current?.type;
     fileRef.current = file;
     if (file?.type === prevType) {
       setPrevFile(null);
       setDisplayFile(file);
       return;
     }
     setPrevFile(displayFileRef.current);
     setDisplayFile(file);
     if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => setPrevFile(null), 320);
   }, [file]);

   const handleKeyDown = useCallback(
     (e) => {
       if (e.key === 'Escape') onClose();
     },
     [onClose]
   );

   useEffect(() => {
     document.body.style.overflow = 'hidden';
     document.body.style.overscrollBehavior = 'none';
     window.addEventListener('keydown', handleKeyDown);
     return () => {
       document.body.style.overflow = '';
       document.body.style.overscrollBehavior = '';
       window.removeEventListener('keydown', handleKeyDown);
     };
   }, [handleKeyDown]);

   const handleTouchStart = (e) => {
     touchStartX.current = e.touches[0].clientX;
   };

   const handleTouchMove = (e) => {
     const dx = e.touches[0].clientX - touchStartX.current;
     if (touchStartX.current < 30 && dx > 0) {
       e.preventDefault();
     }
   };

   const handleTouchEnd = (e) => {
     touchStartX.current = 0;
   };

const handleFileChange = useCallback((newFile) => {
      // Skip if trying to change to the same file
      if (newFile?.id === displayFileRef.current?.id) {
        return;
      }
      setDisplayFile(newFile);
      if (onFileChange) onFileChange(newFile);
    }, [onFileChange]);

    // Repo-native next/previous used by the keyboard bindings inside the
    // players. Without this, VideoPlayer's OWN 'global-media-next' handler
    // navigated through the small hydrated window array (wrapping 1..100) while
    // the cluster navigated the whole repo — the two fought and the key presses
    // ended up cycling inside the window instead of walking the full index.
    const handleRepoNext = useCallback(async () => {
      const f = displayFileRef.current;
      if (!mediaRepo || !f?.id) return;
      const nid = mediaRepo.nextId(f.id);
      if (!nid) return;
      mediaRepo.prefetchWindow(mediaRepo.findIndex(nid), 12);
      const obj = await mediaRepo.getOrHydrate(nid);
      if (obj) handleFileChange(obj);
    }, [mediaRepo, handleFileChange]);

    const handleRepoPrev = useCallback(async () => {
      const f = displayFileRef.current;
      if (!mediaRepo || !f?.id) return;
      const pid = mediaRepo.prevId(f.id);
      if (!pid) return;
      mediaRepo.prefetchWindow(mediaRepo.findIndex(pid), 12);
      const obj = await mediaRepo.getOrHydrate(pid);
      if (obj) handleFileChange(obj);
    }, [mediaRepo, handleFileChange]);

    // Ref bridge so the persistent bottom cluster's controls can drive the
    // CURRENTLY displayed video element. Only the active (cur) video player
    // attaches to this ref; the outgoing (prev) player uses its own internal ref.
    const activeMediaRef = useRef(null);

    // Favorite + send + progress logic for the persistent bottom cluster (driven
    // by the currently displayed file). Mirrors the standalone players' logic.
     const { progress, handleToggleFavorite, handleSend, isFileQueued, isFileSent, sendStatus, sendMessage, sendExtraInfo, isFileLocked, toggleItemLock, checkFileSendStatus } =
       useVaultMediaActions(displayFile, onToggleFavorite);

     // "Jadwalkan" (schedule by date) flow for the currently-opened Media Vault
     // item. If the item isn't in the queue yet, it's enqueued as PENDING first
     // (no immediate send), then the calendar modal pins it to the chosen slot.
     const [scheduleItem, setScheduleItem] = useState(null);
     const [scheduleAllItems, setScheduleAllItems] = useState([]);
     const [scheduleEtaMap, setScheduleEtaMap] = useState({});
     const [showScheduleModal, setShowScheduleModal] = useState(false);

     const handleSchedule = useCallback(async () => {
       const fid = displayFileRef.current?.id;
       if (!fid) return;
       let item = null;
       try {
         const qData = await getSendQueue('pending', 0, 500);
         const existing = (qData?.items || []).find(
           (it) => String(it.file_id) === String(fid) || String(it.qid) === String(fid) || String(it.id) === String(fid)
         );
         if (existing) item = existing;
       } catch {}
       if (!item) {
         try {
           const res = await enqueueSendItem(fid, 'status');
           const qid = res?.qid ?? res?.queueId;
           if (qid == null) return;
           item = { qid };
         } catch {
           return;
         }
       }
       try {
         const [qAll, statusData] = await Promise.all([
           getSendQueue('pending', 0, 500),
           getSendQueueStatuses('whatsapp,channel,status,all'),
         ]);
         const allItems = qAll?.items || [];
         const etaMap = {};
         for (const t of statusData?.timeline || []) etaMap[t.id] = t.eta;
         setScheduleAllItems(allItems);
         setScheduleEtaMap(etaMap);
       } catch {}
       setScheduleItem(item);
       setShowScheduleModal(true);
     }, []);

     const closeScheduleModal = useCallback(() => {
       setShowScheduleModal(false);
       setScheduleItem(null);
     }, []);

     const handleScheduleConfirm = useCallback(async (qid, timestamp) => {
       try {
         await rescheduleQueueItem(qid, timestamp);
         window.dispatchEvent(new Event('media-vault:send-changed'));
         if (checkFileSendStatus) checkFileSendStatus();
       } finally {
         closeScheduleModal();
       }
     }, [checkFileSendStatus, closeScheduleModal]);

     const handleScheduleUnpin = useCallback(async (qid) => {
       try {
         await unpinQueueItem(qid);
         window.dispatchEvent(new Event('media-vault:send-changed'));
         if (checkFileSendStatus) checkFileSendStatus();
       } finally {
         closeScheduleModal();
       }
     }, [checkFileSendStatus, closeScheduleModal]);

     // playlistFiles supplies both the player and the carousel. For folders with many
     // items we intentionally pass the full filtered list so the carousel can scroll
     // through the entire folder instead of wrapping at a fixed window.
     const playlistFiles = useMemo(() => {
       if (!folderFiles || folderFiles.length === 0) {
         return [];
       }

       if (currentFilter === 'all') {
         return favoriteOnly ? folderFiles.filter(f => f.is_favorite === 1) : folderFiles;
       }
       if (currentFilter === 'folder') {
         return favoriteOnly ? folderFiles.filter(f => f.is_favorite === 1) : folderFiles;
       }

        const filtered = folderFiles.filter(f => f.type === currentFilter);
        return favoriteOnly ? filtered.filter(f => f.is_favorite === 1) : filtered;
      }, [folderFiles, currentFilter, favoriteOnly]);

     // Index-driven playback: when a repository + folder scope are supplied we
     // stop passing the full folder array around. Only a bounded hydrated window
     // around the ACTIVE item is materialized (Carousel + controls). Next/prev
     // navigate through the repo (O(1), always wraps).
      const [windowFiles, setWindowFiles] = useState(null);
      const scopeJson = mediaRepo && folderScope ? JSON.stringify(folderScope) : null;
      const [indexReady, setIndexReady] = useState(false);
      useEffect(() => {
        if (!mediaRepo || !folderScope || !displayFile?.id) {
          setWindowFiles(null);
          setIndexReady(false);
          return;
        }
        let cancelled = false;
        let ready = false;
        (async () => {
          try {
            ready = await mediaRepo.ensureIndex(folderScope);
          } catch {}
          if (cancelled) return;
          setIndexReady(ready);
          if (!ready) {
            setWindowFiles(null);
            return;
          }
          const idx = mediaRepo.findIndex(displayFile.id);
          if (idx < 0) return;
          await mediaRepo.prefetchWindow(idx, WINDOW_RADIUS);
          if (cancelled) return;
          setWindowFiles(mediaRepo.getWindow(idx, WINDOW_RADIUS).filter(Boolean));
        })();
        return () => { cancelled = true; };
      }, [displayFile?.id, scopeJson, mediaRepo, folderScope]);

      const useRepo = !!(mediaRepo && folderScope && displayFile?.id && indexReady);
      const clusterFiles = useRepo ? (windowFiles || []) : playlistFiles;

      const renderPlayer = useCallback((f, startPaused = false, isCur = false) => {
       if (!f) return null;
         if (f.type === 'video') {
           return (
              <VideoPlayer
                file={f}
 folderFiles={playlistFiles}
                 currentSortBy={currentSortBy}
                 currentSortOrder={currentSortOrder}
                  onClose={onClose}
                  onFileChange={handleFileChange}
                  onToggleFavorite={onToggleFavorite}
                  embedded
                  mediaRef={isCur ? activeMediaRef : undefined}
                  startPaused={startPaused}
                   onSend={handleSend}
                   lockEnabled={carouselLock}
                   onToggleLock={toggleCarouselLock}
                   onRepoNext={handleRepoNext}
                   onRepoPrev={handleRepoPrev}
                   isFileQueued={isFileQueued}
                   isFileSent={isFileSent}
                   isFileLocked={isFileLocked}
                   onToggleItemLock={toggleItemLock}
                    sendStatus={sendStatus}
                   sendMessage={sendMessage}
                   sendExtraInfo={sendExtraInfo}
                   onSchedule={handleSchedule}
                 />
             );
    }
    if (f.type === 'audio') {
      return (
        <VaultAudioPlayer
          file={f}
 folderFiles={playlistFiles}
              currentSortBy={currentSortBy}
              currentSortOrder={currentSortOrder}
              onClose={onClose}
              onAudioChange={handleFileChange}
              onToggleFavorite={onToggleFavorite}
              sharedAudioRef={sharedAudioRef}
              audioReady={audioReady}
              startPaused={startPaused}
              embedded
              lockEnabled={carouselLock}
              onToggleLock={toggleCarouselLock}
              onSchedule={handleSchedule}
            />
          );
        }
         if (f.type === 'image') {
            return (
              <ImageViewer
                file={f}
                folderFiles={playlistFiles}
                currentSortBy={currentSortBy}
                currentSortOrder={currentSortOrder}
                onClose={onClose}
                onImageChange={handleFileChange}
                onLoadFolderFiles={onLoadFolderFiles}
                onToggleFavorite={onToggleFavorite}
                embedded
                lockEnabled={carouselLock}
                onToggleLock={toggleCarouselLock}
                onRepoNext={handleRepoNext}
                onRepoPrev={handleRepoPrev}
                onSend={handleSend}
                isFileQueued={isFileQueued}
                isFileSent={isFileSent}
                sendStatus={sendStatus}
                sendMessage={sendMessage}
                sendExtraInfo={sendExtraInfo}
                onSchedule={handleSchedule}
              />
        );
        }
        return null;
      }, [playlistFiles, currentSortBy, currentSortOrder, onClose, handleFileChange, onToggleFavorite, onLoadFolderFiles, sharedAudioRef, audioReady, handleRepoNext, handleRepoPrev, carouselLock, toggleCarouselLock, handleSend, isFileQueued, sendStatus, sendMessage, sendExtraInfo, handleSchedule]);

     return (
      <div
        data-debug-id="1.1.9"
        data-debug-name="MediaModal"
        data-debug-type="modal"
        className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
        onClick={onClose}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ overscrollBehavior: 'none' }}
      >
        {!hydrated ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-neutral-500 text-xs">Opening media...</p>
          </div>
        ) : (
         <div
          data-debug-id="1.1.9.1"
          data-debug-name="Carousel"
          data-debug-type="player"
          className="relative w-full h-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
         >
             {/* Outgoing player (during a type-change crossfade): fades out in
                 place. Only the MEDIA + header fade here — the bottom cluster is
                 rendered ONCE below (outside these layers) so it slides smoothly
                 instead of teleporting. startPaused so the outgoing audio player
                 does not replay/keep sounding while it fades. */}
             {prevFile && (
               <div
                 key={'prev-' + prevFile.type}
                 className="absolute inset-0 z-0 animate-out fade-out duration-300"
                 style={{ animationFillMode: 'forwards' }}
               >
                 {renderPlayer(prevFile, true, false)}
               </div>
             )}
             {/* Incoming / active player: fades in on a type change, updates
                 seamlessly on a same-type skip (no remount, same key type). */}
             <div
               key={'cur-' + displayFile?.type}
               className="absolute inset-0 z-10 animate-in fade-in duration-300"
             >
{renderPlayer(displayFile, false, true)}
             </div>

             {/* Persistent bottom cluster: controls + carousel, owned
                 once by MediaModal so it slides across type swaps. Never remounts
                 (no key) → carousel centering stays continuous, no teleport. */}
              <VaultBottomCluster
                type={displayFile?.type}
                files={clusterFiles}
                currentFile={displayFile}
                onSelect={handleFileChange}
                sortBy={currentSortBy}
                sortOrder={currentSortOrder}
                activeMediaRef={activeMediaRef}
                sharedAudioRef={sharedAudioRef}
                 onClose={onClose}
                 onToggleFavorite={onToggleFavorite}
                 onPreviousEnd={onPreviousEnd}
                 onNextEnd={onNextEnd}
                 repo={useRepo ? mediaRepo : null}
                 lockEnabled={carouselLock}
                 allFiles={playlistFiles}
              />

              {/* Send progress pills: rendered once, top-right of the modal,
                  driven by the cluster's send action (not per-player). */}
               {progress && (
                 <div className="absolute top-16 right-3 z-50 pointer-events-none">
                   <SendProgressPills progress={progress} />
                 </div>
               )}

               {showScheduleModal && (
                 <RescheduleModal
                   open={showScheduleModal}
                   item={scheduleItem}
                   allItems={scheduleAllItems}
                   etaMap={scheduleEtaMap}
                   onClose={closeScheduleModal}
                   onConfirm={handleScheduleConfirm}
                   onUnpin={handleScheduleUnpin}
                 />
               )}
           </div>
         )}
       </div>
     );
   }

export default MediaModal;
