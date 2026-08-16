import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { VariableSizeList as List, FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Music, Trash2, Plus, Upload, X, Check, ChevronDown, Shuffle, Heart, Image as ImageIcon, ListMusic, Play, Search, SlidersHorizontal, Grid, ArrowLeft, ChevronLeft } from 'lucide-react';
import usePlaylistStore from '../store/playlistStore';
import usePlaybackStore from '../store/playbackStore';
import { loadPlaylists, loadPlaylist, getPlaylistQueue, refreshPlaylists, importXSPFPlaylist, createEmptyPlaylist, removeTrackFromPlaylist, bulkRemoveTracksFromPlaylist, loadFavorites, uploadPlaylistCover, playlistImageUrl } from '../utils/playlistApi';
import { deletePlaylist } from '../utils/api';
import { buildPlayableQueue, resolveClickedIndex } from '../utils/playlistQueue';
import { LOVED_PLAYLIST_ID } from '../utils/routeParser';
import { useToast } from './Toast';
import NetworkImage from './NetworkImage';
import PlaylistGrid from './PlaylistGrid';
import PlaylistRow from './PlaylistRow';
import ServiceStoppedBanner from './ServiceStoppedBanner';
import PlaylistListRow, { injectPlaylistListRowStyles } from './PlaylistListRow';
import PlaylistListItemRow, { injectPlaylistListItemRowStyles } from './PlaylistListItemRow';
import AddMusicPanel from './AddMusicPanel';
import FilterPanel from './FilterPanel';
import { PlaylistListHeader, PlaylistDetailHeader } from './HeaderComponents';
import { listeningTracker, formatDuration as formatListeningDuration } from '../utils/listeningTracker.js';


import './PlaylistView.css';

injectPlaylistListRowStyles();
injectPlaylistListItemRowStyles();

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
  bg: {
    primary: '#0a0a0a',
    secondary: '#171717',
    tertiary: '#0a0a0a',
  },
  border: {
    primary: '#262626',
    secondary: '#404040',
  },
  text: {
    primary: '#e5e5e5',
    secondary: '#a3a3a3',
    tertiary: '#737373',
  },
  accent: '#0ea5e9',
};

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;
const QUEUE_ITEM_HEIGHT = 46;

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTotalDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} jam ${m} menit`;
  if (m > 0) return `${m} menit ${sec} detik`;
  return `${sec} detik`;
}

// Lazily resolve a track's real duration by probing the audio stream metadata.
// Used as a fallback when the DB has no duration for a file. Only the metadata
// is fetched (preload='metadata'), so we don't download the whole file.
function loadAudioDuration(fileId) {
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = `${API_BASE}/file/${fileId}`;
      let settled = false;
      const finish = (d) => {
        if (settled) return;
        settled = true;
        audio.removeAttribute('src');
        audio.load();
        resolve(d);
      };
      audio.addEventListener('loadedmetadata', () => {
        const d = audio.duration && isFinite(audio.duration) ? Math.round(audio.duration) : 0;
        finish(d);
      });
      audio.addEventListener('error', () => finish(0));
    } catch {
      resolve(0);
    }
  });
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ThumbImg = React.memo(function ThumbImg({ fileId, colorClass, size = 48 }) {
  const [src, setSrc] = useState(fileId ? `${API_BASE}/thumbnails/${fileId}.jpg` : null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(!fileId);
  const prevFileIdRef = useRef(fileId);

  useEffect(() => {
    if (fileId === prevFileIdRef.current) return;
    prevFileIdRef.current = fileId;
    if (fileId) {
      setSrc(`${API_BASE}/thumbnails/${fileId}.jpg`);
      setLoaded(false);
      setErr(false);
    } else {
      setSrc(null);
      setErr(true);
    }
  }, [fileId]);

  if (err || !src) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: colorClass,
      }}>
        <Music style={{ width: 24, height: 24 }} />
      </div>
    );
  }

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
      position: 'relative',
      background: '#262626',
    }}>
      {!loaded && <Music style={{ width: 24, height: 24, color: '#737373', position: 'absolute' }} />}
      <img src={src} alt="" style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: loaded ? 1 : 0,
      }}
        onLoad={() => setLoaded(true)} onError={() => setErr(true)} />
    </div>
  );
});

// ========== DROPDOWN MENU COMPONENT ==========
function DropdownMenu({ trigger, items, position = 'right' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          borderRadius: '8px',
          border: `1px solid ${COLORS.border.primary}`,
          background: COLORS.bg.secondary,
          color: COLORS.text.primary,
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = COLORS.border.secondary;
          e.currentTarget.style.background = COLORS.bg.primary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = COLORS.border.primary;
          e.currentTarget.style.background = COLORS.bg.secondary;
        }}
      >
        {trigger}
        <ChevronDown size={16} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          [position]: 0,
          top: '100%',
          marginTop: '4px',
          background: COLORS.bg.primary,
          border: `1px solid ${COLORS.border.primary}`,
          borderRadius: '8px',
          minWidth: '160px',
          zIndex: 50,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {items.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                item.onClick?.();
                setIsOpen(false);
              }}
              disabled={item.disabled}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: item.disabled ? COLORS.text.tertiary : (item.danger ? '#ef4444' : COLORS.text.primary),
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
                borderBottom: idx < items.length - 1 ? `1px solid ${COLORS.border.primary}` : 'none',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  e.currentTarget.style.background = COLORS.bg.secondary;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== SIDEBAR (playlists + Loved) ==========
function PlaylistSidebar({ playlists, favoritesCount, activeId, lovedActive, onSelect, onSelectLoved, onOpenLeaderboard }) {
  return (
    <div style={{
      width: 260,
      flexShrink: 0,
      borderRight: `1px solid ${COLORS.border.primary}`,
      background: COLORS.bg.secondary,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      <div style={{
        padding: '16px 16px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: COLORS.text.tertiary,
      }}>
        Playlist
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {playlists.map((p) => {
          const active = String(p.id) === String(activeId) && !lovedActive;
          const rawCover = playlistImageUrl(p);
          const cover = rawCover
            ? (rawCover.startsWith('/') && !rawCover.startsWith('//') ? `${API_BASE}${rawCover}` : rawCover)
            : null;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = COLORS.bg.primary; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                marginBottom: 2,
                background: active ? COLORS.bg.primary : 'transparent',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
                background: '#262626', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {cover
                  ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Music size={18} color="#737373" />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? COLORS.text.primary : COLORS.text.secondary,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.title}</div>
                <div style={{ fontSize: 11, color: COLORS.text.tertiary }}>{p.track_count ?? 0} lagu</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '8px', borderTop: `1px solid ${COLORS.border.primary}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={onOpenLeaderboard}
          onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.bg.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px',
            borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
            background: 'transparent', color: COLORS.text.secondary,
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0,
            background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Music size={18} color="#fff" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.text.secondary }}>Leaderboard</div>
            <div style={{ fontSize: 11, color: COLORS.text.tertiary }}>Your top tracks</div>
          </div>
        </button>
        <button
          onClick={onSelectLoved}
          onMouseEnter={(e) => { if (!lovedActive) e.currentTarget.style.background = COLORS.bg.primary; }}
          onMouseLeave={(e) => { if (!lovedActive) e.currentTarget.style.background = 'transparent'; }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px',
            borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
            background: lovedActive ? COLORS.bg.primary : 'transparent',
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0,
            background: 'linear-gradient(135deg,#4f46e5,#db2777)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Heart size={18} color="#fff" fill="#fff" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 13, fontWeight: lovedActive ? 600 : 500,
              color: lovedActive ? COLORS.text.primary : COLORS.text.secondary,
            }}>Loved</div>
            <div style={{ fontSize: 11, color: COLORS.text.tertiary }}>{favoritesCount} lagu</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ========== SPOTIFY-STYLE HERO HEADER ==========
const ctrlBtn = {
  height: 40, padding: '0 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13,
  transition: 'background .15s, border-color .15s',
};

