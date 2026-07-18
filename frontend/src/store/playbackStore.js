import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const usePlaybackStore = create(
  persist(
    (set, get) => ({
      // Playback state
      queue: [],
      currentTrackIndex: 0,
      isPlaying: false,
      // Separate flag for the VAULT VIDEO player. Video and audio share one
      // control surface (MediaControls) but must NOT share `isPlaying` — if they
      // did, playing a vault video would flip the audio player's play state and
      // make the MiniPlayer (shared audio element) start a track on its own.
      videoPlaying: false,
      shuffle: false,
      loopMode: 'off',
      playerMode: 'full',
      position: 0,

      // Playlist mode
      hasPlaylist: false,
      playlistId: null,
      playlistTracks: [],
      activePlaybackId: null,

      // Shared audio element ref
      audioRef: null,

      // Actions
      setQueue: (queue, startIndex = 0) => set({
        queue,
        currentTrackIndex: startIndex,
        hasPlaylist: queue.length > 0,
        position: 0,
      }),

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      togglePlay: () => set(s => ({ isPlaying: !s.isPlaying })),

      setVideoPlaying: (v) => set({ videoPlaying: v }),

      setCurrentTrackIndex: (index) => set({ currentTrackIndex: index, position: 0 }),

      next: () => {
        const { queue, currentTrackIndex, loopMode, shuffle } = get();
        if (queue.length === 0) return;

        if (shuffle) {
          let nextIndex;
          do { nextIndex = Math.floor(Math.random() * queue.length); }
          while (nextIndex === currentTrackIndex && queue.length > 1);
          set({ currentTrackIndex: nextIndex, isPlaying: true, position: 0 });
          return;
        }

        if (loopMode === 'off' && currentTrackIndex === queue.length - 1) {
          set({ isPlaying: false });
          return;
        }

        const nextIndex = (currentTrackIndex + 1) % queue.length;
        set({ currentTrackIndex: nextIndex, isPlaying: true, position: 0 });
      },

      previous: () => {
        const { queue, currentTrackIndex, loopMode, shuffle } = get();
        if (queue.length === 0) return;

        if (shuffle) {
          let prevIndex;
          do { prevIndex = Math.floor(Math.random() * queue.length); }
          while (prevIndex === currentTrackIndex && queue.length > 1);
          set({ currentTrackIndex: prevIndex, isPlaying: true, position: 0 });
          return;
        }

        if (loopMode === 'off' && currentTrackIndex === 0) {
          set({ isPlaying: false });
          return;
        }

        const prevIndex = currentTrackIndex === 0 ? queue.length - 1 : currentTrackIndex - 1;
        set({ currentTrackIndex: prevIndex, isPlaying: true, position: 0 });
      },

      setActivePlaylist: (playlistId, playlist, tracks) => set({
        playlistId,
        playlistTracks: tracks || [],
        hasPlaylist: true,
      }),

      clearPlayback: () => set({
        queue: [],
        currentTrackIndex: 0,
        isPlaying: false,
        hasPlaylist: false,
        playlistId: null,
        playlistTracks: [],
        activePlaybackId: null,
        playerMode: 'full',
        position: 0,
      }),

      setActiveFile: (fileId) => set({ activePlaybackId: fileId }),

      setShuffle: (shuffle) => set({ shuffle }),
      setLoopMode: (mode) => set({ loopMode: mode }),

      setPlayerMode: (mode) => set({ playerMode: mode }),
      setPosition: (position) => set({ position }),

      setAudioRef: (ref) => set({ audioRef: ref }),
    }),
    {
      name: 'playbackStore',
      partialize: (state) => ({
        shuffle: state.shuffle,
        loopMode: state.loopMode,
        playerMode: state.playerMode,
        // Persist the active track so a page reload reopens the last-played
        // track instead of resetting to the first one. (isPlaying is omitted
        // on purpose — browsers block autoplay without a user gesture.)
        queue: state.queue,
        currentTrackIndex: state.currentTrackIndex,
        activePlaybackId: state.activePlaybackId,
      }),
    }
  )
);

export default usePlaybackStore;
