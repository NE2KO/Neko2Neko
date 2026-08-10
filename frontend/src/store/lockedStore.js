import { create } from 'zustand';

// Single source of truth for item "lock" status (locks that prevent sending).
// Mirrors favoritesStore: components read useIsLocked(id, fallback) and toggle
// via the API which seeds this store so every surface re-renders in sync.
const useLockedStore = create((set) => ({
  // fileId -> 1 | 0
  map: {},
  set: (fileId, val) =>
    set((s) => ({ map: { ...s.map, [fileId]: val } })),
}));

// `fallback` is the prop-fed initial is_locked (so we don't need to reseed the
// store on every data load). Once the user toggles, the store entry wins.
export function useIsLocked(fileId, fallback = 0) {
  const v = useLockedStore((s) => s.map[fileId]);
  return (v == null ? fallback : v) === 1;
}

export default useLockedStore;
