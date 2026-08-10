import React, { memo } from 'react';
import { formatBytes as formatSize } from '../utils/format.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

const TYPE_COLORS = {
  '.flac': 'text-yellow-400 bg-yellow-500/15',
  '.mp3': 'text-purple-400 bg-purple-500/15',
  '.m4a': 'text-pink-400 bg-pink-500/15',
  '.opus': 'text-slate-300 bg-slate-500/15',
  '.aac': 'text-green-400 bg-green-500/15',
  '.wav': 'text-cyan-400 bg-cyan-500/15',
};

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

const LIST_ROW_STYLE = `
  .playlist-list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid ${COLORS.border.primary};
    cursor: pointer;
    transition: background 0.15s ease, opacity 0.18s ease;
  }
  .playlist-list-row:hover {
    background: ${COLORS.border.primary}40 !important;
  }
  .playlist-list-row.selected {
    background: ${COLORS.accent}15 !important;
    box-shadow: inset 0 0 0 1.5px ${COLORS.accent} !important;
  }
  .playlist-list-row.not-exists {
    cursor: default;
  }
  .playlist-list-row.row-enter {
    animation: playlistRowIn 0.25s ease;
  }
  @keyframes playlistRowIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .playlist-list-row .trash-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  .playlist-list-row:hover .trash-btn {
    opacity: 1;
    pointer-events: auto;
  }
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = LIST_ROW_STYLE;
  document.head.appendChild(s);
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ThumbImg = memo(function ThumbImg({ fileId, colorClass, size = 48 }) {
  const src = fileId ? `${API_BASE}/thumbnails/${fileId}.jpg` : null;
  if (!src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, background: colorClass,
      }}>
        <svg style={{ width: 24, height: 24 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{
        width: size, height: size, borderRadius: '8px',
        objectFit: 'cover', flexShrink: 0,
      }}
      onError={(e) => {
        e.target.style.display = 'none';
        if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
      }}
    >
    </img>
  );
});

const PlaylistListRow = memo(({ index, style, data }) => {
  const { tracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, itemSize, onSelect, onRemove } = data;
  const track = tracks[index];
  if (!track) return null;

  const ext = track.resolved_path ? track.resolved_path.split('.').pop()?.toLowerCase() : '';
  const extLabel = ext.toUpperCase();
  const isSelected = selectedForDelete?.has(track.id);
  const isDeleting = deletingTrackIds?.has(track.id);
  const trackId = track.id ?? track.file_id;
  const isLeaving = leavingTrackIds?.has(trackId);
  const shift = shiftAbove?.get(trackId) || 0;
  const isEntering = enteringTrackIds?.has(trackId);

  const rowClass = `playlist-list-row${isSelected ? ' selected' : ''}${!track.exists ? ' not-exists' : ''}${isEntering ? ' row-enter' : ''}`;

  return (
    <div
      style={{
        ...style,
        ...(isDeleting ? { opacity: 0.4, pointerEvents: 'none' } : {}),
        ...(isLeaving ? { opacity: 0 } : {}),
        ...(shift > 0 ? { transform: `translateY(${-shift * (itemSize || 64)}px)`, transition: 'transform 200ms ease' } : {}),
      }}
      className={rowClass}
      onClick={() => onSelect?.(track, index)}
    >
      <div style={{
        width: 32, flexShrink: 0, textAlign: 'right',
        fontSize: '13px', fontWeight: 700, color: COLORS.text.secondary,
        fontVariantNumeric: 'tabular-nums', userSelect: 'none',
      }}>
        {index + 1}
      </div>
      <div style={{
        width: 48, height: 48, borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, overflow: 'hidden', background: '#262626',
      }}>
        {track.file_id ? (
          <img
            src={`${API_BASE}/thumbnails/${track.file_id}.jpg`}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <svg style={{ width: 24, height: 24, color: '#737373' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{
          margin: 0, fontSize: '13px', fontWeight: 500,
          color: track.exists ? COLORS.text.primary : COLORS.text.secondary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {track.display_name}
        </h4>
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          {ext && (
            <span style={{
              fontSize: '10px', fontWeight: 600, padding: '2px 6px',
              borderRadius: '4px', background: 'rgba(100,150,200,0.2)',
              color: COLORS.text.tertiary,
            }}>
              {extLabel}
            </span>
          )}
          {track.size > 0 && (
            <span style={{ fontSize: '11px', color: COLORS.text.tertiary }}>
              {formatSize(track.size)}
            </span>
          )}
        </div>
      </div>
      {track.duration > 0 && (
        <div style={{ fontSize: '12px', color: COLORS.text.secondary, whiteSpace: 'nowrap' }}>
          {formatDuration(track.duration)}
        </div>
      )}
      {deleteMode ? (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect?.(track, index); }}
          style={{
            width: 20, height: 20, borderRadius: '4px',
            border: `1.5px solid ${isSelected ? '#ef4444' : COLORS.border.primary}`,
            background: isSelected ? '#ef4444' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'white', fontSize: '12px', fontWeight: 600,
          }}
        >
          {isSelected && '✓'}
        </button>
      ) : (
        <button
          className="trash-btn"
          onClick={(e) => { e.stopPropagation(); onRemove?.(track.id, e); }}
          style={{
            padding: '6px', borderRadius: '6px', border: 'none',
            background: 'transparent', color: COLORS.text.secondary,
            cursor: 'pointer', display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      )}
    </div>
  );
});

PlaylistListRow.displayName = 'PlaylistListRow';

export { injectStyles as injectPlaylistListRowStyles };
export default PlaylistListRow;
