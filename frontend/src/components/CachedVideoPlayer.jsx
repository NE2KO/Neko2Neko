import { useState, useEffect, useRef, forwardRef, useImperativeHandle, memo } from 'react';

const CachedVideoPlayer = memo(forwardRef(function CachedVideoPlayer({ youtubeId, playing, onReady, onWaiting, onPlaying, onStalled, onSeeked, onEnded, onError, onLoadedMetadata, scrubbingRef }, ref) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('checking');
  const [progress, setProgress] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadCountRef = useRef(0);

  const seekInProgressRef = useRef(false);
  const pendingSeekRef = useRef(null);
  const lastRequestedSeekRef = useRef(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  useImperativeHandle(ref, () => ({
    getCurrentTime() {
      return videoRef.current?.currentTime || 0;
    },
    seekTo(time) {
      const video = videoRef.current;
      if (!video) return false;

      if (lastRequestedSeekRef.current === time) return false;
      lastRequestedSeekRef.current = time;

      if (seekInProgressRef.current) {
        pendingSeekRef.current = time;
        return true;
      }

      seekInProgressRef.current = true;
      video.currentTime = time;
      return true;
    },
    forceSeek(time) {
      const video = videoRef.current;
      if (!video) return false;
      // No-op if already at (or within a frame of) the target: re-assigning
      // currentTime to the same value makes the <video> briefly flash the
      // pre-seek frame, which reads as flicker during rapid seeks.
      if (Math.abs((video.currentTime || 0) - time) < 0.05) {
        lastRequestedSeekRef.current = time;
        return false;
      }
      seekInProgressRef.current = false;
      pendingSeekRef.current = null;
      lastRequestedSeekRef.current = time;
      video.currentTime = time;
      return true;
    },
    pauseVideo() {
      if (videoRef.current) videoRef.current.pause();
  },
    playVideo() {
      const video = videoRef.current;
      if (video) {
        video.play().catch(() => {});
      }
    },
    setRate(rate) {
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
    },
    getRate() {
      const video = videoRef.current;
      return video ? video.playbackRate : 1;
    },
    getDuration() {
      const video = videoRef.current;
      return video ? (video.duration || 0) : 0;
    },
    reload() {
      // Self-heal: remount the <video> element (e.g. after a genuine error).
      // Capped so a permanently-broken stream can't loop forever.
      if (reloadCountRef.current >= 3) return;
      reloadCountRef.current += 1;
      setReloadKey(k => k + 1);
    },
  }));


  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const notifySeeked = onSeeked;   // prop (local handler below is renamed to avoid shadowing)

    const handleSeeked = () => {
      const next = pendingSeekRef.current;
      if (next !== null) {
        pendingSeekRef.current = null;
        video.currentTime = next;
        // Only auto-resume if we're NOT mid-scrub. While the user is dragging the
        // progress bar the parent has paused the video and is soft-seeking it for
        // frame-preview; auto-playing here would cancel that pause and let the MV
        // run as a second timeline (the "frame from old position carried over"
        // glitch). The parent re-anchors + resumes on scrub-end.
        if (playingRef.current && !scrubbingRef?.current) {
          video.play().catch(() => {});
        }
        notifySeeked?.();
        return;
      }
      seekInProgressRef.current = false;
      notifySeeked?.();
    };

    video.addEventListener('seeked', handleSeeked);
    return () => {
      video.removeEventListener('seeked', handleSeeked);
      seekInProgressRef.current = false;
      pendingSeekRef.current = null;
    };
  }, [status]);

  // TEMP DIAGNOSTIC: raw <video> event timeline.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const fmt = () => {
      let buf = '';
      try {
        const b = video.buffered;
        if (b && b.length) buf = `${b.start(0).toFixed(2)}-${b.end(b.length - 1).toFixed(2)}`;
      } catch {}
      return `t=${(performance.now()/1000).toFixed(2)} ct=${video.currentTime.toFixed(2)} rs=${video.readyState} buf=[${buf}]`;
    };
    const evs = ['loadedmetadata', 'canplay', 'seeking', 'seeked', 'waiting', 'stalled', 'playing', 'play', 'pause'];
    const log = (e) => console.log(`[VID ${e.type.padEnd(13)}] ${fmt()}`);
    evs.forEach(ev => video.addEventListener(ev, log));
    return () => evs.forEach(ev => video.removeEventListener(ev, log));
  }, [youtubeId, status]);

  // Fetch the cached video into the range-streamed URL. Plays immediately from
  // `/api/video-cache/stream/:id` (HTTP Range serves the faststart copy built by
  // the backend, so seeks are clean) — no in-memory blob + src swap (that swap
  // caused the post-streaming backward-seek double-frame glitch).
  useEffect(() => {
    if (!youtubeId) return;
    setStatus('checking');
    setProgress(0);
    reloadCountRef.current = 0;

    fetch(`/api/video-cache/download/${youtubeId}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.status === 'cached') {
          setStatus('cached');
        } else if (data.status === 'downloading') {
          setStatus('downloading');
          pollDownload();
        }
      })
      .catch(() => setStatus('error'));

    let pollTimer;
    function pollDownload() {
      pollTimer = setTimeout(() => {
        fetch(`/api/video-cache/progress/${youtubeId}`)
          .then(r => r.json())
          .then(data => {
            if (data.status === 'cached') {
              setStatus('cached');
            } else {
              setProgress(data.progress || 0);
              pollDownload();
            }
          })
          .catch(() => {});
      }, 1000);
    }

    return () => clearTimeout(pollTimer);
  }, [youtubeId]);

  // Remove the background blob hot-swap effect (post-streaming regression that
  // caused the backward-seek double-frame glitch). Playback stays on the
  // range-streamed URL; the <video src> is never reassigned.

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      // Only auto-resume when the clip is already positioned mid-playback. The
      // INITIAL start from ~0 is driven by the parent AFTER it seeks to the
      // offset target (prepare-then-play), so frame 0 is never painted for
      // offset tracks. Resuming an already-advanced clip (user pause→play) is
      // still handled here. Don't auto-resume mid-scrub — the parent paused the
      // video and will re-anchor + resume on scrub-end.
      if (!scrubbingRef?.current && (video.currentTime || 0) > 0.05) video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  if (!youtubeId) return null;

  if (status === 'checking' || status === 'downloading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black rounded-2xl gap-3">
        <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/50 text-xs">
          {status === 'checking' ? 'Checking cache...' : `Downloading video... ${progress}%`}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black rounded-2xl">
        <p className="text-red-400 text-xs">Failed to load video</p>
      </div>
    );
  }

  return (
  <video
    key={`${reloadKey}:${youtubeId}`} /* remounts on track change so skip follows */
    ref={videoRef}
    className="w-full h-full object-contain rounded-2xl"
    src={`/api/video-cache/stream/${youtubeId}`}
    preload="auto"
    playsInline
    muted
    disablePictureInPicture
    disableRemotePlayback
    onCanPlay={onReady}
    onWaiting={onWaiting}
    onPlaying={onPlaying}
    onStalled={onStalled}
    onSeeked={onSeeked}
    onLoadedMetadata={onLoadedMetadata}
    onEnded={onEnded}
    onError={onError}
  />
  );
}));

export default CachedVideoPlayer;
