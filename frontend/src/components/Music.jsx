import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, Minimize2, ListMusic, Heart, ChevronUp, ChevronDown, Ban, RotateCw, Trash2 } from 'lucide-react';
import MediaControls from './MediaControls';
import Carousel from './Carousel';
import QueuePanel from './QueuePanel';
import LyricsDisplay from './LyricsDisplay';
import MetadataEditor from './MetadataEditor';
import CachedVideoPlayer from './CachedVideoPlayer';
import NetworkImage from './NetworkImage';
import SpeakerOutputButton from './SpeakerOutputButton';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';
import { getCached, fetchBlob } from '../utils/thumbCache';
import { applySink, getStoredDevice } from '../utils/audioOutput';
import { cancelSendQueueItem, retrySendQueueItem, removeSendQueueItem } from '../utils/api';

export default function MusicPlayer({
  file,
  onChangeStatus,
  folderFiles = [],
  currentSortBy,
  currentSortOrder,
  onClose,
  onMinimize,
  onAudioChange,
  onFavoriteToggle,
  playlistQueue = null,
  currentTrackIndex = 0,
  onTrackIndexChange,
  sharedAudioRef,
  sharedPrevFileIdRef,
  audioReady,
  playlistTitle = null,
  trackSort = null,
  queueMode = false,
  queueItem = null,
  onQueueChanged = null,
}) {
  const {
    isPlaying,
    play,
    pause,
    next,
    previous,
    setCurrentTrackIndex,
    setPosition: setStorePosition,
    position: storedPosition,
    currentTrackIndex: storeCurrentTrackIndex,
  } = usePlaybackStore();

  const audioRef = sharedAudioRef || { current: null };
  const prevFileIdRef = sharedPrevFileIdRef || { current: null };
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);

  const [coverBlobUrl, setCoverBlobUrl] = useState(null);
  const [autoPlayPending, setAutoPlayPending] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [playerMode, setPlayerMode] = useState('cover');
  const [videoRemountKey, setVideoRemountKey] = useState(0);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [trackMetadata, setTrackMetadata] = useState(null);
  const [lyricsSynced, setLyricsSynced] = useState(null);
  const [youtubeId, setYoutubeId] = useState(null);
  const [videoSearchResults, setVideoSearchResults] = useState(null);
  const hasLyrics = !!(lyricsSynced || trackMetadata?.lyrics);
  const [coverVersion, setCoverVersion] = useState(0);
  const videoRef = useRef(null);
  const videoSeekRef = useRef(0);
  const [videoOffset, setVideoOffset] = useState(0);
  const syncedRef = useRef(false);
  // The videoOffset that the one-time sync last applied. Lets the sync re-run
  // when a late/changed offset arrives (fixes the frame-0 race).
  const syncedOffsetRef = useRef(null);
  const readyFiredRef = useRef(false);
  const storedPositionRef = useRef(storedPosition);
  storedPositionRef.current = storedPosition;

  const containerRef = useRef(null);
  const mediaAreaRef = useRef(null);
  const controlsRef = useRef(null);
  const titleRef = useRef(null);
  const [videoReady, setVideoReady] = useState(false);
  const [availSize, setAvailSize] = useState({ width: 0, height: 0 });
  // True once the <video> reports loadedmetadata — lets the one-time sync run
  // the offset seek before the first frame paints (so frame 0 is never shown).
  const [metadataReady, setMetadataReady] = useState(false);

   const isVideoMode = playerMode === "video" || playerMode === "video-split" || playerMode === "video-cover";
   const lastSeekTimeRef = useRef(0); // Cooldown for drift correction seeks
   // Watchdog sync state — kept in refs so an explicit re-anchor (user seek)
   // can reset it, preventing the rate controller from fighting the jump.
   const rateRef = useRef(1);
   const integralRef = useRef(0);
   const lastVideoSyncRef = useRef(0);

  // Volume gesture refs
  const touchStartYRef = useRef(0);
  const isGestureActiveRef = useRef(false);
  const [volumeGesture, setVolumeGesture] = useState({ deltaY: 0, showIndicator: false });
  const volumeIndicatorTimeoutRef = useRef(null);

  // Volume gesture handlers
  const handleTouchStart = useCallback((e) => {
    if (playerMode !== 'cover') return;
    touchStartYRef.current = e.touches[0].clientY;
    isGestureActiveRef.current = true;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
}, [playerMode]);

