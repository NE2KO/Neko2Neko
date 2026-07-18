import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Type } from 'lucide-react';

export default function CaptionEditorModal({ open, caption = '', onSave, onClose }) {
  const [draft, setDraft] = useState(caption);
  const inputRef = useRef(null);

  useEffect(() => {
    setDraft(caption);
  }, [caption, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = draft.trim();
  const changed = trimmed !== caption;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        className="relative bg-[#111418] border border-[#2a3040] rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Type size={16} className="text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-neutral-200">Edit Caption</h3>
            <p className="text-[10px] text-neutral-500 mt-0.5">Teks yang dikirim bersama media</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Input area */}
        <div className="px-5 pb-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 1024))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (changed) onSave(trimmed);
                onClose();
              }
            }}
            rows={3}
            className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-200 outline-none resize-none placeholder:text-neutral-600 focus:border-cyan-500/50 transition-colors"
            placeholder="Tulis caption di sini..."
            maxLength={1024}
          />
          <div className="flex items-center justify-between mt-2 px-0.5">
            <span className="text-[10px] text-neutral-600">
              Shift+Enter untuk baris baru
            </span>
            <span className={`text-[10px] tabular-nums ${draft.length > 900 ? 'text-amber-400' : 'text-neutral-600'}`}>
              {draft.length}/1024
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-neutral-400 bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={() => { onSave(trimmed); onClose(); }}
            disabled={!changed}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Check size={12} strokeWidth={3} />
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
