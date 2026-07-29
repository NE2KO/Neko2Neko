import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import VideoPlayer from './VideoPlayer';
import VaultAudioPlayer from './VaultAudioPlayer';
import ImageViewer from './ImageViewer';
import VaultBottomCluster from './VaultBottomCluster';
import VaultActionBar from './VaultActionBar';
import SendProgressPills from './SendProgressPills';
import { useVaultMediaActions } from '../hooks/useVaultMediaActions';
import { buildPlaylistWindow } from '../utils/playlistWindow';

function MediaModal({ file, folderFiles, currentFilter, currentSortBy, currentSortOrder = 'asc', favoriteOnly = false, onClose, onFileChange, onLoadFolderFiles, onToggleFavorite, sharedAudioRef, audioReady }) {
   const [displayFile, setDisplayFile] = useState(file);
   const [prevFile, setPrevFile] = useState(null);
   const touchStartX = useRef(0);
   const [hydrated, setHydrated] = useState(false);
   const hydratingRef = useRef(false);

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

    // Ref bridge so the persistent bottom cluster's controls can drive the
    // CURRENTLY displayed video element. Only the active (cur) video player
    // attaches to this ref; the outgoing (prev) player uses its own internal ref.
    const activeMediaRef = useRef(null);

    // Favorite + send + progress logic for the persistent bottom cluster (driven
    // by the currently displayed file). Mirrors the standalone players' logic.
    const { isFav, waUnsupported, progress, handleToggleFavorite, handleSend } =
      useVaultMediaActions(displayFile, onToggleFavorite);

    // Get filtered + windowed playlist — never pass the full 72k array to carousel/player.
    // buildPlaylistWindow returns a centered window (radius=125 → ~251 items max).
    const playlistFiles = useMemo(() => {
      if (!folderFiles || folderFiles.length === 0) {
        return [];
      }

      let filtered;
      if (currentFilter === 'all') {
        filtered = folderFiles;
      } else if (currentFilter !== 'folder') {
        filtered = folderFiles.filter(f => f.type === currentFilter);
      } else {
        filtered = folderFiles;
      }

      // Apply favorites filter (matches vault grid's favoriteOnly toggle)
      if (favoriteOnly) {
        filtered = filtered.filter(f => f.is_favorite === 1);
      }

      // Window it to avoid passing 72k to carousel/player
      const result = buildPlaylistWindow(filtered, displayFile?.id, 125);
      return result.window;
    }, [folderFiles, currentFilter, displayFile?.id, favoriteOnly]);

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
           />
        );
       }
       return null;
     }, [playlistFiles, currentSortBy, currentSortOrder, onClose, handleFileChange, onToggleFavorite, onLoadFolderFiles, sharedAudioRef, audioReady]);

     // Video/image show a send bar (Tele/WA/All) at the very bottom; audio does
     // not. The bottom cluster slides DOWN (translateY 3.5rem) in audio mode to
     // drop the carousel to the bottom and hide the (empty) send-bar slot.
     const hasSendBar = (t) => t === 'video' || t === 'image';
     const isAudioMode = displayFile?.type === 'audio';

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

             {/* Persistent bottom cluster: controls + carousel + send bar, owned
                 once by MediaModal so it slides across type swaps. Never remounts
                 (no key) → carousel centering stays continuous, no teleport. */}
             <VaultBottomCluster
               type={displayFile?.type}
               files={playlistFiles}
               currentFile={displayFile}
               onSelect={handleFileChange}
               sortBy={currentSortBy}
               sortOrder={currentSortOrder}
               activeMediaRef={activeMediaRef}
               sharedAudioRef={sharedAudioRef}
               isAudioMode={isAudioMode}
               onClose={onClose}
               onToggleFavorite={onToggleFavorite}
               bottomBar={hasSendBar(displayFile?.type) ? (
                  <VaultActionBar
                    file={displayFile}
                    isFav={isFav}
                    onToggleFavorite={handleToggleFavorite}
                    onSend={handleSend}
                    waUnsupported={waUnsupported}
                    hideLove={displayFile?.type === 'video'}
                    floating
                  />
               ) : null}
             />

             {/* Send progress pills: rendered once, top-right of the modal,
                 driven by the cluster's send action (not per-player). */}
             {progress && (
               <div className="absolute top-16 right-3 z-50 pointer-events-none">
                 <SendProgressPills progress={progress} />
               </div>
             )}
         </div>
        )}
      </div>
    );
}

export default MediaModal;