function PlaylistHeroHeader({
  playlist, trackCount, totalDurationSeconds, onPlay, onShuffle, onCoverChange, isLoved,
  selectionMode, selectedCount, onEnterSelectMode, onSelectAll, onDeleteSelected, onCancelSelect,
  onFilter, filterType, onToggleView, displayMode, onAdd,
}) {
  const rawCover = isLoved ? null : playlistImageUrl(playlist);
  const cover = rawCover
    ? (rawCover.startsWith('/') && !rawCover.startsWith('//') ? `${API_BASE}${rawCover}` : rawCover)
    : null;
  const durationLabel = formatTotalDuration(totalDurationSeconds);
  return (
    <div style={{ position: 'relative', padding: '24px 24px 16px', background: 'transparent' }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{
          position: 'relative', width: 200, height: 200, flexShrink: 0, borderRadius: 8,
          overflow: 'hidden', background: '#262626', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {cover ? (
            <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }} />
          ) : isLoved ? (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#4f46e5,#db2777)' }}>
              <Heart size={72} color="#fff" fill="#fff" />
            </div>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Music size={64} color="#737373" />
            </div>
          )}
          {!isLoved && !selectionMode && (
            <button
              onClick={onCoverChange}
              title="Ubah cover"
              style={{
                position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ImageIcon size={16} />
            </button>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: COLORS.text.secondary,
          }}>{isLoved ? 'Loved' : 'Playlist'}</div>
          <h1 style={{
            margin: '8px 0 0', fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 800, color: '#fff',
            lineHeight: 1.1, wordBreak: 'break-word',
          }}>{playlist?.title || ''}</h1>
          <div style={{ marginTop: 10, fontSize: 14, color: COLORS.text.secondary }}>
            {trackCount} lagu • {durationLabel}
          </div>
        </div>
      </div>

      {!selectionMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            onClick={onPlay}
            title="Putar"
            style={{
              width: 56, height: 56, borderRadius: '50%', background: '#1db954', border: 'none',
              color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(29,185,84,0.4)',
            }}
          >
            <Play size={26} fill="#000" style={{ marginLeft: 3 }} />
          </button>
          <button
            onClick={onShuffle}
            title="Acak"
            style={{
              width: 48, height: 48, borderRadius: '50%', background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Shuffle size={20} />
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onFilter}
            title="Filter"
            style={{
              ...ctrlBtn,
              ...(filterType !== 'all' ? { borderColor: 'rgba(56,189,248,0.5)', color: '#38bdf8' } : {}),
            }}
          >
            <SlidersHorizontal size={16} />
            <span className="hidden md:inline">Filter</span>
          </button>
          <button
            onClick={onToggleView}
            title="Ubah tampilan"
            style={ctrlBtn}
          >
            {displayMode === 'grid' ? <Grid size={16} /> : <ListMusic size={16} />}
            <span className="hidden md:inline">{displayMode === 'grid' ? 'Grid' : 'List'}</span>
          </button>
          <button
            onClick={onAdd}
            title="Tambah musik"
            style={{ ...ctrlBtn, background: '#1db954', borderColor: '#1db954', color: '#000' }}
          >
            <Plus size={16} />
            <span className="hidden md:inline">Tambah</span>
          </button>
          <button
            onClick={onEnterSelectMode}
            title="Pilih untuk dihapus"
            style={ctrlBtn}
          >
            <Check size={16} />
            <span className="hidden md:inline">Pilih</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ========== VIRTUALIZED TRACK GRID (memoized) ==========
// Isolated + memoized so it does NOT re-render (and does NOT rebuild the row
// layout / itemData object) on every PlaylistView render. `rows`, `gridData`
// and `itemSize` are memoized so react-window's `PlaylistRow` memo actually
// holds across scrolls (previously a fresh gridData object every render forced
// every visible row+card to re-render → the "grid berat" jank).
const PlaylistTrackGridInner = React.memo(function PlaylistTrackGridInner({
  height, width, gridItems, onSelect, selectedForDelete, deletingTrackIds, selectMode, playingFileId, isPlayingActive, onProbeVisibleItems,
}) {
  const listRef = useRef(null);

  const { cols, IW, CH } = useMemo(() => {
    const effectiveWidth = Math.min(width || 0, CONTAINER_MAX);
    const iw = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effectiveWidth * 0.10)));
    const ch = iw + 44;
    const c = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((effectiveWidth - GUTTER) / (iw + GUTTER))));
    return { cols: c, IW: iw, CH: ch };
  }, [width]);

  const rows = useMemo(() => {
    const r = [];
    let currentRow = { items: [] };
    for (let i = 0; i < gridItems.length; i++) {
      currentRow.items.push(gridItems[i]);
      if (currentRow.items.length === cols) { r.push(currentRow); currentRow = { items: [] }; }
    }
    if (currentRow.items.length > 0) r.push(currentRow);
    return r;
  }, [gridItems, cols]);

  // FLIP slide: during the exit phase (some items marked _leaving) compute where
  // each remaining card will land after reflow, as a CSS transform delta. The
  // cards slide into place while the leaving ones fade, so the swap after 200ms
  // has no visible jump. Uses width/cols for exact horizontal (centered) offsets.
  const slideMap = useMemo(() => {
    if (!gridItems.some(it => it._leaving)) return null;
    const rowWidth = width || 0;
    const centerOffset = (c) => c <= 0 ? 0 : (rowWidth - (c * IW + (c - 1) * GUTTER)) / 2;
    const fullRowsOld = Math.floor(gridItems.length / cols);
    const lastCountOld = gridItems.length % cols === 0 ? cols : gridItems.length % cols;
    const leavingBefore = [];
    let removed = 0;
    for (let i = 0; i < gridItems.length; i++) {
      leavingBefore[i] = removed;
      if (gridItems[i]._leaving) removed++;
    }
    const remaining = gridItems.length - removed;
    const fullRowsNew = Math.floor(remaining / cols);
    const lastCountNew = remaining % cols === 0 ? cols : remaining % cols;
    const map = {};
    for (let i = 0; i < gridItems.length; i++) {
      const it = gridItems[i];
      if (it._leaving) continue;
      const oldRow = Math.floor(i / cols);
      const oldCol = i % cols;
      const oldCount = oldRow < fullRowsOld ? cols : lastCountOld;
      const newIndex = i - leavingBefore[i];
      const newRow = Math.floor(newIndex / cols);
      const newCol = newIndex % cols;
      const newCount = newRow < fullRowsNew ? cols : lastCountNew;
      const oldLeft = centerOffset(oldCount) + oldCol * (IW + GUTTER);
      const newLeft = centerOffset(newCount) + newCol * (IW + GUTTER);
      map[it._trackId] = {
        dx: Math.round(newLeft - oldLeft),
        dy: (newRow - oldRow) * (CH + GUTTER),
      };
    }
    return map;
  }, [gridItems, cols, IW, CH, width]);

  const gridData = useMemo(() => ({
    rows, onSelect, itemWidth: IW, cardHeight: CH, columnCount: cols, selectedForDelete, deletingTrackIds, selectMode, slideMap, playingFileId, isPlayingActive,
  }), [rows, onSelect, IW, CH, cols, selectedForDelete, deletingTrackIds, selectMode, slideMap, playingFileId, isPlayingActive]);

  const itemSize = useCallback(() => CH + GUTTER, [CH]);

  // Recompute cached row offsets when card height / column count changes (resize).
  useEffect(() => {
    listRef.current?.resetAfterIndex(0);
  }, [CH, cols]);

  if (!height || !width || height <= 0 || width <= 0) return null;
  const gridHeight = Math.max(0, height - GUTTER);
  return (
    <List
      ref={listRef}
      key="track-grid"
      height={gridHeight}
      width={width}
      itemCount={rows.length}
      itemSize={itemSize}
      overscanCount={3}
      itemData={gridData}
      onItemsRendered={({ overscanStartIndex, overscanStopIndex }) => {
        if (!onProbeVisibleItems) return;
        const ids = [];
        for (let r = overscanStartIndex; r <= overscanStopIndex && r < rows.length; r++) {
          for (const it of rows[r].items) {
            const id = it._file_id || it._track?.file_id || it._trackId;
            if (id) ids.push(id);
          }
        }
        onProbeVisibleItems(ids);
      }}
    >
      {PlaylistRow}
    </List>
  );
});

// ========== MAIN COMPONENT ==========
// ========== MAIN COMPONENT ==========
// ========== LEADERBOARD PANEL ==========
function LeaderboardPanel({ listeningLeaderboardMetric, onMetricChange, leaderboardDisplayMode, onDisplayModeChange, formatListeningDuration }) {
  const globalStats = listeningTracker.getGlobalStats();
  const activeSessionSeconds = listeningTracker.getActiveSessionSeconds();
  const currentTrackId = listeningTracker.getCurrentTrackId();
  const leaderboard = listeningTracker.getLeaderboard(listeningLeaderboardMetric, 10).map(entry => {
    if (entry.trackId === currentTrackId && activeSessionSeconds > 0) {
      return { ...entry, listenedSeconds: (entry.listenedSeconds || 0) + activeSessionSeconds };
    }
    return entry;
  });
  const displayTotalListened = globalStats.totalListenedSeconds + activeSessionSeconds;
  const isGrid = leaderboardDisplayMode === 'grid';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
        <button
          onClick={() => onMetricChange('plays')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, textAlign: 'center',
            background: listeningLeaderboardMetric === 'plays' ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: listeningLeaderboardMetric === 'plays' ? '#fff' : COLORS.text.tertiary,
          }}
        >
          MOST PLAYED
        </button>
        <button
          onClick={() => onMetricChange('listened')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 600, textAlign: 'center',
            background: listeningLeaderboardMetric === 'listened' ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: listeningLeaderboardMetric === 'listened' ? '#fff' : COLORS.text.tertiary,
          }}
        >
          MOST LISTENED
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, padding: '0 2px' }}>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plays</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{globalStats.totalPlayCount}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Time</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{formatListeningDuration(displayTotalListened)}</div>
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tracks</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{globalStats.uniqueTracks}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top 10</span>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: 2 }}>
          <button
            onClick={() => onDisplayModeChange('list')}
            style={{
              padding: '2px 6px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              background: leaderboardDisplayMode === 'list' ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: leaderboardDisplayMode === 'list' ? '#fff' : COLORS.text.tertiary,
            }}
          >
            <ListMusic size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
            List
          </button>
          <button
            onClick={() => onDisplayModeChange('grid')}
            style={{
              padding: '2px 6px', borderRadius: 4, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 600, textAlign: 'center',
              background: leaderboardDisplayMode === 'grid' ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: leaderboardDisplayMode === 'grid' ? '#fff' : COLORS.text.tertiary,
            }}
          >
            <Grid size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
            Grid
          </button>
        </div>
      </div>
      {leaderboard.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: COLORS.text.tertiary, fontSize: 12 }}>
          No listening history yet.
        </div>
      ) : isGrid ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }} className="sidebar-scroll">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 8 }}>
            {leaderboard.map((entry) => {
              const isActive = entry.trackId === currentTrackId;
              return (
                <div
                  key={entry.trackId}
                  style={{
                    borderRadius: 12,
                    background: '#171717',
                    border: `1px solid ${isActive ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'background 200ms ease, border-color 200ms ease, transform 200ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.14)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#171717';
                    e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ width: '100%', aspectRatio: '1/1', background: '#0a0a0a', overflow: 'hidden' }}>
                    {entry.trackId ? (
                      <NetworkImage src={`/thumbnails/${entry.trackId}.jpg`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Music size={20} color="#525252" />
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 12, color: COLORS.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{entry.displayName || entry.trackId}</div>
                    <div style={{ fontSize: 10, color: COLORS.text.tertiary }}>{formatListeningDuration(entry.listenedSeconds)}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#34d399' }}>{entry.playCount} plays</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {leaderboard.map((entry, idx) => {
            const isActive = entry.trackId === currentTrackId;
            return (
              <div
                key={entry.trackId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 12,
                  background: isActive ? 'rgba(52,211,153,0.08)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(52,211,153,0.18)' : 'transparent'}`,
                  cursor: 'pointer',
                  transition: 'background 200ms ease, border-color 200ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(52,211,153,0.08)' : 'transparent';
                  e.currentTarget.style.borderColor = isActive ? 'rgba(52,211,153,0.18)' : 'transparent';
                }}
              >
                <div style={{ width: 22, textAlign: 'center', fontSize: 12, fontWeight: 700, color: COLORS.text.tertiary, flexShrink: 0 }}>#{idx + 1}</div>
                <div style={{ width: 38, height: 38, borderRadius: 8, background: '#171717', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, overflow: 'hidden' }}>
                  {entry.trackId ? (
                    <NetworkImage src={`/thumbnails/${entry.trackId}.jpg`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Music size={14} color="#525252" />
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: COLORS.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{entry.displayName || entry.trackId}</div>
                  <div style={{ fontSize: 10, color: COLORS.text.tertiary, marginTop: 1 }}>{formatListeningDuration(entry.listenedSeconds)}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#34d399', whiteSpace: 'nowrap' }}>{entry.playCount} plays</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========== NOW PLAYING PANEL ==========
const QueueRow = React.memo(function QueueRow({ index, style, data }) {
  const t = data[index];
  const tFid = t.file_id || t.id;
  const tName = t.display_name || t.name || 'Unknown';
  const tArtist = t.artist || 'Unknown Artist';
  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', height: '100%' }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: '#262626', flexShrink: 0, overflow: 'hidden' }}>
          {tFid ? (
            <NetworkImage src={`/thumbnails/${tFid}.jpg`} alt="" className="w-full h-full object-cover" />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Music size={14} color="#525252" />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{tName}</div>
          <div style={{ fontSize: 12, color: '#737373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{tArtist}</div>
        </div>
      </div>
    </div>
  );
});

const NowPlayingPanel = React.memo(function NowPlayingPanel({ queue, currentTrackIndex }) {
  const currentTrack = queue && queue.length > 0 ? queue[currentTrackIndex] : null;
  const fid = currentTrack?.file_id || currentTrack?.id;
  const displayName = currentTrack?.display_name || currentTrack?.name || 'Memutar Audio...';
  const artist = currentTrack?.artist || 'Unknown Artist';
  const album = currentTrack?.album || '';
  const upcoming = useMemo(() => queue ? queue.slice(currentTrackIndex + 1) : [], [queue, currentTrackIndex]);
  const scrollRef = useRef(null);
  const [scrollH, setScrollH] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [upcoming.length]);

  if (!currentTrack) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: '#262626', marginBottom: 20, boxShadow: '0 10px 25px rgba(0,0,0,0.45)', flexShrink: 0 }}>
        {fid ? (
          <NetworkImage
            src={`/thumbnails/${fid}.jpg`}
            alt="Cover"
            className="w-full h-full object-cover"
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Music size={64} color="#525252" />
          </div>
        )}
      </div>
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.3, wordBreak: 'break-word' }}>{displayName}</h2>
        <p style={{ fontSize: 14, color: '#a3a3a3', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</p>
        {album && (
          <p style={{ fontSize: 13, color: '#737373', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{album}</p>
        )}
      </div>
      {upcoming.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Next in queue ({upcoming.length})</div>
          </div>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0 }} className="sidebar-scroll">
            {scrollH > 0 && (
              <FixedSizeList
                height={scrollH}
                width={scrollRef.current?.clientWidth || 300}
                itemSize={QUEUE_ITEM_HEIGHT}
                itemCount={upcoming.length}
                overscanCount={5}
                itemData={upcoming}
              >
                {QueueRow}
              </FixedSizeList>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default function PlaylistView({ onMenuOpen, onPlayPlaylist, onPlayTrack, onBackToPlaylistList, playerOpen = false }) {
  const { playlists, setPlaylists, setLoading, setError, loading,
    currentPlaylist, currentPlaylistTracks,
    setCurrentPlaylist, setCurrentPlaylistTracks, clearCurrentPlaylist, clearPlaylistDetail,
  } = usePlaylistStore();
  const { showToast } = useToast();
  const [selectedPlaylist, setSelectedPlaylist] = useState(() => {
    const savedId = sessionStorage.getItem('selectedPlaylistId');
    return savedId ? { id: savedId, title: '' } : null;
  });
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [viewMode, setViewMode] = useState(() => sessionStorage.getItem('selectedPlaylistId') ? 'detail' : 'list');
  const [displayMode, setDisplayMode] = useState(() => sessionStorage.getItem('playlistDisplayMode') || 'list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
   const [showAddMusicPanel, setShowAddMusicPanel] = useState(false);

  // Listening statistics
  const [listeningLeaderboardMetric, setListeningLeaderboardMetric] = useState(() => {
    try { return localStorage.getItem('listeningLeaderboardMetric') || 'plays'; } catch { return 'plays'; }
  });

  // Persist listening metric preference
  useEffect(() => {
    try { localStorage.setItem('listeningLeaderboardMetric', listeningLeaderboardMetric); } catch {}
  }, [listeningLeaderboardMetric]);

  // Sort/Filter states
  const PLAYLIST_SORT_OPTIONS = [
    { key: null, label: 'None', order: 'asc' },
    { key: 'name', label: 'Name', order: 'asc' },
    { key: 'created_at', label: 'Created', order: 'desc' },
  ];
  const TRACK_FILTER_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'is_favorite', label: 'Love' },
    { key: 'flac', label: 'FLAC' },
    { key: 'mp3', label: 'MP3' },
    { key: 'm4a', label: 'M4A' },
    { key: 'opus', label: 'OPUS' },
    { key: 'aac', label: 'AAC' },
    { key: 'wav', label: 'WAV' },
  ];
  const TRACK_SORT_OPTIONS = [
    { key: null, label: 'None', order: 'asc' },
    { key: 'track_num', label: 'Track #', order: 'asc' },
    { key: 'track_index', label: 'Added', order: 'asc' },
    { key: 'title', label: 'Title', order: 'asc' },
    { key: 'artist', label: 'Artist', order: 'asc' },
    { key: 'album', label: 'Album', order: 'asc' },
    { key: 'duration', label: 'Duration', order: 'desc' },
    { key: 'created_at', label: 'Created', order: 'desc' },
    { key: 'mtime', label: 'Modified', order: 'desc' },
    { key: 'size', label: 'Size', order: 'desc' },
  ];
  const [playlistSort, setPlaylistSort] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('playlistSort')); return s || { by: 'name', order: 'asc' }; } catch { return { by: 'name', order: 'asc' }; }
  });
  const [trackSort, setTrackSort] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('trackSort')); return s || { by: 'track_num', order: 'asc' }; } catch { return { by: 'track_num', order: 'asc' }; }
  });
  const [trackFilterType, setTrackFilterType] = useState(() => {
    try { return localStorage.getItem('trackFilterType') || 'all'; } catch { return 'all'; }
  });
   const [trackSearchQuery, setTrackSearchQuery] = useState(() => {
     try { return localStorage.getItem('trackSearchQuery') || ''; } catch { return ''; }
   });
   useEffect(() => {
     try { localStorage.setItem('trackSearchQuery', trackSearchQuery); } catch {}
   }, [trackSearchQuery]);
   const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterPanelType, setFilterPanelType] = useState('playlist');

  // Delete mode states
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(new Set());
  const [selectAllForDelete, setSelectAllForDelete] = useState(false);
  const [deletingTrackIds, setDeletingTrackIds] = useState(new Set());
  const [playlistDeleteMode, setPlaylistDeleteMode] = useState(false);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, playlistId: null });

  const fileInputRef = useRef(null);
  const restoreAttemptedRef = useRef(false);
  const playAllGuardRef = useRef(false);
  const playTrackGuardRef = useRef(false);
  const cachedPlaylistRef = useRef(null);
  const cachedTracksRef = useRef(null);
  const cachedPlaylistIdRef = useRef(null);
  const gridColsRef = useRef(0);

  // ---- Spotify-style layout state ----
  const mainRowRef = useRef(null);
  const coverInputRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [showLoved, setShowLoved] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [lovedLoading, setLovedLoading] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarMode, setRightSidebarMode] = useState('nowplaying');
  const [leaderboardDisplayMode, setLeaderboardDisplayMode] = useState('list');
  const [leaderboardTick, setLeaderboardTick] = useState(0);
  const showSidebar = containerWidth >= 760;

  // Force leaderboard re-render every second while open so stats update live.
  useEffect(() => {
    if (!rightSidebarOpen || rightSidebarMode !== 'leaderboard') return;
    const id = setInterval(() => setLeaderboardTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [rightSidebarOpen, rightSidebarMode]);

  // Width of the detail content area (used so the track list can be virtualized
  // while the whole detail view — hero + toolbar + list — scrolls as one tab).
  const detailScrollRef = useRef(null);
  const [detailWidth, setDetailWidth] = useState(0);
  useEffect(() => {
    const el = detailScrollRef.current;
    if (!el) return;
    const update = () => setDetailWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedPlaylist]);

  // Persist displayMode
  useEffect(() => {
    sessionStorage.setItem('playlistDisplayMode', displayMode);
  }, [displayMode]);

  // Reset leaderboard data once per session (early stage, start fresh)
  useEffect(() => {
    try {
      if (sessionStorage.getItem('leaderboardReset')) return;
      const raw = localStorage.getItem('listeningStats');
      if (raw) {
        localStorage.removeItem('listeningStats');
        listeningTracker.reset();
      }
      sessionStorage.setItem('leaderboardReset', '1');
    } catch {}
  }, []);

  // Persist sort state
  useEffect(() => {
    localStorage.setItem('playlistSort', JSON.stringify(playlistSort));
  }, [playlistSort]);
  useEffect(() => {
    localStorage.setItem('trackSort', JSON.stringify(trackSort));
  }, [trackSort]);
  useEffect(() => {
    if (trackFilterType) localStorage.setItem('trackFilterType', trackFilterType);
  }, [trackFilterType]);

  async function handleImportXSPF(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      await importXSPFPlaylist(file);
      showToast('Playlist imported successfully', 'success');
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCreateManualPlaylist() {
    if (!createTitle.trim()) return;
    setIsCreating(true);
    try {
      const result = await createEmptyPlaylist(createTitle.trim());
      showToast('Playlist created successfully', 'success');
      setShowCreateModal(false);
      setCreateTitle('');
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
      if (result.id) {
        handleSelectPlaylist({ id: result.id, title: createTitle.trim() });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }

  // Restore playlist detail — Bug #9: validate URL hash before restoring
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const savedId = sessionStorage.getItem('selectedPlaylistId');

    // Validate URL hash: only restore if URL explicitly targets this playlist
    const hash = window.location.hash;
    const playlistMatch = hash.match(/\/playlists\/(loved|\d+)/);
    const hashId = playlistMatch ? playlistMatch[1] : null;

    // PlaylistView is also mounted (hidden, display:none) behind the full audio
    // player. Don't run restoration there: it would corrupt the audio URL
    // (selectLoved() rewrites it to #/playlists/loved) and re-trigger playlist
    // loads, leaving the playlist stuck on its spinner when you return to the
    // mini player. We only restore when the URL is actually a playlists route.
    // Defensively clear any loading flags before bailing: because PlaylistView
    // is remounted (via the key swap in App.jsx) with the audio URL still in the
    // hash, the spinner would otherwise never be cleared and stay stuck.
    if (/\/audio\//.test(hash)) {
      setLoadingTracks(false);
      setLovedLoading(false);
      return;
    }

    // Loved is a virtual (favorites) playlist, not a server-side one. Restore it
    // from favorites instead of calling the playlist API (which would 404 on id
    // 'loved'). This handles both a stored selection and a deep link to
    // #/playlists/loved.
    if (savedId === LOVED_PLAYLIST_ID || hashId === LOVED_PLAYLIST_ID) {
      setViewMode('detail');
      selectLoved();
      return;
    }

    if (!savedId) return;

    if (!hashId || String(hashId) !== String(savedId)) {
      // If URL has no /playlists/ segment (e.g. audio URL), we're rendered in
      // background — leave selectedPlaylistId alone so it survives for later.
      if (hashId === null) return;
      // URL targets a different playlist — clear stale state and stay on list view
      sessionStorage.removeItem('selectedPlaylistId');
      clearPlaylistDetail();
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      setViewMode('list');
      return;
    }

    setViewMode('detail');

    const cached = cachedPlaylistRef.current;
    if (cached && String(cached.id) === String(savedId)) {
      setSelectedPlaylist(cached);
      setCurrentPlaylist(cached);
      if (cachedTracksRef.current) {
        setPlaylistTracks(cachedTracksRef.current);
        setCurrentPlaylistTracks(cachedTracksRef.current);
        resolveMissingDurations(cachedTracksRef.current);
      } else {
        setLoadingTracks(true);
        loadPlaylist(savedId).then(data => {
          cachedTracksRef.current = data.tracks || [];
          setPlaylistTracks(data.tracks || []);
          setCurrentPlaylistTracks(data.tracks || []);
          resolveMissingDurations(data.tracks || []);
        }).catch(() => {}).finally(() => setLoadingTracks(false));
      }
      return;
    }

    setLoadingTracks(true);
    loadPlaylist(savedId).then(data => {
      cachedPlaylistRef.current = data;
      cachedTracksRef.current = data.tracks || [];
      setSelectedPlaylist(data);
      setCurrentPlaylist(data);
      setPlaylistTracks(data.tracks || []);
      setCurrentPlaylistTracks(data.tracks || []);
      resolveMissingDurations(data.tracks || []);
    }).catch(() => {
      sessionStorage.removeItem('selectedPlaylistId');
      clearPlaylistDetail();
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      setViewMode('list');
    }).finally(() => setLoadingTracks(false));
  }, [viewMode, clearPlaylistDetail]);

  useEffect(() => {
    loadPlaylists().then(data => {
      setPlaylists(data.playlists || []);
    }).catch(() => {});
  }, []);

  // Track available width so the left sidebar only shows when the tab is wide enough.
  useEffect(() => {
    const el = mainRowRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load loved tracks once for the sidebar count (and reuse when Loved is opened).
  const refreshFavorites = useCallback(() => {
    loadFavorites().then(setFavorites).catch(() => {});
  }, []);
  useEffect(() => { refreshFavorites(); }, [refreshFavorites]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshPlaylists();
      const data = await loadPlaylists();
      setPlaylists(data.playlists || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setPlaylists, setError]);

  const handleSelectPlaylist = useCallback((playlist) => {
    cachedPlaylistRef.current = playlist;
    sessionStorage.setItem('selectedPlaylistId', playlist.id);
    setSelectedPlaylist(playlist);
    setCurrentPlaylist(playlist);
    setViewMode('detail');
    const url = `#/playlists/${playlist.id}`;
    if (window.location.hash !== url) {
      window.history.pushState({}, '', url);
    }
    // Reuse cached tracks for an instant open (mirrors how the Loved section is
    // instant because its favorites are already cached). Refresh in the
    // background so the list still stays fresh.
    const cached = cachedPlaylistIdRef.current === playlist.id ? cachedTracksRef.current : null;
    if (cached && cached.length > 0) {
      setPlaylistTracks(cached);
      setCurrentPlaylistTracks(cached);
      setLoadingTracks(false);
      resolveMissingDurations(cached);
      loadPlaylist(playlist.id).then(data => {
        const tracks = data.tracks || [];
        cachedTracksRef.current = tracks;
        cachedPlaylistIdRef.current = playlist.id;
        setPlaylistTracks(tracks);
        setCurrentPlaylistTracks(tracks);
        resolveMissingDurations(tracks);
      }).catch(() => {});
      return;
    }
    // Clear tracks immediately so stale data doesn't leak into queue
    cachedTracksRef.current = null;
    cachedPlaylistIdRef.current = null;
    setPlaylistTracks([]);
    setCurrentPlaylistTracks([]);
    setLoadingTracks(true);
    loadPlaylist(playlist.id).then(data => {
      const tracks = data.tracks || [];
      cachedTracksRef.current = tracks;
      cachedPlaylistIdRef.current = playlist.id;
      setPlaylistTracks(tracks);
      setCurrentPlaylistTracks(tracks);
      resolveMissingDurations(tracks);
    }).catch(err => {
      console.error('Failed to load playlist:', err);
      setPlaylistTracks([]);
      setCurrentPlaylistTracks([]);
    }).finally(() => setLoadingTracks(false));
  }, [setCurrentPlaylist, setCurrentPlaylistTracks]);

  const handleBackToList = useCallback(() => {
    sessionStorage.removeItem('selectedPlaylistId');
    cachedPlaylistRef.current = null;
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setShowLoved(false);
    clearCurrentPlaylist();
    setViewMode('list');
    onBackToPlaylistList?.();
    const url = '#/playlists';
    if (window.location.hash !== url) {
      window.history.pushState({}, '', url);
    }
  }, [clearCurrentPlaylist, onBackToPlaylistList]);

  const selectLoved = useCallback(async () => {
    setShowLoved(true);
    setLovedLoading(true);
    setSelectedPlaylist({ id: 'loved', title: 'Loved', isLoved: true, image: null, track_count: favorites.length });
    sessionStorage.setItem('selectedPlaylistId', LOVED_PLAYLIST_ID);
    if (window.location.hash !== '#/playlists/loved') {
      window.history.pushState({ view: 'playlists', playlistId: LOVED_PLAYLIST_ID }, '', '#/playlists/loved');
    }
    try {
      const favs = await loadFavorites();
      setFavorites(favs);
      cachedTracksRef.current = favs;
      setPlaylistTracks(favs);
      setCurrentPlaylistTracks(favs);
      resolveMissingDurations(favs);
      setSelectedPlaylist({ id: 'loved', title: 'Loved', isLoved: true, image: null, track_count: favs.length });
    } catch {
      showToast('Gagal memuat musik yang disukai', 'error');
    } finally {
      setLovedLoading(false);
    }
  }, [favorites, setCurrentPlaylistTracks, showToast]);

  const handleCoverFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !selectedPlaylist || selectedPlaylist.isLoved) return;
    try {
      const image = await uploadPlaylistCover(selectedPlaylist.id, file);
      setSelectedPlaylist(prev => prev ? { ...prev, image } : prev);
      setCurrentPlaylist(prev => prev ? { ...prev, image } : prev);
      setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, image } : p));
      cachedPlaylistRef.current = { ...(cachedPlaylistRef.current || {}), image };
      showToast('Cover diperbarui', 'success');
    } catch {
      showToast('Gagal mengunggah cover', 'error');
    }
  }, [selectedPlaylist, setCurrentPlaylist, showToast]);

  const handleDeletePlaylist = useCallback((playlistId, e) => {
    if (e) e.stopPropagation();
    setDeleteConfirm({ open: true, playlistId });
  }, []);

  const confirmDeletePlaylist = useCallback(async () => {
    const playlistId = deleteConfirm.playlistId;
    if (!playlistId) return;
    try {
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/playlists/${playlistId}`, { method: 'DELETE' });
      showToast('Playlist deleted', 'success');
      setPlaylists(prev => prev.filter(p => p.id !== playlistId));
      if (String(selectedPlaylist?.id) === String(playlistId)) {
        handleBackToList();
      }
    } catch (err) {
      showToast('Failed to delete playlist', 'error');
    } finally {
      setDeleteConfirm({ open: false, playlistId: null });
    }
  }, [deleteConfirm.playlistId, selectedPlaylist?.id, setPlaylists, showToast, handleBackToList]);

  const handleRemoveTrack = useCallback(async (trackId, e) => {
    if (e) e.stopPropagation();
    if (!selectedPlaylist) return;
    try {
      await removeTrackFromPlaylist(selectedPlaylist.id, trackId);
      setPlaylistTracks(prev => prev.filter(t => t.id !== trackId));
      showToast('Track removed', 'success');
      loadPlaylist(selectedPlaylist.id).then(data => {
        setSelectedPlaylist(prev => prev ? { ...prev, track_count: data.track_count, total_duration: data.total_duration } : prev);
      });
    } catch (err) {
      showToast('Failed to remove track', 'error');
    }
  }, [selectedPlaylist, showToast]);

  const toggleSelectForDelete = useCallback((trackId) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  // Sorted data
  const sortedPlaylists = useMemo(() => {
    const list = Array.isArray(playlists) ? [...playlists] : [];
    const { by, order } = playlistSort;
    list.sort((a, b) => {
      let valA = a[by] ?? '';
      let valB = b[by] ?? '';
      if (by === 'created_at') {
        valA = new Date(valA).getTime() || 0;
        valB = new Date(valB).getTime() || 0;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [playlists, playlistSort]);

  const sortedTracks = useMemo(() => {
    let list = [...playlistTracks];
    if (trackFilterType === 'is_favorite') {
      list = list.filter(t => t.is_favorite === 1);
    } else if (trackFilterType !== 'all') {
      list = list.filter(t => {
        const filePath = t.resolved_path || t.location || '';
        const ext = filePath.split('.').pop().toLowerCase();
        return ext === trackFilterType;
      });
    }
    const query = trackSearchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter(t => {
        const name = (t.display_name || t.title || t.name || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        return name.includes(query) || artist.includes(query);
      });
    }
    const { by, order } = trackSort;
    list.sort((a, b) => {
      let valA = a[by] ?? '';
      let valB = b[by] ?? '';
      if (by === 'duration' || by === 'track_num' || by === 'track_index' || by === 'created_at' || by === 'mtime' || by === 'size') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [playlistTracks, trackSort, trackFilterType, trackSearchQuery]);

  const totalDurationSeconds = useMemo(
    () => sortedTracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0),
    [sortedTracks]
  );

  // ---- Search filter animation (fade-out + slide) ----
  // Keeps the previously-rendered list for ~200ms after a filter/search change,
  // marks the removed tracks as "leaving" (fade out) and shifts the remaining
  // tracks up by the number of leaving rows above them (slide). Only the visible
  // rows are ever rendered (react-window), so this stays lightweight.
  const trackKey = (t) => (t?.id ?? t?.file_id ?? '');
  const [displayTracks, setDisplayTracks] = useState(() => sortedTracks);
  const [leavingTrackIds, setLeavingTrackIds] = useState(new Set());
  const [shiftAbove, setShiftAbove] = useState(new Map());
  const [enteringTrackIds, setEnteringTrackIds] = useState(new Set());
  const displayRef = useRef(sortedTracks);
  const filterAnimTimerRef = useRef(null);

  useEffect(() => {
    if (filterAnimTimerRef.current) {
      clearTimeout(filterAnimTimerRef.current);
      filterAnimTimerRef.current = null;
    }
    const prev = displayRef.current;
    if (!prev || prev.length === 0 || prev === sortedTracks) {
      displayRef.current = sortedTracks;
      setDisplayTracks(sortedTracks);
      setLeavingTrackIds(new Set());
      setShiftAbove(new Map());
      setEnteringTrackIds(new Set());
      return;
    }
    const prevKeys = new Set(prev.map(trackKey));
    const newKeys = new Set(sortedTracks.map(trackKey));
    const leaving = new Set(prev.filter(t => !newKeys.has(trackKey(t))).map(trackKey));
    const entering = new Set(sortedTracks.filter(t => !prevKeys.has(trackKey(t))).map(trackKey));

    if (leaving.size > 0) {
      // Exit phase: keep the old list, fade out removed items, slide remaining.
      // For grid view, skip the exit phase (instantly swap) because CSS grid
      // reflow can't be smoothly transitioned — the remaining cards look wrong
      // when they slide while leaving cards still occupy their cells.
      if (displayMode !== 'grid') {
        const shift = new Map();
        let count = 0;
        for (const t of prev) {
          const k = trackKey(t);
          if (leaving.has(k)) count++;
          else shift.set(k, count);
        }
        setDisplayTracks(prev);
        setLeavingTrackIds(leaving);
        setShiftAbove(shift);
        setEnteringTrackIds(new Set());
        filterAnimTimerRef.current = setTimeout(() => {
          displayRef.current = sortedTracks;
          setDisplayTracks(sortedTracks);
          setLeavingTrackIds(new Set());
          setShiftAbove(new Map());
        }, 220);
      } else {
        // Grid: swap instantly, no exit animation. Still animate new items in.
        displayRef.current = sortedTracks;
        setDisplayTracks(sortedTracks);
        setLeavingTrackIds(new Set());
        setShiftAbove(new Map());
        if (entering.size > 0) {
          setEnteringTrackIds(entering);
          filterAnimTimerRef.current = setTimeout(() => {
            setEnteringTrackIds(new Set());
          }, 260);
        } else {
          setEnteringTrackIds(new Set());
        }
      }
    } else {
      // Enter phase (e.g. clearing search): swap immediately, animate new items in.
      displayRef.current = sortedTracks;
      setDisplayTracks(sortedTracks);
      setLeavingTrackIds(new Set());
      setShiftAbove(new Map());
      if (entering.size > 0) {
        setEnteringTrackIds(entering);
        filterAnimTimerRef.current = setTimeout(() => {
          setEnteringTrackIds(new Set());
        }, 260);
      } else {
        setEnteringTrackIds(new Set());
      }
    }
  }, [sortedTracks, displayMode]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedPlaylist) return;
    const ids = selectAllForDelete
      ? sortedTracks.map(t => t.id).filter(id => !selectedForDelete.has(id))
      : Array.from(selectedForDelete);
    if (ids.length === 0) return;
    setDeletingTrackIds(new Set(ids));
    await new Promise(r => setTimeout(r, 400));
    try {
      const result = await bulkRemoveTracksFromPlaylist(selectedPlaylist.id, ids);
      const remainingTracks = sortedTracks.filter(t => !ids.includes(t.id));
      setPlaylistTracks(remainingTracks);
      setCurrentPlaylistTracks(remainingTracks);
      cachedTracksRef.current = remainingTracks;
      const updatedPlaylist = {
        ...selectedPlaylist,
        track_count: result.track_count ?? remainingTracks.length,
        total_size: remainingTracks.reduce((sum, t) => sum + (t.size || 0), 0),
      };
      cachedPlaylistRef.current = updatedPlaylist;
      setSelectedPlaylist(updatedPlaylist);
      setCurrentPlaylist(updatedPlaylist);
      setPlaylists(prev => prev.map(p => p.id === updatedPlaylist.id ? { ...p, ...updatedPlaylist } : p));
      showToast(`${ids.length} track(s) deleted`, 'success');
    } catch (err) {
      showToast('Failed to delete from server', 'error');
    } finally {
      setSelectedForDelete(new Set());
      setDeleteMode(false);
      setSelectAllForDelete(false);
      setDeletingTrackIds(new Set());
    }
  }, [selectedPlaylist, sortedTracks, selectedForDelete, selectAllForDelete, showToast, setCurrentPlaylist, setCurrentPlaylistTracks]);

  const handleCancelDeleteMode = useCallback(() => {
    setDeleteMode(false);
    setSelectedForDelete(new Set());
    setSelectAllForDelete(false);
    setDeletingTrackIds(new Set());
  }, []);

  const bulkSelectedCount = deleteMode
    ? (selectAllForDelete ? sortedTracks.length - selectedForDelete.size : selectedForDelete.size)
    : 0;

  // Filter panel handlers
  const handleOpenPlaylistFilters = useCallback(() => {
    setFilterPanelType('playlist');
    setShowFilterPanel(true);
  }, []);

  const handleOpenTrackFilters = useCallback(() => {
    setFilterPanelType('track');
    setShowFilterPanel(true);
  }, []);

  const handleFilterApply = useCallback((key, order) => {
    if (filterPanelType === 'playlist') {
      setPlaylistSort({ by: key, order: order || 'asc' });
    } else {
      setTrackSort({ by: key, order: order || 'asc' });
    }
  }, [filterPanelType]);

  const handleTrackFilterTypeChange = useCallback((type) => {
    setTrackFilterType(type);
  }, []);

  const handlePlaylistOrderToggle = useCallback(() => {
    setPlaylistSort(prev => ({ ...prev, order: prev.order === 'asc' ? 'desc' : 'asc' }));
  }, []);

  const togglePlaylistSelect = useCallback((playlistId) => {
    setSelectedPlaylistIds(prev => {
      const next = new Set(prev);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  }, []);

  // Stable select handler so PlaylistGrid / PlaylistListItemRow memoization
  // actually holds across selection toggles (inline arrows would re-create the
  // callback every render and force every visible card to re-render per click).
  const handlePlaylistGridSelect = useCallback((playlist) => {
    if (playlistDeleteMode) togglePlaylistSelect(playlist.id);
    else handleSelectPlaylist(playlist);
  }, [playlistDeleteMode, togglePlaylistSelect, handleSelectPlaylist]);

  const handlePlaylistListSelect = useCallback((playlist) => {
    if (playlistDeleteMode) togglePlaylistSelect(playlist.id);
    else handleSelectPlaylist(playlist);
  }, [playlistDeleteMode, togglePlaylistSelect, handleSelectPlaylist]);

  const fullQueueMemo = useMemo(() => {
    return sortedTracks.map((t, i) => ({
      file_id: t.file_id,
      track_index: i,
      display_name: t.display_name,
      artist: t.artist || '',
      album: t.album || '',
      duration: t.duration || 0,
      path: t.resolved_path || t.location || '',
      resolved_path: t.resolved_path,
      location: t.location,
      exists: !!t.exists && !!t.file_id,
      type: 'audio',
      ext: t.resolved_path ? t.resolved_path.split('.').pop()?.toLowerCase() || '' : '',
      size: t.size || 0,
      is_favorite: t.is_favorite || 0,
      youtube_id: t.youtube_id || null,
      video_offset: t.video_offset || 0,
    }));
  }, [sortedTracks]);
  
  // Currently-playing file id (from the shared playback store) so the list and
  // grid can mark which track is active while the MiniPlayer is in the background.
  const queue = usePlaybackStore(s => s.queue);
  const currentTrackIndex = usePlaybackStore(s => s.currentTrackIndex);
  const playingFileId = usePlaybackStore(s => {
    const q = s.queue;
    const idx = s.currentTrackIndex;
    const item = q && q.length > 0 ? q[idx] : null;
    return item ? (item.file_id || item.id || null) : null;
  });
  const isPlayingActive = usePlaybackStore(s => s.isPlaying);

   const hasActivePlayback = useMemo(() => {
     return queue && queue.length > 0 && currentTrackIndex < queue.length;
   }, [queue, currentTrackIndex]);

   useEffect(() => {
     if (hasActivePlayback && !rightSidebarOpen) {
       setRightSidebarOpen(true);
     }
   }, [hasActivePlayback, rightSidebarOpen]);

   const [toggleHovered, setToggleHovered] = useState(false);

  const handlePlay = useCallback(() => {
    if (playAllGuardRef.current) return;
    if (loadingTracks || sortedTracks.length === 0) return;
    playAllGuardRef.current = true;
    setTimeout(() => { playAllGuardRef.current = false; }, 1000);

    const queue = fullQueueMemo.filter(t => t.exists);
    if (queue.length === 0) return;
    onPlayPlaylist({ queue, playlist: selectedPlaylist });
  }, [fullQueueMemo, sortedTracks, selectedPlaylist, onPlayPlaylist, loadingTracks]);

  const handlePlayShuffle = useCallback(() => {
    if (lovedLoading || sortedTracks.length === 0) return;
    const queue = shuffleArray(fullQueueMemo.filter(t => t.exists));
    if (queue.length === 0) return;
    onPlayPlaylist({ queue, playlist: selectedPlaylist });
  }, [lovedLoading, sortedTracks, fullQueueMemo, selectedPlaylist, onPlayPlaylist]);

  const handlePlayTrack = useCallback((track, index) => {
    if (playTrackGuardRef.current) return;
    if (loadingTracks || lovedLoading) return;
    const fileId = track?.file_id || track?.id;
    if (!fileId) return;
    playTrackGuardRef.current = true;
    setTimeout(() => { playTrackGuardRef.current = false; }, 500);

    // Build the playable queue from the SAME ordered list the user sees
    // (displayTracks) so the clicked track's index maps directly into this
    // queue — the old code built it from sortedTracks (which can diverge from
    // the displayed/animating order) and then fell back to index 0 on any
    // mismatch, which is why clicking the 3rd track played the 1st.
    const playableTracks = buildPlayableQueue(displayTracks);
    if (playableTracks.length === 0) return;

    // Resolve the clicked track by the VISUAL row the user actually clicked.
    // The grid/list passes `index` (position in displayTracks); we map that
    // through the exists-filtered playable subset so the Nth visible row plays
    // the Nth track — never the first one. Fall back to an id-based match only
    // when no visual index is available.
    let clickedIdx;
    if (index != null && index >= 0 && index < displayTracks.length) {
      const visual = displayTracks[index];
      const byVisual = playableTracks.findIndex(t =>
        (t.id != null && t.id === visual.id) || (t.file_id != null && t.file_id === visual.file_id));
      clickedIdx = byVisual >= 0 ? byVisual : index;
    } else {
      clickedIdx = resolveClickedIndex(track, playableTracks);
    }

    if (clickedIdx < 0 || clickedIdx >= playableTracks.length) {
      showToast('Lagu belum tersedia', 'error');
      return;
    }
    onPlayTrack(track, playableTracks, clickedIdx, selectedPlaylist);
  }, [selectedPlaylist, onPlayTrack, loadingTracks, lovedLoading, displayTracks, showToast]);

  // ---- Duration resolution ----
  // Not every playlist track stores a duration (some were added before the
  // scanner filled `duration` in, or the field was never synced from the files
  // table). To show a duration for those tracks, we resolve it once: first via
  // the cheap batched file-metadata endpoint, then (for any still-missing) by
  // probing the audio stream metadata. Resolved values are written back into
  // the track objects so the list/grid + header totals update.
  const durationResolvedRef = useRef(new Set());
  const durationPendingRef = useRef(new Set());
  const probeQueueRef = useRef([]);
  const probeInFlightRef = useRef(0);
  const MAX_PROBES = 4;

  const applyResolvedDuration = useCallback((fileId, seconds) => {
    if (!fileId || !seconds) return;
    setPlaylistTracks(prev => prev.map(t => {
      if (t.duration && t.duration > 0) return t;
      if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
      return t;
    }));
    setCurrentPlaylistTracks(prev => prev.map(t => {
      if (t.duration && t.duration > 0) return t;
      if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
      return t;
    }));
    if (cachedTracksRef.current) {
      cachedTracksRef.current = cachedTracksRef.current.map(t => {
        if (t.duration && t.duration > 0) return t;
        if (t.file_id === fileId || t.id === fileId) return { ...t, duration: seconds };
        return t;
      });
    }
  }, []);

  // Bounded, FIFO scheduler for audio-duration probes. At most MAX_PROBES run
  // concurrently so opening a playlist never floods the server with hundreds of
  // /file/:id requests at once. A probe is considered "resolved" once it settles
  // (success OR 0/error) so a track whose probe fails is never re-queued on scroll.
  const pumpProbeQueue = useCallback(() => {
    while (probeInFlightRef.current < MAX_PROBES && probeQueueRef.current.length > 0) {
      const fileId = probeQueueRef.current.shift();
      if (!fileId) continue;
      if (durationResolvedRef.current.has(fileId)) { durationPendingRef.current.delete(fileId); continue; }
      probeInFlightRef.current++;
      loadAudioDuration(fileId).then((d) => {
        probeInFlightRef.current--;
        durationResolvedRef.current.add(fileId);
        durationPendingRef.current.delete(fileId);
        if (d) applyResolvedDuration(fileId, d);
        pumpProbeQueue();
      });
    }
  }, [applyResolvedDuration]);

  const requestDurationProbe = useCallback((fileId) => {
    if (!fileId) return;
    if (durationResolvedRef.current.has(fileId)) return;
    if (durationPendingRef.current.has(fileId)) return;
    durationPendingRef.current.add(fileId);
    probeQueueRef.current.push(fileId);
    pumpProbeQueue();
  }, [pumpProbeQueue]);

  // Cheap batched lookup of durations already stored in the DB (most tracks once
  // the backend has enriched them). Tracks whose duration is still 0 are NOT
  // probed here — probing is driven lazily by the visible rows (onItemsRendered)
  // so only on-screen tracks ever hit /file/:id, at most MAX_PROBES at a time.
  const resolveMissingDurations = useCallback((tracks) => {
    if (!Array.isArray(tracks)) return;
    const need = [];
    for (const t of tracks) {
      if (t.duration && t.duration > 0) continue;
      const fileId = t.file_id || t.id;
      if (!fileId || durationResolvedRef.current.has(fileId)) continue;
      need.push(fileId);
    }
    if (need.length === 0) return;
    const chunks = [];
    for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
    Promise.all(chunks.map(ids =>
      fetch(`${API_BASE}/api/files/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
    )).then(results => {
      for (const res of results) {
        if (!res || !Array.isArray(res.items)) continue;
        for (const item of res.items) {
          const dur = item.duration || 0;
          if (dur) {
            applyResolvedDuration(item.id, dur);
            durationResolvedRef.current.add(item.id);
          }
        }
      }
    }).catch(() => {});
  }, [applyResolvedDuration]);

  const listRowData = useMemo(() => ({
    tracks: displayTracks,
    deleteMode,
    selectedForDelete,
    deletingTrackIds,
    leavingTrackIds,
    shiftAbove,
    enteringTrackIds,
    itemSize: 64,
    playingFileId,
    isPlayingActive,
    onSelect: (track, index) => {
      if (deleteMode) { toggleSelectForDelete(track.id); return; }
      if (track.file_id || track.id) handlePlayTrack(track, index);
    },
    onRemove: handleRemoveTrack,
  }), [displayTracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, handlePlayTrack, handleRemoveTrack, toggleSelectForDelete, playingFileId, isPlayingActive]);

  const listItemSize = useCallback(() => 64, []);

  const playlistListItemSize = useCallback(() => 72, []);

  const playlistListRowData = useMemo(() => ({
    playlists: sortedPlaylists,
    playlistDeleteMode,
    selectedPlaylistIds,
    onSelect: playlistDeleteMode
      ? handlePlaylistListSelect
      : handleSelectPlaylist,
    onDelete: handleDeletePlaylist,
    onToggleSelect: togglePlaylistSelect,
  }), [sortedPlaylists, playlistDeleteMode, selectedPlaylistIds, handleSelectPlaylist, handleDeletePlaylist, togglePlaylistSelect, handlePlaylistListSelect]);

  const gridItems = useMemo(() => {
    return displayTracks.map((track, i) => ({
      id: track.file_id || `track-${i}`,
      _trackId: track.id || track.file_id || `track-${i}`,
      _flattenIndex: i,
      _cardTitle: track.display_name,
      _cardSubtitle: track.duration > 0 ? formatDuration(track.duration) : (track.artist || ''),
      _cardThumbnail: track.file_id ? `/thumbnails/${track.file_id}.jpg` : null,
      _cardHasImage: true,
      _typeLabel: 'AUDIO',
      _trackIndex: i,
      _track: track,
      _leaving: leavingTrackIds.has(track.id ?? track.file_id),
      _entering: enteringTrackIds.has(track.id ?? track.file_id),
      _exists: !!(track.exists && track.file_id),
      _file_id: track.file_id,
      _is_favorite: track.is_favorite || 0,
    }));
  }, [displayTracks, leavingTrackIds, enteringTrackIds]);

  const handleTrackGridSelect = useCallback((item) => {
    if (deleteMode) {
      const realTrack = item?._track || sortedTracks[item?._trackIndex] || item;
      if (realTrack?.id) toggleSelectForDelete(realTrack.id);
      return;
    }
    const realTrack = item?._track || sortedTracks[item?._trackIndex] || item;
    handlePlayTrack(realTrack, item?._trackIndex);
  }, [deleteMode, handlePlayTrack, sortedTracks, toggleSelectForDelete]);

  // Lazy probe: only rows currently rendered get a duration probe. This keeps the
  // concurrent /file/:id requests bounded to the visible window (see pumpProbeQueue /
  // MAX_PROBES) so scrolling stays smooth and opening a playlist never floods.
  const handleListItemsRendered = useCallback(({ overscanStartIndex, overscanStopIndex }) => {
    for (let i = overscanStartIndex; i <= overscanStopIndex; i++) {
      const t = displayTracks[i];
      if (t) requestDurationProbe(t.file_id || t.id);
    }
  }, [displayTracks, requestDurationProbe]);

  const handleGridItemsRendered = useCallback((ids) => {
    for (const id of ids) requestDurationProbe(id);
  }, [requestDurationProbe]);

  // Create modal
  const createModal = showCreateModal && (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: COLORS.bg.primary,
        borderRadius: '16px',
        border: `1px solid ${COLORS.border.primary}`,
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px',
          borderBottom: `1px solid ${COLORS.border.primary}`,
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: COLORS.text.primary, fontWeight: 600 }}>
            Create New Playlist
          </h2>
          <button
            onClick={() => { setShowCreateModal(false); setCreateTitle(''); }}
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '20px',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: COLORS.text.secondary, marginBottom: '8px', fontWeight: 500 }}>
            Playlist Title
          </label>
          <input
            type="text"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="My Awesome Playlist"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && createTitle.trim()) handleCreateManualPlaylist(); }}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              background: COLORS.bg.secondary,
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.primary,
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '20px',
          borderTop: `1px solid ${COLORS.border.primary}`,
        }}>
          <button
            onClick={() => { setShowCreateModal(false); setCreateTitle(''); }}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'transparent',
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateManualPlaylist}
            disabled={!createTitle.trim() || isCreating}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: COLORS.accent,
              border: 'none',
              color: 'white',
              cursor: !createTitle.trim() || isCreating ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              opacity: !createTitle.trim() || isCreating ? 0.5 : 1,
            }}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );

  const deleteConfirmModal = deleteConfirm.open && (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: COLORS.bg.primary,
        borderRadius: '16px',
        border: `1px solid ${COLORS.border.primary}`,
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px',
          borderBottom: `1px solid ${COLORS.border.primary}`,
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: COLORS.text.primary, fontWeight: 600 }}>
            Delete Playlist
          </h2>
          <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: COLORS.text.secondary }}>
            Are you sure you want to delete this playlist? This action cannot be undone.
          </p>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          padding: '20px',
        }}>
          <button
            onClick={() => setDeleteConfirm({ open: false, playlistId: null })}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'transparent',
              border: `1px solid ${COLORS.border.primary}`,
              color: COLORS.text.secondary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirmDeletePlaylist}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: '#ef4444',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={mainRowRef}
      className="pv-no-focus"
      onClickCapture={(e) => {
        // After a pointer click on a button, drop focus so the focus ring
        // disappears and pressing Space afterwards doesn't re-trigger the
        // click. Keyboard (Tab) focus is unaffected and still activates.
        const t = e.target;
        if (t && t.tagName === 'BUTTON') {
          requestAnimationFrame(() => t.blur());
        }
      }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <ServiceStoppedBanner service="playlists" />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {showSidebar && (
          <PlaylistSidebar
            playlists={sortedPlaylists}
            favoritesCount={favorites.length}
            activeId={selectedPlaylist?.id}
            lovedActive={showLoved}
            onSelect={handleSelectPlaylist}
            onSelectLoved={selectLoved}
            onOpenLeaderboard={() => { setRightSidebarMode('leaderboard'); setRightSidebarOpen(true); }}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* List View */}
          {!selectedPlaylist && (
        <>
        <PlaylistListHeader
          playlistCount={sortedPlaylists.length}
          selectionMode={playlistDeleteMode}
          selectedCount={selectedPlaylistIds.size}
          onMenuOpen={onMenuOpen}
          onToggleSelect={() => {
            setPlaylistDeleteMode(true);
            setSelectedPlaylistIds(new Set());
          }}
          onSelectAll={() => {
            if ((Array.isArray(playlists) ? playlists : []).length === selectedPlaylistIds.size) {
              setSelectedPlaylistIds(new Set());
            } else {
              setSelectedPlaylistIds(new Set((Array.isArray(playlists) ? playlists : []).map(p => p.id)));
            }
          }}
          onDeleteSelected={async () => {
            if (selectedPlaylistIds.size === 0) return;
            for (const id of selectedPlaylistIds) {
              try { await deletePlaylist(id); } catch {}
            }
            setPlaylists(prev => prev.filter(p => !selectedPlaylistIds.has(p.id)));
            showToast(`${selectedPlaylistIds.size} playlist(s) deleted`, 'success');
            setSelectedPlaylistIds(new Set());
            setPlaylistDeleteMode(false);
          }}
          onCancelSelect={() => {
            setPlaylistDeleteMode(false);
            setSelectedPlaylistIds(new Set());
          }}
          onImport={() => fileInputRef.current?.click()}
          onRefresh={() => { setLoading(true); handleRefresh(); }}
          onToggleView={() => setDisplayMode(d => d === 'grid' ? 'list' : 'grid')}
          displayMode={displayMode}
          isImporting={isImporting}
          fileInputRef={fileInputRef}
          onImportFile={handleImportXSPF}
          onCreate={() => setShowCreateModal(true)}
          sortBy={playlistSort.by}
          sortOrder={playlistSort.order}
          onOpenFilters={handleOpenPlaylistFilters}
          onToggleOrder={handlePlaylistOrderToggle}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: COLORS.text.secondary, padding: 24, overflow: 'hidden' }}>
          <Music size={64} style={{ opacity: 0.22, marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: COLORS.text.primary }}>Pilih playlist</p>
          <p style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>Pilih salah satu daftar di samping untuk melihat lagunya.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{ marginTop: 12, height: 40, padding: '0 18px', borderRadius: 999, border: 'none', background: '#1db954', color: '#000', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> Buat Playlist
          </button>
        </div>
      </>
    )}

      {/* Detail View */}
      {selectedPlaylist && (
    <div ref={detailScrollRef} data-debug-id="5.1" data-debug-name="PlaylistView" data-debug-type="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'linear-gradient(180deg, #2e2e2e 0%, #1c1c1c 300px, #121212 560px)' }}>
          {/* Sticky top bar — search centered, larger & refined.
              Hidden while the audio player is open so its back/search chrome
              doesn't bleed through behind the (opaque) player header. */}
          {!playerOpen && (
          <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', background: 'rgba(18,18,18,0.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={handleBackToList} title="Kembali" style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowLeft size={18} />
            </button>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
              <div style={{ position: 'relative', width: 'min(520px, 100%)' }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: COLORS.text.secondary, pointerEvents: 'none' }} />
                <input
                  value={trackSearchQuery}
                  onChange={(e) => setTrackSearchQuery(e.target.value)}
                  placeholder="Cari di playlist…"
                  style={{
                    width: '100%', height: 44, padding: '0 18px 0 44px', borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)',
                    color: '#fff', fontSize: 15, outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(29,185,84,0.7)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(29,185,84,0.18)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.3)'; }}
                />
              </div>
            </div>
            <div style={{ flexShrink: 0, width: 34 }} />
          </div>
          )}
          <PlaylistDetailHeader
            selectionMode={deleteMode}
            selectedCount={bulkSelectedCount}
            trackCount={sortedTracks.length}
            onSelectAll={() => {
              setSelectAllForDelete(true);
              setSelectedForDelete(new Set());
            }}
            onDeleteSelected={handleBulkDelete}
            onCancelSelect={handleCancelDeleteMode}
          />
          <PlaylistHeroHeader
            playlist={selectedPlaylist}
            isLoved={!!selectedPlaylist.isLoved}
            trackCount={sortedTracks.length}
            totalDurationSeconds={
              selectedPlaylist?.isLoved
                ? favorites.reduce((sum, t) => sum + (Number(t.duration) || 0), 0)
                : (Number(selectedPlaylist?.total_duration) || totalDurationSeconds)
            }
            onPlay={handlePlay}
            onShuffle={handlePlayShuffle}
            onCoverChange={() => coverInputRef.current?.click()}
            selectionMode={deleteMode}
            selectedCount={bulkSelectedCount}
            onEnterSelectMode={() => setDeleteMode(true)}
            onSelectAll={() => {
              setSelectAllForDelete(true);
              setSelectedForDelete(new Set());
            }}
            onDeleteSelected={handleBulkDelete}
            onCancelSelect={handleCancelDeleteMode}
            onFilter={handleOpenTrackFilters}
            filterType={trackFilterType}
            onToggleView={() => setDisplayMode(d => d === 'grid' ? 'list' : 'grid')}
            displayMode={displayMode}
            onAdd={() => setShowAddMusicPanel(true)}
          />

          {/* Content — track area virtualizes against the visible viewport so
               switching to grid doesn't mount every card at once (was freezing
               the tab on large playlists). Hero + toolbar stay fixed above.
               The `key` is tied to the playlist id + loading state so the
               content re-mounts (and thus re-runs the fade-in) both on a fresh
               open and after the loading spinner finishes — matching the Loved
               section's fade-in behaviour. */}
          <div
            key={`pv-content-${selectedPlaylist?.id}-${loadingTracks ? 'loading' : 'ready'}`}
            className="animate-in fade-in duration-300"
            style={{ flex: 1, minHeight: 0, padding: '0 24px 24px', display: 'flex', flexDirection: 'column' }}
          >
            {loadingTracks ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
              }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  border: `2px solid ${COLORS.border.primary}`,
                  borderTop: `2px solid ${COLORS.accent}`,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
              </div>
            ) : displayTracks.length === 0 ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                color: COLORS.text.secondary,
              }}>
                <Music size={48} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <p style={{ margin: 0, fontSize: '14px' }}>No tracks in this playlist</p>
              </div>
            ) : displayMode === 'list' ? (
              <div data-debug-id="5.2.2" data-debug-name="TrackListView" data-debug-type="list" style={{ flex: 1, minHeight: 0 }}>
                <AutoSizer>
                  {({ height, width }) => (
                    <div style={{ height, width, display: 'flex', justifyContent: 'center' }}>
                      <List
                        key={`track-list-${displayMode}`}
                        height={height}
                        width={Math.min(width || 0, 1100)}
                        itemCount={displayTracks.length}
                        itemSize={listItemSize}
                        overscanCount={5}
                        itemData={listRowData}
                        onItemsRendered={handleListItemsRendered}
                      >
                        {PlaylistListRow}
                      </List>
                    </div>
                  )}
                </AutoSizer>
              </div>
            ) : (
              <div data-debug-id="5.2.3" data-debug-name="TrackGridView" data-debug-type="grid" style={{ flex: 1, minHeight: 0 }}>
                <AutoSizer>
                  {({ height, width }) => {
                    const effW = Math.min(width || 0, CONTAINER_MAX);
                    const iw = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effW * 0.10)));
                    const ch = iw + 44;
                    const cols = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((effW - GUTTER) / (iw + GUTTER))));
                    return (
                      <PlaylistTrackGridInner
                        height={height}
                        width={width}
                        gridItems={gridItems}
                        onSelect={handleTrackGridSelect}
                        selectedForDelete={selectedForDelete}
                        deletingTrackIds={deletingTrackIds}
                        selectMode={deleteMode}
                        playingFileId={playingFileId}
                        isPlayingActive={isPlayingActive}
                        onProbeVisibleItems={handleGridItemsRendered}
                      />
                    );
                  }}
                </AutoSizer>
              </div>
            )}
          </div>
        </div>
      )}
       </div>

          {/* Now Playing Sidebar */}
           <div
             data-debug-id="5.3"
             data-debug-name="NowPlayingSidebar"
             data-debug-type="panel"
             style={{
               position: 'absolute',
               right: 0,
               top: 0,
               bottom: 0,
               width: 360,
               background: 'linear-gradient(180deg, #1a1a1a 0%, #121212 100%)',
               borderLeft: '1px solid rgba(255,255,255,0.06)',
               display: 'flex',
               flexDirection: 'column',
               overflow: 'hidden',
               transform: rightSidebarOpen ? 'translateX(0)' : 'translateX(100%)',
               opacity: rightSidebarOpen ? 1 : 0,
               transition: 'transform 300ms ease, opacity 300ms ease',
               pointerEvents: rightSidebarOpen ? 'auto' : 'none',
               zIndex: 20,
             }}
           >
             <>
               <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                   <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
                     <button
                       onClick={() => setRightSidebarMode('nowplaying')}
                       style={{
                         padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                         fontSize: 11, fontWeight: 600, textAlign: 'center',
                         background: rightSidebarMode === 'nowplaying' ? 'rgba(255,255,255,0.12)' : 'transparent',
                         color: rightSidebarMode === 'nowplaying' ? '#fff' : COLORS.text.tertiary,
                       }}
                     >
                       Now Playing
                     </button>
                     <button
                       onClick={() => setRightSidebarMode('leaderboard')}
                       style={{
                         padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                         fontSize: 11, fontWeight: 600, textAlign: 'center',
                         background: rightSidebarMode === 'leaderboard' ? 'rgba(255,255,255,0.12)' : 'transparent',
                         color: rightSidebarMode === 'leaderboard' ? '#fff' : COLORS.text.tertiary,
                       }}
                     >
                       Leaderboard
                     </button>
                   </div>
                   <button
                     onClick={() => setRightSidebarOpen(false)}
                     style={{ width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                     title="Close sidebar"
                   >
                     <X size={14} />
                   </button>
                 </div>
               </div>
                <div style={{ flex: 1, overflow: 'hidden', padding: '0 24px 24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {rightSidebarMode === 'nowplaying' && hasActivePlayback && (
                    <NowPlayingPanel queue={queue} currentTrackIndex={currentTrackIndex} />
                  )}
                 {rightSidebarMode === 'nowplaying' && !hasActivePlayback && (
                   <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.text.tertiary, fontSize: 13, flexShrink: 0 }}>
                     No track is playing
                   </div>
                 )}
                  {rightSidebarMode === 'leaderboard' && (
                    <LeaderboardPanel
                      listeningLeaderboardMetric={listeningLeaderboardMetric}
                      onMetricChange={setListeningLeaderboardMetric}
                      leaderboardDisplayMode={leaderboardDisplayMode}
                      onDisplayModeChange={setLeaderboardDisplayMode}
                      formatListeningDuration={formatListeningDuration}
                    />
                  )}
               </div>
             </>
          </div>
         {!rightSidebarOpen && (hasActivePlayback || true) && (
           <button
             onClick={() => { setRightSidebarMode(hasActivePlayback ? 'nowplaying' : 'leaderboard'); setRightSidebarOpen(true); }}
             onMouseEnter={() => setToggleHovered(true)}
             onMouseLeave={() => setToggleHovered(false)}
             style={{
               position: 'absolute',
               right: 0,
               top: 0,
               bottom: 0,
               width: 40,
               cursor: 'pointer',
               zIndex: 10,
               background: 'transparent',
               border: 'none',
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
             }}
             title={hasActivePlayback ? "Open Now Playing" : "Open Leaderboard"}
           >
             <ChevronLeft size={16} style={{ opacity: toggleHovered ? 1 : 0, transition: 'opacity 0.2s', color: '#a3a3a3' }} />
           </button>
          )}
 
       </div>


     {/* Filter Panel */}
    <FilterPanel
      open={showFilterPanel}
      onClose={() => setShowFilterPanel(false)}
      title="Filters"
      filterTypeOptions={filterPanelType === 'track' ? TRACK_FILTER_OPTIONS : null}
      filterType={trackFilterType}
      onFilterTypeChange={handleTrackFilterTypeChange}
      sortOptions={filterPanelType === 'playlist' ? PLAYLIST_SORT_OPTIONS : TRACK_SORT_OPTIONS}
      sortBy={filterPanelType === 'playlist' ? playlistSort.by : trackSort.by}
      sortOrder={filterPanelType === 'playlist' ? playlistSort.order : trackSort.order}
      onApply={handleFilterApply}
    />

    {/* Side panel - Add Music (slide from right) */}
    <AddMusicPanel
      isOpen={showAddMusicPanel}
      onClose={() => setShowAddMusicPanel(false)}
      playlistId={selectedPlaylist?.id}
      playlistTitle={selectedPlaylist?.title}
      existingTrackIds={sortedTracks.map(t => t.file_id).filter(Boolean)}
      onTracksAdded={(allTracks) => {
        if (!selectedPlaylist) return;
        if (Array.isArray(allTracks) && allTracks.length > 0) {
          cachedTracksRef.current = allTracks;
          setPlaylistTracks(allTracks);
          setCurrentPlaylistTracks(allTracks);
          resolveMissingDurations(allTracks);
          setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, track_count: allTracks.length } : p));
        } else {
          loadPlaylist(selectedPlaylist.id).then((data) => {
            const tracks = data.tracks || [];
            cachedTracksRef.current = tracks;
            setPlaylistTracks(tracks);
            setCurrentPlaylistTracks(tracks);
            resolveMissingDurations(tracks);
            setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, track_count: data.track_count, total_duration: data.total_duration, available_tracks: data.available_tracks } : p));
          }).catch(() => {});
        }
      }}
    />

    {/* Modals */}
    {createModal}
    {deleteConfirmModal}

    <input
      ref={coverInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      style={{ display: 'none' }}
      onChange={handleCoverFileChange}
    />

    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      /* Hide the focus ring left behind after a mouse click on a button
         inside the playlist view (keyboard focus is preserved). The ring is
         also cleared programmatically on pointer click so Space won't
         re-trigger the last-clicked button. */
      .pv-no-focus button:focus:not(:focus-visible) {
        outline: none;
        box-shadow: none;
      }
    `}</style>
    </div>
  );
}