// ---- ResizeObserver: measure available media area for the cover stage.
// We measure the large media area (mediaAreaRef), not the cover's direct parent,
// so the cover can be sized to fill the area while the cover+title+controls are
// centered together as one unit (controls stay close to the cover). ----
useEffect(() => {
  const parent = mediaAreaRef.current;
  if (!parent) return;

  const computeSize = () => {
    const titleH = titleRef.current ? titleRef.current.offsetHeight : 0;
    const controlsH = controlsRef.current ? controlsRef.current.offsetHeight : 0;
    const width = Math.max(0, parent.clientWidth - 48);
    const height = Math.max(0, parent.clientHeight - titleH - controlsH - 220);
    setAvailSize({ width, height });
  };

  computeSize();

  const ro = new ResizeObserver(computeSize);
  ro.observe(parent);
  if (titleRef.current) ro.observe(titleRef.current);
  if (controlsRef.current) ro.observe(controlsRef.current);

  return () => { ro.disconnect(); };
}, []);

  const handleTouchMove = useCallback((e) => {
    if (!isGestureActiveRef.current || playerMode !== 'cover') return;
    const deltaY = touchStartYRef.current - e.touches[0].clientY;
    if (Math.abs(deltaY) > 5) {
      const audio = audioRef?.current;
      if (audio) {
        const volumeChange = deltaY * 0.5;
        const newVolume = Math.max(0, Math.min(100, audio.volume * 100 + volumeChange));
        audio.volume = newVolume / 100;
        setVolume(newVolume);
      }
      setVolumeGesture({ deltaY });
    }
    e.preventDefault();
  }, [playerMode, audioRef]);

  const handleTouchEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    setVolumeGesture({ deltaY: 0, showIndicator: true });
    if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    volumeIndicatorTimeoutRef.current = setTimeout(() => {
      setVolumeGesture(prev => ({ ...prev, showIndicator: false }));
    }, 800);
  }, []);

  const playlistFiles = useMemo(() => {
    if (!playlistQueue || !playlistQueue.length) return [];
    return playlistQueue.map((track, idx) => ({
      id: track.file_id || track.id || `playlist_track_${idx}`,
      name: track.display_name,
      display_name: track.display_name,
      type: track.type || 'audio',
      ext: track.ext || '.mp3',
      size: track.size || 0,
      mtime: track.mtime || 0,
      duration: track.duration || 0,
      has_thumb: 0,
      dir_path: '__playlist__',
      artist: track.artist,
      album: track.album,
      _playlistPath: track.path,
      _exists: track.exists,
      file_id: track.file_id,
      is_favorite: track.is_favorite || 0,
      youtube_id: track.youtube_id || null,
      video_offset: track.video_offset || 0,
    }));
  }, [playlistQueue]);

  const hasPlaylist = playlistFiles.length > 0;
  const carouselFiles = hasPlaylist ? playlistFiles : folderFiles;
  const activeFile = hasPlaylist
    ? (playlistFiles[storeCurrentTrackIndex] || playlistFiles[0])
    : file;

  // Context caption for the carousel so the user always knows WHICH order the
  // strip follows. The playlist carousel follows the queue order, which is now
  // the user's chosen track sort (the queue is built sorted in PlaylistView and,
  // on re-open, the backend /play endpoint re-sorts using the persisted
  // trackSort). This label tells the user exactly which order that is, so the
  // carousel never looks like it lost the sort.
  const sortLabel = useMemo(() => {
    const map = {
      created_at: 'date added',
      name: 'name',
      title: 'title',
      artist: 'artist',
      album: 'album',
      track_num: 'track #',
      track_index: 'added',
      mtime: 'modified',
      size: 'size',
      duration: 'duration',
    };
    const by = (trackSort?.by || currentSortBy || 'created_at');
    const order = trackSort?.order || currentSortOrder || 'asc';
    const label = map[by] || by;
    return `${label} ${order === 'desc' ? '↓' : '↑'}`;
  }, [trackSort, currentSortBy, currentSortOrder]);

  const carouselContextLabel = useMemo(() => {
    if (hasPlaylist) {
      const name = playlistTitle || 'Playlist';
      const by = trackSort?.by || currentSortBy;
      if (!by) return `Playlist: ${name}`;
      return `Playlist: ${name} · sorted by ${sortLabel}`;
    }
    return `In folder order · ${sortLabel}`;
  }, [hasPlaylist, playlistTitle, sortLabel, trackSort, currentSortBy]);

  const handleVideoSearch = useCallback(async () => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      const res = await fetch(`/api/video-cache/auto-detect/${fileId}`);
      const data = await res.json();
      setVideoSearchResults(data.results || []);
    } catch {
      setVideoSearchResults([]);
    }
  }, [activeFile?.file_id, activeFile?.id]);

  const handleVideoPick = useCallback(async (videoId) => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;
    try {
      await fetch(`/api/video-cache/save-id/${fileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeId: videoId }),
      });
      setYoutubeId(videoId);
      setVideoSearchResults(null);
    } catch {}
  }, [activeFile?.file_id, activeFile?.id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
    };
  }, []);

  // Stable cacheBust for Carousel - only changes when file ID changes
  const stableCacheBust = useMemo(() => String(coverVersion), [activeFile?.id, coverVersion]);

  // Warm the browser HTTP cache for the ±2 neighbor cover thumbnails so that the
  // cover swap on skip is instant. Uses the exact displayed URL (same coverVersion
  // cache-buster) so the request the <img> makes hits cache. `queue` is read from
  // getState() (it is not a reactive value in this component).
  useEffect(() => {
    const { queue } = usePlaybackStore.getState();
    if (!queue || queue.length === 0) return;
    const n = queue.length;
    const idx = storeCurrentTrackIndex ?? 0;
    const cv = coverVersion;
    [-2, -1, 1, 2].forEach((off) => {
      const f = queue[(idx + off + n) % n];
      const fid = f?.id || f?.file_id;
      if (fid) {
        const img = new Image();
        img.decoding = 'async';
        img.src = `/thumbnails/${fid}.jpg?v=${cv}`;
      }
    });
  }, [storeCurrentTrackIndex, coverVersion]);

  // Sync playlist queue to store — only when the queue CONTENT actually changes.
  // The click path (onPlayTrack) already sets the queue + index authoritatively
  // (store currentTrackIndex is set synchronously BEFORE the player mounts), so
  // PRESERVE the store's currentTrackIndex here instead of overwriting it with the
  // React prop. Overwriting with a stale prop index was the cause of the player
  // showing the PREVIOUS track after navigating back and re-selecting.
  const prevQueueSigRef = useRef(null);
  useEffect(() => {
    if (!hasPlaylist) return;
    const sig = playlistFiles.map(f => f.id).join('|');
    if (sig === prevQueueSigRef.current) return;
    prevQueueSigRef.current = sig;
    const st = usePlaybackStore.getState();
    st.setQueue(playlistFiles, st.currentTrackIndex);
  }, [hasPlaylist, playlistFiles]);

  // Load file when changed — shared audio, skip reload if same track
  useEffect(() => {
    if (!audioReady) return;
    const audio = audioRef?.current;
    if (!audio) return;

    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) return;

    const isSameTrack = prevFileIdRef.current === fileId;
    prevFileIdRef.current = fileId;

    if (isSameTrack) {
      setIsLoading(false);
      // Sync store isPlaying → audio element (guard against redundant calls)
      if (isPlaying && audio.paused) {
        audio.play().catch(() => {});
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
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

    // New track — load and play. Re-apply the chosen output device NOW (during
    // buffering, before any sound) so setSinkId resolves before 'playing' and
    // there is no audible blip to the default device.
    audio.currentTime = 0;
    audio.src = `/file/${fileId}`;
    audio.load();
    applySink(audio, getStoredDevice());

    const tryPlay = () => {
      audio.play().then(() => {
        setIsLoading(false);
      }).catch((err) => {
        setIsLoading(false);
        if (err?.name === 'NotAllowedError') {
          setAutoPlayPending(true);
        }
      });
    };

    if (audio.readyState >= 3) {
      tryPlay();
    } else {
      audio.addEventListener('canplay', tryPlay, { once: true });
    }

    const onPlay = () => play();
    const onPause = () => pause();
    const onError = () => {
      setIsLoading(false);
      setError('Format tidak didukung browser');
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('canplay', tryPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [activeFile?.id, activeFile?.file_id, audioReady, audioRef, play, pause]);

  // Audio timeupdate → PlaybackStore (source of truth)
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    const sync = () => setStorePosition(audio.currentTime);
    audio.addEventListener('timeupdate', sync);
    return () => audio.removeEventListener('timeupdate', sync);
  }, [audioRef, setStorePosition]);

  // Fetch metadata + lyrics when track changes
  useEffect(() => {
    const fileId = activeFile?.file_id || activeFile?.id;
    if (!fileId) {
      setTrackMetadata(null);
      setLyricsSynced(null);
      setVideoOffset(0);
      setYoutubeId(null);
      return;
    }
    // Clear content immediately so stale lyrics/cover don't flash on the new
    // track. NOTE: we intentionally do NOT reset playerMode here — keeping the
    // current mode (e.g. video) lets the MV follow when skipping next/prev.
    setTrackMetadata(null);
    setLyricsSynced(null);
    setVideoSearchResults(null);
    // Set the video identity SYNCHRONOUSLY from the queue entry so the player can
    // switch video<->cover on the same tick as the skip — no waiting on the
    // /api/metadata round-trip. This unmounts the previous <video> instantly
    // (killing the "stuck old frame") and lets the cover-fallback effect fire
    // immediately when the new track has no video. The fetch below reconciles in
    // case the DB has a newer youtube_id/offset than the cached queue value.
    setYoutubeId(activeFile?.youtube_id || null);
    setVideoOffset(Number(activeFile?.video_offset) || 0);
    let cancelled = false;
    fetch(`/api/metadata/${fileId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        setTrackMetadata(data);
        setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
        setYoutubeId(data.youtube_id || null);
        setVideoOffset(Number(data.video_offset) || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFile?.file_id, activeFile?.id, storeCurrentTrackIndex]);

  // When skipping tracks while in a video mode, fall back to cover if the new
  // track's video is NOT actually cached on disk (a YouTube ID may exist but the
  // file was never downloaded). Only stay in video mode when the cached file
  // exists. A manual switch into video mode for the current track is NOT
  // overridden (prevYoutubeIdRef guard) — the user still sees the download
  // spinner rather than being bounced to cover.
  const prevYoutubeIdRef = useRef(null);
  useEffect(() => {
    const prev = prevYoutubeIdRef.current;
    prevYoutubeIdRef.current = youtubeId;
    if (prev === youtubeId) return;            // only act on TRACK change, not manual mode switch
    const videoMode =
      playerMode === 'video' || playerMode === 'video-split' || playerMode === 'video-cover';
    if (!videoMode) return;
    if (!youtubeId) { setPlayerMode('cover'); return; }   // no video at all
    let cancelled = false;
    fetch(`/api/video-cache/progress/${youtubeId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        // 'cached' here means the file exists on disk (see backend note).
        if (data?.status !== 'cached') setPlayerMode('cover');
        // if cached -> leave in current video mode (MV follows the skip)
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [youtubeId, playerMode, setPlayerMode]);

  // Retry autoplay after user gesture
  useEffect(() => {
    if (autoPlayPending && userInteracted && audioRef?.current) {
      audioRef.current.play().catch(() => {});
      setAutoPlayPending(false);
    }
  }, [autoPlayPending, userInteracted, audioRef]);

// Drift correction: keep the video synced to the live audio position, but
// THROTTLED (~1s interval, not a per-frame requestAnimationFrame loop).
// The old per-frame loop re-called forceSeek()/playVideo()/pauseVideo() up to
// 60x/sec, which made playback feel heavy. Now the <video> just plays
// on its own; we only (a) pause/resume it from the audio's own
// 'waiting'/'playing' events, and (b) re-seek only on LARGE drift (>2s).
const videoOffsetRef = useRef(videoOffset);
videoOffsetRef.current = videoOffset;

// Tracks whether the <video> is currently stalled/buffering so we know a
// resume must be re-anchored. Set by native <video> event callbacks below.
const videoStalledRef = useRef(false);
// Timestamp (ms) of when the current stall began; used as a safety net to clear
// a stale stall flag if `playing` never fires (genuinely broken stream).
const stalledSinceRef = useRef(0);
// Tracks whether the AUDIO element itself is buffering (audio `waiting`). The
// store's `isPlaying` stays true during audio buffering, so the watchdog must
// use this flag to avoid replaying/seeking the video ahead while audio stalls.
const audioStalledRef = useRef(false);
// True while a video seek is in flight. Prevents the drift watchdog from
// re-issuing forceSeek (or rate-fighting) on top of an unfinished seek, which
// would make the <video> flash between the old and new frame (flicker).
const videoSeekPendingRef = useRef(false);
// The target of the in-flight seek (set by anchorVideoToAudio). Used to make
// anchorVideoToAudio idempotent: a redundant re-anchor to the SAME target while
// a seek is still landing must NOT re-issue playVideo() — that was the cause of
// a single timeline jump replaying the same frame ~3x (handleSeekSync + audio
// `seeked` + audio `timeupdate` jump-detector each re-anchored and played).
const lastAnchorTargetRef = useRef(null);
// Timestamp (ms) of the last issued re-anchor. Combined with lastAnchorTargetRef
// this lets anchorVideoToAudio dedupe a burst of re-anchors to the SAME target
// (e.g. handleSeekSync + audio `seeked` + audio `timeupdate` jump-detector all
// firing for one timeline jump) even when the underlying seek completes so fast
// that videoSeekPendingRef has already been cleared by the time the later events
// arrive. That dedup is what stops the video replaying the same frame several
// times on a single jump.
const lastAnchorTimeRef = useRef(0);
// While a seek has JUST settled, the video is normally a bit behind the still
// advancing audio (seek latency). The rate-based watchdog absorbs this smoothly;
// a hard re-seek on it replays the slice. rafGraceUntilRef marks a short window
// after each settle during which the rAF sampler must NOT hard re-seek.
const rafGraceUntilRef = useRef(0);
// Armed when we issue an offset seek whose settle (`seeked`) should START video
// playback. This is how "prepare-then-play" keeps frame 0 from ever painting:
// we seek to the offset first, and only call playVideo() once it lands.
const pendingPlayRef = useRef(false);
// True while the user is dragging the progress bar. While scrubbing we pause the
// video and soft-seek it frame-by-frame; the watchdog + jump-detector are gated
// off so the audio (the only master clock) and the paused video never run as two
// parallel timelines, and a stale watchdog re-anchor can't yank the video.
const scrubbingRef = useRef(false);

// Single source of truth for where the video SHOULD be for the live audio clock.
const getVideoTarget = () => {
  const audioEl = audioRef?.current;
  const base = audioEl ? audioEl.currentTime : storedPositionRef.current;
  return base + (videoOffsetRef.current || 0);
};

// TEMP DIAGNOSTIC: unified audio+video timeline.
const dbg = (tag) => {
  try {
    const a = audioRef?.current;
    const v = videoRef.current;
    const at = a ? a.currentTime.toFixed(2) : '-';
    const vt = v?.getCurrentTime ? v.getCurrentTime().toFixed(2) : '-';
    const pl = usePlaybackStore.getState().isPlaying;
    console.log(`[OFS ${(performance.now()/1000).toFixed(2)}] ${tag} audio=${at} video=${vt} off=${videoOffsetRef.current||0} play=${pl} seekPend=${videoSeekPendingRef.current} pendPlay=${pendingPlayRef.current}`);
  } catch {}
};

// SINGLE source of truth for re-anchoring the <video> to the live audio clock.
// Every discontinuity (start, seek, scrub-end, loop, offset-change, tab-refocus,
// video-ended wrap) routes through this so the video never runs as a second,
// independent timeline. It snaps the video to `audio + offset` (or an explicit
// `target`) and always defers playback to the seek settle (handleVideoResumed)
// via `pendingPlayRef` — that guarantee is what keeps frame 0 from ever painting
// on offset tracks. When the video is already at the target (no-op seek) it plays
// immediately. Watchdog smoothing state is reset so the rate controller can't
// fight the jump. `play = true` means "resume playback once it lands".
const anchorVideoToAudio = useCallback(({ play = false, target } = {}) => {
  const player = videoRef.current;
  if (!player?.forceSeek) return;            // no video mounted
  const { isPlaying: playing } = usePlaybackStore.getState();
  const t = (target != null) ? target : getVideoTarget();
  // Dedupe a burst of re-anchors to the SAME target within a short window. A
  // single timeline jump fires anchorVideoToAudio from several places at once
  // (handleSeekSync, audio `seeked`, audio `timeupdate` jump-detector, the rAF
  // sampler). Each redundant re-anchor would clear videoSeekPendingRef and fire
  // playVideo() early, replaying the same frame several times. We must NOT key
  // this purely on videoSeekPendingRef — for a fast (cached) seek the `seeked`
  // event can clear that flag before the later events arrive. So dedup on
  // (target, recent-timestamp) instead and just preserve the play intent.
  if (lastAnchorTargetRef.current != null &&
      Math.abs(lastAnchorTargetRef.current - t) < 0.25 &&
      Date.now() - lastAnchorTimeRef.current < 400) {
    if (play) pendingPlayRef.current = true;
    dbg(`anchor SKIP (dedup) t=${t.toFixed(2)} play=${play}`);
    return;
  }
  player.setRate?.(1);
  videoSeekPendingRef.current = true;
  lastAnchorTargetRef.current = t;
  lastAnchorTimeRef.current = Date.now();
  const didSeek = player.forceSeek(t);
  dbg(`anchor t=${t.toFixed(2)} didSeek=${didSeek} play=${play}`);
  if (didSeek) {
    // Play (if requested) is deferred to `seeked` so the first painted frame is
    // the offset frame. handleVideoResumed only actually plays when audio is
    // playing, so a paused anchor stays paused.
    pendingPlayRef.current = true;
  } else {
    videoSeekPendingRef.current = false;
    if (play && playing) player.playVideo?.();
  }
  // Reset watchdog smoothing so it doesn't rate-fight this jump.
  rateRef.current = 1;
  integralRef.current = 0;
  lastVideoSyncRef.current = 0;
  lastSeekTimeRef.current = Date.now();
}, [audioRef]);

// Native <video> events — these fire for VIDEO-side stalls that the audio
// element never reports (the root cause of the intermittent desync).
// CRITICAL: never seek/pause/play the video WHILE it is buffering — that is
// what caused the patah-patah (stutter) regression. During waiting/stalled we
// ONLY flag the stall; the single clean re-anchor happens once, when the stall
// ends (handleVideoResumed on `playing`/`seeked`).
const handleVideoWaiting = useCallback(() => {
  videoStalledRef.current = true;
  stalledSinceRef.current = Date.now();
}, []);

const handleVideoStalled = useCallback(() => {
  videoStalledRef.current = true;
  stalledSinceRef.current = Date.now();
}, []);

const handleVideoResumed = useCallback(() => {
  // A video `seeked`/`playing` means any in-flight seek has settled — let the
  // drift watchdog resume (and stop it from re-seeking on top of this one).
  videoSeekPendingRef.current = false;
  // Open a short grace window: the video is normally a bit behind the still
  // advancing audio right after a seek lands. The rate watchdog absorbs that
  // residual smoothly; tell the rAF sampler not to hard re-seek it (which would
  // replay the slice — the leftover "frame repeats 1x" on a jump).
  rafGraceUntilRef.current = Date.now() + 1500;
  dbg('videoResumed(seeked/playing)');
  // Prepare-then-play: the offset seek has landed → START playback now so the
  // first painted frame is the offset frame, not frame 0.
  if (pendingPlayRef.current) {
    pendingPlayRef.current = false;
    const player = videoRef.current;
    player?.setRate?.(1);
    if (usePlaybackStore.getState().isPlaying) player?.playVideo?.();
  }
  if (videoStalledRef.current) {
    videoStalledRef.current = false;
    stalledSinceRef.current = 0;
    // Resume the video WITHOUT seeking. Seeking a video that just recovered from
    // a stall makes it re-buffer, which fires `waiting` again → another `playing`
    // → another seek: a death-spiral that looks like severe stutter. Drift after
    // a stall is corrected smoothly by the rate-based watchdog instead.
    const player = videoRef.current;
    player?.setRate?.(1);
    player?.playVideo?.();
  }
}, []);

// The MV ended (shorter than the song, or reached its own end). Wrap it
// seamlessly to the live audio position (mod MV duration) and keep playing —
// never show a black frame at the end of the clip.
const handleVideoEnded = useCallback(() => {
  const player = videoRef.current;
  if (!player?.forceSeek) return;
  const { isPlaying: playing } = usePlaybackStore.getState();
  if (!playing) return;
  const audioEl = audioRef?.current;
  if (!audioEl) return;
  const mvDur = player.getDuration?.() || 0;
  const target = mvDur > 0
    ? ((audioEl.currentTime + (videoOffsetRef.current || 0)) % mvDur)
    : (videoOffsetRef.current || 0);
  // Wrap seamlessly to the live audio position (mod MV duration) and keep
  // playing — never show a black frame at the end of the clip.
  anchorVideoToAudio({ play: true, target });
}, [audioRef, anchorVideoToAudio]);

// Genuine <video> error (e.g. stream hiccup). Self-heal by silently remounting
// the element — no overlay/text, no permanent black screen.
  const handleVideoError = useCallback(() => {
    videoRef.current?.reload?.();
  }, []);

  // If the network drops (wifi off) the YouTube MV frame goes blank and won't
  // recover on its own. Remount the player when the connection returns so it
  // re-fetches the iframe.
  useEffect(() => {
    const onOnline = () => setVideoRemountKey((k) => k + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);


useEffect(() => {
    const onWaiting = () => {
    // The SONG audio is buffering (or seeking at a loop). Do NOT pause the MV
    // here — pausing the <video> paints a black frame. Keep the video playing
    // its own buffer; the rate-based watchdog re-aligns it when audio resumes.
    audioStalledRef.current = true;
    dbg('AUDIO waiting');
    // Reset rate so resume starts clean (no leftover speed nudge).
    videoRef.current?.setRate?.(1);
  };
  const onResume = () => {
    audioStalledRef.current = false;
    dbg('AUDIO playing(resume)');
    // Resume the video alongside the audio. Do NOT forceSeek here — seeking on
    // resume can re-buffer the video and stutter. The rate-based watchdog keeps
    // drift in check smoothly.
    const player = videoRef.current;
    if (!player?.forceSeek) return;            // no video mounted
    if (usePlaybackStore.getState().isPlaying) {
      player.setRate?.(1);   // back to normal speed after any pause/seek
      // CRITICAL: never start playback from frame 0 at a fresh start. The
      // one-time sync (anchorVideoToAudio) seeks to the offset FIRST and defers
      // play to `seeked` via pendingPlayRef. If the video is still at ~0 (not
      // yet anchored) we must NOT playVideo here — that would run the MV from
      // the beginning for the first seconds before the anchor yanks it to the
      // offset. Only resume an ALREADY-anchored video (positioned past 0.05).
      if ((player.getCurrentTime?.() ?? 0) > 0.05) player.playVideo?.();
    }
  };

  const onPause = () => {
    // Keep the video locked to the audio: pausing the song must also pause
    // the video. Otherwise it keeps playing and drifts; on resume `onResume`
    // would then hard-forceSeek (a visible hitch) — that is what made play/pause
    // feel delayed / not instant.
    videoRef.current?.pauseVideo?.();
  };

  const audio = audioRef?.current;
  if (audio) {
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onResume);
    audio.addEventListener('pause', onPause);
  }

  // Background-tab throttling can let the video drift far from audio; re-anchor
  // the instant the tab becomes visible again.
  const onVisibility = () => {
    if (!document.hidden && usePlaybackStore.getState().isPlaying) {
      anchorVideoToAudio({ play: true });
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Continuous, HITCH-FREE sync: keep the video locked to the audio clock using
  // ONLY playbackRate (no seeking during playback — seeks on a streaming video
  // cause re-buffering and stutter). Speed-up is fps-safe & inaudible (muted);
  // slowdown is tightly capped so 24/30fps sources never look laggy.
  const KP = 0.35;             // proportional gain
  const KI = 0.05;             // integral gain (steady offset)
  const RATE_BEHIND_MAX = 0.30;// up to +30% to catch up after a stall (muted)
  const RATE_AHEAD_MAX = 0.03; // cap slowdown at -3% (fps-safe on 24/30fps)
  const TOL = 0.02;            // within this, lock rate to exactly 1
  const STALL_TIMEOUT = 3000;  // ms a stall may persist before we clear the flag
  const HARD_SEEK = 3.0;       // drift (s) above which we snap the video
  const SEEK_COOLDOWN = 1500;  // ms to settle after a hard seek (no rate fight)
  const JUMP_SEEK = 5.0;       // drift (s) treated as a position JUMP → re-anchor now (ignore cooldown)

  const sync = () => {
    // While the user is scrubbing we pause the video and soft-seek it; the audio
    // is the only clock in motion. Don't let the watchdog re-anchor/yank it.
    if (scrubbingRef.current) return;
    const player = videoRef.current;
    if (!player?.forceSeek) return;            // no video mounted
    const { isPlaying: playing } = usePlaybackStore.getState();
    if (!playing) return;
    const audioEl = audioRef?.current;
    if (!audioEl) return;

    // While the AUDIO is buffering, `isPlaying` stays true but the audio clock
    // is frozen — don't touch the video (it would drift / get yanked later).
    if (audioStalledRef.current) return;

    // While the VIDEO is buffering, NEVER seek/adjust it (that caused stutter).
    // Safety net: if a stall lasts too long (stream broken), clear the flag.
    if (videoStalledRef.current) {
      if (stalledSinceRef.current && Date.now() - stalledSinceRef.current > STALL_TIMEOUT) {
        videoStalledRef.current = false;
        stalledSinceRef.current = 0;
      } else {
        return;
      }
    }

    // While a video seek is in flight, don't re-anchor or fight the rate — that
    // would pile a new seek on top of the unfinished one and make the <video>
    // flash between the old and new frame (flicker). Resume once it settles.
    if (videoSeekPendingRef.current) return;

    const now = Date.now();

    // Hard re-anchor on LARGE drift (after a user seek / big desync). Driven by
    // the audio clock + cooldown, so it can't spiral. Resets smoothing state.
    const audioPos = audioEl.currentTime + (videoOffsetRef.current || 0);
    const videoTime = player.getCurrentTime?.() ?? 0;
    const drift = audioPos - videoTime;        // + => video behind audio
    const adrift = Math.abs(drift);

    if (adrift > HARD_SEEK && now - lastSeekTimeRef.current > SEEK_COOLDOWN) {
      dbg(`watchdog HARD-SEEK drift=${drift.toFixed(2)}`);
      anchorVideoToAudio({ play: true });
      return;
    }
    // JUMP re-anchor: a very large drift means the audio POSITION jumped (user
    // seek / loop / replay), not gradual drift. Re-anchor immediately, IGNORING
    // SEEK_COOLDOWN — the cooldown only exists to stop rate-fighting on small
    // drift, and honoring it here left the video on the OLD position for up to
    // ~1.5s after a scrub. Backstop for the timeupdate jump detector above.
    if (adrift > JUMP_SEEK) {
      dbg(`watchdog JUMP-SEEK drift=${drift.toFixed(2)}`);
      anchorVideoToAudio({ play: true });
      return;
    }
    // Settle after a hard seek: hold rate at 1, don't fight the jump.
    if (now - lastSeekTimeRef.current < SEEK_COOLDOWN) {
      player.setRate?.(1);
      return;
    }

    const elapsed = now - lastVideoSyncRef.current;
    if (elapsed < 250) return;                 // measure ~4x/sec
    const dt = lastVideoSyncRef.current === 0 ? 0.25 : elapsed / 1000;
    lastVideoSyncRef.current = now;

    integralRef.current += drift * dt;
    integralRef.current = Math.max(-2, Math.min(2, integralRef.current));   // anti-windup

    // Within tolerance: lock rate to exactly 1 (no leftover speed bias).
    if (adrift < TOL) {
      rateRef.current += (1 - rateRef.current) * 0.3;
      if (Math.abs(rateRef.current - 1) < 0.004) rateRef.current = 1;
      player.setRate?.(rateRef.current);
      return;
    }

    // Target rate: speed up to catch (fps-safe), slow down capped so low-fps
    // sources never look laggy. Asymmetric & fps-safe.
    const raw = KP * drift + KI * integralRef.current;
    const target = drift >= 0
      ? 1 + Math.max(0, Math.min(RATE_BEHIND_MAX, raw))
      : 1 + Math.max(-RATE_AHEAD_MAX, Math.min(0, raw));

    // Low-pass the rate so it never jitters frame-to-frame (smooth, no stutter).
    rateRef.current += (target - rateRef.current) * 0.3;
    if (Math.abs(rateRef.current - 1) < 0.004) rateRef.current = 1;
    player.setRate?.(rateRef.current);
  };

  const id = setInterval(sync, 250);

  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisibility);
    if (audio) {
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onResume);
      audio.removeEventListener('pause', onPause);
    }
  };
  }, [audioRef]);

// Fix E: per-frame drift sampler. The 250ms watchdog above keeps small drift in
// check via playbackRate (smooth, no replay). This rAF loop samples EVERY frame
// and re-anchors (hard seek) ONLY when drift exceeds a LARGE threshold (~1s),
// i.e. genuine desync such as after a stall/refocus. It must NOT hard-seek on
// small drift: right after a jump-seek the video settles ~seekDuration behind the
// still-advancing audio, and a hard re-seek on that small gap REPLAYS the slice
// (the "frame plays Nx on a jump" bug). Small drift is left to the rate watchdog.
// It never fights an in-flight seek, a scrub, or a stalled audio/video, and a
// ~200ms minimum interval cap prevents thrash on a weak GPU. Mounted on video mode.
useEffect(() => {
   if (!isVideoMode) return;
  let raf = 0;
  let lastSeek = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const player = videoRef.current;
    if (!player?.forceSeek) return;                 // no video mounted
    // Never yank the video while it is mid-seek, scrubbing, or stalled — that is
    // what causes the flicker / double-frame.
    if (videoSeekPendingRef.current) return;
    if (scrubbingRef.current) return;
    if (audioStalledRef.current || videoStalledRef.current) return;
    const { isPlaying: playing } = usePlaybackStore.getState();
    if (!playing) return;
    const audioEl = audioRef?.current;
    if (!audioEl) return;
    const target = audioEl.currentTime + (videoOffsetRef.current || 0);
    const vtime = player.getCurrentTime?.() ?? 0;
    // Just after a seek settled the video is normally a bit behind the still
    // advancing audio (seek latency). Re-seeking on that small residual replays
    // the slice, so defer hard re-seeks to the rate watchdog during the grace
    // window opened in handleVideoResumed.
    if (Date.now() < rafGraceUntilRef.current) return;
    if (Math.abs(vtime - target) > 1.0) {
      const now = Date.now();
      if (now - lastSeek < 200) return;             // min-interval cap
      lastSeek = now;
      dbg(`rAF re-anchor drift=${(vtime - target).toFixed(2)}`);
      anchorVideoToAudio({ play: true });
    }
  };
  raf = requestAnimationFrame(tick);
  return () => { if (raf) cancelAnimationFrame(raf); };
}, [isVideoMode, audioRef, anchorVideoToAudio]);

// Re-anchor the video whenever the AUDIO seeks (skip ±5s, progress-bar drag,
// loop restart). The drift watchdog only corrects via playbackRate during
// normal playback (to avoid stutter), so an explicit seek would otherwise
// leave the MV slowly drifting back instead of jumping with the audio.
useEffect(() => {
  const audio = audioRef?.current;
  if (!audio) return;
  let lastPos = audio.currentTime;
  const onTimeUpdate = () => {
    const now = audio.currentTime;
    // While scrubbing, MediaControls sets audio.currentTime directly; don't
    // treat that as a jump (the scrub-end re-anchor handles it cleanly).
    if (scrubbingRef.current) { lastPos = now; return; }
    // Detect an explicit audio position JUMP (progress-bar scrub release via
    // programmatic seek, loop restart, replay) and re-anchor the video
    // IMMEDIATELY. `timeupdate` fires reliably (~4x/s) on the audio element,
    // unlike the `seeked` event in this setup, and this path does NOT wait for
    // the drift watchdog's SEEK_COOLDOWN — that cooldown was making the video
    // show the OLD position for ~1.5s after a seek.
    if (!videoSeekPendingRef.current && Math.abs(now - lastPos) > 0.75) {
      dbg(`AUDIO jump ${lastPos.toFixed(2)}->${now.toFixed(2)}`);
      anchorVideoToAudio({ play: true });
      syncedRef.current = false;
    }
    lastPos = now;
  };
    const onSeeked = () => {
      const now = audio.currentTime;
      dbg('AUDIO seeked');
      // Instant re-anchor on an explicit seek. anchorVideoToAudio resets the
      // watchdog's smoothing state and defers playback until the seek settles,
      // so the pre-seek frame is never shown.
      anchorVideoToAudio({ play: true });
      syncedRef.current = false;
      lastPos = now;
    };
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('seeked', onSeeked);
  return () => {
    audio.removeEventListener('timeupdate', onTimeUpdate);
    audio.removeEventListener('seeked', onSeeked);
  };
}, [audioRef]);

// Resume video playback when switching into video mode
useEffect(() => {
  if (isVideoMode && isPlaying) {
    const player = videoRef.current;
    // Only resume an ALREADY-anchored video. At a fresh start the video is still
    // at ~0; the one-time sync (anchorVideoToAudio) seeks to the offset and
    // defers play to `seeked` via pendingPlayRef. Playing here unconditionally
    // would run the MV from frame 0 for the first seconds before the anchor
    // yanks it to the offset — the exact "first 3s broken" start symptom.
    if (player && (player.getCurrentTime?.() ?? 0) > 0.05) {
      player.playVideo();
    }
  }
}, [isVideoMode]);

// One-time sync: position the video at the offset target as soon as it becomes
// ready. This runs again if `videoOffset` arrives/changes AFTER the first pass
// (see syncedOffsetRef) — that late offset was the race that made the video play
// frame 0 (offset still 0 on first run → seek skipped → syncedRef locked true).
// When audio is playing we prepare-then-play (seek, then play on `seeked`) so the
// first painted frame is the offset frame; when paused we just position the frame.
useEffect(() => {
  if (!(videoReady || metadataReady)) return;
  if (syncedRef.current && syncedOffsetRef.current === videoOffset) return;
  dbg(`one-time sync (ready=${videoReady}/${metadataReady})`);
  // Same single re-anchor path as every other discontinuity. When playing we
  // prepare-then-play (seek, then play on `seeked`) so the first painted frame
  // is the offset frame; when paused we just position the frame.
  if (usePlaybackStore.getState().isPlaying) {
    anchorVideoToAudio({ play: true });
  } else {
    const target = getVideoTarget();
    const videoTime = videoRef.current?.getCurrentTime?.() ?? 0;
    if (Math.abs(target - videoTime) >= 0.1) anchorVideoToAudio({ play: false, target });
  }
  syncedRef.current = true;
  syncedOffsetRef.current = videoOffset;
}, [videoReady, metadataReady, videoOffset, isVideoMode, anchorVideoToAudio]);

// Reset the one-time sync when the track/video changes so a new clip syncs again.
useEffect(() => {
  syncedRef.current = false;
  syncedOffsetRef.current = null;
  pendingPlayRef.current = false;
  readyFiredRef.current = false;
  lastAnchorTargetRef.current = null;
  lastAnchorTimeRef.current = 0;
  setVideoReady(false);
  setMetadataReady(false);
}, [youtubeId]);

  // Favorite toggle — single source of truth via the global favorites store,
  // so the mini player / carousel / queue list stay in sync.
  const [favLoading, setFavLoading] = useState(false);
  const isFav = useIsFavorite(activeFile?.file_id || activeFile?.id, activeFile?.is_favorite ? 1 : 0);
  const handleToggleFavorite = useCallback(async () => {
    if (!activeFile?.id || favLoading) return;
    setFavLoading(true);
    try {
      await onFavoriteToggle(activeFile);
    } catch {}
    setFavLoading(false);
  }, [activeFile, favLoading, onFavoriteToggle]);

  const displayName = activeFile
    ? activeFile.display_name || activeFile.name
    : 'Memutar Audio...';

  const displayTitle = displayName;

  const handleQueueCancel = useCallback(() => {
    if (queueItem?.qid) cancelSendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleQueueRetry = useCallback(() => {
    if (queueItem?.qid) retrySendQueueItem(queueItem.qid).then(() => onQueueChanged && onQueueChanged());
  }, [queueItem?.qid, onQueueChanged]);

  const handleQueueRemove = useCallback(() => {
    if (queueItem?.qid) {
      removeSendQueueItem(queueItem.qid).then(() => { if (onQueueChanged) onQueueChanged(); if (onClose) onClose(); });
    }
  }, [queueItem?.qid, onQueueChanged, onClose]);

  const headerNode = useMemo(() => (
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
      {queueMode ? (
        <>
          {queueItem?.status === 'pending' && (
            <button onClick={handleQueueCancel} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-red-400" title="Batalkan pengiriman">
              <Ban size={20} />
            </button>
          )}
          {queueItem?.status === 'failed' && (
            <button onClick={handleQueueRetry} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-emerald-400" title="Ulangi pengiriman">
              <RotateCw size={20} />
            </button>
          )}
          <button onClick={handleQueueRemove} className="p-2 rounded-full transition-colors text-white/70 hover:bg-white/20 hover:text-red-400" title="Hapus dari riwayat">
            <Trash2 size={20} />
          </button>
        </>
      ) : (
      <button
        onClick={handleToggleFavorite}
        disabled={favLoading}
        className={`p-2 rounded-full transition-colors ${isFav ? 'text-red-500 hover:bg-white/20' : 'text-white/70 hover:bg-white/20 hover:text-white'}`}
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart size={20} className={isFav ? 'fill-red-500' : ''} />
      </button>
      )}
      {hasPlaylist && (
        <button
          onClick={() => setShowQueuePanel(p => !p)}
          className={`p-2 rounded-full transition-colors ${showQueuePanel ? 'bg-white/20 text-white' : 'hover:bg-white/20 text-white/60'}`}
          title="Queue"
        >
          <ListMusic className="w-5 h-5" />
        </button>
      )}
      <SpeakerOutputButton audioRef={audioRef} />
      {onMinimize && (
        <button
          onClick={onMinimize}
          className="p-2 rounded-full hover:bg-white/20 transition-colors"
          title="Mini player"
        >
          <Minimize2 className="w-5 h-5 text-white" />
        </button>
      )}
      </div>
    </>
  ), [onClose, onMinimize, hasPlaylist, showQueuePanel, isFav, favLoading, handleToggleFavorite]);
        const handleClick = useCallback((e) => {
          if (e.button !== 0 && e.button !== 1) return;   // left / middle only
          e.preventDefault();

          if (!youtubeId) {
            // No video: simple cover <-> lyrics toggle.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
            return;
          }

          if (isVideoMode) {
            // Left-click anywhere in video mode returns to the main cover view
            // (video disappears). The side panel is driven by RIGHT-click.
            setPlayerMode('cover');
          } else {
            // Cover / lyrics mode (a track with a video): left-click cycles cover <-> lyrics.
            setPlayerMode(prev => (prev === 'lyrics' ? 'cover' : 'lyrics'));
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleContextMenu = useCallback((e) => {
          e.preventDefault();
          if (!youtubeId) return;             // nothing video-related to cycle
          const area = e.target.closest('[data-area]')?.getAttribute('data-area');

          if (!isVideoMode) {
            // Cover / lyrics mode: right-click enters VIDEO mode (pure video first);
            // further right-clicks reveal the side panel (cover/lyrics).
            setPlayerMode('video');
            return;
          }

          // Inside a video mode, the right-click target decides the action:
          //  - clicking the VIDEO closes the side panel back to pure video;
          //  - clicking the SIDE PANEL swaps lyrics <-> cover (the user's intent);
          //  - a click that lands on the container margin falls back to pure video.
          if (playerMode === 'video') {
            setPlayerMode(hasLyrics ? 'video-split' : 'video-cover');
          } else if (playerMode === 'video-split') {
            if (area === 'lyrics') {
              setPlayerMode('video-cover');     // swap panel: lyrics -> cover
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          } else if (playerMode === 'video-cover') {
            if (area === 'cover-box') {
              setPlayerMode(hasLyrics ? 'video-split' : 'video-cover'); // swap -> lyrics
            } else {
              setPlayerMode('video');           // video area / margin -> close panel
            }
          }
        }, [youtubeId, playerMode, hasLyrics, isVideoMode, setPlayerMode]);

        const handleVideoReady = useCallback(() => {
          // Fire once per load only. The <video> re-fires `canplay` after
          // every seek/buffer; without this guard it would re-set videoReady and
          // re-trigger the one-time sync in a loop, freezing playback.
          if (readyFiredRef.current) return;
          readyFiredRef.current = true;
          setVideoReady(true);
        }, []);

  // Play audio within user gesture context (click handler) to bypass autoplay policy
  const playFileInGesture = useCallback((fileId) => {
    const audio = audioRef?.current;
    if (!audio || !fileId) return;
    const newSrc = `/file/${fileId}`;
    audio.currentTime = 0;
     if (audio.src !== window.location.origin + newSrc) {
      audio.src = newSrc;
      audio.load();
      applySink(audio, getStoredDevice());
    }
    prevFileIdRef.current = fileId;
    audio.play().then(() => {
      play();
      setIsLoading(false);
    }).catch(() => {});
  }, [audioRef, play]);

  const handleCarouselSelect = useCallback((selectedFile) => {
    const fileId = selectedFile?.file_id || selectedFile?.id;
    if (fileId) playFileInGesture(fileId);
    if (hasPlaylist) {
      const idx = playlistFiles.findIndex(f => f.id === selectedFile.id);
      if (idx !== -1) {
        setCurrentTrackIndex(idx);
        onTrackIndexChange?.(idx);
      }
    } else {
      onAudioChange?.(selectedFile);
    }
  }, [hasPlaylist, playlistFiles, playFileInGesture, setCurrentTrackIndex, onAudioChange, onTrackIndexChange]);

  // Scrub start: pause the video so it can't run as a second, parallel timeline
  // while the audio clock jumps around. The video is re-anchored on scrub-end.
  const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true;
    videoRef.current?.pauseVideo?.();
  }, []);

  // Scrub move: soft/coalesced seek so the paused video frame tracks the drag
  // in real time (preview), without jank or a parallel playback clock.
  const handleScrubChange = useCallback((val) => {
    const player = videoRef.current;
    if (!player?.seekTo) return;
    player.seekTo(val + (videoOffsetRef.current || 0));
  }, []);

  // Seek synchronization from progress bar – fires for ALL video modes. On
  // release we clear the scrub flag and re-anchor the video to the live audio
  // position through the single consolidated path (resuming clean sync).
  const handleSeekSync = useCallback((seconds) => {
    scrubbingRef.current = false;
    setStorePosition(seconds);
    if (isVideoMode && videoRef.current?.forceSeek) {
      anchorVideoToAudio({ play: true });
    }
  }, [audioRef, isVideoMode, anchorVideoToAudio, setStorePosition]);

  const handleNext = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === prev.queue.length - 1) return;
    next();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const nextFile = st.queue[st.currentTrackIndex];
    if (nextFile) {
      const fid = nextFile.file_id || nextFile.id;
      if (fid) playFileInGesture(fid);
      // Keep the `file` prop (and thus the cover/MV metadata) in sync so the
      // video follows the skip even when there is no playlist queue.
      onAudioChange?.(nextFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [next, playFileInGesture, hasPlaylist, onTrackIndexChange, onAudioChange]);

  const handlePrevious = useCallback(() => {
    const prev = usePlaybackStore.getState();
    if (prev.queue.length === 0) return;
    if (!prev.shuffle && prev.loopMode === 'off' && prev.currentTrackIndex === 0) return;
    previous();
    const st = usePlaybackStore.getState();
    if (st.currentTrackIndex === prev.currentTrackIndex) return;
    const prevFile = st.queue[st.currentTrackIndex];
    if (prevFile) {
      const fid = prevFile.file_id || prevFile.id;
      if (fid) playFileInGesture(fid);
      onAudioChange?.(prevFile);
    }
    if (hasPlaylist) onTrackIndexChange?.(st.currentTrackIndex);
  }, [previous, playFileInGesture, hasPlaylist, onTrackIndexChange, onAudioChange]);

    const mainContent = useMemo(() => {
     // --- Fit cover/video into the available media area (excludes title) ---
    const aW = availSize.width || 384;
    const aH = availSize.height || 384;
    const COVER_MAX = 384; // 24rem
    const coverBox = Math.min(aW, aH, COVER_MAX);

    const isSplit = playerMode === 'video-split' || playerMode === 'video-cover';
    const hasVideo = !!youtubeId;
    const isVideo = isVideoMode && hasVideo;

    const baseVidW = coverBox * 16 / 9;
    const baseVidH = coverBox;
    const vScale = Math.min(1, aW / baseVidW, aH / baseVidH);

    const GAP = 16;
    const basePanel = baseVidH;
    const sScale = Math.min(1, aW / (baseVidW + GAP + basePanel), aH / baseVidH);

    const curVidW = isSplit ? baseVidW * sScale : baseVidW * vScale;
    const curVidH = isSplit ? baseVidH * sScale : baseVidH * vScale;
    const panelW = isSplit ? basePanel * sScale : 0;
    const panelH = isSplit ? curVidH : 0;

    // In split (video-split / video-cover) mode, center the COMBINED
    // video + panel block so the video nudges left and the panel sits to its
    // right with equal left/right margins — instead of the video being
    // hard-centered with the panel hanging off the right edge.
    const totalBlockW = isSplit ? curVidW + GAP + panelW : curVidW;
    const videoLeft = Math.max(0, (aW - totalBlockW) / 2);
    const videoTop  = Math.max(0, (aH - curVidH) / 2);

    const panelLeft = videoLeft + curVidW + GAP;
    const panelTop  = videoTop;

    const coverLeft = Math.max(0, (aW - coverBox) / 2);
    const coverTop  = Math.max(0, (aH - coverBox) / 2);

    // Breathing (play/pause) pulse only for cover/lyrics. In any video mode we
    // keep scale = 1 so the 1.04 grow never eats the gap and makes the side
    // panel overlap the video in split (video-split / video-cover) layouts.
    const coverScale = isVideo ? 1 : (isPlaying ? 1.04 : 0.9);
    const breath = `scale(${coverScale})`;

    const containerTransition = 'width 400ms ease, height 400ms ease, opacity 400ms ease';

    const containerStyle = {
      width: aW + 'px',
      height: aH + 'px',
      maxWidth: '100%',
      transition: containerTransition,
      opacity: isPlaying ? 1 : 0.5,
    };

    let regionLeft, regionTop, regionW, regionH;
    if (isVideo) {
      regionLeft = videoLeft;
      regionTop  = videoTop;
      regionW    = curVidW;
      regionH    = curVidH;
    } else {
      regionLeft = coverLeft;
      regionTop  = coverTop;
      regionW    = coverBox;
      regionH    = coverBox;
    }

    const stageStyle = {
      position: 'absolute',
      left: regionLeft + 'px',
      top: regionTop + 'px',
      width: regionW + 'px',
      height: regionH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
      transform: breath,
      transformOrigin: 'center center',
      transition: 'left 400ms ease, top 400ms ease, width 400ms ease, height 400ms ease, transform 400ms ease, opacity 400ms ease',
      zIndex: 2,
    };

    const lyricsPanelStyle = {
      position: 'absolute',
      left: panelLeft + 'px',
      top: panelTop + 'px',
      width: panelW + 'px',
      height: panelH + 'px',
      borderRadius: '1rem',
      overflow: 'hidden',
      transform: breath,
      transformOrigin: 'center center',
      opacity: isSplit ? 1 : 0,
      pointerEvents: isSplit ? 'auto' : 'none',
      transition: 'width 400ms ease, height 400ms ease, opacity 400ms ease, left 400ms ease, top 400ms ease, transform 400ms ease',
      zIndex: 1,
    };

    return (
      <div className="flex flex-col items-center w-full">
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer overflow-visible rounded-2xl mb-4"
        style={containerStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* SINGLE MORPHING STAGE: cover / video / lyrics (1:1 <-> 16:9).
            Satu kontainer rounded yang ukuran/posisinya morph; anak-anak isi penuh
            (inset:0) dan di-crossfade opacity sehingga transisi cover<->video tanpa peek. */}
        <div
          data-area={isVideo ? 'video' : (playerMode === 'lyrics' ? 'lyrics' : 'cover')}
          className="absolute"
          style={stageStyle}
        >
          {/* Cover child — fills the square clip region */}
          <div
            className="absolute inset-0"
            style={{
              // Stage clips to a rounded 1rem container, so the image is always
              // rounded; borderRadius/overflow below are a harmless safeguard.
              borderRadius: '1rem',
              overflow: 'hidden',
              opacity: (!isVideo && playerMode !== 'lyrics') ? 1 : 0,
              pointerEvents: (!isVideo && playerMode !== 'lyrics') ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            {activeFile ? (
              <NetworkImage
                src={coverBlobUrl || `/thumbnails/${activeFile.id}.jpg?v=${coverVersion}`}
                alt="Cover"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-purple-800 to-sky-900 flex items-center justify-center">
                <svg className="w-20 h-20 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            {isLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
              </div>
            )}
            {playerMode === 'cover' && (
              <div className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMetadataEditor(true); }}
                  className="p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white/70 hover:text-white transition-colors"
                  title="Edit metadata"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Video child — fills the 16:9 clip region */}
          {youtubeId && (
            <div
              className="absolute inset-0"
              style={{
                opacity: isVideo ? 1 : 0,
                pointerEvents: isVideo ? 'auto' : 'none',
                transition: 'opacity 400ms ease',
              }}
            >
              <CachedVideoPlayer
                key={videoRemountKey}
                ref={videoRef}
                youtubeId={youtubeId}
                playing={isPlaying}
                scrubbingRef={scrubbingRef}
                muted
                onReady={handleVideoReady}
                onLoadedMetadata={() => setMetadataReady(true)}
                onWaiting={handleVideoWaiting}
                onStalled={handleVideoStalled}
                onPlaying={handleVideoResumed}
                onSeeked={handleVideoResumed}
                onEnded={handleVideoEnded}
                onError={handleVideoError}
              />
            </div>
          )}

          {/* Lyrics child — fills the square clip region (blurred cover + lyrics) */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: '1rem',
              overflow: 'hidden',
              opacity: playerMode === 'lyrics' ? 1 : 0,
              pointerEvents: playerMode === 'lyrics' ? 'auto' : 'none',
              transition: 'opacity 400ms ease',
            }}
          >
            <img
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt=""
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(28px) brightness(0.7) saturate(1.25)', transform: 'scale(1.15)' }}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
            <div className="absolute inset-0 bg-black/15" />
            <div
              className="absolute inset-0"
              style={{ background: 'radial-gradient(circle at center, rgba(10,10,10,0) 38%, rgba(10,10,10,0.6) 100%)' }}
            />
            <div className="relative z-10 w-full h-full overflow-y-auto p-4 sm:p-6">
              <LyricsDisplay
                lyrics={lyricsSynced || trackMetadata?.lyrics}
                audioRef={audioRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>

        {/* SPLIT BLOCK (video-split: lyrics, video-cover: cover art).
            Kedua konten dirender sekaligus dan di-crossfade opacity agar
            transisi cover<->lyrics tidak "loncat". Posisi di-animasikan via
            transform (style lyricsPanelStyle); video layer z-index lebih tinggi
            sehingga panel tidak menutupi video saat transisi. */}
        <div
          data-area={playerMode === 'video-cover' ? 'cover-box' : 'lyrics'}
          className="rounded-2xl overflow-hidden"
          style={lyricsPanelStyle}
        >
          {/* Child A: cover art (video-cover) */}
          <div
            className="absolute inset-0"
            style={{ opacity: playerMode === 'video-cover' ? 1 : 0, transition: 'opacity 300ms ease' }}
          >
            <NetworkImage
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt="Cover"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
          {/* Child B: lyrics (video-split) */}
          <div
            className="absolute inset-0"
            style={{
              opacity: playerMode === 'video-split' ? 1 : 0,
              transition: 'opacity 300ms ease',
            }}
          >
            <img
              src={coverBlobUrl || `/thumbnails/${activeFile?.id}.jpg?v=${coverVersion}`}
              alt=""
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(22px) brightness(0.75) saturate(1.2)', transform: 'scale(1.1)' }}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
            <div className="absolute inset-0 bg-black/15" />
            <div className="relative z-10 w-full h-full">
              <LyricsDisplay
                lyrics={lyricsSynced || trackMetadata?.lyrics}
                audioRef={audioRef}
                isPlaying={isPlaying}
              />
            </div>
          </div>
        </div>

        {/* VIDEO SEARCH PICKER */}
        {playerMode === 'video' && !youtubeId && videoSearchResults && (
          <div className="absolute inset-0 bg-black/90 rounded-2xl overflow-y-auto z-20 p-3">
            <p className="text-white/60 text-[10px] mb-2">Pilih video:</p>
            <div className="space-y-2">
              {videoSearchResults && videoSearchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={(e) => { e.stopPropagation(); handleVideoPick(r.id); }}
                  className="w-full flex gap-2 items-start p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left"
                >
                  <img src={r.thumbnail} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white text-[11px] font-medium leading-tight truncate">{r.title}</p>
                    <p className="text-white/40 text-[10px] truncate">{r.channel}</p>
                  </div>
                </button>
              ))}
              {videoSearchResults.length === 0 && (
                <p className="text-white/30 text-xs text-center py-4">No results found</p>
              )}
            </div>
          </div>
        )}

      </div>
      <div
        ref={titleRef}
        className="w-full max-w-xl px-2"
        style={{
          opacity: 1,
          pointerEvents: 'auto',
        }}
      >
        <h2 className="text-lg sm:text-2xl font-bold text-white truncate text-center px-4">
          {displayTitle}
        </h2>
        <p className="text-purple-400/60 text-xs sm:text-sm mt-1 font-medium tracking-wide text-center">
          {activeFile?.artist || 'Digital Audio Stream'}
        </p>
      </div>
    </div>
  );
  }, [activeFile?.id, activeFile?.display_name, activeFile?.artist, displayTitle, coverBlobUrl, coverVersion, isLoading, error, isPlaying, playerMode, lyricsSynced, trackMetadata, youtubeId, videoSearchResults, audioRef, pause, play, handleVideoSearch, handleVideoPick, availSize]);

  const handleQueueSelect = useCallback((index) => {
    const queueFile = playlistFiles[index];
    if (queueFile) {
      const fid = queueFile.file_id || queueFile.id;
      if (fid) playFileInGesture(fid);
    }
    setCurrentTrackIndex(index);
    if (hasPlaylist) onTrackIndexChange?.(index);
  }, [playlistFiles, playFileInGesture, setCurrentTrackIndex, hasPlaylist, onTrackIndexChange]);

  // Dedicated Music UI (no MediaLayout / media-vault shared chrome): show the
  // carousel only when there are siblings, and let the user hide it (persisted).
  const showCarousel = carouselFiles.length > 1;
  const [manualHidden, setManualHidden] = useState(() => {
    try { return localStorage.getItem('mv_carousel_hidden') === '1'; } catch { return false; }
  });
  const toggleCarouselHidden = useCallback(() => {
    setManualHidden((h) => {
      const next = !h;
      try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  return (
    <div data-debug-id="1.1.9.3" data-debug-name="AudioPlayer" data-debug-type="player" className="w-full h-full overflow-hidden max-w-full flex flex-col bg-neutral-950 text-slate-100 select-none relative">
      {headerNode && (
        <div className="relative flex-none h-14 flex items-center justify-between border-b border-white/5 px-4">
          {headerNode}
        </div>
      )}

      {/* Media area: cover + title + controls grouped and centered as ONE unit, so
          the media controls stay close to the cover/title even when the window is tall
          (instead of being pushed to the very bottom by a greedy flex child). */}
      <div ref={mediaAreaRef} className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-8">
        <div className="flex flex-col items-center w-full">
          {mainContent}
          <div ref={controlsRef} className="w-full max-w-3xl mt-4 sm:mt-5">
            <MediaControls
              type="audio"
              mediaRef={audioRef}
              folderFiles={carouselFiles}
              currentFile={activeFile}
              onFileChange={handleCarouselSelect}
              onSeek={handleSeekSync}
              onSeekStart={handleScrubStart}
              onSeekChange={handleScrubChange}
              onClose={onClose}
              playlistMode={hasPlaylist}
              currentTrackIndex={storeCurrentTrackIndex}
              totalTracks={playlistFiles.length}
              onNext={hasPlaylist ? handleNext : undefined}
              onPrevious={hasPlaylist ? handlePrevious : undefined}
            />
          </div>
        </div>
      </div>

      {/* Playlist / queue strip pinned to the bottom, large thumbnails, with a
          hide toggle. Uses its own collapse so it never overlaps the audio UI. */}
      {showCarousel && (
        <div className="w-full relative">
          <div className={`grid transition-all duration-300 ease-out ${manualHidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
            <div className="overflow-hidden">
              <Carousel
                files={carouselFiles}
                currentFile={activeFile}
                onSelect={handleCarouselSelect}
                sortBy={currentSortBy}
                sortOrder={currentSortOrder}
                cacheBust={stableCacheBust}
                onToggleFavorite={onFavoriteToggle}
                contextLabel={carouselContextLabel}
                itemSize="lg"
              />
            </div>
          </div>
          <button
            onClick={toggleCarouselHidden}
            className="absolute -top-9 right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity"
            title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
          >
            {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      )}

      <QueuePanel
        isOpen={showQueuePanel}
        onClose={() => setShowQueuePanel(false)}
        tracks={playlistFiles}
        currentTrackIndex={storeCurrentTrackIndex}
        onTrackSelect={handleQueueSelect}
        onFavoriteToggle={onFavoriteToggle}
      />
    {showMetadataEditor && activeFile?.id && (
      <MetadataEditor
        fileId={activeFile.id}
        onSaved={() => {
          fetch(`/api/metadata/${activeFile.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
        onCoverChanged={() => setCoverVersion(v => v + 1)}
        onClose={() => {
          setShowMetadataEditor(false);
          fetch(`/api/metadata/${activeFile.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data) {
                setTrackMetadata(data);
                setLyricsSynced(data.lyrics_synced || data.syncedLyrics || null);
                setYoutubeId(data.youtube_id || null);
                setVideoOffset(Number(data.video_offset) || 0);
              }
            })
            .catch(() => {});
        }}
      />
    )}
    </div>
  );
}
