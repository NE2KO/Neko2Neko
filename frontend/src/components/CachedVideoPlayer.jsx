import { useState, useEffect, useRef, forwardRef, useImperativeHandle, memo } from 'react';

const CachedVideoPlayer = memo(forwardRef(function CachedVideoPlayer({ youtubeId, onReady, onWaiting, onPlaying, onStalled, onSeeked, onEnded, onError, onLoadedMetadata, onPause, coverUrl }, ref) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('checking');
  const [progress, setProgress] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadCountRef = useRef(0);

  const seekInProgressRef = useRef(false);
  const pendingSeekRef = useRef(null);
  const lastRequestedSeekRef = useRef(null);
  const pendingForceSeekRef = useRef(null);

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

      // If another force seek is still pending, queue/replace it so rapid
      // re-anchors win on the latest target instead of stacking浏览器 seeks.
      if (pendingForceSeekRef.current !== null) {
        if (Math.abs(pendingForceSeekRef.current - time) < 0.25) {
          lastRequestedSeekRef.current = time;
          return true;
        }
        pendingForceSeekRef.current = time;
        lastRequestedSeekRef.current = time;
        return true;
      }

      // No-op if already at (or within 1ms of) the target: re-assigning
      // currentTime to the same value makes the <video> briefly flash the
      // pre-seek frame, which reads as flicker during rapid seeks.
      // Threshold lowered from 50ms to 1ms so soft-seek corrections
      // (drift 3–50ms) are not silently dropped.
      if (Math.abs((video.currentTime || 0) - time) < 0.001) {
        lastRequestedSeekRef.current = time;
        return false;
      }
      // Pause before seek to prevent wrong-frame flash on videos with long GOPs
      // or sparse keyframes. Skip pause for seeks < 300ms to allow seamless
      // soft-seek correction from the sync engine (no visible frame jump).
      if (Math.abs((video.currentTime || 0) - time) > 0.3) {
        if (!video.paused) video.pause();
      }

      seekInProgressRef.current = true;
      pendingForceSeekRef.current = null;
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
    getPaused() {
      const video = videoRef.current;
      return video ? video.paused : true;
    },
    getSeeking() {
      const video = videoRef.current;
      return video ? video.seeking : false;
    },
    getReadyState() {
      const video = videoRef.current;
      if (!video) return 0;
      return video.readyState;
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
        notifySeeked?.();
        return;
      }

      // Drain pending force-seek queue so the latest target wins without
      // stacking browser seeks on top of each other.
      const nextForce = pendingForceSeekRef.current;
      if (nextForce !== null && seekInProgressRef.current) {
        pendingForceSeekRef.current = null;
        if (Math.abs((videoRef.current?.currentTime || 0) - nextForce) >= 0.001) {
          seekInProgressRef.current = true;
          videoRef.current.currentTime = nextForce;
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

  // TEMP DIAGNOSTIC: raw <video> event timeline. Enabled only when the global
  // sync telemetry flag is active to avoid console spam during normal playback.
  useEffect(() => {
    const enabled = typeof window !== 'undefined' && window.__SYNC_ENABLED__;
    const video = videoRef.current;
    if (!video || !enabled) return;
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

  // Self-heal: while in the error state (source temporarily unavailable, e.g.
  // server restart / network loss) keep probing the backend so the video
  // recovers the moment it comes back — without waiting for the parent's
  // remount cycle. Idempotent; cheap while the source is still down.
  useEffect(() => {
    if (status !== 'error' || !youtubeId) return undefined;
    const id = setInterval(() => {
      fetch(`/api/video-cache/download/${youtubeId}`, { method: 'POST' })
        .then((r) => r.json())
        .then((data) => { if (data?.status === 'cached') setStatus('cached'); })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(id);
  }, [status, youtubeId]);

  // Remove the background blob hot-swap effect (post-streaming regression that
  // caused the backward-seek double-frame glitch). Playback stays on the
  // range-streamed URL; the <video src> is never reassigned.
  // Playback is now driven entirely by the parent engine via playVideo/pauseVideo;
  // the old `playing` prop auto-play/pause effect was removed so the engine is
  // the single source of truth and cannot fight with rapid play/pause spam.

  if (!youtubeId) return null;

  if (status === 'checking' || status === 'downloading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black rounded-2xl gap-3">
        <div className="w-10 h-10 border-3 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/50 text-xs">
          {status === 'checking' ? 'Memeriksa cache…' : `Mengunduh video… ${progress}%`}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black rounded-2xl overflow-hidden relative">
        {coverUrl && (
          <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2 text-white/90">
          <div className="w-8 h-8 border-2 border-white/25 border-t-white rounded-full animate-spin" />
          <p className="text-[11px] font-medium">Menyambungkan kembali…</p>
        </div>
      </div>
    );
  }

  return (
  <video
    key={`${reloadKey}:${youtubeId}`} /* remounts on track change so skip follows */
    ref={videoRef}
    className="w-full h-full object-contain rounded-2xl"
    src={`/api/video-cache/stream/${youtubeId}`}
    poster={coverUrl || undefined}
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
    onPause={onPause}
  />
  );
}));

export default CachedVideoPlayer;
