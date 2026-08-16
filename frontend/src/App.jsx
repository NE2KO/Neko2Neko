import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Bell, Upload as UploadIcon, X, Trash2, Bug, Heart, Send, SlidersHorizontal, CheckSquare } from 'lucide-react';
import { fetchFolder, fetchFileById, clearResponseCache, toggleFavorite, fetchPlaylistPlay } from './utils/api';
import { loadFavorites } from './utils/playlistApi';
import { createMediaRepository } from './utils/mediaRepository';
import { safeParseTrackFilter, safeParseTrackSearchQuery, applyTrackFilter, applyTrackSearch } from './utils/trackFilter';
import { cancelAutoPlayPending } from './utils/autoPlayPending';

// Index-driven playback repository (singleton, holds ordered ID indexes + a
// small LRU object cache OUTSIDE React). Grid/playback are decoupled: the modal
// navigates through this, never through a full media array.
const mediaRepo = createMediaRepository();

// Initial page size when opening a folder. The backend caps a folder at 5000
// items by default, which makes opening a large folder ship a huge JSON payload
// up front ("berat"). We load a smaller first page and let the grid's existing
// infinite-scroll pull the rest as the user scrolls. 500 keeps the initial
// parse + React state small; the grid is virtualized so only visible rows render.
const INITIAL_FOLDER_LIMIT = 500;
const PAGE_SIZE = 500;
let hasRestoredFromSnapshot = false;
import MediaGrid from './components/MediaGrid';
import MediaModal from './components/MediaModal';
import MonitoringView from './components/MonitoringView';
import DownloaderPage from './monitoring/pages/DownloaderPage';
import AdbTransfer from './components/AdbTransfer';
import WhatsAppView from './components/WhatsAppView';
import UploadsMonitor from './components/UploadsMonitor';
import useDebugStore from './debug/useDebugStore';
import PlaylistView from './components/PlaylistView';
import MusicPlayer from './components/Music';
import VaultAudioPlayer from './components/VaultAudioPlayer';
import MiniPlayer from './components/MiniPlayer';
import ServiceStoppedBanner from './components/ServiceStoppedBanner';
import ScrcpyView from './components/ScrcpyView';
import SendQueueView from './components/SendQueueView';
import FilterPanel from './components/FilterPanel';

// import UploadQueue from './components/UploadQueue'; // Removed
import { useToast } from './components/Toast';
import useFolderSortStore from './store/folderSortStore';
import useFolderMetaSortStore from './store/folderMetaSortStore';
import usePlaybackStore from './store/playbackStore';
import useFavoritesStore from './store/favoritesStore';
import { useUploadQueueLogic } from './hooks/useUploadQueueLogic'; // New hook import
import usePlaylistStore from './store/playlistStore';
import { applySink, getStoredDevice, isOutputRoutingSupported } from './utils/audioOutput';
import { ErrorBoundary } from './components/ErrorBoundary';
import { pageCacheSet, pageCacheGet, pageCacheEvict, pageCacheStats, pageCacheInit } from './utils/pageCache.js';
import { getFrontendSnapshot, trackThumbnails, trackWorkerHeap } from './utils/resourceManager.js';

// === STABLE MERGE FUNCTION (APPEND NEW, UPDATE CHANGED) ===
function safeParseTrackSort() {
  try {
    const s = JSON.parse(localStorage.getItem('trackSort') || '{}');
    if (s && typeof s === 'object' && s.by) return { by: s.by, order: s.order || 'asc' };
  } catch { /* ignore */ }
  return { by: null, order: 'asc' };
}

function stableMerge(oldList = [], newList = []) {
  if (!oldList.length) return newList;
  if (!newList.length) return oldList;

  // PHASE 3: Single-pass stable merge using index map (avoids repeated findIndex)
  const oldMap = new Map(oldList.map(i => [i.id, i]));
  const result = [...oldList];
  const indexMap = new Map(result.map((item, idx) => [item.id, idx]));

  for (const newItem of newList) {
    const oldItem = oldMap.get(newItem.id);
    if (!oldItem) {
      result.push(newItem);
      indexMap.set(newItem.id, result.length - 1);
    } else if (oldItem.type !== newItem.type || oldItem.name !== newItem.name) {
      const idx = indexMap.get(newItem.id);
      if (idx !== undefined) {
        result[idx] = { ...oldItem, ...newItem };
      }
    }
  }

  return result;
}

// === ROUTE STATE MACHINE ===
import { parseHash, LOVED_PLAYLIST_ID } from './utils/routeParser';

