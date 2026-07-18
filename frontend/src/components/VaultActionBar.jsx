import React from 'react';
import { Heart, Share2 } from 'lucide-react';
import WaLogo from './icons/WaLogo';
import TelegramLogo from './icons/TelegramLogo';

// Shared action bar for the Media Vault players (video + image).
// Kept consistent so every vault surface shows Love + Send the same way.
// Audio keeps its Love button in the header (top) per the design split.
export default function VaultActionBar({
  file,
  isFav,
  onToggleFavorite,
  onSend,
  waUnsupported,
  hideLove = false,
  floating = false,
}) {
  const sendBtn =
    "flex items-center gap-1.5 px-2.5 py-2 rounded-full border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className={`flex items-center justify-center gap-2 sm:gap-3 py-3 ${floating ? 'border-t border-transparent bg-transparent' : 'border-t border-white/5 bg-neutral-950/80'}`}>
      {!hideLove && (
        <button
          onClick={() => onToggleFavorite && onToggleFavorite()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-neutral-800/60 border border-neutral-700/40 text-neutral-300 hover:bg-neutral-700/60 hover:text-white transition-all active:scale-95"
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={16} className={isFav ? 'text-red-500 fill-red-500' : ''} />
          <span className="text-xs font-medium">{isFav ? 'Favorited' : 'Love'}</span>
        </button>
      )}

      <button
        onClick={() => onSend && onSend('telegram')}
        className={`${sendBtn} bg-[#0088cc]/15 border-[#0088cc]/40 text-[#29a9ea] hover:bg-[#0088cc]/25`}
        title="Kirim ke Telegram"
      >
        <TelegramLogo size={16} />
        <span className="text-[11px] font-medium">Ke Tele</span>
      </button>

      <button
        onClick={() => onSend && onSend('channel')}
        disabled={waUnsupported}
        className={`${sendBtn} bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20`}
        title="Kirim ke WhatsApp Channel"
      >
        <WaLogo size={16} />
        <span className="text-[11px] font-medium">Channel</span>
      </button>

      <button
        onClick={() => onSend && onSend('status')}
        disabled={waUnsupported}
        className={`${sendBtn} bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20`}
        title="Kirim ke WhatsApp Status"
      >
        <WaLogo size={16} />
        <span className="text-[11px] font-medium">Status</span>
      </button>

      <button
        onClick={() => onSend && onSend('all')}
        className={`${sendBtn} bg-neutral-800/60 border-neutral-700/40 text-neutral-300 hover:bg-neutral-700/60 hover:text-white`}
        title="Kirim ke semua target"
      >
        <Share2 size={16} />
        <span className="text-[11px] font-medium">Semua</span>
      </button>
    </div>
  );
}
