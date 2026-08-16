import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Heart, Ban, RotateCw, Pencil, Calendar, ShieldBan, ShieldCheck } from 'lucide-react';
import MediaLayout from './MediaLayout';
import MediaControls from './MediaControls';
import Hls from 'hls.js';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { useSendProgress } from '../hooks/useSendProgress';
import { useWaUnsupported } from '../hooks/useWaUnsupported';
import { sendToTelegram, sendToChannel, sendToStatus, sendToAll, cancelSendQueueItem, retrySendQueueItem } from '../utils/api';
import SendProgressPills from './SendProgressPills';
import VaultActionBar from './VaultActionBar';
import CarouselLockToggle from './CarouselLockToggle';
import WaLogo from './icons/WaLogo';
import SendStatusPill from './SendStatusPill';
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
       onReschedule = null,
       onSchedule = null,
        bottomClusterAnim = null,
      embedded = false,
      mediaRef = null,
      startPaused = false,
       onSend = null,
       lockEnabled = true,
       onToggleLock = null,
       onToggleItemLock = null,
       isFileLocked = false,
       onRepoNext = null,
      onRepoPrev = null,
       isFileQueued = false,
       isFileSent = false,
       sendStatus = 'idle',
       sendMessage = '',
       sendExtraInfo = null,
       }) {
   const localVideoRef = useRef(null);
   const videoRef = mediaRef || localVideoRef;
   const hlsRef = useRef(null);
   const titleRef = useRef(null);
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
    const sendBlocked = isFileQueued || isFileSent || waUnsupported;
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
        } catch {}
      }, [file?.id, startProgress]);

     // In queue mode the header's right side shows send/cancel actions instead
     // of the favorite (love) button — the queue item has no favorite concept.

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

  // Toggle play/pause when Spacebar is pressed from App-level handler
  useEffect(() => {
    const handler = () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      } catch {}
    };
    window.addEventListener('global-media-toggle-play', handler);
    return () => window.removeEventListener('global-media-toggle-play', handler);
  }, []);

  // Toggle favorite when L key is pressed from App-level handler
  useEffect(() => {
    const handler = () => {
      if (!onToggleFavorite) return;
      onToggleFavorite();
    };
    window.addEventListener('global-media-toggle-favorite', handler);
    return () => window.removeEventListener('global-media-toggle-favorite', handler);
  }, [onToggleFavorite]);

  // Next / previous / shuffle / skip / send from App-level keyboard bindings
  useEffect(() => {
    const handler = (e) => {
      const video = videoRef.current;
      if (e.type === 'global-media-next') {
        if (onRepoNext) { onRepoNext(); return; }
        if (!onFileChange || !folderFiles.length) return;
        const curIdx = folderFiles.findIndex(f => f.id === file?.id);
        const nextIdx = curIdx < folderFiles.length - 1 ? curIdx + 1 : 0;
        if (video) video.pause();
        onFileChange(folderFiles[nextIdx]);
      } else if (e.type === 'global-media-previous') {
        if (onRepoPrev) { onRepoPrev(); return; }
        if (!onFileChange || !folderFiles.length) return;
        const curIdx = folderFiles.findIndex(f => f.id === file?.id);
        const prevIdx = curIdx > 0 ? curIdx - 1 : folderFiles.length - 1;
        if (video) video.pause();
        onFileChange(folderFiles[prevIdx]);
      } else if (e.type === 'global-media-toggle-shuffle') {
        // No-op for video player; shuffle is handled at playlist level
      } else if (e.type === 'global-media-skip-minus5') {
        if (video) video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (e.type === 'global-media-skip-plus5') {
        if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      } else if (e.type === 'global-media-send-status') {
        if (onSend && !isFileLocked) onSend('status');
      }
    };
    // When the vault provides repo-native navigation (onRepoNext/onRepoPrev),
    // the bottom cluster's MediaControls is the single n/m handler — if this
    // player ALSO listened to these events we'd get two racing navigators per
    // keypress (one could wrap inside the hydrated window, showing "old" items).
    // Same in queue mode: SendQueuePlayer owns n/m on the queue list. So we only
    // register next/previous here when nothing else is navigating for us.
    const singleNavigator = (onRepoNext && onRepoPrev) || queueMode;
    const events = singleNavigator
      ? [
          // Skip ±5 is intentionally omitted here: the bottom cluster (MediaControls)
          // owns G/H in vault & queue mode — having the player also apply ±5 would
          // double the jump to ±10s per press.
          'global-media-toggle-shuffle',
          'global-media-send-status',
        ]
      : [
          'global-media-next', 'global-media-previous',
          'global-media-toggle-shuffle',
          'global-media-skip-minus5', 'global-media-skip-plus5', 'global-media-send-status',
        ];
    events.forEach((evt) => window.addEventListener(evt, handler));
    return () => events.forEach((evt) => window.removeEventListener(evt, handler));
  }, [onFileChange, folderFiles, file, onSend, onRepoNext, onRepoPrev, queueMode, isFileLocked]);

  const displayName = file
      ? file.displayName || file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
      : 'Memutar Video...';

      const headerNode = (
        <>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors shrink-0 focus:outline-none focus:ring-0">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div ref={titleRef} className="flex-1 min-w-0 text-center px-2 pl-16 pointer-events-none">
            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-[0.2em]" title={displayName ? 'Now Playing: ' + displayName : 'Now Playing'}>Now Playing</div>
            <div className="text-sm font-semibold text-white truncate" title={displayName}>{displayName}</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {onToggleItemLock && (
              <button
                onClick={onToggleItemLock}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-2 transition-all duration-150 active:scale-90 focus:outline-none focus:ring-0 ${
                  isFileLocked
                    ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
                title={isFileLocked ? 'Kirim diblokir — tombol kirim & K dimatikan (klik untuk buka)' : 'Blokir kirim — matikan tombol kirim & K'}
              >
                {isFileLocked ? <ShieldBan size={15} className="text-red-400 fill-red-400/20" /> : <ShieldCheck size={15} />}
                <span className="text-[11px] font-semibold leading-none">{isFileLocked ? 'Blok' : 'Buka'}</span>
              </button>
            )}
            {onToggleLock && (
              <CarouselLockToggle lockEnabled={lockEnabled} onToggleLock={onToggleLock} />
            )}
            {onSchedule && (
              <button
                onClick={() => onSchedule(file)}
                className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-cyan-400 focus:outline-none focus:ring-0"
                title="Jadwalkan berdasarkan tanggal"
              >
                <Calendar size={20} />
              </button>
            )}
             {queueMode ? (
                 <>
                 {queueItem?.status === 'pending' && (
                       <>
                        <button
                          onClick={() => { cancelSendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged()); }}
                          className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-red-400 focus:outline-none focus:ring-0"
                          title="Batalkan pengiriman"
                         >
                           <Ban size={20} />
                         </button>
                         {onReschedule && (
                           <button
                             onClick={() => onReschedule(queueItem)}
                             className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-cyan-400 focus:outline-none focus:ring-0"
                             title="Jadwalkan ulang"
                           >
                             <Calendar size={20} />
                           </button>
                         )}
                         {onEditCaption && (
                          <button
                            onClick={onEditCaption}
                            className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-cyan-400 focus:outline-none focus:ring-0"
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
                       className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-emerald-400 focus:outline-none focus:ring-0"
                       title="Ulangi pengiriman"
                     >
                       <RotateCw size={20} />
                     </button>
                   )}
                 </>
              ) : (
                 <>
                 <button
                   onClick={handleToggleFavorite}
                   className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-0"
                   title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                 >
                   <Heart size={20} className={isFav ? 'fill-red-500 text-red-500' : ''} />
                 </button>
                     {embedded && !queueMode && onSend && (
                       <>
                          <button
                            onClick={() => !sendBlocked && !isFileLocked && onSend('status')}
                            disabled={sendBlocked || isFileLocked}
                            className={`p-2 rounded-full transition-colors ${sendBlocked || isFileLocked ? 'text-neutral-500 cursor-not-allowed' : 'text-white/70 hover:bg-white/10 hover:text-emerald-400'} focus:outline-none focus:ring-0`}
                            title={isFileLocked ? 'Item terkunci — buka kunci dulu untuk mengirim' : isFileQueued ? 'Sudah dalam antrian' : isFileSent ? 'Sudah pernah dikirim' : waUnsupported ? 'Codec tidak didukung WhatsApp (bukan H.264)' : 'Kirim ke WhatsApp Status'}
                          >
                           <WaLogo size={18} />
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
                    isFileQueued={isFileQueued}
                    isFileSent={isFileSent}
                    isFileLocked={isFileLocked}
                  />
                ))}
            >
              {mainContent}
            </MediaLayout>
           </div>
         );
    }
