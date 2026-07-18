import React, { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Music, X, Search, Heart } from 'lucide-react';
import usePlaybackStore from '../store/playbackStore';
import { useIsFavorite } from '../store/favoritesStore';

const API_BASE = import.meta.env.VITE_API_URL || '';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

const ITEM_HEIGHT = 52;
const BUFFER = 8;

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const QueueItem = memo(({ track, index, isActive, onSelect, onToggleFavorite }) => {
  const [imgError, setImgError] = useState(false);
  const fileId = track.file_id || track._file_id;
  const showImg = !!fileId && !imgError;
  const isFav = useIsFavorite(fileId || track.id, track.is_favorite ? 1 : 0);
  return (
    <div
      onClick={() => onSelect?.(index)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: '8px',
        background: isActive ? `${COLORS.accent}15` : 'transparent',
        borderLeft: isActive ? `3px solid ${COLORS.accent}` : '3px solid transparent',
        transition: 'background 0.15s ease',
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = `${COLORS.border.primary}40`;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '6px',
        overflow: 'hidden', flexShrink: 0, background: '#262626',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {showImg ? (
          <img
            src={`${API_BASE}/thumbnails/${fileId}.jpg`}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <Music style={{ width: 16, height: 16, color: '#737373' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: '12px', fontWeight: isActive ? 600 : 400,
          color: isActive ? COLORS.accent : COLORS.text.primary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {track.display_name || track.title || 'Unknown'}
        </p>
        <p style={{
          margin: '2px 0 0', fontSize: '10px', color: COLORS.text.tertiary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {track.artist || ''} {track.duration > 0 ? `· ${formatDuration(track.duration)}` : ''}
        </p>
      </div>
      {onToggleFavorite && (
        <span
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(track); }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }}
        >
          <Heart size={14} style={{ color: isFav ? '#ef4444' : COLORS.text.tertiary, fill: isFav ? '#ef4444' : 'none' }} />
        </span>
      )}
      {isActive && (
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.accent, flexShrink: 0 }} />
      )}
    </div>
  );
});
QueueItem.displayName = 'QueueItem';

export default function QueuePanel({ isOpen, onClose, tracks, currentTrackIndex, onTrackSelect, onFavoriteToggle }) {
  const { setCurrentTrackIndex, play } = usePlaybackStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleToggleFav = useCallback((track) => {
    onFavoriteToggle?.(track);
  }, [onFavoriteToggle]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const filteredTracks = useMemo(() => {
    if (!tracks || !query.trim()) return tracks || [];
    const q = query.toLowerCase();
    return tracks.filter((t) => {
      const name = (t.display_name || t.title || '').toLowerCase();
      const artist = (t.artist || '').toLowerCase();
      return name.includes(q) || artist.includes(q);
    });
  }, [tracks, query]);

  const indexMap = useMemo(() => {
    const map = new Map();
    if (tracks) {
      for (let i = 0; i < tracks.length; i++) {
        const key = tracks[i].file_id || tracks[i].id || i;
        map.set(key, i);
      }
    }
    return map;
  }, [tracks]);

  const totalHeight = filteredTracks.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const endIndex = Math.min(filteredTracks.length, Math.ceil((scrollTop + 800) / ITEM_HEIGHT) + BUFFER);
  const visibleTracks = filteredTracks.slice(startIndex, endIndex);

  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  useEffect(() => {
    if (!isOpen && listRef.current) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [isOpen]);

  // Auto-scroll to the currently playing track when the panel opens or the
  // active track changes. The list is virtualized by `scrollTop`, so setting
  // `scrollTop` fires onScroll → setScrollTop → the active row enters the
  // rendered window (no imperative scrollIntoView needed).
  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current;
    if (!el) return;
    if (!tracks || tracks.length === 0) return;
    const active = tracks[currentTrackIndex];
    if (!active) return;
    const activeId = active.file_id || active.id;
    const idx = filteredTracks.findIndex((t) => (t.file_id || t.id) === activeId);
    if (idx < 0) return; // active track hidden by search filter
    const target = Math.max(0, Math.min(
      idx * ITEM_HEIGHT - el.clientHeight / 2 + ITEM_HEIGHT / 2,
      el.scrollHeight - el.clientHeight,
    ));
    el.scrollTop = target;
    setScrollTop(target);
  }, [isOpen, currentTrackIndex, filteredTracks, tracks]);

  const handleSelect = (index) => {
    if (onTrackSelect) {
      onTrackSelect(index);
    } else {
      setCurrentTrackIndex(index);
      play();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div data-debug-id="5.2.5" data-debug-name="QueuePanel" data-debug-type="drawer" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: 340, maxWidth: '90vw', height: '100%',
        background: COLORS.bg.primary, borderLeft: `1px solid ${COLORS.border.primary}`,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px', borderBottom: `1px solid ${COLORS.border.primary}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: COLORS.text.primary }}>
              Now Playing
            </h3>
            <button
              onClick={onClose}
              style={{
                padding: '6px', borderRadius: '6px', border: 'none',
                background: 'transparent', color: COLORS.text.secondary,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
              }}
            >
              <X size={18} />
            </button>
          </div>
          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '8px',
            background: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}`,
          }}>
            <Search size={14} color={COLORS.text.tertiary} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tracks..."
              style={{
                flex: 1, border: 'none', background: 'transparent', outline: 'none',
                color: COLORS.text.primary, fontSize: '12px',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  padding: '2px', borderRadius: '4px', border: 'none',
                  background: 'transparent', color: COLORS.text.tertiary,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Track list — virtualized */}
        <div ref={listRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
          {filteredTracks.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: COLORS.text.secondary,
            }}>
              <Music size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
              <p style={{ margin: 0, fontSize: '12px' }}>
                {query ? 'No matches' : 'No tracks in queue'}
              </p>
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              {visibleTracks.map((track, vi) => {
                const realIndex = startIndex + vi;
                const key = track.file_id || track.id || realIndex;
                const origIndex = indexMap.get(key);
                return (
                  <div key={key} style={{ position: 'absolute', top: realIndex * ITEM_HEIGHT, left: 0, right: 0 }}>
                    <QueueItem
                      track={track}
                      index={origIndex}
                      isActive={origIndex === currentTrackIndex}
                      onSelect={handleSelect}
                      onToggleFavorite={handleToggleFav}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {tracks && tracks.length > 0 && (
          <div style={{
            padding: '12px 16px', borderTop: `1px solid ${COLORS.border.primary}`,
            fontSize: '10px', color: COLORS.text.tertiary, flexShrink: 0,
          }}>
            Track {currentTrackIndex + 1} of {tracks.length}
          </div>
        )}
      </div>
    </div>
  );
}
