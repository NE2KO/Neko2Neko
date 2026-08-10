import React from 'react';
import { Heart } from 'lucide-react';
import WaLogo from './icons/WaLogo';

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
  isFileQueued = false,
  isFileSent = false,
  isFileLocked = false,
}) {
  const sendBtn =
    "flex items-center gap-1.5 px-2.5 py-2 rounded-full border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed";
  const blocked = waUnsupported || isFileQueued || isFileSent || isFileLocked;
  const sendTitle = isFileLocked
    ? 'Item terkunci — buka kunci dulu untuk mengirim'
    : isFileQueued
      ? 'Sudah dalam antrian'
      : isFileSent
        ? 'Sudah pernah dikirim'
        : waUnsupported
          ? 'Codec tidak didukung WhatsApp (bukan H.264)'
          : 'Kirim ke WhatsApp Status';
  const sendLabel = isFileLocked ? 'Terkunci' : isFileQueued ? 'Antri' : isFileSent ? 'Terkirim' : 'Status';
  return (
    <div className={`flex items-center justify-center gap-2 sm:gap-3 py-3 ${floating ? 'border-t border-transparent bg-transparent' : 'border-t border-white/5 bg-neutral-950/80'}`}>
      {!hideLove && (
        <button
          onClick={() => onToggleFavorite && onToggleFavorite()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-neutral-800/60 border border-neutral-700/40 text-neutral-300 hover:bg-neutral-700/60 hover:text-white transition-all active:scale-95 focus:outline-none focus:ring-0"
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={16} className={isFav ? 'text-red-500 fill-red-500' : ''} />
          <span className="text-xs font-medium">{isFav ? 'Favorited' : 'Love'}</span>
        </button>
      )}

      <button
        onClick={() => onSend && onSend('status')}
        disabled={blocked}
        className={`${sendBtn} ${blocked ? 'bg-neutral-800/50 border-neutral-700/30 text-neutral-500 cursor-not-allowed' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'} focus:outline-none focus:ring-0`}
        title={sendTitle}
      >
        <WaLogo size={16} />
        <span className="text-[11px] font-medium">{sendLabel}</span>
      </button>
    </div>
  );
}