function DebugToggle() {
  const { enabled, toggle } = useDebugStore();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Bug size={14} className={enabled ? 'text-emerald-400' : 'text-neutral-600'} />
        <span className={`text-xs font-medium ${enabled ? 'text-emerald-400' : 'text-neutral-500'}`}>
          Debug
        </span>
      </div>
      <button
        onClick={toggle}
        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
          enabled ? 'bg-emerald-500' : 'bg-neutral-700'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function App() {
  // === SNAPSHOT-BASED STATE ===
  const [state, setState] = useState({
    folders: [],
    allFolders: [],
    items: [],
    lastValidItems: [],
    stable: false,
    selectedFile: null,
    loading: false,
    error: null,
    currentPath: '',
    currentFolderId: null,
    currentFilter: 'all',
    currentSortBy: null,
    currentSortOrder: 'asc',
    loadedSortBy: null,
    loadedSortOrder: 'asc',
    updateNotification: '',
     hasMore: false,
     fetchingMore: false,
     nextCursor: null,
     prevCursor: null,
     pagesFetched: 0,
     stats: null,
  });

const [sidebarOpen, setSidebarOpen] = useState(false);
   const initialRoute = parseHash(window.location.hash, sessionStorage);
    const initialView = initialRoute.type === 'playlists' ? 'playlists'
       : initialRoute.type === 'playlist-detail' ? 'playlists'
        : initialRoute.type === 'monitoring' ? 'monitoring'
        : initialRoute.type === 'downloader' ? 'downloader'
        : initialRoute.type === 'adb' ? 'adb'
        : initialRoute.type === 'audio' ? 'audio'
        : initialRoute.type === 'vault-audio' ? 'vaultAudio'
        : initialRoute.type === 'scrcpy' ? 'scrcpy'
        : initialRoute.type === 'whatsapp' ? 'whatsapp'
        : initialRoute.type === 'sendqueue' ? 'sendqueue'
        : 'media';
    const [view, setView] = useState(initialView);
    const viewRef = useRef(view);
    useEffect(() => { viewRef.current = view; }, [view]);

    const resumedFromSnapshotRef = useRef(false);

     // Playlist state
    const [playlistQueue, setPlaylistQueue] = useState(null);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
    const [playlistMetadata, setPlaylistMetadata] = useState(null);

    const playlistQueueRef = useRef(playlistQueue);
    const playlistMetadataRef = useRef(playlistMetadata);
    useEffect(() => { playlistQueueRef.current = playlistQueue; }, [playlistQueue]);
    useEffect(() => { playlistMetadataRef.current = playlistMetadata; }, [playlistMetadata]);

    const playerMode = usePlaybackStore(s => s.playerMode);
    const hasActivePlayback = usePlaybackStore(s => s.queue?.length > 0);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
    const [panelFilterType, setPanelFilterType] = useState('all');
    const [panelSortBy, setPanelSortBy] = useState(null);
    const [panelSortOrder, setPanelSortOrder] = useState('asc');
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

     // Restore playlist state from sessionStorage/localStorage on mount when entering audio view
     useEffect(() => {
       if (hasRestoredFromSnapshot) return;
       if (initialView !== 'audio') return;
       (async () => {
        try {
          // Repopulate the single-file identity from the URL so a bare-file audio
          // URL survives a reload (useRef is lost on reload). Fall back to a
          // previously-mirrored id in storage.
          if (initialRoute.fileId) currentAudioFileIdRef.current = initialRoute.fileId;
          else {
            const savedFid = sessionStorage.getItem('currentAudioFileId') || localStorage.getItem('currentAudioFileId');
            if (savedFid) currentAudioFileIdRef.current = savedFid;
          }

          const savedQueue = sessionStorage.getItem('playlistQueue') || localStorage.getItem('playlistQueue');
          const savedMetadata = sessionStorage.getItem('playlistMetadata') || localStorage.getItem('playlistMetadata');
          const savedTrackIndex = sessionStorage.getItem('currentTrackIndex') || localStorage.getItem('currentTrackIndex');

          let queueToUse = savedQueue ? JSON.parse(savedQueue) : null;
          let metadataToUse = savedMetadata ? JSON.parse(savedMetadata) : null;

          // URL-driven fallback: if the route names a playlist but storage was
          // empty (new tab / cleared), rebuild the queue from the server so we
          // DON'T fall back to the default audio view.
           if (initialRoute.playlistId === LOVED_PLAYLIST_ID) {
             const favs = await loadFavorites();
             if (favs?.length) {
               const ts = safeParseTrackSort();
               let q = applyTrackSearch(applyTrackFilter(favs, safeParseTrackFilter()), safeParseTrackSearchQuery());
               const { by, order } = ts;
               if (by) {
                 q = [...q].sort((a, b) => {
                   let valA = a[by] ?? '';
                   let valB = b[by] ?? '';
                   if (by === 'duration' || by === 'track_num' || by === 'track_index' || by === 'created_at' || by === 'mtime' || by === 'size') {
                     valA = Number(valA) || 0;
                     valB = Number(valB) || 0;
                   } else {
                     valA = String(valA).toLowerCase();
                     valB = String(valB).toLowerCase();
                   }
                   if (valA < valB) return order === 'asc' ? -1 : 1;
                   if (valA > valB) return order === 'asc' ? 1 : -1;
                   return 0;
                 });
               }
               queueToUse = q;
               metadataToUse = { id: LOVED_PLAYLIST_ID, title: 'Loved', image: null };
             }
           } else if (initialRoute.playlistId && !queueToUse) {
             const ts = safeParseTrackSort();
             const data = await fetchPlaylistPlay(initialRoute.playlistId, { sortBy: ts.by, sortOrder: ts.order });
             if (data?.queue?.length) {
               queueToUse = applyTrackSearch(applyTrackFilter(data.queue, safeParseTrackFilter()), safeParseTrackSearchQuery());
               metadataToUse = data.playlist;
             }
           }

          if (queueToUse) setPlaylistQueue(queueToUse);
          if (metadataToUse) setPlaylistMetadata(metadataToUse);

            // Start from the persisted track index (it reflects the last track
            // the user navigated to). A deep link / shareable URL that names an
            // explicit track should still win when it points at a *different*
            // track than the restored index — otherwise clicking a track URL
            // (e.g. .../track/<fileId>) silently plays the wrong (first) track.
            // On skip the URL is kept in sync with the current track, so when the
            // URL and the restored index resolve to the same file there is no
            // behavior change (this does not re-introduce the "reload jumps to a
            // different song" bug).
            let resolvedIdx = 0;
            if (savedTrackIndex !== null) {
              resolvedIdx = parseInt(savedTrackIndex, 10) || 0;
            }
            if (initialRoute.trackFileId && queueToUse) {
              const urlIdx = queueToUse.findIndex(t => String(t.file_id || t.id) === String(initialRoute.trackFileId));
              if (urlIdx >= 0) {
                const restoredFid = queueToUse[resolvedIdx] ? String(queueToUse[resolvedIdx].file_id || queueToUse[resolvedIdx].id) : null;
                if (savedTrackIndex === null || restoredFid !== String(initialRoute.trackFileId)) {
                  resolvedIdx = urlIdx;
                }
              }
            }

          setCurrentTrackIndex(resolvedIdx);

           // CRITICAL: Also update zustand store directly. Music.jsx reads
           // storeCurrentTrackIndex from zustand (not React props) to determine
           // the active track. Without this, the zustand store still has index 0
           // from its default, and Music.jsx's sync effect persists that stale 0
           // to localStorage.playbackStore before zustand hydration completes.
           const zs = usePlaybackStore.getState();
            if (queueToUse) {
              zs.setQueue(queueToUse, resolvedIdx);
            } else {
              zs.setCurrentTrackIndex(resolvedIdx);
            }
            // Do NOT call zs.play() here. isPlaying is intentionally left false on
            // reload so playback starts as a fresh initialization: the shared load
            // effect in Music.jsx loads the current track, resets currentTime to 0,
            // and attempts audio.play() (falling back to the user-interaction
            // autoPlayPending retry on NotAllowedError). Resume-state restoration is
            // intentionally not implemented yet.
         } catch (e) {
          console.error('[App] Failed to restore playlist state:', e);
        }
      })();
    }, [initialView]);

      // Mount: restore from resume snapshot if present, otherwise clear stale
      // playback state when leaving audio view. Runs once so it never races with
      // later view changes.
       useEffect(() => {
        const raw = sessionStorage.getItem('playbackResumeSnapshot');
        console.log('[mount effect] raw snapshot present:', !!raw, 'view:', view, 'initialView:', initialView, 'hasRestoredFromSnapshot:', hasRestoredFromSnapshot);

        if (raw) {
          try {
            const snapshot = JSON.parse(raw);
            const store = usePlaybackStore.getState();

            if (snapshot.queue?.length > 0) {
              store.setQueue(snapshot.queue, snapshot.currentTrackIndex);
              store.setActiveFile(snapshot.activePlaybackId);
              store.setPosition(snapshot.position);
              store.pause();

              setPlaylistQueue(snapshot.playlistQueue);
              setPlaylistMetadata(snapshot.playlistMetadata);
            }

            sessionStorage.setItem('audioReloadWasPlaying', String(snapshot.wasPlaying));
            sessionStorage.setItem('audioReloadResumeAt', String(Date.now() + 2000));
            sessionStorage.removeItem('playbackResumeSnapshot');
            sessionStorage.removeItem('audioReloadPosition');

            hasRestoredFromSnapshot = true;
            console.log('[mount effect] Restored from snapshot, queueLength:', snapshot.queue?.length, 'trackIndex:', snapshot.currentTrackIndex);
          } catch (e) {
            console.error('[mount effect] Failed to restore snapshot:', e);
          }
          return;
        }

        if (view !== 'audio' && !hasRestoredFromSnapshot) {
          console.log('[mount effect] Clearing playback');
          sessionStorage.removeItem('playlistQueue');
          sessionStorage.removeItem('playlistMetadata');
          sessionStorage.removeItem('currentTrackIndex');
          localStorage.removeItem('playlistQueue');
          localStorage.removeItem('playlistMetadata');
          localStorage.removeItem('currentTrackIndex');
          usePlaybackStore.getState().clearPlayback();
        }
      }, []);

      // Detect reload and schedule delayed resume so playback starts after load.
      useEffect(() => {
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        const isReload = nav?.type === 'reload' || performance.navigation?.type === 1;
        if (!isReload) return;

        const wasPlaying = sessionStorage.getItem('audioReloadWasPlaying') === 'true';

        const timer = setTimeout(() => {
          if (wasPlaying) {
            usePlaybackStore.getState().play();
          }
          sessionStorage.removeItem('audioReloadWasPlaying');
          sessionStorage.removeItem('audioReloadResumeAt');
          window.dispatchEvent(new CustomEvent('audio-reload-resume'));
        }, 0);

        return () => clearTimeout(timer);
      }, []);

    // Persist view and playlist state for reload recovery.
    // NOTE: playlistMetadata can include a base64 cover image (data: URL) which
    // blows past the ~5MB localStorage quota for large playlists. Serializing it
    // threw QuotaExceededError inside this effect, crashing the UI loop ("berat
    // sampai ga respon"). Strip oversized fields and guard every write.
    useEffect(() => {
      const safeStore = (key, value) => {
        try { sessionStorage.setItem(key, value); } catch {}
        try {
          localStorage.setItem(key, value);
        } catch {
          try { localStorage.removeItem(key); } catch {}
        }
      };
      sessionStorage.setItem('view', view);
      if (playlistQueue && playlistQueue.length > 0) {
        const q = JSON.stringify(playlistQueue);
        safeStore('playlistQueue', q);
      }
      if (playlistMetadata) {
        const sanitized = { ...playlistMetadata };
        if (typeof sanitized.image === 'string' && sanitized.image.startsWith('data:')) {
          sanitized.image = null;
        }
        safeStore('playlistMetadata', JSON.stringify(sanitized));
      }
      safeStore('currentTrackIndex', String(currentTrackIndex));
      if (currentAudioFileIdRef.current) {
        safeStore('currentAudioFileId', currentAudioFileIdRef.current);
      }
    }, [view, playlistQueue, playlistMetadata, currentTrackIndex]);

    // NOTE: Single popstate handler lives at line ~1191 (HANDLE BROWSER BACK/FORWARD).
    // The duplicate handler above was removed to prevent race conditions.

    // Shared audio element — persists across full ↔ mini player switches
    const sharedAudioRef = useRef(null);
    const sharedPrevFileIdRef = useRef(null);
    const [audioReady, setAudioReady] = useState(false);
    const setAudioRef = usePlaybackStore(s => s.setAudioRef);
    const endedGuardRef = useRef(false);
    const lastEnforceRef = useRef(0);
    useEffect(() => {
      let audio;
      if (sharedAudioRef.current) return;
      audio = new Audio();
       audio.preload = 'metadata';
      // setSinkId() only reroutes audio for an element connected to the document,
      // so the shared element (created with `new Audio()`, never in the React tree)
      // must be attached to the DOM or the chosen output silently has no effect.
      audio.style.cssText =
        'position:fixed;width:0;height:0;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
      document.body.appendChild(audio);
      sharedAudioRef.current = audio;
      setAudioRef(audio);
      setAudioReady(true);

      // Restore persisted volume (source of truth = the shared element's volume).
      // Default to browser default (1.0) when nothing stored.
      try {
        const savedVol = localStorage.getItem('audio.volume');
        if (savedVol != null) {
          audio.volume = Math.max(0, Math.min(1, Number(savedVol) / 100));
        }
      } catch { /* ignore */ }
      // Persist volume on every change — captures slider, touch gesture, and
      // external (websocket) paths since they all write this shared element.
      const onVolumeChange = () => {
        try { localStorage.setItem('audio.volume', String(Math.round(audio.volume * 100))); } catch { /* ignore */ }
      };
      audio.addEventListener('volumechange', onVolumeChange);

      // Apply persisted audio-output device (routing) if the browser supports it.
      const storedOut = getStoredDevice();
      if (storedOut && storedOut.deviceId) applySink(audio, storedOut);

      // Re-apply / fall back when OS audio devices change (connect / disconnect).
      const onDeviceChange = async () => {
        const s = getStoredDevice();
        if (!s || !s.deviceId) return;
        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          const present = list.some((d) => d.kind === 'audiooutput' && d.deviceId === s.deviceId);
          if (present) applySink(audio, s);
          else applySink(audio, null); // chosen device gone → back to default
        } catch {
          /* ignore */
        }
      };
      if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      }

      // setSinkId() does not reliably survive a `src` reload, a loop, or a seek,
      // and Chromium may silently reset the sink at the ended→play boundary of a
      // loop. Rather than depending on which media events fire, *enforce* the
      // stored device whenever the element's actual sink has drifted from the
      // desired one. Skip the call entirely when already correct so a properly
      // routed element is never touched (no audible glitch).
      const debugSink = typeof location !== 'undefined' && location.search.includes('debugSink');
      const enforceSink = () => {
        if (!isOutputRoutingSupported()) return;
        const s = getStoredDevice();
        const desired = s && s.deviceId ? s.deviceId : '';
        if (debugSink) {
          try { console.debug(`[sink] desired=${desired} actual=${audio.sinkId}`); } catch { /* ignore */ }
        }
        if (audio.sinkId !== desired) {
          audio.setSinkId(desired).catch(() => {});
        }
      };
      // Enforce on the events that bracket a (re)start, track change, loop, or seek.
      ['play', 'loadstart', 'loadedmetadata', 'canplay', 'seeked', 'playing'].forEach((ev) =>
        audio.addEventListener(ev, enforceSink)
      );
      // timeupdate fires only while playing (~4x/s); throttle to ≤1/s so any
      // mid-playback reset (incl. the loop boundary) self-corrects within ~1s
      // with zero churn while paused.
      const onTimeUpdate = () => {
        const now = Date.now();
        if (now - lastEnforceRef.current < 1000) return;
        lastEnforceRef.current = now;
        enforceSink();
      };
      audio.addEventListener('timeupdate', onTimeUpdate);

      // Single source of truth for 'ended' — prevents double-advance during view transitions
      audio.addEventListener('ended', () => {
         if (endedGuardRef.current) return;
         endedGuardRef.current = true;
         setTimeout(() => { endedGuardRef.current = false; }, 300);
         const { next, loopMode, shuffle, queue, currentTrackIndex } = usePlaybackStore.getState();
          if (loopMode === 'one') {
            audio.currentTime = 0;
            enforceSink();                 // re-issue setSinkId immediately at loop boundary
            audio.play().catch(() => {});
            return;
          }
         if (loopMode === 'off' && !shuffle && currentTrackIndex === queue.length - 1) {
           usePlaybackStore.getState().pause();
           return;
         }
          next();
          syncAudioUrl();
         });

       return () => {
        ['play', 'loadedmetadata', 'canplay', 'seeked', 'playing'].forEach((ev) =>
          audio.removeEventListener(ev, enforceSink)
        );
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('volumechange', onVolumeChange);
        if (sharedAudioRef.current) {
          sharedAudioRef.current.pause();
        }
        if (navigator.mediaDevices?.removeEventListener) {
          navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
        }
      };
    }, [setAudioRef]);

    // Pause audio and persist playback snapshot on page unload/reload.
    useEffect(() => {
      const saveSnapshot = () => {
        try {
          const audio = sharedAudioRef.current;
          const store = usePlaybackStore.getState();

          const snapshot = {
            queue: store.queue,
            currentTrackIndex: store.currentTrackIndex,
            activePlaybackId: store.activePlaybackId,
            position: audio ? audio.currentTime : store.position,
            wasPlaying: audio ? !audio.paused : store.isPlaying,
            playlistQueue: playlistQueueRef.current,
            playlistMetadata: playlistMetadataRef.current,
          };

          try {
            sessionStorage.setItem('playbackResumeSnapshot', JSON.stringify(snapshot));
          } catch (e) {
            console.error('[saveSnapshot] quota/write error:', e);
          }
        } catch (e) {
          console.error('[saveSnapshot] Error:', e);
        }
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          saveSnapshot();
        }
      };

      const timer = setInterval(saveSnapshot, 5000);

      window.addEventListener('beforeunload', saveSnapshot);
      window.addEventListener('pagehide', saveSnapshot);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => {
        window.removeEventListener('beforeunload', saveSnapshot);
        window.removeEventListener('pagehide', saveSnapshot);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        clearInterval(timer);
      };
    }, []);

   const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchBarRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const panelTriggerRef = useRef(null); // Ref for the panel trigger button
  const refreshGuardRef = useRef(0); // Guard against concurrent refresh calls
  const loadedPageKeyRef = useRef(null);

  const { toasts: appToasts, showToast, removeToast } = useToast();
  const { uploads, removeUpload, deleteUploadFile, cancelUpload, formatSize, formatSpeed, formatEta, statusColors, statusIcons, activeUploadCount } = useUploadQueueLogic();

  // Initialize panel states when panel opens
  useEffect(() => {
    if (showFilterPanel) {
      setPanelFilterType(state.currentFilter);
      setPanelSortBy(state.currentSortBy);
      setPanelSortOrder(state.currentSortOrder);
    }
  }, [showFilterPanel, state.currentFilter, state.currentSortBy, state.currentSortOrder]);

  // Click outside search bar to collapse (but not when clicking search results area)
  useEffect(() => {
    if (!searchExpanded) return;
    const handleClickOutside = (e) => {
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
        const mainEl = scrollContainerRef.current;
        if (mainEl && mainEl.contains(e.target) && searchResults) return;
        // Keep the bar open while there is still a query typed in it, so it
        // doesn't collapse under the user while they're searching.
        if (searchQuery.trim()) return;
        setSearchExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [searchExpanded, searchResults]);



  const searchFileList = useMemo(() => {
    if (!searchResults || searchQuery.trim().length < 2) return [];
    let result = [...(searchResults.files || [])];
    if (state.currentFilter !== 'all') {
      result = result.filter(f => f.type === state.currentFilter);
    }
    if (favoriteOnly) {
      result = result.filter(f => f.is_favorite === 1);
    }
    // When 'all', we keep video + audio + image (consistent with playerFiles above)
    if (state.currentSortBy) {
      result.sort((a, b) => {
        let cmp = 0;
        if (state.currentSortBy === 'name') {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        } else if (state.currentSortBy === 'mtime') {
          cmp = (a.mtime || 0) - (b.mtime || 0);
        } else if (state.currentSortBy === 'created_at') {
          cmp = (a.created_at || 0) - (b.created_at || 0);
        } else if (state.currentSortBy === 'size') {
          cmp = (a.size || 0) - (b.size || 0);
        }
        return state.currentSortOrder === 'desc' ? -cmp : cmp;
      });
    }
    return result;
  }, [searchResults, searchQuery, state.currentFilter, state.currentSortBy, state.currentSortOrder, favoriteOnly]);

  // Refs
  const currentRequestRef = useRef(0);
  const abortControllerRef = useRef(null);
  const backgroundLoadControllerRef = useRef(null);
  const lastUrlWriteRef = useRef(null);
  const navigationInProgressRef = useRef(false);
  const scrollContainerRef = useRef(null);
  const isRestoringScrollRef = useRef(false);
  const navigateToFolderRef = useRef(null);
  const navigateToRootRef = useRef(null);
  const modalClosingRef = useRef(false);
  const selectedFileRef = useRef(null);
  const gridApiRef = useRef(null);
  const restoreRef = useRef({ clickedFileId: null, activePlaybackId: null, mode: 'normal' });

  // Handle notifications panel close on Escape key
  useEffect(() => {
    if (!showNotificationsPanel) return;
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setShowNotificationsPanel(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showNotificationsPanel]);

  // === STABLE STATE UPDATES ===
  const updateState = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next.items && next.items.length > 0) {
        next.lastValidItems = next.items;
        next.stable = true;
      }
      return next;
    });
  }, []);

  // Handle favorite toggle from MediaGrid
  const handleToggleFavorite = useCallback(async (item) => {
    if (!item?.id) return;
    // Optimistically toggle the favorite status in the global store
    const favStore = useFavoritesStore.getState();
    const currentStored = favStore.map[item.id];
    const fallback = item.is_favorite ? 1 : 0;
    const currentFav = currentStored !== undefined ? currentStored : fallback;
    const optimisticFav = currentFav === 1 ? 0 : 1;
    favStore.set(item.id, optimisticFav);
    // A favorite change can alter the favorite-only index membership + ordering.
    // Invalidate the repository's cached indexes so the affected folder's
    // favoriteOnly/filter scopes refetch on the next modal open.
    if (folderScope) {
      mediaRepo.invalidate(folderScope);
    }
    try {
      const result = await toggleFavorite(item.id);
      // Ensure store reflects the server result
      favStore.set(item.id, result.is_favorite);
      updateState(prev => ({
        ...prev,
        items: prev.items.map(f => f.id === item.id ? { ...f, is_favorite: result.is_favorite } : f),
        lastValidItems: prev.lastValidItems.map(f => f.id === item.id ? { ...f, is_favorite: result.is_favorite } : f),
        selectedFile: prev.selectedFile?.id === item.id ? { ...prev.selectedFile, is_favorite: result.is_favorite } : prev.selectedFile,
      }));
      const pStore = usePlaybackStore.getState();
      if (pStore.queue && pStore.queue.length > 0) {
        const newQueue = pStore.queue.map(t =>
          (t.file_id === item.id || t.id === item.id)
            ? { ...t, is_favorite: result.is_favorite }
            : t
        );
        pStore.setQueue(newQueue, pStore.currentTrackIndex);
      }
      // Also patch playlistQueue (used by Carousel/QueuePanel in Music view)
      setPlaylistQueue(prev => {
        if (!prev || prev.length === 0) return prev;
        return prev.map(t =>
          (t.file_id === item.id || t.id === item.id)
            ? { ...t, is_favorite: result.is_favorite }
            : t
        );
      });
    } catch (err) {
      // Revert optimistic update on error
      favStore.set(item.id, currentFav);
      console.error('[App] Failed to toggle favorite:', err);
    }
  }, [updateState]);

  // Lock Spacebar to play/pause and L key for favorite in audio / vaultAudio / sendqueue views
  useEffect(() => {
    const handleKey = (e) => {
      const target = e.target;
      const isTyping = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if (isTyping) return;

      if (e.key === ' ' || e.code === 'Space') {
        const view = viewRef.current;
        if (view === 'audio' || view === 'vaultAudio') {
          e.preventDefault();
          e.stopPropagation();
          const audio = sharedAudioRef.current;
          if (!audio) return;
          try {
            if (audio.paused) {
              audio.play().catch(() => {});
              usePlaybackStore.getState().play();
            } else {
              audio.pause();
              usePlaybackStore.getState().pause();
            }
          } catch {}
        } else if (view === 'media') {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new Event('global-media-toggle-play'));
        } else if (view === 'sendqueue') {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new Event('global-media-toggle-play'));
        }
        return;
      }

      if (e.key === 'l' || e.key === 'L') {
        const view = viewRef.current;
        const pStore = usePlaybackStore.getState();
        const track = pStore.queue?.[pStore.currentTrackIndex];
        const item = track || state.selectedFile;
        if (view === 'audio' || view === 'vaultAudio' || view === 'media') {
          e.preventDefault();
          e.stopPropagation();
          if (item?.id) handleToggleFavorite(item);
        }
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        const view = viewRef.current;
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'audio') {
          window.dispatchEvent(new Event('music-skip-next'));
        } else if (view === 'vaultAudio') {
          usePlaybackStore.getState().next();
          syncAudioUrl();
        } else if (view === 'media' || view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-next'));
        }
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        const view = viewRef.current;
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'audio') {
          window.dispatchEvent(new Event('music-skip-prev'));
        } else if (view === 'vaultAudio') {
          usePlaybackStore.getState().previous();
          syncAudioUrl();
        } else if (view === 'media' || view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-previous'));
        }
        return;
      }

      if (e.key === 'b' || e.key === 'B') {
        const view = viewRef.current;
        e.preventDefault();
        e.stopPropagation();
        const pStore = usePlaybackStore.getState();
        if (view === 'audio' || view === 'vaultAudio' || view === 'media') {
          pStore.setShuffle(!pStore.shuffle);
        } else if (view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-toggle-shuffle'));
        }
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        const view = viewRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'audio' || view === 'vaultAudio' || view === 'media') {
          const pStore = usePlaybackStore.getState();
          const modes = ['off', 'all', 'one'];
          const idx = modes.indexOf(pStore.loopMode);
          const next = modes[(idx + 1) % modes.length];
          pStore.setLoopMode(next);
        } else if (view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-toggle-loop'));
        }
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        const view = viewRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'media' || view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-skip-minus5'));
        } else if ((view === 'audio' || view === 'vaultAudio') && sharedAudioRef.current) {
          sharedAudioRef.current.currentTime = Math.max(0, sharedAudioRef.current.currentTime - 5);
        }
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        const view = viewRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'media' || view === 'sendqueue') {
          window.dispatchEvent(new Event('global-media-skip-plus5'));
        } else if ((view === 'audio' || view === 'vaultAudio') && sharedAudioRef.current) {
          sharedAudioRef.current.currentTime = Math.min(sharedAudioRef.current.duration || 0, sharedAudioRef.current.currentTime + 5);
        }
        return;
      }

      if (e.key === 'k' || e.key === 'K') {
        const view = viewRef.current;
        e.preventDefault();
        e.stopPropagation();
        if (view === 'media') {
          window.dispatchEvent(new Event('global-media-send-status'));
        }
        return;
      }
    };
    document.addEventListener('keydown', handleKey, { capture: true });
    return () => document.removeEventListener('keydown', handleKey, { capture: true });
  }, [handleToggleFavorite, state.selectedFile]);

  // === SCROLL POSITION MANAGEMENT ===
  const saveScrollPosition = useCallback((path, itemCount) => {
    // LOCK: Prevent saving during restoration phase
    if (isRestoringScrollRef.current) return;

    if (scrollContainerRef.current) {
      const scrollY = scrollContainerRef.current.scrollTop;
      // Stored data: path, scrollY, timestamp, itemCount
      const data = {
        path,
        scrollY,
        timestamp: Date.now(),
        itemCount: itemCount || 0
      };
      sessionStorage.setItem(`scroll:${path}`, JSON.stringify(data));
    }
  }, []);

  const restoreScrollPosition = useCallback((path, currentItemCount) => {
    const rawData = sessionStorage.getItem(`scroll:${path}`);
    if (!rawData) return;

    try {
      const data = JSON.parse(rawData);
      const targetY = data.scrollY;
      
      if (targetY <= 0) return;

      // === SMART VALIDATION ===
      const timeDiff = Date.now() - data.timestamp;
      const countDiff = Math.abs((currentItemCount || 0) - data.itemCount);
      
      if (data.path !== path) return;
      if (timeDiff > 30 * 60 * 1000) return;
      if (countDiff > 5) return;

      // === START RESTORATION PHASE ===
      isRestoringScrollRef.current = true;

      // LAYOUT STABILIZATION GATE: Wait 2 animation frames
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollContainerRef.current) {
             isRestoringScrollRef.current = false;
             return;
          }

          // PHASE 1: Instant jump (Fix flicker)
          scrollContainerRef.current.scrollTo({ top: targetY, behavior: 'instant' });

          // PHASE 2: Stabilization check
          let attempts = 0;
          const tryFineTune = () => {
            if (scrollContainerRef.current && isRestoringScrollRef.current) {
              const currentY = scrollContainerRef.current.scrollTop;
              if (Math.abs(currentY - targetY) > 2 && attempts < 10) {
                scrollContainerRef.current.scrollTo({ top: targetY, behavior: 'smooth' });
                attempts++;
                requestAnimationFrame(tryFineTune);
              } else {
                // FINALIZE
                setTimeout(() => {
                  isRestoringScrollRef.current = false;
                }, 300); // 300ms stabilization window
              }
            }
          };
          requestAnimationFrame(tryFineTune);
        });
      });

    } catch (e) {
      console.warn('[App] Scroll restore parse error');
      isRestoringScrollRef.current = false;
    }
  }, []);

  // === CONTINUOUS SCROLL SAVER (SMART DEBOUNCE) ===
  useEffect(() => {
    let timeout;
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // LOCK: Ignore ALL scroll events during restoration
      if (isRestoringScrollRef.current) return;

      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Guard: Only save if we're in a stable state
        if (!state.loading && !navigationInProgressRef.current && !isRestoringScrollRef.current) {
          const path = state.currentPath || '';
          const currentY = container.scrollTop;
          
          // Anti-reset guard: if browser resets scroll to 0 during transitions, don't save it
          if (currentY === 0) {
            const lastSavedRaw = sessionStorage.getItem(`scroll:${path}`);
            if (lastSavedRaw) {
              try {
                const lastSaved = JSON.parse(lastSavedRaw);
                if (lastSaved.scrollY > 0) return;
              } catch(e) {}
            }
          }
          
          saveScrollPosition(path, state.items.length);
        }
      }, 500); // 500ms debounce
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (timeout) clearTimeout(timeout);
    };
  }, [state.currentPath, state.loading, state.items.length, saveScrollPosition]);

  // === SINGLE URL WRITER ===
  const writeUrl = useCallback((path, fileId = null, replace = false) => {
    const requestId = ++currentRequestRef.current;
    let newHash;
    if (path === 'root') {
      newHash = fileId ? `/media/v/${fileId}` : '/media';
    } else {
      const hashParts = ['/f', path];
      if (fileId) hashParts.push('v', fileId);
      newHash = hashParts.join('/');
    }
    const newUrl = '#' + newHash;

    if (window.location.hash === newUrl) return requestId;

    lastUrlWriteRef.current = { requestId, hash: newUrl, time: Date.now() };
    
    const stateData = { requestId, folderId: path === 'root' ? null : path, fileId };
    
    if (replace) {
      history.replaceState(stateData, '', newUrl);
    } else {
      history.pushState(stateData, '', newUrl);
    }
    
    return requestId;
  }, []);

  // === SINGLE URL WRITER FOR PLAYLISTS ===
  const writePlaylistUrl = useCallback((playlistId, trackIdx = null, replace = false) => {
    let hash;
    if (playlistId && trackIdx !== null) {
      hash = `/audio/playlist/${playlistId}/track/${trackIdx}`;
    } else if (playlistId) {
      hash = `/playlists/${playlistId}`;
    } else {
      hash = '/playlists';
    }
    const newUrl = '#' + hash;
    if (window.location.hash === newUrl) return;
    const stateData = { view: 'playlists', playlistId, trackIdx };
    if (replace) {
      history.replaceState(stateData, '', newUrl);
    } else {
      history.pushState(stateData, '', newUrl);
    }
  }, []);

  const clearUrl = useCallback(() => {
    const requestId = ++currentRequestRef.current;
    if (window.location.hash !== '#/media' && window.location.hash !== '#') {
      lastUrlWriteRef.current = { requestId, hash: '#/media', time: Date.now() };
      history.replaceState({ requestId, folderId: null, fileId: null }, '', '#/media');
    } else if (window.location.hash === '#') {
      // normalize legacy root hash to /media
      lastUrlWriteRef.current = { requestId, hash: '#/media', time: Date.now() };
      history.replaceState({ requestId, folderId: null, fileId: null }, '', '#/media');
    }
    return requestId;
  }, []);

  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!q || q.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      /* console.time removed */
      try {
        const isFolderScoped = state.currentFolderId ? 'current' : 'all';
        const folderIdParam = state.currentFolderId ? `&folder_id=${state.currentFolderId}` : '';
        const res = await fetch(`/api/files/search?q=${encodeURIComponent(q)}&scope=${isFolderScoped}${folderIdParam}&type=all&limit=500`);
        if (!res.ok) { setSearchResults(null); return; }
        const data = await res.json();
        setSearchResults(data);
      } catch { 
        setSearchResults(null);
      }
    }, 300);
  }, [state.currentFolderId]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchExpanded(false);
  }, []);

  // === SORT HANDLERS (re-fetch from backend with new sort order) ===
  const handleSortByChange = useCallback(async (sortBy) => {
    clearResponseCache();
    const newOrder = sortBy === null ? 'asc' : (
      sortBy === state.currentSortBy
        ? (state.currentSortOrder === 'asc' ? 'desc' : 'asc')
        : state.currentSortOrder
    );
    const path = state.currentPath || '/';
    useFolderMetaSortStore.getState().setSort(path, sortBy, newOrder);
    updateState(prev => ({ ...prev, currentSortBy: sortBy, currentSortOrder: newOrder, loadedSortBy: sortBy, loadedSortOrder: newOrder }));
    const guard = ++refreshGuardRef.current;
    try {
      const data = await fetchFolder(
        state.currentPath,
        null, null,
        state.currentFolderId,
        sortBy, newOrder
      );
      if (guard !== refreshGuardRef.current) return;
    updateState(prev => ({
      ...prev,
      items: data.items || [],
      folders: data.folders || prev.folders,
      hasMore: data.has_more || false,
      nextCursor: data.next_cursor || null,
      prevCursor: data.prev_cursor || null,
      pagesFetched: 0,
      loadedSortBy: sortBy,
      loadedSortOrder: newOrder,
    }));
    loadedPageKeyRef.current = `${state.currentFolderId || 'root'}:${state.currentPath || ''}:${sortBy}:${newOrder}`;
    } catch {}
  }, [state.currentSortBy, state.currentSortOrder, state.currentPath, state.currentFolderId]);

  const handleSortOrderToggle = useCallback(() => {
    if (state.currentSortBy === null) return;
    const newOrder = state.currentSortOrder === 'asc' ? 'desc' : 'asc';
    const path = state.currentPath || '/';
    useFolderMetaSortStore.getState().setSort(path, state.currentSortBy, newOrder);
    updateState(prev => ({ ...prev, currentSortOrder: newOrder, loadedSortOrder: newOrder }));
    // Must re-fetch from backend to get correct cursor for the new order
    ++refreshGuardRef.current;
    const guard = refreshGuardRef.current;
    (async () => {
      try {
        const data = await fetchFolder(
          state.currentPath, null, null,
          state.currentFolderId,
          state.currentSortBy, newOrder
        );
        if (guard !== refreshGuardRef.current) return;
        updateState(prev => ({
          ...prev,
          items: data.items || [],
          hasMore: data.has_more || false,
          nextCursor: data.next_cursor || null,
          prevCursor: data.prev_cursor || null,
          pagesFetched: 0,
          loadedSortBy: state.currentSortBy,
          loadedSortOrder: newOrder,
        }));
        loadedPageKeyRef.current = `${state.currentFolderId || 'root'}:${state.currentPath || ''}:${state.currentSortBy || ''}:${newOrder}`;
      } catch {}
    })();
  }, [state.currentSortBy, state.currentSortOrder, state.currentPath, state.currentFolderId]);

  // Upload handlers
  const handleUploadFiles = useCallback((files) => {
    if (!files || files.length === 0) return;
    const formData = new FormData();
    const folder = state.currentPath || '';
    // Send metadata FIRST so busboy parses it before file events
    const meta = Array.from(files).map(f => ({ name: f.name, lastModified: f.lastModified || Date.now(), size: f.size }));
    formData.append('_timestamps', JSON.stringify(meta));
    for (const file of files) {
      formData.append('files', file);
    }
    fetch(`/api/upload?folder=${encodeURIComponent(folder)}`, {
      method: 'POST',
      body: formData,
    })
    .then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        const total = data.summary?.total || 0;
        const completed = data.summary?.completed || 0;
        const failed = data.summary?.failed || 0;
        if (completed > 0 && failed === 0) {
          showToast(`Uploaded ${completed} file${completed > 1 ? 's' : ''} successfully`, 'success');
        } else if (failed > 0 && completed > 0) {
          showToast(`Uploaded ${completed}, ${failed} failed`, 'warning');
        } else if (failed > 0) {
          showToast(`${failed} upload${failed > 1 ? 's' : ''} failed`, 'error');
        }

        // Refresh grid automatically when upload(s) completed.
        // Dispatch an event; actual refetch is handled by a listener installed later
        // (avoids referencing navigateToFolder/navigateToRoot before initialization).
        if (completed > 0) {
          try { window.dispatchEvent(new CustomEvent('media-upload-complete')); } catch {}
        }
      } else {
        showToast('Upload failed server error', 'error');
      }
    })
    .catch(() => showToast('Upload network error', 'error'));
  }, [state.currentPath, showToast]);

  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Drag-to-upload is intentionally disabled: uploads only happen via the
  // upload button (Media Vault). We still preventDefault on drag/drop so the
  // browser doesn't navigate away when a file is accidentally dragged in, but
  // dragging any in-app item must never trigger an upload.
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleInputChange = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUploadFiles(files);
    }
    e.target.value = '';
  }, [handleUploadFiles]);

  // === DETERMINISTIC FETCH (WITH ABORT + VERSIONING) ===
  const fetchFolderData = useCallback(async (folderPath, cursor = null, requestId = null, sortBy = null, sortOrder = 'asc') => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const thisRequestId = requestId || ++currentRequestRef.current;

    try {
      const data = await fetchFolder(folderPath, cursor, null, null, sortBy, sortOrder);

      if (thisRequestId !== currentRequestRef.current) {
        return;
      }

      if (!data || !Array.isArray(data.items)) {
        console.warn('Invalid API response:', data);
        return;
      }

      updateState(prev => ({
        ...prev,
        folders: data.folders || [],
        items: stableMerge(prev.items, data.items),
        loading: false,
        error: null,
        hasMore: data.has_more || false,
        nextCursor: data.next_cursor || null,
        prevCursor: data.prev_cursor || null,
      }));

      return data;
    } catch (err) {
      if (err.name === 'AbortError') return;

      if (thisRequestId === currentRequestRef.current) {
        updateState(prev => ({
          ...prev,
          loading: false,
          error: err.message,
        }));
      }
    }
  }, []);

  // === FETCH NEXT PAGE (INCREMENTAL LOADING) ===
  const fetchNextPageGuardRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pageKeyRef = useRef('');
  const evictedPageRef = useRef(null);

  const buildPageKey = useCallback((folderId, sortBy, sortOrder, pageIndex) => {
    return `${folderId || 'root'}:${sortBy || ''}:${sortOrder || 'asc'}:${pageIndex}`;
  }, []);

  const fetchFolderPage = useCallback(async (folderPath, cursor, limit, folderId, sortBy, sortOrder) => {
    return fetchFolder(folderPath, cursor, limit, folderId, sortBy, sortOrder);
  }, []);

  pageCacheInit(async (pageKey) => {
    const [folderId, sortBy, sortOrder, pageIndex] = pageKey.split(':');
    const pageIdx = parseInt(pageIndex, 10);
    if (isNaN(pageIdx) || pageIdx < 0) return [];

    const s = stateRef.current;
    const cursor = pageIdx === 0 ? null : `page_${pageIdx}`;
    const data = await fetchFolderPage(
      s.currentPath,
      cursor,
      PAGE_SIZE,
      s.currentFolderId || (folderId === 'root' ? null : parseInt(folderId)),
      sortBy || s.currentSortBy,
      sortOrder || s.currentSortOrder
    );
    return data?.items || [];
  });

  const ensurePage = useCallback(async (pageKey) => {
    if (!pageKey) return [];
    const result = await pageCacheGet(pageKey);
      if (result.reloaded && result.items.length > 0) {
        setState(prev => {
          const existingIds = new Set(prev.items.map(i => i.id));
          const newItems = result.items.filter(i => !existingIds.has(i.id));
          if (newItems.length === 0) return prev;
          return { ...prev, items: [...newItems, ...prev.items] };
        });
      }
    return result.items;
  }, []);

  const handleNearTop = useCallback(async () => {
    const s = stateRef.current;
    const pageIndex = 0;
    const pageKey = buildPageKey(s.currentFolderId, s.currentSortBy, s.currentSortOrder, pageIndex);
    await ensurePage(pageKey);
  }, [buildPageKey, ensurePage]);

  // === BACKGROUND FULL-FOLDER LOAD (AbortController + incremental merge) ===

  const loadAllFolderItems = useCallback(async (folderId, path, sortBy, sortOrder) => {
    if (folderId == null && path == null) return;

    if (backgroundLoadControllerRef.current) {
      backgroundLoadControllerRef.current.abort();
    }
    const controller = new AbortController();
    backgroundLoadControllerRef.current = controller;
    backgroundLoadTargetRef.current = { folderId, path };

    let cursor = null;
    let pageIndex = 0;

    try {
      while (true) {
        if (controller.signal.aborted) return;
        const data = await fetchFolder(path, cursor, PAGE_SIZE, folderId == null ? null : folderId, sortBy, sortOrder);
        if (!data || !Array.isArray(data.items) || data.items.length === 0) break;

        const newItems = data.items;
        updateState(prev => {
          const existingIds = new Set(prev.items.map(i => i.id));
          const trulyNew = newItems.filter(i => !existingIds.has(i.id));
          if (trulyNew.length === 0) return prev;
          return { ...prev, items: [...prev.items, ...trulyNew] };
        });

        cursor = data.next_cursor;
        pageIndex++;
        if (!data.has_more || !cursor) break;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[loadAllFolderItems] background load stopped:', err.message);
      }
    } finally {
      backgroundLoadControllerRef.current = null;
      backgroundLoadTargetRef.current = { folderId: null, path: null };
    }
  }, [updateState]);

  const fetchNextPage = useCallback(async (onDone) => {
    if (fetchNextPageGuardRef.current) return;
    if (navigationInProgressRef.current) return;
    if (!stateRef.current.hasMore || !stateRef.current.nextCursor) return;

    fetchNextPageGuardRef.current = true;
    setState(prev => ({ ...prev, fetchingMore: true }));

    try {
      const s = stateRef.current;
      const folderData = await fetchFolder(s.currentPath, s.nextCursor, null, s.currentFolderId, s.currentSortBy, s.currentSortOrder);

      if (!folderData || !Array.isArray(folderData.items)) {
        console.warn('Invalid API response for next page:', folderData);
        setState(prev => ({ ...prev, fetchingMore: false }));
        fetchNextPageGuardRef.current = false;
        return;
      }

      const merged = [...s.items, ...folderData.items];
      const pageIndex = (s.pagesFetched || 0) + 1;
      const pageKey = buildPageKey(s.currentFolderId, s.currentSortBy, s.currentSortOrder, pageIndex);
      pageCacheSet(pageKey, folderData.items);

      setState(prev => ({
        ...prev,
        items: merged,
        hasMore: folderData.has_more || false,
        nextCursor: folderData.next_cursor || null,
        prevCursor: folderData.prev_cursor || null,
        pagesFetched: pageIndex,
        fetchingMore: false,
      }));
      fetchNextPageGuardRef.current = false;
      if (onDone) onDone(folderData.items[0]);
    } catch (err) {
      console.error('[fetchNextPage] Error:', err);
      setState(prev => ({ ...prev, fetchingMore: false }));
      fetchNextPageGuardRef.current = false;
    }
  }, [buildPageKey]);

  const fetchPrevPageGuardRef = useRef(false);

  const fetchPrevPage = useCallback(async (onDone) => {
    if (fetchPrevPageGuardRef.current) return false;
    if (navigationInProgressRef.current) return false;
    const s = stateRef.current;
    if (!s.prevCursor) return false;

    fetchPrevPageGuardRef.current = true;
    setState(prev => ({ ...prev, fetchingMore: true }));

    try {
      const folderData = await fetchFolder(s.currentPath, null, null, s.currentFolderId, s.currentSortBy, s.currentSortOrder, s.prevCursor);

      if (!folderData || !Array.isArray(folderData.items)) {
        console.warn('Invalid API response for prev page:', folderData);
        setState(prev => ({ ...prev, fetchingMore: false }));
        fetchPrevPageGuardRef.current = false;
        return false;
      }

      const merged = [...folderData.items, ...s.items];
      const pageIndex = Math.max(0, (s.pagesFetched || 0) - 1);
      const pageKey = buildPageKey(s.currentFolderId, s.currentSortBy, s.currentSortOrder, pageIndex);
      pageCacheSet(pageKey, folderData.items);

      setState(prev => ({
        ...prev,
        items: merged,
        hasMore: folderData.has_more || false,
        nextCursor: folderData.next_cursor || null,
        prevCursor: folderData.prev_cursor || null,
        pagesFetched: pageIndex,
        fetchingMore: false,
      }));
      fetchPrevPageGuardRef.current = false;
      if (onDone) onDone(folderData.items[0]);
      return true;
    } catch (err) {
      console.error('[fetchPrevPage] Error:', err);
      setState(prev => ({ ...prev, fetchingMore: false }));
      fetchPrevPageGuardRef.current = false;
      return false;
    }
  }, [buildPageKey]);

  // === FOLDER-CHANGE GUARD RESET ===
  const prevFolderIdRef = useRef(state.currentFolderId);
  const prevPathRef = useRef(state.currentPath);
  const backgroundLoadTargetRef = useRef({ folderId: null, path: null });
  useEffect(() => {
    if (prevFolderIdRef.current !== state.currentFolderId || prevPathRef.current !== state.currentPath) {
      fetchNextPageGuardRef.current = false;
      fetchPrevPageGuardRef.current = false;
      navigationInProgressRef.current = false;
      const bgTarget = backgroundLoadTargetRef.current;
      const currentFolderId = state.currentFolderId;
      const currentPath = state.currentPath;
      const isSameFolder = bgTarget.folderId === currentFolderId && bgTarget.path === currentPath;
      if (backgroundLoadControllerRef.current && !isSameFolder) {
        backgroundLoadControllerRef.current.abort();
        backgroundLoadControllerRef.current = null;
      }
      prevFolderIdRef.current = state.currentFolderId;
      prevPathRef.current = state.currentPath;
    }
  }, [state.currentFolderId, state.currentPath]);

  // === NAVIGATE TO FOLDER (single consolidated API call) ===
    const navigateToFolder = useCallback(async (folderId, fileId = null, source = 'internal', preloadedPath = null) => {
      if (navigationInProgressRef.current && (source === 'internal' || source === 'upload')) return;
 
     navigationInProgressRef.current = true;
     
     const currentFolderId = state.currentFolderId;
     const isSameFolder = folderId === currentFolderId;
      if (!isSameFolder) {
        updateState(prev => ({ ...prev, loading: true, error: null, selectedFile: null }));
      }
 
           try {
             // PHASE 1 TASK 1: Read stored sort BEFORE main fetch
             // Look up folder path from existing state first to avoid extra API call
             let folderPath = preloadedPath || '';
             if (!folderPath) {
               const existingFolder = state.allFolders?.find(f => f.id === folderId);
               if (existingFolder?.path) {
                 folderPath = existingFolder.path;
               }
             }
             // Only fetch folder metadata if path not found in state (skip unnecessary API call)
             if (!folderPath) {
               try {
                 const controller = new AbortController();
                 const timeout = setTimeout(() => controller.abort(), 3000);
                 const folderMetaRes = await fetch(`/api/folders/${folderId}`, { signal: controller.signal });
                 clearTimeout(timeout);
                 if (folderMetaRes.ok) {
                   const folderInfoForSort = await folderMetaRes.json();
                   folderPath = folderInfoForSort.path || '';
                 }
               } catch (e) {}
             }
           const storedMetaSort = useFolderMetaSortStore.getState().getSort(folderPath);
           const storedSort = useFolderSortStore.getState().getSort(folderPath);

            // Now fetch the actual data, requesting the user's preferred sort from backend
            // Cancel any in-flight sort/refresh requests
            ++refreshGuardRef.current;
            const folderData = await fetchFolder('', null, INITIAL_FOLDER_LIMIT, folderId, storedMetaSort.sortBy, storedMetaSort.sortOrder);
           const folderInfo = folderData.current_folder;
          if (!folderInfo) throw new Error('Folder not found');
 
         updateState(prev => {
           const existingFolders = prev.allFolders || [];
           const newFolders = folderData.folders || [];
           const folderMap = new Map();
           for (const f of [...existingFolders, ...newFolders]) {
             if (f && f.id) folderMap.set(f.id, f);
           }
           if (folderInfo && folderInfo.id) {
             folderMap.set(folderInfo.id, folderInfo);
           }
           const mergedAllFolders = Array.from(folderMap.values());
  
            return {
              ...prev,
              folders: newFolders,
              allFolders: mergedAllFolders,
              items: folderData.items || [],
              currentPath: folderInfo.path || '',
              currentFolderId: folderId,
               currentFilter: storedSort,
               currentSortBy: storedMetaSort.sortBy,
               currentSortOrder: storedMetaSort.sortOrder,
               loadedSortBy: storedMetaSort.sortBy,
               loadedSortOrder: storedMetaSort.sortOrder,
               loading: false,
               hasMore: folderData.has_more || false,
               nextCursor: folderData.next_cursor || null,
               prevCursor: folderData.prev_cursor || null,
               pagesFetched: 0,
               fetchingMore: false,
            };
         });
          // Optional background preload of missing ancestor folders so breadcrumb
          // ancestry is already clickable before the user actually clicks it.
          const ancestorPaths = [];
          if (folderInfo?.path) {
            const parts = folderInfo.path.split('/').filter(Boolean);
            for (let i = 1; i < parts.length; i++) {
              ancestorPaths.push('/' + parts.slice(0, i).join('/'));
            }
          }
          if (ancestorPaths.length > 0) {
            const knownNow = new Set((state.allFolders || []).map(f => f.path));
            const missingAncestors = ancestorPaths.filter(p => !knownNow.has(p));
            if (missingAncestors.length > 0) {
              const batch = missingAncestors.map(p => fetchFolder(p).then(d => ({ p, d })).catch(() => null));
              Promise.all(batch).then(results => {
                const additions = [];
                results.forEach(r => {
                  if (!r) return;
                  const fi = r.d?.current_folder;
                  if (fi?.id) additions.push(fi);
                });
                if (additions.length > 0) {
                  updateState(prev => {
                    const existing = new Set((prev.allFolders || []).map(f => f.path));
                    let changed = false;
                    const merged = (prev.allFolders || []).slice();
                    additions.forEach(fi => {
                      if (!existing.has(fi.path)) {
                        merged.push(fi);
                        changed = true;
                      }
                    });
                    return changed ? { ...prev, allFolders: merged } : prev;
                  });
                }
              }).catch(() => {});
            }
          }
loadedPageKeyRef.current = `${folderId}:${folderInfo.path || ''}:${storedMetaSort.sortBy || ''}:${storedMetaSort.sortOrder || 'asc'}`;

        // Playback list no longer depends on the full folder being loaded into
        // React state: the MediaRepository serves its own ordered ID index for
        // the modal/carousel. Only the grid's scrolled pages live in state.items.

        // Restore scroll position after folder load
       restoreScrollPosition(folderInfo.path || '', folderData.items?.length || 0);
 
        if (fileId) {
          writeUrl(folderId, fileId, true);
         try {
           const file = await fetchFileById(fileId);
           updateState(prev => ({ ...prev, selectedFile: file }));
         } catch (error) {
           console.error('[App] Failed to fetch file for video:', fileId, error);
           updateState(prev => ({ ...prev, selectedFile: null }));
         }
       } else {
         writeUrl(folderId);
         updateState(prev => ({ ...prev, selectedFile: null }));
       }
     } catch (err) {
       console.error('Navigate error:', err);
       updateState(prev => ({ ...prev, error: err.message, loading: false }));
      } finally {
        navigationInProgressRef.current = false;
      }
    }, [writeUrl, updateState, stableMerge, state.currentFolderId, state.currentPath, restoreScrollPosition, state.currentSortBy, state.currentSortOrder, state.currentFilter, state.allFolders]);

  // === NAVIGATE TO ROOT ===
  const navigateToRoot = useCallback(async (source = 'internal') => {
    if (navigationInProgressRef.current && (source === 'internal' || source === 'upload')) return;
    navigationInProgressRef.current = true;

    if (source === 'internal' || source === 'initial') {
      sessionStorage.removeItem('scroll:');
    }

    updateState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // PHASE 1: Request pre-sorted data from backend using saved preference
      // Cancel any in-flight sort/refresh requests
      ++refreshGuardRef.current;
      const savedMetaSort = useFolderMetaSortStore.getState().getSort('/');
      const savedSort = useFolderSortStore.getState().getSort('/');
      const folderData = await fetchFolder('', null, INITIAL_FOLDER_LIMIT, null, savedMetaSort.sortBy, savedMetaSort.sortOrder);
        updateState(prev => ({
          ...prev,
          folders: folderData.folders || [],
          allFolders: folderData.folders || [],
          items: folderData.items || [],
          currentPath: '',
          currentFolderId: null,
          currentFilter: 'all',
          currentSortBy: savedMetaSort.sortBy,
          currentSortOrder: savedMetaSort.sortOrder,
          loadedSortBy: savedMetaSort.sortBy,
          loadedSortOrder: savedMetaSort.sortOrder,
          loading: false,
          hasMore: folderData.has_more || false,
          nextCursor: folderData.next_cursor || null,
          prevCursor: folderData.prev_cursor || null,
          pagesFetched: 0,
          fetchingMore: false,
          selectedFile: null,
        }));
         loadedPageKeyRef.current = `root::${savedMetaSort.sortBy || ''}:${savedMetaSort.sortOrder || 'asc'}`;
      clearUrl();

      restoreScrollPosition('', folderData.items?.length || 0);
    } catch (err) {
      updateState(prev => ({ ...prev, error: err.message, loading: false }));
    } finally {
      navigationInProgressRef.current = false;
    }
  }, [clearUrl]);

  // Refresh current view when an upload finishes.
  // Debounced to avoid multiple rapid refreshes.
  const refreshTimeoutRef = useRef(null);
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const handler = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        const now = Date.now();
        if (now - lastRefreshRef.current < 2000) return;
        lastRefreshRef.current = now;
      }, 500);
    };
    window.addEventListener('media-upload-complete', handler);
    return () => {
      clearTimeout(refreshTimeoutRef.current);
      window.removeEventListener('media-upload-complete', handler);
    };
  }, []);

  // === HANDLE SELECT ===
   const handleSelect = useCallback((item) => {
     if (!item) return;
      if (item.type === 'folder') {
        sessionStorage.removeItem(`scroll:${item.path || ''}`);
        navigateToFolder(item.id, null, 'internal', item.path);
      } else {
        // Clear any leftover playlist queue context so a previously-played
        // playlist can never bleed into the folder player or MiniPlayer.
        usePlaybackStore.getState().clearPlayback();
        sessionStorage.removeItem('playlistQueue');
        sessionStorage.removeItem('currentTrackIndex');
        setPlaylistQueue(null);
        // Stop audio playback when selecting a video file
        if (item.type === 'video') {
         const playbackState = usePlaybackStore.getState();
         if (playbackState.isPlaying) {
           playbackState.pause();
         }
         if (sharedAudioRef.current) {
           sharedAudioRef.current.pause();
           sharedAudioRef.current.currentTime = 0;
         }
       }
       if (state.currentPath) {
         saveScrollPosition(state.currentPath, state.items.length);
       }
        restoreRef.current = { clickedFileId: item.id, activePlaybackId: item.id, mode: 'normal' };
        // A file opened from the Media Vault grid is a VAULT playback context,
        // so the MiniPlayer expand opens the vault audio player (not Music's).
        if (item.type === 'audio') {
          audioContextRef.current = 'vault';
          currentAudioFileIdRef.current = item.id;
        }
        updateState(prev => ({ ...prev, selectedFile: item }));
        if (state.currentFolderId) {
          writeUrl(state.currentFolderId, item.id, true);
        } else {
          writeUrl('root', item.id, true);
        }
     }
    }, [writeUrl, saveScrollPosition, state.currentFolderId, state.currentPath, navigateToFolder]);

   const toggleSelectionMode = useCallback(() => {
     setSelectionMode(prev => {
       const next = !prev;
       if (next) setSelectedIds(new Set());
       return next;
     });
   }, []);

   const toggleSelectItem = useCallback((id) => {
     setSelectedIds(prev => {
       const next = new Set(prev);
       if (next.has(id)) next.delete(id);
       else next.add(id);
       return next;
     });
   }, []);

   const clearSelection = useCallback(() => {
     setSelectedIds(new Set());
     setSelectionMode(false);
   }, []);

   const handleBulkLock = useCallback(async () => {
     const ids = Array.from(selectedIds);
     if (ids.length === 0) return;
     try {
       await bulkLock(ids, true);
       showToast(`${ids.length} item dikunci dari kirim WA`, 'success');
     } catch {
       showToast('Gagal mengunci item', 'error');
     } finally {
       clearSelection();
     }
   }, [selectedIds, clearSelection]);

   const handleBulkDelete = useCallback(async () => {
     const ids = Array.from(selectedIds);
     if (ids.length === 0) return;
     try {
       await bulkDelete(ids);
       showToast(`${ids.length} item dihapus`, 'success');
     } catch {
       showToast('Gagal menghapus item', 'error');
     } finally {
       clearSelection();
     }
   }, [selectedIds, clearSelection]);

   const handleGridSelect = useCallback((item) => {
     if (selectionMode && item?.id) {
       toggleSelectItem(item.id);
       return;
     }
     handleSelect(item);
   }, [selectionMode, toggleSelectItem, handleSelect]);

  // === HANDLE FILE CHANGE ===
  const handleFileChange = useCallback((file) => {
    updateState(prev => ({ ...prev, selectedFile: file }));
    restoreRef.current.activePlaybackId = file?.id;
    if (usePlaybackStore.getState().shuffle) {
      restoreRef.current.mode = 'shuffle';
    }
    if (state.currentFolderId) {
      writeUrl(state.currentFolderId, file.id, true);
    } else {
      writeUrl('root', file.id, true);
    }
  }, [writeUrl, state.currentFolderId]);

  // === HANDLE CLOSE MODAL ===
  const handleCloseModal = useCallback(() => {
    modalClosingRef.current = true;
    // Resolve target file: shuffle mode → active playback file, normal → clicked file
    const { activePlaybackId, clickedFileId, mode } = restoreRef.current;
    const targetId = mode === 'shuffle' ? activePlaybackId : clickedFileId;
    updateState(prev => ({ ...prev, selectedFile: null }));
    // Clear fileId from URL hash
    if (state.currentFolderId) {
      history.pushState({ requestId: ++currentRequestRef.current, folderId: state.currentFolderId, fileId: null }, '', '#/f/' + state.currentFolderId);
    } else {
      history.pushState({ requestId: ++currentRequestRef.current, folderId: null, fileId: null }, '', '#/media');
    }
    // Restore scroll after modal disappears and layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (targetId && gridApiRef.current) {
          gridApiRef.current.scrollToFile(targetId);
        }
        modalClosingRef.current = false;
      });
    });
  }, [state.currentFolderId]);

   // === AUDIO URL SYNC (unique URL per playlist / track / single file) ===
   const currentAudioFileIdRef = useRef(null);
   // Tracks which surface started the current background playback so the
   // MiniPlayer "expand" can open the matching full-screen player (vault vs
   // music) instead of always funnelling into the shared Music AudioPlayer.
   const audioContextRef = useRef(null);
  const syncAudioUrl = useCallback((newIndex) => {
    const st = usePlaybackStore.getState();
    const q = st.queue;
    const meta = playlistMetadata;
    const idx = (newIndex != null ? newIndex : st.currentTrackIndex) ?? 0;
    // Prefer playlistMetadata.id; otherwise recover it from the current hash so a
    // bare playlist URL never silently degrades to "#/audio" (which read as
    // "audio thrown to default").
    let playlistId = meta?.id;
    if (!playlistId) {
      const m = window.location.hash.match(/#\/audio\/playlist\/([^/]+)/);
      if (m) playlistId = m[1];
    }
    if (playlistId) {
      const item = q?.[idx];
      const fid = item?.file_id || item?.id;
      if (fid) {
        const url = `#/audio/playlist/${playlistId}/track/${fid}`;
        if (window.location.hash !== url) {
          history.replaceState({ view: 'audio', playlistId, trackFileId: fid }, '', url);
        }
      } else {
        const url = `#/audio/playlist/${playlistId}`;
        if (window.location.hash !== url) history.replaceState({ view: 'audio', playlistId }, '', url);
      }
    } else if (currentAudioFileIdRef.current) {
      const url = '#/audio/single/' + currentAudioFileIdRef.current;
      if (window.location.hash !== url) {
        history.replaceState({ view: 'audio', fileId: currentAudioFileIdRef.current }, '', url);
      }
    } else {
      // Only fall back to the bare "#/audio" tab when there is genuinely no
      // queue/playlist context. If a more specific audio URL is already in the
      // hash, leave it alone.
      const hash = window.location.hash;
      if (!hash.startsWith('#/audio')) {
        const url = '#/audio';
        if (hash !== url) history.replaceState({ view: 'audio' }, '', url);
      }
    }
  }, [playlistMetadata]);

  // === HANDLE PLAYLIST TRACK INDEX CHANGE ===
  const handleTrackIndexChange = useCallback((newIndex) => {
    setCurrentTrackIndex(newIndex);
    syncAudioUrl(newIndex);
    // Don't update selectedFile in playlist mode - AudioPlayer manages its own active file
    const st = usePlaybackStore.getState();
    const q = st.queue;
    const meta = playlistMetadata;
    if (q && q[newIndex] && !meta) {
      const track = q[newIndex];
      if (track.file_id) {
        fetchFileById(track.file_id)
          .then(file => {
            updateState(prev => ({ ...prev, selectedFile: file }));
          })
          .catch(err => console.error('[App] Failed to fetch track:', err));
      }
    }
   }, [playlistMetadata, syncAudioUrl]);

   // === HANDLE DELETE PLAYLIST ===
   const handleDeletePlaylist = useCallback(async (playlistId) => {
     if (!playlistId) return;
     
     // Show confirmation
     if (window.confirm('Apakah Anda yakin ingin menghapus playlist ini?')) {
       try {
         await fetch(`${import.meta.env.VITE_API_URL || ''}/api/playlists/${playlistId}`, { 
           method: 'DELETE' 
         });
         showToast('Playlist deleted', 'success');
         // Remove from store
         usePlaylistStore.getState().removePlaylist(playlistId);
         
         // If deleting currently selected playlist, go back to list
         if (playlistMetadata?.id === playlistId) {
           setView('playlists');
           setPlaylistMetadata(null);
           setPlaylistQueue([]);
           setCurrentTrackIndex(0);
         }
       } catch (err) {
         console.error('Failed to delete playlist:', err);
         showToast('Gagal menghapus playlist', 'error');
       }
     }
   }, [playlistMetadata, showToast]);

   // === HANDLE CLOSE AUDIO PLAYER ===
   const handleCloseAudioPlayer = useCallback(() => {
     const isVault = audioContextRef.current === 'vault';
     // Pause audio element before clearing state
     if (sharedAudioRef.current) {
       sharedAudioRef.current.pause();
     }
     sharedPrevFileIdRef.current = null;
     usePlaybackStore.getState().clearPlayback();
     usePlaylistStore.getState().clearPlaylistDetail();
     sessionStorage.removeItem('playlistQueue');
     sessionStorage.removeItem('playlistMetadata');
     sessionStorage.removeItem('currentTrackIndex');
     setPlaylistQueue(null);
     setPlaylistMetadata(null);
     setCurrentTrackIndex(0);
     if (isVault) {
       setView('media');
       navigateToRoot();
       return;
     }
     const meta = playlistMetadata;
     const playlistId = meta?.id;
     if (playlistId) {
       sessionStorage.setItem('selectedPlaylistId', playlistId);
       setView('playlists');
       writePlaylistUrl(playlistId, null, false);
     } else {
       setView('media');
       navigateToRoot();
     }
   }, [playlistMetadata, writePlaylistUrl, navigateToRoot]);

    // Close the full-screen VAULT audio player → return to the Media Vault grid.
    const handleCloseVaultAudio = useCallback(() => {
      if (sharedAudioRef.current) {
        sharedAudioRef.current.pause();
      }
      sharedPrevFileIdRef.current = null;
      cancelAutoPlayPending();
      usePlaybackStore.getState().clearPlayback();
      audioContextRef.current = null;
      setView('media');
      navigateToRoot();
    }, [navigateToRoot]);

   // === EXPAND MINI PLAYER TO FULL AUDIO (push URL so Back is deterministic) ===
   const expandToAudio = useCallback(() => {
    // A vault file playing in the background expands into the dedicated vault
    // audio player, NOT the Music AudioPlayer — keeps the two surfaces separate.
    if (audioContextRef.current === 'vault') {
      setView('vaultAudio');
      const fid = state.selectedFile?.id || currentAudioFileIdRef.current;
      if (fid) {
        const url = '#/vault/audio/' + fid;
        if (window.location.hash !== url) history.pushState({ view: 'vaultAudio', fileId: fid }, '', url);
      } else {
        history.pushState({ view: 'vaultAudio' }, '', '#/vault/audio');
      }
      return;
    }
    setView('audio');
    const playlistState = usePlaylistStore.getState();
    const playlistId = playlistState.currentPlaylist?.id;
    if (playlistId) {
      const pb = usePlaybackStore.getState();
      const activeIdx = pb.currentTrackIndex ?? 0;
      const queueToUse = pb.queue || playlistQueue;
      if (queueToUse && queueToUse.length > 0) setPlaylistQueue(queueToUse);
      setCurrentTrackIndex(activeIdx);
      const item = queueToUse?.[activeIdx];
      const fid = item?.file_id || item?.id;
      if (fid) {
        const url = `#/audio/playlist/${playlistId}/track/${fid}`;
        if (window.location.hash !== url) history.pushState({ view: 'audio', playlistId, trackFileId: fid }, '', url);
      } else {
        writePlaylistUrl(playlistId, null);
      }
    } else if (currentAudioFileIdRef.current) {
      const url = '#/audio/single/' + currentAudioFileIdRef.current;
      if (window.location.hash !== url) {
        history.pushState({ view: 'audio', fileId: currentAudioFileIdRef.current }, '', url);
      }
    } else {
      history.pushState({ view: 'audio' }, '', '#/audio');
    }
  }, [writePlaylistUrl, state.selectedFile]);

  // === PROCESSED ITEMS (STABLE MEMOIZED) ===
  const processedFolders = useMemo(() => {
    if (state.currentFilter !== 'all' && state.currentFilter !== 'folder') return [];
    if (state.currentFilter === 'love') return [];
    return [...state.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [state.folders, state.currentFilter]);

  const processedItems = useMemo(() => {
    if (state.currentFilter === 'folder') return [];
    let result = state.items;

    if (state.currentFilter !== 'all') {
      if (state.currentFilter !== 'folder' && state.currentFilter !== 'love') {
        result = result.filter(f => f.type === state.currentFilter);
      }
    }

    // Filter favorites only
    if (favoriteOnly) {
      result = result.filter(f => f.is_favorite === 1);
    }

    // Love filter type — show only loved items
    if (state.currentFilter === 'love') {
      result = result.filter(f => f.is_favorite === 1);
    }

    const backendDeliveredCorrectSort = 
      state.currentSortBy === state.loadedSortBy && 
      state.currentSortOrder === state.loadedSortOrder;

    if (state.currentSortBy && !backendDeliveredCorrectSort) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (state.currentSortBy === 'name') {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        } else if (state.currentSortBy === 'mtime') {
          cmp = (a.mtime || 0) - (b.mtime || 0);
        } else if (state.currentSortBy === 'created_at') {
          cmp = (a.created_at || 0) - (b.created_at || 0);
        } else if (state.currentSortBy === 'size') {
          cmp = (a.size || 0) - (b.size || 0);
        }
        return state.currentSortOrder === 'desc' ? -cmp : cmp;
      });
    }
    return result;
  }, [state.items, state.currentFilter, state.currentSortBy, state.currentSortOrder, state.loadedSortBy, state.loadedSortOrder, favoriteOnly]);

    const sortedSearchItems = useMemo(() => {
     const files = searchResults?.files;
     if (!files || files.length === 0) return files || [];
     let result = [...files];
    if (state.currentFilter !== 'all') {
      if (state.currentFilter !== 'folder' && state.currentFilter !== 'love') {
        result = result.filter(f => f.type === state.currentFilter);
      }
    }
     // Love filter type — show only loved items
     if (state.currentFilter === 'love') {
       result = result.filter(f => f.is_favorite === 1);
     }
     if (state.currentSortBy) {
       result.sort((a, b) => {
         let cmp = 0;
         if (state.currentSortBy === 'name') {
           cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
         } else if (state.currentSortBy === 'mtime') {
           cmp = (a.mtime || 0) - (b.mtime || 0);
         } else if (state.currentSortBy === 'created_at') {
           cmp = (a.created_at || 0) - (b.created_at || 0);
         } else if (state.currentSortBy === 'size') {
           cmp = (a.size || 0) - (b.size || 0);
         }
         return state.currentSortOrder === 'desc' ? -cmp : cmp;
       });
     }
     return result;
   }, [searchResults, state.currentFilter, state.currentSortBy, state.currentSortOrder]);

  const sortedSearchFolders = useMemo(() => {
    if (!searchResults?.folders) return [];
    if (state.currentFilter !== 'all' && state.currentFilter !== 'folder') return [];
    return [...searchResults.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [searchResults, state.currentFilter]);

  // Files for the media player modal (VideoPlayer / AudioPlayer / ImageViewer + Carousel).
  // Respects currentFilter exactly:
  // - 'all' → includes video + audio + image (user requested)
  // - specific type → only that type
  // No longer hard-excludes images for "playability".
  const playerFiles = useMemo(() => {
    if (state.currentFilter === 'all') {
      return processedItems; // full mixed list
    }
    if (state.currentFilter === 'folder') {
      return [];
    }
    return processedItems.filter(f => f.type === state.currentFilter);
  }, [processedItems, state.currentFilter]);

  // Scope descriptor for the index-driven MediaRepository. Maps the current
  // vault filter/sort/favorites into server-side index filters. When searching,
  // playback falls back to the (search-capped) array path.
  const isSearching = searchResults !== null && searchQuery.trim().length >= 2;
  const folderScope = useMemo(() => {
    if (isSearching || state.currentFolderId == null) return null;
    const type = (state.currentFilter === 'video' || state.currentFilter === 'audio' || state.currentFilter === 'image')
      ? state.currentFilter
      : null;
    return {
      folderId: state.currentFolderId,
      type,
      favoriteOnly: favoriteOnly || state.currentFilter === 'love',
      sortBy: state.currentSortBy,
      sortOrder: state.currentSortOrder,
    };
  }, [isSearching, state.currentFolderId, state.currentFilter, state.currentSortBy, state.currentSortOrder, favoriteOnly]);



  /* DEBUG console.log removed */

  // === SYNC NAVIGATION REFS (for popstate handler) ===
  useEffect(() => { navigateToFolderRef.current = navigateToFolder; }, [navigateToFolder]);
  useEffect(() => { navigateToRootRef.current = navigateToRoot; }, [navigateToRoot]);

// === INITIAL LOAD (respect URL hash) ===
   const initialLoadDoneRef = useRef(false);
   useEffect(() => {
     if (initialLoadDoneRef.current) return;
     let cancelled = false;
     let retryTimer = null;
     const MAX_RETRIES = 60;

     const attemptLoad = (retriesLeft) => {
       const route = parseHash(window.location.hash, sessionStorage);
       if (route.type === 'monitoring') {
         const sub = route.subPath || '';
         if (sub) sessionStorage.setItem('monitoringSubPath', sub);
         setView('monitoring');
         return;
       }
         if (route.type === 'downloader') { setView('downloader'); return; }
         if (route.type === 'adb') { setView('adb'); return; }
         if (route.type === 'scrcpy') { setView('scrcpy'); return; }
         if (route.type === 'whatsapp') { setView('whatsapp'); return; }
         if (route.type === 'sendqueue') { setView('sendqueue'); return; }
        if (route.type === 'playlists') { setView('playlists'); return; }
       if (route.type === 'playlist-detail') {
         if (route.playlistId) sessionStorage.setItem('selectedPlaylistId', route.playlistId);
         setView('playlists');
         return;
       }
       if (route.type === 'vault-audio') {
         audioContextRef.current = 'vault';
         if (route.fileId) {
           currentAudioFileIdRef.current = route.fileId;
           (async () => {
             try {
               const file = await fetchFileById(route.fileId);
               if (file) updateState(prev => ({ ...prev, selectedFile: file }));
             } catch (e) {}
           })();
         }
         setView('vaultAudio');
         return;
       }
        if (route.type === 'audio') {
         // Re-entering audio after leaving it: the previous popstate cleared the
        // playlist state, so rebuild it from the URL (server) or storage instead
        // of showing an empty default audio view.
        if (route.fileId) currentAudioFileIdRef.current = route.fileId;
        if ((route.playlistId || route.fileId) && (!usePlaybackStore.getState().queue || usePlaybackStore.getState().queue.length === 0)) {
          (async () => {
            try {
                if (route.playlistId && route.playlistId !== LOVED_PLAYLIST_ID) {
                  const ts = safeParseTrackSort();
                  const data = await fetchPlaylistPlay(route.playlistId, { sortBy: ts.by, sortOrder: ts.order });
                if (data?.queue?.length) {
                  const q = applyTrackSearch(applyTrackFilter(data.queue, safeParseTrackFilter()), safeParseTrackSearchQuery());
                  setPlaylistQueue(q);
                  setPlaylistMetadata(data.playlist);
                  const idx = route.trackFileId
                    ? q.findIndex(t => String(t.file_id || t.id) === String(route.trackFileId))
                    : -1;
                  const resolved = idx >= 0 ? idx : 0;
                  setCurrentTrackIndex(resolved);
                  const zs2 = usePlaybackStore.getState();
                  zs2.setQueue(q, resolved);
                }
              } else if (route.fileId) {
                const file = await fetchFileById(route.fileId);
                if (file) setPlaylistQueue([{ file_id: file.id, title: file.name, artist: file.artist, album: file.album, duration: file.duration, path: file.path, exists: true, type: file.type || 'audio' }]);
              }
            } catch (e) { console.error('[App] popstate audio restore failed:', e); }
          })();
        }
        setView('audio');
        return;
      }

       if (route.type === 'folder' || route.type === 'file') {
         navigateToFolder(parseInt(route.folderId, 10), route.fileId || null, 'initial')
           .catch(() => {
             if (!cancelled && retriesLeft > 0) {
               retryTimer = setTimeout(() => attemptLoad(retriesLeft - 1), 3000);
             }
           });
       } else if (route.type === 'root-file') {
         navigateToRoot('initial').then(async () => {
           try {
             const file = await fetchFileById(route.fileId);
             updateState(prev => ({ ...prev, selectedFile: file }));
             writeUrl('root', file.id, true);
           } catch (e) {}
         }).catch(() => {
           if (!cancelled && retriesLeft > 0) {
             retryTimer = setTimeout(() => attemptLoad(retriesLeft - 1), 3000);
           }
         });
       } else {
         navigateToRoot('initial').catch(() => {
           if (!cancelled && retriesLeft > 0) {
             retryTimer = setTimeout(() => attemptLoad(retriesLeft - 1), 3000);
           }
         });
       }
     };

      attemptLoad(MAX_RETRIES);
      initialLoadDoneRef.current = true;

      return () => {
       cancelled = true;
       if (retryTimer) clearTimeout(retryTimer);
     };
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

  // === HANDLE BROWSER BACK/FORWARD ===
  useEffect(() => {
    const handlePopState = (event) => {
      const route = parseHash(window.location.hash, sessionStorage);
      if (route.type === 'monitoring') {
  const sub = route.subPath || '';
  if (sub) {
    sessionStorage.setItem('monitoringSubPath', sub);
  }
  setView('monitoring');
  return;
  }
       if (route.type === 'downloader') { setView('downloader'); return; }
       if (route.type === 'adb') { setView('adb'); return; }
       if (route.type === 'scrcpy') { setView('scrcpy'); return; }
       if (route.type === 'whatsapp') { setView('whatsapp'); return; }
if (route.type === 'sendqueue') { setView('sendqueue'); return; }
       if (route.type === 'playlists' || route.type === 'playlist-detail') {
        // Only clear audio if we're actually coming from audio view
        if (viewRef.current === 'audio') {
          if (sharedAudioRef.current) sharedAudioRef.current.pause();
      sharedPrevFileIdRef.current = null;
      cancelAutoPlayPending();
      usePlaybackStore.getState().clearPlayback();
          usePlaylistStore.getState().clearPlaylistDetail();
          sessionStorage.removeItem('playlistQueue');
          sessionStorage.removeItem('playlistMetadata');
          sessionStorage.removeItem('currentTrackIndex');
          setPlaylistQueue(null);
          setPlaylistMetadata(null);
          setCurrentTrackIndex(0);
        }
        // Preserve selectedPlaylistId for PlaylistView restore
        if (route.type === 'playlist-detail' && route.playlistId) {
          sessionStorage.setItem('selectedPlaylistId', route.playlistId);
        } else {
          sessionStorage.removeItem('selectedPlaylistId');
        }
        setView('playlists');
        return;
      }
       if (route.type === 'vault-audio') {
         audioContextRef.current = 'vault';
         if (route.fileId && !usePlaybackStore.getState().queue?.length) {
           (async () => {
             try {
               const file = await fetchFileById(route.fileId);
               if (file) updateState(prev => ({ ...prev, selectedFile: file }));
             } catch (e) {}
           })();
         }
         setView('vaultAudio');
         return;
       }
       if (route.type === 'audio') { setView('audio'); return; }
      setView('media');
      const state = event.state;
      if (route.type === 'root-file' && route.fileId) {
        navigateToRootRef.current?.('popstate').then(async () => {
          try {
            const file = await fetchFileById(route.fileId);
            updateState(prev => ({ ...prev, selectedFile: file }));
            writeUrl('root', file.id, true);
          } catch (e) {}
        });
      } else if (!state || !state.folderId) {
        navigateToRootRef.current?.('popstate');
      } else {
        navigateToFolderRef.current?.(state.folderId, state.fileId || null, 'popstate');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [writeUrl, updateState]);

   // Prevent permanent blank loading state if initial navigation stalls.
   useEffect(() => {
     if (!state.loading) return;
     const timer = setTimeout(() => updateState(prev => ({ ...prev, loading: false })), 10000);
     return () => clearTimeout(timer);
   }, [state.loading, updateState]);

    // === PROCESSED ITEMS (STABLE MEMOIZED) ===
   return (
    <ErrorBoundary title="Something went wrong" reloadLabel="Reload">
      <div
        data-debug-id="1"
        data-debug-name="MediaVaultRoot"
        data-debug-type="container"
        className="h-[100dvh] flex flex-col bg-neutral-950 overflow-hidden"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Header — hidden when playlists/scrcpy/sendqueue view (they have their own header) */}
        {view !== 'playlists' && view !== 'audio' && view !== 'scrcpy' && view !== 'vaultAudio' && view !== 'sendqueue' && (
        <>
        <header className="flex-shrink-0 px-3 py-2 border-b border-neutral-800 bg-neutral-950 z-10">


{view === 'media' && (
            <div className="flex items-center gap-2 overflow-x-auto">
              {/* Breadcrumb with Home button */}
              <button
                onClick={() => navigateToRoot()}
                className={`px-2 py-0.5 rounded text-xs whitespace-nowrap transition-colors flex-shrink-0 ${
                  !state.currentPath 
                    ? 'bg-sky-600/80 text-white' 
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'
                }`}
              >
                Home
              </button>
               {state.currentPath && state.currentPath.split('/').map((part, i, parts) => {
                   const path = parts.slice(0, i + 1).join('/');
                   const folder = (state.allFolders || []).find(f => f.path === path);
                   const isLast = i === parts.length - 1;
                   return (
                     <React.Fragment key={i}>
                       <span className="text-neutral-600 text-xs">/</span>
                       <button
                         onClick={async () => {
                           try {
                             let folderIdToUse = folder?.id;
                             let pathToUse = folder?.path || path;
                             if (!folderIdToUse) {
                               const data = await fetchFolder(path);
                               const fi = data?.current_folder;
                               if (fi?.id) {
                                 folderIdToUse = fi.id;
                                 pathToUse = fi.path || path;
                               }
                             }
                             if (folderIdToUse) {
                               sessionStorage.removeItem(`scroll:${pathToUse || ''}`);
                               navigateToFolder(folderIdToUse, null, 'internal', pathToUse);
                             }
                           } catch (e) {
                             console.error('[breadcrumb] failed to resolve folder:', path, e);
                           }
                         }}
                         className={`px-2 py-0.5 rounded text-xs whitespace-nowrap transition-colors ${
                           isLast
                             ? 'bg-sky-600/50 text-sky-300'
                             : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                         }`}
                       >
                         {part}
                       </button>
                     </React.Fragment>
                   );
               })}
            </div>
            )}

            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
                <span className="text-sm font-semibold whitespace-nowrap text-neutral-200">
                  {view === 'media' ? 'Media Vault' : view === 'monitoring' ? 'Monitoring' : view === 'downloader' ? 'Downloader' : view === 'playlists' || view === 'audio' ? (view === 'audio' ? (playlistMetadata?.title || 'Audio Player') : 'Music') : view === 'scrcpy' ? 'Scrcpy Mirror' : view === 'adb' ? 'ADB Transfer' : view === 'whatsapp' ? 'Bot' : 'Media Vault'}
                </span>
              </div>

              <div className="flex-1 flex justify-center px-2">
                {(view === 'media' || view === 'playlists') && (
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Cari file atau folder..."
                    className="w-56 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:border-neutral-600"
                  />
                )}
              </div>

              {view === 'media' && (
                <div className="flex items-center gap-1 flex-shrink-0">
                {selectionMode ? (
                  <>
                    <span className="text-xs text-neutral-300 mr-1">{selectedIds.size} item</span>
                    <button
                      onClick={handleBulkLock}
                      className="single-panel-btn"
                      title="Kunci item dari kirim WA"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="single-panel-btn hover:!border-red-500/50 hover:!text-red-400"
                      title="Hapus item yang dipilih"
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      onClick={clearSelection}
                      className="single-panel-btn"
                      title="Batal pilih"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={toggleSelectionMode}
                      className="single-panel-btn"
                      title="Pilih item untuk dihapus atau dikunci dari kirim WA"
                    >
                      <CheckSquare size={16} />
                    </button>
                    <button
                      onClick={() => setShowFilterPanel(true)}
                      className={`single-panel-btn ${state.currentFilter !== 'all' || state.currentSortBy !== null ? 'has-filters' : ''}`}
                      title="Filters"
                    >
                      <SlidersHorizontal size={16} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </header>
        {selectionMode && view === 'media' && (
          <div className="flex-shrink-0 px-3 py-2 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between z-10">
            <span className="text-xs text-neutral-400">Mode pilih — klik kartu untuk memilih</span>
            <button
              onClick={clearSelection}
              className="text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Batal
            </button>
          </div>
        )}
        </>
        )}

        {/* Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 transition-opacity duration-300"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Slide-in Sidebar */}
        <div className={`fixed top-0 left-0 h-full w-64 bg-neutral-900 border-r border-neutral-800 z-50 transform transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col overflow-hidden`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
            <span className="text-sm font-semibold text-neutral-200">Menu</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <nav className="p-2 space-y-1 overflow-y-auto flex-1 min-h-0">
            <button
              data-debug-id="1.1.1.1" data-debug-name="NavMedia" data-debug-type="other"
              onClick={() => { setView('media'); setSidebarOpen(false); sessionStorage.removeItem('view'); history.pushState({ view: 'media' }, '', '#/media'); navigateToRoot(); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'media' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Media Vault
            </button>
            <button
              data-debug-id="1.1.1.2" data-debug-name="NavMonitoring" data-debug-type="other"
              onClick={() => { setView('monitoring'); setSidebarOpen(false); history.pushState({ view: 'monitoring' }, '', '#/monitoring'); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'monitoring' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V10M18 20V4M6 20v-4" />
              </svg>
              Monitoring
            </button>
            <button
              data-debug-id="1.1.1.3" data-debug-name="NavDownloader" data-debug-type="other"
              onClick={() => { setView('downloader'); setSidebarOpen(false); history.pushState({ view: 'downloader' }, '', '#/downloader'); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'downloader' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 11l5 5 5-5M12 4v12" />
              </svg>
              Downloader
            </button>
<button
              data-debug-id="1.1.1.4" data-debug-name="NavAdb" data-debug-type="other"
              onClick={() => { setView('adb'); setSidebarOpen(false); history.pushState({ view: 'adb' }, '', '#/adb'); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'adb' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12" y2="18" />
              </svg>
              ADB Transfer
            </button>
            <button
              data-debug-id="1.1.1.4b" data-debug-name="NavScrcpy" data-debug-type="other"
              onClick={() => { setView('scrcpy'); setSidebarOpen(false); history.pushState({ view: 'scrcpy' }, '', '#/scrcpy'); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'scrcpy' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Scrcpy Mirror
            </button>
            <button
              data-debug-id="1.1.1.5" data-debug-name="NavPlaylists" data-debug-type="other"
              onClick={() => {
                // Reset all playlist state when clicking menu (Issue #1)
                sessionStorage.removeItem('selectedPlaylistId');
                sessionStorage.removeItem('playlistQueue');
                sessionStorage.removeItem('playlistMetadata');
                sessionStorage.removeItem('currentTrackIndex');
                setPlaylistQueue(null);
                setPlaylistMetadata(null);
                setCurrentTrackIndex(0);
        cancelAutoPlayPending();
        usePlaybackStore.getState().clearPlayback();
                setView('playlists');
                setSidebarOpen(false);
                history.pushState({ view: 'playlists' }, '', '#/playlists');
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'playlists' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              Music
             </button>
             <button
               data-debug-id="1.1.1.6" data-debug-name="NavBot" data-debug-type="other"
              onClick={() => { setView('whatsapp'); setSidebarOpen(false); history.pushState({ view: 'whatsapp' }, '', '#/whatsapp'); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'whatsapp' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
              Bot
            </button>
            <button
               data-debug-id="1.1.1.7" data-debug-name="NavSendQueue" data-debug-type="other"
               onClick={() => { setView('sendqueue'); setSidebarOpen(false); history.pushState({ view: 'sendqueue' }, '', '#/sendqueue'); }}
               className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${view === 'sendqueue' ? 'text-sky-400 bg-sky-500/10 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              Antrian Kirim
             </button>

            {/* Debug Toggle */}
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <DebugToggle />
            </div>

          </nav>
        </div>

          {/* Main Content */}
          {view === 'monitoring' ? (
            <MonitoringView onBackToMedia={() => { setView('media'); history.replaceState({}, '', '#/media'); navigateToRoot(); }} />
          ) : view === 'downloader' ? (
            <div className="flex-1 flex overflow-hidden">
              <DownloaderPage />
            </div>
) : view === 'adb' ? (
  <AdbTransfer />
) : (view === 'playlists' || view === 'audio' || view === 'vaultAudio') ? (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-hidden" style={{ display: (view === 'audio' || view === 'vaultAudio') ? 'none' : 'flex', flexDirection: 'column' }}>
   <PlaylistView key={view === 'audio' ? 'audio-hidden' : 'playlists-visible'}
     onMenuOpen={() => setSidebarOpen(true)}
       onPlayPlaylist={async (data) => {
         cancelAutoPlayPending();
         usePlaybackStore.getState().clearPlayback();
         sharedPrevFileIdRef.current = null;
        usePlaybackStore.getState().setQueue(data.queue, 0);
        usePlaybackStore.getState().play();
        setPlaylistQueue(data.queue);
        setPlaylistMetadata(data.playlist);
        setCurrentTrackIndex(0);
        audioContextRef.current = 'music';
        showToast(`Playing: ${data.playlist.title}`, 'success');
      }}
         onPlayTrack={(file, fullQueue, clickedIdx, playlist) => {
           if (!file?.file_id && !file?.id) return;
           cancelAutoPlayPending();
           usePlaybackStore.getState().clearPlayback();
           sharedPrevFileIdRef.current = null;
          const queue = fullQueue && fullQueue.length > 0 ? fullQueue : [{
            file_id: file.file_id || file.id,
            track_index: 0,
            title: file.display_name || file.displayName || file.name?.replace(/\.[^/.]+$/, ''),
            artist: file.artist || '',
            album: file.album || '',
            duration: file.duration || 0,
            path: file.resolved_path || file.path || (file.dir_path ? `${file.dir_path}/${file.name}` : file.name),
            exists: true,
            name: file.display_name || file.name,
            type: file.type || 'audio',
          }];
          const trackIdx = clickedIdx != null ? clickedIdx : 0;
          usePlaybackStore.getState().setQueue(queue, trackIdx);
          usePlaybackStore.getState().setCurrentTrackIndex(trackIdx);
          usePlaybackStore.getState().play();
          setPlaylistQueue(queue);
          setPlaylistMetadata(playlist || { title: file.display_name || file.displayName || file.name?.replace(/\.[^/.]+$/, ''), creator: '' });
          setCurrentTrackIndex(trackIdx);
          audioContextRef.current = 'music';
          showToast(`Playing: ${file.display_name || file.name}`, 'success');
        }}
        onDeletePlaylist={handleDeletePlaylist}
        onBackToPlaylistList={() => {
          setPlaylistQueue(null);
          setPlaylistMetadata(null);
          setCurrentTrackIndex(0);
          sessionStorage.removeItem('playlistQueue');
          sessionStorage.removeItem('playlistMetadata');
          sessionStorage.removeItem('currentTrackIndex');
        }}
      />
         </div>
         {view === 'audio' && (
          <div className="flex-1 flex overflow-hidden animate-in fade-in duration-300">
          <MusicPlayer
            file={state.selectedFile}
            currentSortBy={state.currentSortBy}
            currentSortOrder={state.currentSortOrder}
            favoriteOnly={favoriteOnly}
            onClose={handleCloseAudioPlayer}
            onMinimize={() => {
              const playlistId = playlistMetadata?.id;
              usePlaylistStore.getState().clearPlaylistDetail();
              if (playlistId) {
                sessionStorage.setItem('selectedPlaylistId', playlistId);
                setView('playlists');
                writePlaylistUrl(playlistId, null, true);
              } else {
                setView('media');
                navigateToRoot();
              }
            }}
            onAudioChange={handleFileChange}
            playlistQueue={playlistQueue}
            currentTrackIndex={currentTrackIndex}
            playlistTitle={playlistMetadata?.title || null}
            trackSort={safeParseTrackSort()}
            onTrackIndexChange={handleTrackIndexChange}
            onFavoriteToggle={handleToggleFavorite}
            sharedAudioRef={sharedAudioRef}
            sharedPrevFileIdRef={sharedPrevFileIdRef}
            audioReady={audioReady}
            folderFiles={searchResults !== null && searchQuery.trim().length >= 2 ? searchFileList : playerFiles}
          />
          </div>
        )}
        {view === 'vaultAudio' && (
          <div className="flex-1 flex overflow-hidden animate-in fade-in duration-300">
            <VaultAudioPlayer
              file={state.selectedFile}
              folderFiles={searchResults !== null && searchQuery.trim().length >= 2 ? searchFileList : playerFiles}
              currentSortBy={state.currentSortBy}
              currentSortOrder={state.currentSortOrder}
              favoriteOnly={favoriteOnly}
              onClose={handleCloseVaultAudio}
              onAudioChange={handleFileChange}
              onToggleFavorite={handleToggleFavorite}
              sharedAudioRef={sharedAudioRef}
              sharedPrevFileIdRef={sharedPrevFileIdRef}
              audioReady={audioReady}
            />
          </div>
        )}
       </div>
       ) : view === 'whatsapp' ? (
          <WhatsAppView onMenuOpen={() => setSidebarOpen(true)} />
       ) : view === 'sendqueue' ? (
            <SendQueueView onMenuOpen={() => setSidebarOpen(true)} onToggleFavorite={handleToggleFavorite} />
       ) : view === 'scrcpy' ? (
          <ScrcpyView onMenuOpen={() => setSidebarOpen(true)} />
      ) : (
          <div className="flex-1 flex overflow-hidden relative pb-14">
            <ServiceStoppedBanner service="mediaVault" overlay />
            {/* File Grid - Full Width */}
            <main ref={scrollContainerRef} className="flex-1 overflow-y-auto min-w-0 overscroll-none" style={{ scrollbarGutter: 'stable' }}>
 {(() => {
                const isSearching = searchResults !== null && searchQuery.trim().length >= 2;
                // Cap how many result cards are actually rendered. Rendering the
                // full result set (up to ~200 thumbnails) at once freezes the UI;
                // slicing keeps search snappy while the query can be narrowed.
                const SEARCH_RENDER_LIMIT = 120;
                const displayFolders = isSearching ? sortedSearchFolders : processedFolders;
                const searchCapped = isSearching && sortedSearchItems.length > SEARCH_RENDER_LIMIT;
                const displayItems = isSearching ? sortedSearchItems.slice(0, SEARCH_RENDER_LIMIT) : processedItems;

               if (state.loading && displayFolders.length === 0 && displayItems.length === 0) {
                 return (
                   <div className="flex flex-col items-center justify-center h-64 gap-2">
                     <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                     <p className="text-neutral-500 text-sm">Loading media...</p>
                   </div>
                 );
               }

               if (displayFolders.length === 0 && displayItems.length === 0) {
                 return (
                   <div className="flex flex-col items-center justify-center h-64 gap-2">
                     <p className="text-neutral-500 text-sm">
                       {isSearching ? `No results for "${searchQuery}"` : 'Empty folder'}
                     </p>
                   </div>
                 );
               }

                 return (
                  <>
                   {state.loading && (
                     <div className="sticky top-0 z-10 h-0.5 w-full overflow-hidden">
                       <div className="h-full bg-sky-500 animate-loading-bar" />
                     </div>
                   )}
                     <MediaGrid
                     ref={gridApiRef}
                     key={`${isSearching ? 'search' : state.currentFilter}`}
                     folders={displayFolders}
                     files={displayItems}
                      onSelect={handleGridSelect}
                      onToggleFavorite={handleToggleFavorite}
                     sortBy={state.currentSortBy}
                     sortOrder={state.currentSortOrder}
                      groupByFolder={isSearching}
                     hasMore={state.hasMore}
                     fetchingMore={state.fetchingMore}
                     onLoadMore={fetchNextPage}
                     onNearTop={handleNearTop}
                     selectionMode={selectionMode && view === 'media'}
                     selectedIds={selectedIds}
                     onToggleSelect={toggleSelectItem}
                   />
                   {searchCapped && (
                     <div className="text-center text-xs text-neutral-500 py-3">
                       Menampilkan {Math.min(SEARCH_RENDER_LIMIT, sortedSearchItems.length)} dari {sortedSearchItems.length} hasil — persempit kata kunci untuk melihat lainnya
                     </div>
                   )}
                  </>
               );
             })()}
          </main>
        </div>
          )}

{/* Media Modal - only show when NOT in audio view (audio has its own player) */}
          {state.selectedFile && view !== 'audio' && view !== 'vaultAudio' && (
            <>
                <MediaModal
                  file={state.selectedFile}
                  folderFiles={searchResults !== null && searchQuery.trim().length >= 2 ? searchFileList : playerFiles}
                  currentFilter={state.currentFilter}
                  currentSortBy={state.currentSortBy}
                  currentSortOrder={state.currentSortOrder}
                  favoriteOnly={favoriteOnly}
                  onClose={handleCloseModal}
                  onFileChange={handleFileChange}
                  onToggleFavorite={handleToggleFavorite}
                  sharedAudioRef={sharedAudioRef}
                  audioReady={audioReady}
                  onPreviousEnd={fetchPrevPage}
                  onNextEnd={fetchNextPage}
                  mediaRepo={isSearching ? null : mediaRepo}
                  folderScope={isSearching ? null : folderScope}
                />
           </>
         )}

        {/* Bottom Search Bar + Action Controls */}
        {view === 'media' && (
        <div className="fixed bottom-0 left-0 right-0 h-14 bg-neutral-950/90 backdrop-blur-md border-t border-neutral-800/80 flex items-center px-3 z-40 gap-2">
          <div
            ref={searchBarRef}
            data-debug-id="1.1.3" data-debug-name="SearchBar" data-debug-type="other"
            className={`relative flex items-center rounded-full bg-neutral-800/80 border border-neutral-700/50 transition-all duration-400 ease-out cursor-pointer overflow-hidden ${
              searchExpanded
                ? 'gap-2 px-3.5 py-2 w-60 shadow-lg shadow-blue-500/5 border-blue-500/20'
                : 'gap-0 w-10 h-10 justify-center hover:bg-neutral-700/80 hover:border-neutral-600'
            }`}
            onClick={() => {
              if (!searchExpanded) {
                setSearchExpanded(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
              }
            }}
          >
            <svg className={`w-4 h-4 flex-shrink-0 transition-colors duration-300 ${searchExpanded ? 'text-blue-400' : 'text-neutral-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" />
            </svg>
            <div className={`overflow-hidden transition-all duration-400 ease-out ${
              searchExpanded ? 'w-40 opacity-100 ml-0.5' : 'w-0 opacity-0'
            }`}>
              <input
                ref={searchInputRef}
                data-debug-id="1.1.3.1" data-debug-name="SearchInput" data-debug-type="other"
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Cari file atau folder..."
                className="w-full bg-transparent text-xs text-neutral-200 placeholder-neutral-500 outline-none border-none whitespace-nowrap"
              />
            </div>
            {searchQuery && searchExpanded && (
              <button
                onClick={(e) => { e.stopPropagation(); clearSearch(); }}
                className="p-0.5 text-neutral-500 hover:text-neutral-300 flex-shrink-0 ml-auto transition-opacity duration-300"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Action buttons (right side) */}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            {/* Favorite filter toggle */}
            <button
              onClick={() => setFavoriteOnly(v => !v)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                favoriteOnly
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-neutral-800/80 text-neutral-400 border border-neutral-700/50 hover:bg-neutral-700/80 hover:text-neutral-200'
              }`}
              title={favoriteOnly ? 'Show all files' : 'Show favorites only'}
            >
              <Heart size={16} className={favoriteOnly ? 'fill-red-400' : ''} />
            </button>

            {/* Notifications */}
            <button
              onClick={() => setShowNotificationsPanel(true)}
              className="w-10 h-10 rounded-full bg-neutral-800/80 border border-neutral-700/50 text-neutral-400 flex items-center justify-center hover:bg-neutral-700/80 hover:text-neutral-200 relative transition-colors"
              aria-label="Open notifications panel"
            >
              <Bell size={16} />
              {activeUploadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[9px] leading-4 font-semibold text-center border-2 border-neutral-950">
                  {activeUploadCount}
                </span>
              )}
            </button>

            {/* Send to Telegram (disabled) */}
            <button
              disabled
              className="w-10 h-10 rounded-full bg-neutral-800/80 border border-neutral-700/50 text-neutral-600 flex items-center justify-center cursor-not-allowed opacity-50"
              title="Send to Telegram (coming soon)"
            >
              <Send size={16} />
            </button>

            {/* Upload */}
            <button
              onClick={handleFilePicker}
              className="w-10 h-10 rounded-full bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors flex items-center justify-center shadow shadow-blue-500/20"
              title="Upload"
            >
              <UploadIcon size={16} />
            </button>
          </div>
        </div>
        )}

        {/* Upload: hidden file input */}
        <input ref={fileInputRef} type="file" multiple
          onChange={handleInputChange}
          className="hidden"
          accept={view !== 'media' ? undefined : '.mp4,.mkv,.avi,.mov,.mp3,.flac,.wav,.jpg,.jpeg,.png,.gif,.webp'} />

        {/* Upload controls moved into bottom bar (no floating FAB). */}

        {/* Notifications Panel Modal */}
        {showNotificationsPanel && (
          <div className="panel-backdrop show" onClick={(e) => { if (e.target === e.currentTarget) setShowNotificationsPanel(false); }}>
            <div className="filter-panel"> {/* Reusing filter-panel styles */}
              <div className="panel-header">
                <div className="panel-header-left">
                  <span>Notifications</span>
                </div>
                <button className="close-btn" onClick={() => setShowNotificationsPanel(false)}>×</button>
              </div>
              <div className="notifications-panel-content">
                {uploads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                    <p>No active uploads.</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto divide-y divide-[#404040]/40 flex-1">
                    {uploads.slice(0, 50).map(u => (
                      <div key={u.id}>
                        <div className="flex items-start justify-between gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-neutral-200 truncate leading-tight">{u.filename}</div>
                            <div className="flex items-center gap-2 text-[10px] mt-0.5 text-neutral-400">
                              <span className={`inline-flex items-center gap-0.5 ${statusColors[u.status] || 'text-neutral-500'}`}>
                                {statusIcons[u.status] || null}
                                {' '}{u.status}
                              </span>
                              {u.status === 'uploading' && (
                                <span className="text-neutral-400">{formatSize(u.uploaded)} / {formatSize(u.size)}</span>
                              )}
                              {u.status === 'failed' && u.error && (
                                <span className="text-red-400/70 truncate max-w-[80px]">{u.error}</span>
                              )}
                            </div>
                            {u.status === 'uploading' && (
                              <div className="w-full h-1 bg-[#1a1a1a] rounded mt-1 overflow-hidden">
                                <div
                                  className="h-full rounded"
                                  style={{
                                    width: `${Math.min(u.progress, 100)}%`,
                                    background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          {u.status === 'uploading' && (
                            <button onClick={() => cancelUpload(u.id)} className="p-1 rounded text-neutral-600 hover:text-red-400 flex-shrink-0">
                              <X size={10} />
                            </button>
                          )}
                          {(u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled') && (
                            <button onClick={() => deleteUploadFile(u.id)} className="p-1 rounded text-neutral-600 hover:text-red-400 flex-shrink-0" title="Delete file">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {uploads.length > 50 && (
                      <div className="text-center text-[10px] text-neutral-600 py-2">and {uploads.length - 50} more...</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mini Audio Player */}
        {view === 'playlists' && hasActivePlayback && <MiniPlayer view={view} onExpand={expandToAudio} sharedAudioRef={sharedAudioRef} sharedPrevFileIdRef={sharedPrevFileIdRef} audioReady={audioReady} onFavoriteToggle={handleToggleFavorite} onClose={() => {
          cancelAutoPlayPending();
          usePlaybackStore.getState().clearPlayback();
        }} />}

        {/* Filter Panel Modal */}
        <FilterPanel
          open={showFilterPanel}
          onClose={() => setShowFilterPanel(false)}
          title="Filters"
          filterTypeOptions={[
            { key: 'all', label: 'All' },
            { key: 'love', label: 'Love' },
            { key: 'video', label: 'Video' },
            { key: 'audio', label: 'Audio' },
            { key: 'image', label: 'Image' },
            { key: 'folder', label: 'Folders' },
            { key: 'upload', label: 'Uploaded' },
          ]}
          filterType={panelFilterType}
          onFilterTypeChange={setPanelFilterType}
          sortOptions={[
            { key: null, label: 'None' },
            { key: 'name', label: 'Name' },
            { key: 'mtime', label: 'Modified' },
            { key: 'created_at', label: 'Created' },
            { key: 'size', label: 'Size' },
          ]}
          sortBy={panelSortBy}
          sortOrder={panelSortOrder}
          onApply={async (newSortBy, newSortOrder) => {
            clearResponseCache();
            const path = state.currentPath || '/';
            useFolderSortStore.getState().setSort(path, panelFilterType);
            useFolderMetaSortStore.getState().setSort(path, newSortBy, newSortOrder);
            updateState(prev => ({
              ...prev,
              currentFilter: panelFilterType,
              currentSortBy: newSortBy,
              currentSortOrder: newSortOrder,
              loadedSortBy: newSortBy,
              loadedSortOrder: newSortOrder,
            }));
            const guard = ++refreshGuardRef.current;
            try {
              const data = await fetchFolder(
                state.currentPath, null, null, state.currentFolderId,
                newSortBy, newSortOrder
              );
              if (guard !== refreshGuardRef.current) return;
              updateState(prev => ({
                ...prev,
                items: data.items || [],
                folders: data.folders || prev.folders,
                hasMore: data.has_more || false,
                nextCursor: data.next_cursor || null,
                prevCursor: data.prev_cursor || null,
                pagesFetched: 0,
                loadedSortBy: newSortBy,
                loadedSortOrder: newSortOrder,
              }));
              loadedPageKeyRef.current = `${state.currentFolderId || 'root'}:${state.currentPath || ''}:${newSortBy || ''}:${newSortOrder}`;
            } catch {}
          }}
        />

        </div>
        </ErrorBoundary>
        );
        }export default App;
