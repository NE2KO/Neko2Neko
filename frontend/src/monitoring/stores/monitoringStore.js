import { create } from 'zustand';
import { persist } from 'zustand/middleware';

let lastStatsUpdate = 0;
const STATS_THROTTLE_MS = 1000;

const useMonitoringStore = create(
  persist(
    (set) => ({
      stats: null,
      connected: false,
      lastUpdated: null,
      alertCount: 0,

      refreshIntervalMs: 1000,
      smoothEnabled: true,
      smoothMs: 900,

      setStats: (stats) => {
        const now = Date.now();
        if (now - lastStatsUpdate < STATS_THROTTLE_MS) return;
        lastStatsUpdate = now;
        set({ stats, lastUpdated: now });
      },
      setConnected: (connected) => set({ connected }),
      setAlertCount: (alertCount) => set({ alertCount }),

      applyRuntimeSetting: (key, value) => {
        if (key === 'monitor.refreshInterval') {
          const ms = Math.max(250, Math.min(Number(value) || 1000, 60000));
          set({ refreshIntervalMs: ms });
        }
        if (key === 'monitor.uiSmooth') {
          set({ smoothEnabled: Boolean(value) });
        }
        if (key === 'monitor.uiSmoothMs') {
          const ms = Math.max(0, Math.min(Number(value) || 0, 5000));
          set({ smoothMs: ms });
        }
      },
    }),
    {
      name: 'mediavault-monitoring',
      version: 1,
      partialize: (state) => ({
        stats: state.stats,
        refreshIntervalMs: state.refreshIntervalMs,
        smoothEnabled: state.smoothEnabled,
        smoothMs: state.smoothMs,
      }),
    }
  )
);

export default useMonitoringStore;
