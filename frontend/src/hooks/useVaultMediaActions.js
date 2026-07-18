import { useCallback } from 'react';
import { useIsFavorite } from '../store/favoritesStore';
import { useSendProgress } from './useSendProgress';
import { useWaUnsupported } from './useWaUnsupported';
import { sendToTelegram, sendToChannel, sendToStatus, sendToAll } from '../utils/api';

// Shared favorite + send + progress logic for the Media Vault surfaces
// (the persistent bottom cluster AND the standalone players). Centralizes the
// send API calls + favorite toggle so every surface behaves identically.
export function useVaultMediaActions(file, onToggleFavorite) {
  const isFav = useIsFavorite(file?.id, file?.is_favorite ? 1 : 0);
  const waUnsupported = useWaUnsupported(file);
  const { progress, start: startProgress } = useSendProgress();

  const handleToggleFavorite = useCallback(async () => {
    if (!file?.id || !onToggleFavorite) return;
    try { await onToggleFavorite(file); } catch {}
  }, [file, onToggleFavorite]);

  const handleSend = useCallback(async (target) => {
    if (!file?.id) return;
    let res;
    try {
      if (target === 'telegram') res = await sendToTelegram(file.id);
      else if (target === 'channel') res = await sendToChannel(file.id);
      else if (target === 'status') res = await sendToStatus(file.id);
      else if (target === 'all') res = await sendToAll(file.id);
      if (res && res.qid) startProgress(res.qid, target);
    } catch {}
  }, [file?.id, startProgress]);

  return { isFav, waUnsupported, progress, startProgress, handleToggleFavorite, handleSend };
}
