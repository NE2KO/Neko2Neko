/**
 * ListeningTracker — accurate per-track listening statistics.
 *
 * Tracks actual playback time using a monotonic clock, excluding pause/seek/
 * buffering intervals. Persists to localStorage incrementally.
 *
 * Play count semantics:
 *   - A "play session" starts when audio begins playing after a pause or on
 *     a fresh track load.
 *   - A valid play is counted once a session accumulates >= threshold
 *     of actual listening time.
 *   - Pause/resume within the same track continues the same session and does
 *     NOT increment play count again.
 *   - Track change finalizes the previous session and starts a new one.
 *   - Seek does NOT create a new session; the pre-seek interval is finalized
 *     and a new interval starts after the seek completes.
 *   - Play count is only incremented when sessionAccumulated reaches the
 *     threshold during playback, guarded by sessionPlayCounted to prevent
 *     double counting.
 */

const STORAGE_KEY = 'listeningStats';
const MIN_PLAY_SECONDS = 30;
const PERSIST_DEBOUNCE_MS = 2000;

function getStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function setStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h} jam ${String(m).padStart(2, '0')} menit ${String(sec).padStart(2, '0')} detik`;
  }
  if (m > 0) {
    return `${m} menit ${String(sec).padStart(2, '0')} detik`;
  }
  return `${sec} detik`;
}

export function computePlayThreshold(duration) {
  if (!duration || !isFinite(duration) || duration <= 0) return MIN_PLAY_SECONDS;
  if (duration < 60) return Math.max(1, Math.floor(Math.min(MIN_PLAY_SECONDS, duration * 0.5)));
  return MIN_PLAY_SECONDS;
}

export class ListeningTracker {
  constructor() {
    this.stats = getStorage();
    this.persistTimer = null;
    this.currentTrackId = null;
    this.sessionStart = null;
    this.sessionListened = 0;
    this.sessionAccumulated = 0;
    this.sessionPlayCounted = false;
    this.sessionThreshold = MIN_PLAY_SECONDS;
    this.lastAudioTime = null;
    this.lastTick = null;
    this.rafId = null;
    this._attachCount = 0;
    this._boundTick = this._tick.bind(this);
    this._onPlay = this._onPlay.bind(this);
    this._onPause = this._onPause.bind(this);
    this._onSeeked = this._onSeeked.bind(this);
    this._onEnded = this._onEnded.bind(this);
    this._onTimeUpdate = this._onTimeUpdate.bind(this);
    this._onLoadedMetadata = this._onLoadedMetadata.bind(this);
  }

  getActiveSessionSeconds() {
    return Math.max(0, this.sessionListened || 0);
  }

  getCurrentTrackId() {
    return this.currentTrackId || null;
  }

  getTrackStats(trackId) {
    if (!trackId) return null;
    if (!this.stats[trackId]) {
      this.stats[trackId] = {
        playCount: 0,
        listenedSeconds: 0,
        lastPlayedAt: null,
        updatedAt: null,
        displayName: null,
        sessionAccumulated: 0,
        sessionPlayCounted: false,
      };
    }
    return this.stats[trackId];
  }

  getGlobalStats() {
    const tracks = Object.values(this.stats);
    const totalPlayCount = tracks.reduce((s, t) => s + (t.playCount || 0), 0);
    const totalListenedSeconds = tracks.reduce((s, t) => s + (t.listenedSeconds || 0), 0);
    const uniqueTracks = tracks.length;
    return { totalPlayCount, totalListenedSeconds, uniqueTracks };
  }

  getLeaderboard(metric = 'plays', limit = 10) {
    const entries = Object.entries(this.stats)
      .filter(([, s]) => (s.playCount > 0 || s.listenedSeconds > 0))
      .map(([trackId, s]) => ({
        trackId,
        displayName: s.displayName,
        playCount: s.playCount || 0,
        listenedSeconds: s.listenedSeconds || 0,
        lastPlayedAt: s.lastPlayedAt,
      }))
      .sort((a, b) => {
        if (metric === 'listened') {
          return (b.listenedSeconds || 0) - (a.listenedSeconds || 0);
        }
        return (b.playCount || 0) - (a.playCount || 0);
      })
      .slice(0, limit);
    return entries;
  }

  _attach() {
    if (!this._audio || !this.currentTrackId) return;
    this._audio.addEventListener('play', this._onPlay);
    this._audio.addEventListener('pause', this._onPause);
    this._audio.addEventListener('seeked', this._onSeeked);
    this._audio.addEventListener('ended', this._onEnded);
    this._audio.addEventListener('timeupdate', this._onTimeUpdate);
    this._audio.addEventListener('loadedmetadata', this._onLoadedMetadata);
    if (!this._audio.paused) {
      this._startSession();
    }
  }

  _detach() {
    if (!this._audio) return;
    this._audio.removeEventListener('play', this._onPlay);
    this._audio.removeEventListener('pause', this._onPause);
    this._audio.removeEventListener('seeked', this._onSeeked);
    this._audio.removeEventListener('ended', this._onEnded);
    this._audio.removeEventListener('timeupdate', this._onTimeUpdate);
    this._audio.removeEventListener('loadedmetadata', this._onLoadedMetadata);
  }

  _onLoadedMetadata() {
    if (!this._audio || !this.currentTrackId) return;
    this.sessionThreshold = computePlayThreshold(this._audio.duration);
  }

  attach(audio, trackId, displayName) {
    if (!audio || !trackId) return;
    const wasAttached = this._attachCount > 0;
    this._audio = audio;
    this.currentTrackId = trackId;
    if (displayName && (!this.stats[trackId] || !this.stats[trackId].displayName)) {
      const stats = this.getTrackStats(trackId);
      stats.displayName = displayName;
    }
    this.sessionThreshold = computePlayThreshold(audio.duration);
    const saved = this.getTrackStats(trackId);
    if (wasAttached && this.currentTrackId === trackId && this._audio === audio) {
      this.sessionPlayCounted = saved ? saved.sessionPlayCounted || false : false;
      this.sessionAccumulated = saved ? saved.sessionAccumulated || 0 : 0;
    } else if (!wasAttached && saved) {
      this.sessionPlayCounted = saved.sessionPlayCounted || false;
      this.sessionAccumulated = saved.sessionAccumulated || 0;
    } else {
      this.sessionStart = null;
      this.sessionListened = 0;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
    }
    this.lastAudioTime = null;
    this.lastTick = null;
    this._attachCount += 1;
    if (!wasAttached) {
      this._attach();
    } else if (!audio.paused) {
      this._startSession();
    }
  }

  detach() {
    if (this._attachCount <= 0) return;
    this._attachCount -= 1;
    if (this._attachCount <= 0) {
      this._detach();
      this._stopTick();
      this._finalizeSession();
      this._audio = null;
      this.currentTrackId = null;
      this._attachCount = 0;
    }
  }

  onTrackChange(newTrackId) {
    if (this.currentTrackId && this.currentTrackId !== newTrackId) {
      this._finalizeSession();
    }
    if (newTrackId && this._audio && !this._audio.paused) {
      this.currentTrackId = newTrackId;
      this.sessionStart = null;
      this.sessionListened = 0;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
      this.sessionThreshold = computePlayThreshold(this._audio.duration);
      this.lastAudioTime = null;
      this.lastTick = null;
      this._startSession();
    } else if (newTrackId) {
      this.currentTrackId = newTrackId;
      this.sessionStart = null;
      this.sessionListened = 0;
      this.sessionAccumulated = 0;
      this.sessionPlayCounted = false;
      this.sessionThreshold = computePlayThreshold(this._audio?.duration);
      this.lastAudioTime = null;
      this.lastTick = null;
    }
  }

  _startSession() {
    if (!this.currentTrackId || !this._audio) return;
    this.sessionStart = performance.now();
    this.lastAudioTime = this._audio.currentTime || 0;
    this.lastTick = this.sessionStart;
    this._startTick();
  }

  _startTick() {
    this._stopTick();
    if (this._audio && !this._audio.paused) {
      this.rafId = requestAnimationFrame(this._boundTick);
    }
  }

  _stopTick() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _tick() {
    if (!this._audio || this._audio.paused || !this.currentTrackId) {
      this.rafId = null;
      return;
    }
    const now = performance.now();
    if (this.lastTick != null) {
      const dt = (now - this.lastTick) / 1000;
      if (dt > 0) {
        this.sessionListened += dt;
        this.sessionAccumulated += dt;
        if (!this.sessionPlayCounted && this.sessionAccumulated >= this.sessionThreshold) {
          this.sessionPlayCounted = true;
          const stats = this.getTrackStats(this.currentTrackId);
          stats.playCount += 1;
          stats.lastPlayedAt = Date.now();
          stats.updatedAt = Date.now();
          this._schedulePersist();
        }
      }
    }
    this.lastTick = now;
    if (this._audio && !this._audio.paused) {
      this.rafId = requestAnimationFrame(this._boundTick);
    } else {
      this.rafId = null;
    }
  }

  _onPlay() {
    if (!this.currentTrackId) return;
    if (this.sessionStart == null) {
      this._startSession();
    } else {
      this.lastTick = performance.now();
      this.lastAudioTime = this._audio?.currentTime || 0;
      this._startTick();
    }
  }

  _onPause() {
    if (!this.currentTrackId) return;
    this._finalizeSessionInterval();
    this._stopTick();
  }

  _onSeeked() {
    if (!this.currentTrackId || !this._audio) return;
    this.lastAudioTime = this._audio.currentTime || 0;
    this.lastTick = performance.now();
    if (!this._audio.paused) {
      this._startTick();
    }
  }

  _onEnded() {
    if (!this.currentTrackId) return;
    this._finalizeSession();
    this._stopTick();
  }

  _onTimeUpdate() {
    if (!this.currentTrackId || !this._audio) return;
    if (this.sessionStart == null && !this._audio.paused) {
      this._startSession();
    }
  }

  _finalizeSessionInterval() {
    if (!this.currentTrackId) return;
    if (this.sessionListened > 0) {
      const stats = this.getTrackStats(this.currentTrackId);
      stats.listenedSeconds = Math.round((stats.listenedSeconds || 0) + this.sessionListened);
      stats.lastPlayedAt = Date.now();
      stats.updatedAt = Date.now();
      if (!this.sessionPlayCounted && this.sessionAccumulated >= this.sessionThreshold) {
        stats.playCount += 1;
        this.sessionPlayCounted = true;
      }
      stats.sessionAccumulated = this.sessionAccumulated;
      stats.sessionPlayCounted = this.sessionPlayCounted;
      this._schedulePersist();
    }
    this.sessionListened = 0;
    this.lastTick = null;
  }

  _finalizeSession() {
    this._finalizeSessionInterval();
    this.sessionStart = null;
    this.sessionAccumulated = 0;
    this.sessionPlayCounted = false;
  }

  _schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      setStorage(this.stats);
    }, PERSIST_DEBOUNCE_MS);
  }

  forcePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._finalizeSession();
    setStorage(this.stats);
  }

  reset() {
    this.stats = {};
    setStorage(this.stats);
  }
}

export const listeningTracker = new ListeningTracker();
