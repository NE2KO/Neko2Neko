import React, { memo, useMemo, useRef, useEffect, useLayoutEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { PlaylistGridCard } from './PlaylistGridCard';
import './MediaGrid.css';
import { formatBytes as formatSize } from '../utils/format.js';

// Constants – same as MediaVault but a bit smaller thumbnails
const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165; // match MediaVault
const MAX_COLUMNS = 10;
const GUTTER = 8;

// Build rows of cards (same logic as MediaGrid)
function buildRows(items, cols) {
  const rows = [];
  let cur = { items: [] };
  for (const it of items) {
    cur.items.push(it);
    if (cur.items.length === cols) {
      rows.push(cur);
      cur = { items: [] };
    }
  }
  if (cur.items.length) rows.push(cur);
  return rows;
}

// Named row component — stable reference for react-window
const PlaylistGridRow = memo(({ index, style, data }) => {
  const { rows, onSelect, onDelete, itemWidth, cardHeight, columnCount, selectedPlaylistIds } = data;
  const row = rows[index];

  if (row.type === 'separator') {
    return (
      <div style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingLeft: '12px', paddingBottom: '6px' }}>
        <hr className="border-neutral-800 w-full mb-1.5" />
      </div>
    );
  }

  return (
    <div style={{ ...style, padding: `${GUTTER / 2}px 0` }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, ${itemWidth}px)`,
        gap: GUTTER,
        justifyContent: 'center',
      }}>
        {row.items.map(p => (
          <PlaylistGridCard
            key={p.id}
            item={p}
            typeLabel="PLAYLIST"
            itemWidth={itemWidth}
            cardHeight={cardHeight}
            onSelect={onSelect}
            onDelete={onDelete}
            _rawItem={p}
            isSelected={selectedPlaylistIds?.has(p.id)}
          />
        ))}
      </div>
    </div>
  );
});

PlaylistGridRow.displayName = 'PlaylistGridRow';

const PlaylistGrid = forwardRef(({
  playlists = [],
  onSelect,
  onDelete,
  hasMore = false,
  fetchingMore = false,
  onLoadMore = () => {},
  sortBy = null,
  sortOrder = 'asc',
  groupByFolder = false,
  selectedPlaylistIds = null,
}, ref) => {
  const listRef = useRef(null);
  const outerListRef = useRef(null);
  const rowsRef = useRef([]);

  // Infinite-scroll detection (via react-window's onItemsRendered)
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const handleItemsRendered = useCallback(({ overscanStopIndex }) => {
    if (!hasMore || fetchingMore) return;
    const totalRows = rowsRef.current.length;
    if (totalRows === 0) return;
    if (overscanStopIndex >= totalRows - 2) {
      onLoadMoreRef.current();
    }
  }, [hasMore, fetchingMore]);

  // Fallback scroll listener
  useEffect(() => {
    const el = outerListRef.current;
    if (!el || !hasMore) return;
    let guard = false;
    const onScroll = () => {
      if (guard || !hasMore || fetchingMore) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        guard = true;
        onLoadMoreRef.current();
        requestAnimationFrame(() => { guard = false; });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, fetchingMore]);

  // expose scroll-to-playlist for external callers (optional)
  useImperativeHandle(ref, () => ({
    scrollToPlaylist(id) {
      if (!listRef.current) return;
      const rows = rowsRef.current;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.type === 'separator') continue;
        if (row.items.some(p => p.id === id)) {
          listRef.current.scrollToItem(i, 'center');
          return;
        }
      }
    },
  }));

// Memoize items transformation — only recomputes when playlists changes
   const items = useMemo(() => {
      return (Array.isArray(playlists) ? playlists : []).map(p => {
       const trackInfo = `${p.available_tracks} tracks`;
       const sizeInfo = p.total_size ? ` · ${formatSize(p.total_size)}` : '';
       const missingInfo = p.missing_tracks > 0 ? ` · ${p.missing_tracks} missing` : '';
       return {
         id: p.id,
         title: p.title,
         subtitle: `${trackInfo}${sizeInfo}${missingInfo}`,
         thumbnailUrl: `/thumbnails/${p.id}.jpg`,
         hasImage: p.has_image,
       };
     });
   }, [playlists]);

   // Reset react-window cache when items change (parity with MediaGrid)
   useLayoutEffect(() => {
     if (listRef.current) {
       listRef.current.resetAfterIndex(0);
     }
   }, [items]);

  return (
    <div className="w-full h-full">
      <div className="h-full" style={{ maxWidth: CONTAINER_MAX, marginInline: 'auto' }}>
        <AutoSizer>
          {({ height, width }) => {
            if (height <= 0 || width <= 0) return null;
            const effectiveWidth = Math.min(width, CONTAINER_MAX);
            const ITEM_W = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effectiveWidth * 0.10)));
            const CARD_H = Math.round(ITEM_W * 180 / 140);
            const cols = Math.max(1, Math.min(MAX_COLUMNS,
              Math.floor((effectiveWidth - GUTTER) / (ITEM_W + GUTTER))));

            const rows = buildRows(items, cols);
            rowsRef.current = rows;
            const gridHeight = Math.max(0, height - GUTTER);

            const getRowHeight = (i) => (rows[i].type === 'separator' ? 44 : CARD_H + GUTTER);

            const itemData = {
              rows,
              onSelect,
              onDelete,
              itemWidth: ITEM_W,
              cardHeight: CARD_H,
              columnCount: cols,
              selectedPlaylistIds,
            };

            return (
              <List
                ref={listRef}
                outerRef={outerListRef}
                height={gridHeight}
                width={width}
                itemCount={rows.length}
                itemSize={getRowHeight}
                overscanCount={3}
                itemData={itemData}
                onItemsRendered={handleItemsRendered}
                style={{ overscrollBehavior: 'none', scrollBehavior: 'auto' }}
              >
                {PlaylistGridRow}
              </List>
            );
          }}
        </AutoSizer>
      </div>
    </div>
  );
});

export default memo(PlaylistGrid);
