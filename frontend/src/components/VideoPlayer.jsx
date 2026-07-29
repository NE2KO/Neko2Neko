import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Heart, Send, Share2, Trash2, Ban, RotateCw, Pencil } from 'lucide-react';
import MediaLayout from './MediaLayout';
import MediaControls from './MediaControls';
import Hls from 'hls.js';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { useSendProgress } from '../hooks/useSendProgress';
import { useWaUnsupported } from '../hooks/useWaUnsupported';
import { sendToTelegram, sendToChannel, sendToStatus, sendToAll, removeSendQueueItem, cancelSendQueueItem, retrySendQueueItem } from '../utils/api';
import SendProgressPills from './SendProgressPills';
import WaLogo from './icons/WaLogo';
import VaultActionBar from './VaultActionBar';
import './VideoPlayer.css';

export default function VideoPlayer({
   file,
   folderFiles = [],
   currentSortBy,
   currentSortOrder,
   onClose,
    onFileChange,
     onToggleFavorite,
     queueMode = false,
     queueItem = null,
     onQueueChanged = null,
     onEditCaption = null,
      bottomClusterAnim = null,
      embedded = false,
      mediaRef = null,
      startPaused = false,
      }) {
   const localVideoRef = useRef(null);
   const videoRef = mediaRef || localVideoRef;
   const hlsRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const isFav = useIsFavorite(file?.id, file?.is_favorite ? 1 : 0);
    const handleToggleFavorite = useCallback(async () => {
      if (!file?.id || !onToggleFavorite) return;
      try { await onToggleFavorite(file); }
      catch {}
    }, [file, onToggleFavorite]);

    const waUnsupported = useWaUnsupported(file);
    const { progress, start: startProgress } = useSendProgress();

const handleSend = useCallback(async (target) => {
        if (!file?.id) return;
        let res;
        try {
          if (target === 'telegram') res = await sendToTelegram(file.id);
          else if (target === 'channel') res = await sendToChannel(file.id);
          else if (target === 'status') res = await sendToStatus(file.id);
          else if (target === 'all') res = await sendToAll(file.id);
          if (res && res.qid) startProgress(res.qid);
          if (res) try { window.dispatchEvent(new CustomEvent('media-vault:send-changed')); } catch {}
        } catch {}
      }, [file?.id, startProgress]);

     // In queue mode the header's right side shows "Hapus dari riwayat" instead
     // of the favorite (love) button — the queue item has no favorite concept.
     const handleQueueRemove = useCallback(async () => {
       if (!queueItem?.qid) return;
       try { await removeSendQueueItem(queueItem.qid); } catch {}
       if (onQueueChanged) onQueueChanged();
       if (onClose) onClose();
     }, [queueItem?.qid, onQueueChanged, onClose]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !file?.id) return;

      setIsLoading(true);
      setError(null);
      hlsRef.current = null;

      const startedRef = { current: false };

       function onPlay() {
         setIsPlaying(true);
         const playbackState = usePlaybackStore.getState();
         if (playbackState.audioRef && !playbackState.audioRef.paused) {
           playbackState.audioRef.pause();
         }
       }
      function onPause() { setIsPlaying(false); }
      function onPlaying() { startedRef.current = true; setIsLoading(false); }
      function onWaiting() { setIsLoading(true); }
      function onCanPlay() { setIsLoading(false); }

      let hls = null;
      let usingHls = false;
      function cleanupHls() {
        if (hls) { try { hls.destroy(); } catch {} hls = null; }
      }

       function onLoadedMetadata() {
         video.currentTime = 0;
         if (startPaused) { setIsLoading(false); return; }
         video.play().catch(() => {});
       }

      function startHLS() {
        if (usingHls) return;
        usingHls = true;
        video.removeEventListener('error', onError);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        try { video.pause(); } catch {}
        video.removeAttribute('src');
        video.load();

        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 8,
            maxMaxBufferLength: 16,
            backbufferLength: 8,
            startLevel: -1,
            maxBandwidth: 2000000,
          });
          hlsRef.current = hls;
          hls.loadSource(`/stream/video/${file.id}/hls/playlist.m3u8`);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.currentTime = 0;
            setIsLoading(false);
            if (!startPaused) video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              console.error('[VideoPlayer] HLS fatal error:', data);
              cleanupHls();
              hlsRef.current = null;
              setError('Gagal memutar via HLS. Coba download & buka dengan VLC/mpv.');
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = `/stream/video/${file.id}/hls/playlist.m3u8`;
          video.load();
        } else {
          setError('Browser tidak support format ini. Coba download & buka dengan VLC/mpv.');
        }
      }

      function onError(e) {
        const videoEl = videoRef.current;
        const errorCode = videoEl?.error?.code;
        const errorMessage = videoEl?.error?.message;
        const errorType = errorCode === 1 ? 'ABORTED' :
                           errorCode === 2 ? 'NETWORK' :
                           errorCode === 3 ? 'DECODE' :
                           errorCode === 4 ? 'SRC_NOT_SUPPORTED' : 'UNKNOWN';
        console.error('[VideoPlayer] direct stream error:', { code: errorCode, type: errorType, message: errorMessage, event: e });

        if (errorType === 'SRC_NOT_SUPPORTED') {
          console.warn('[VideoPlayer] direct stream not supported, falling back to HLS');
          startHLS();
          return;
        }

        const ext = (file.name || '').toLowerCase().match(/\.[^/.]+$/)?.[0] || '';
        let errorMsg = `Gagal memuat video (${errorType})`;
        if (errorMessage) errorMsg += `: ${errorMessage}`;
        if (ext === '.hevc' || ext === '.h265') {
          errorMsg += ' Format .hevc/.h265 tidak bisa diputar langsung di browser. Coba download & buka dengan VLC/mpv.';
        } else {
          errorMsg += ' Browser tidak support format ini. Coba file .mp4 atau .webm, atau download dengan VLC/mpv.';
        }
        setError(errorMsg);
      }

      video.currentTime = 0;
      video.src = `/stream/video/${file.id}`;
      video.load();

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);

      const watchdog = setTimeout(() => {
        if (!startedRef.current) {
          console.warn('[VideoPlayer] direct stream timeout — falling back to HLS');
          startHLS();
        }
      }, 15000);

       return () => {
         clearTimeout(watchdog);
         video.removeEventListener('loadedmetadata', onLoadedMetadata);
         video.removeEventListener('play', onPlay);
         video.removeEventListener('pause', onPause);
         video.removeEventListener('playing', onPlaying);
         video.removeEventListener('waiting', onWaiting);
         video.removeEventListener('canplay', onCanPlay);
         video.removeEventListener('error', onError);
         cleanupHls();
         hlsRef.current = null;
         try { video.pause(); } catch {}
       };
     }, [file?.id]);

     const displayName = file
      ? file.displayName || file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
      : 'Memutar Video...';

     const headerNode = (
       <>
         <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors shrink-0">
           <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
         </button>
          <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none px-2 max-w-[70%]">
            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-[0.2em]" title={displayName ? 'Now Playing: ' + displayName : 'Now Playing'}>Now Playing</div>
            <div className="text-sm font-semibold text-white truncate" title={displayName}>{displayName}</div>
          </div>
           <div className="ml-auto flex items-center gap-1">
             {queueMode ? (
               <>
              {queueItem?.status === 'pending' && (
                    <>
                      <button
                        onClick={() => { cancelSendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged()); }}
                        className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-red-400"
                        title="Batalkan pengiriman"
                       >
                         <Ban size={20} />
                       </button>
                       {onEditCaption && (
                        <button
                          onClick={onEditCaption}
                          className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-cyan-400"
                          title="Edit caption"
                        >
                          <Pencil size={18} />
                        </button>
                      )}
                    </>
                  )}
                 {queueItem?.status === 'failed' && (
                   <button
                     onClick={() => { retrySendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged()); }}
                     className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-emerald-400"
                     title="Ulangi pengiriman"
                   >
                     <RotateCw size={20} />
                   </button>
                 )}
                 <button
                   onClick={handleQueueRemove}
                   className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-red-400"
                   title="Hapus dari riwayat"
                 >
                   <Trash2 size={20} />
                 </button>
               </>
             ) : (
               <button
                 onClick={handleToggleFavorite}
                 className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-white"
                 title={isFav ? 'Remove from favorites' : 'Add to favorites'}
               >
                 <Heart size={20} className={isFav ? 'fill-red-500 text-red-500' : ''} />
               </button>
             )}
           </div>
       </>
     );

      const mainContent = (
        <div className="media-wrapper">
          <div className="flex w-full h-full flex-col sm:flex-row">
            <div className="relative w-full h-full">
              <video ref={videoRef} className="w-full h-full" playsInline preload="metadata" />
              {error && (
                <div className="loading-overlay">
                  <div className="text-center p-4">
                    <svg className="w-10 h-10 mx-auto mb-2 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <p className="text-red-300 text-sm font-medium">{error}</p>
                  </div>
                </div>
              )}
              {isLoading && !error && (
                <div className="loading-overlay"><div className="spinner" /></div>
              )}
            </div>
          </div>
          {progress && (
            <div className="absolute top-16 right-3 z-40">
              <SendProgressPills progress={progress} />
            </div>
          )}
         </div>
       );

    return (
           <div data-debug-id="1.1.9.2" data-debug-name="VideoPlayer" data-debug-type="player" className="h-full">
            <MediaLayout
              header={headerNode}
              embedded={embedded}
              files={embedded ? undefined : folderFiles}
              currentFile={file}
              onSelect={onFileChange}
              sortBy={currentSortBy}
              sortOrder={currentSortOrder}
               autoHide={isPlaying}
               bottomBarOverlay
               bottomClusterAnim={bottomClusterAnim}
               controls={embedded ? undefined : (
                 <MediaControls type="video" mediaRef={videoRef} folderFiles={folderFiles} currentFile={file} onFileChange={onFileChange} />
              )}
               bottomBar={embedded ? undefined : (queueMode ? undefined : (
                 <VaultActionBar
                   file={file}
                   isFav={isFav}
                   onToggleFavorite={handleToggleFavorite}
                   onSend={handleSend}
                   waUnsupported={waUnsupported}
                   hideLove
                 />
               ))}
            >
              {mainContent}
            </MediaLayout>
           </div>
         );
    }
