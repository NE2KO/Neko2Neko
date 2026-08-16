import React, { memo, useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Heart } from 'lucide-react';
import { getThumbnailUrl, toggleFavorite } from '../utils/api';
import VideoIcon from './icons/VideoIcon';
import AudioIcon from './icons/AudioIcon';
import ImageIcon from './icons/ImageIcon';
import FolderIcon from './icons/FolderIcon';
import GroupDivider from './GroupDivider';
import { getGroupLabel } from '../utils/grouping';
import { formatBytes as formatSize } from '../utils/format.js';
import { useIsFavorite } from '../store/favoritesStore';
import './MediaGrid.css';

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;
const META_HEIGHT = 44;

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ThumbnailImage = memo(({ src, alt, file }) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="media-thumb-loading">
        <svg className="w-6 h-6 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="media-thumb-wrapper">
      {!loaded && <div className="media-thumb-shimmer" aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        className={`media-thumb transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        onContextMenu={(e) => e.preventDefault()}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          objectFit: 'cover',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
});

const VirtualizedMediaCard = memo(({ file, onSelect, onToggleFavorite, itemWidth, cardHeight, selectionMode, isSelected, onToggleSelect }) => {

  const handleClick = () => {
    if (!file || !file.id) return;
    if (selectionMode) {
      if (file.type === 'folder') return;
      onToggleSelect && onToggleSelect(file);
    } else {
      onSelect && onSelect(file);
    }
  };

  const handleFavorite = (e) => {
    e.stopPropagation();
    if (!file || !file.id) return;
    onToggleFavorite && onToggleFavorite(file);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
  };

  const thumbnailUrl = getThumbnailUrl(file);

  // Determine favorite status via global store for instant UI updates
  const fileId = file.id || file.file_id;
  const isFav = useIsFavorite(fileId, file.is_favorite ? 1 : 0);

  if (!file || !file.id) return null;

  if (file.type === 'folder') {
    return (
      <div style={{ width: itemWidth, height: cardHeight, contentVisibility: 'auto' }} className="flex flex-col flex-shrink-0 select-none">
        <div
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          className="group relative rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800/80 w-full h-full cursor-pointer flex flex-col flex-shrink-0 select-none"
          style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <div style={{ height: itemWidth }} className="w-full bg-black/40 flex items-center justify-center overflow-hidden relative">
            {!file.previews || file.previews.length === 0 ? (
              <FolderIcon className="w-8 h-8 text-neutral-600" />
            ) : file.previews.length === 1 ? (
              <div className="w-full h-full flex items-center justify-center">
                <ThumbnailImage src={getThumbnailUrl(file.previews[0])} alt={file.previews[0].name} file={file.previews[0]} />
              </div>
            ) : file.previews.length === 2 ? (
              <div className="flex w-full h-full overflow-hidden">
                {file.previews.slice(0, 2).map((pf, i) => (
                  <div key={i} className="w-1/2 h-full relative overflow-hidden flex items-center justify-center">
                    <ThumbnailImage src={getThumbnailUrl(pf)} alt={pf.name} file={pf} />
                  </div>
                ))}
              </div>
            ) : file.previews.length === 3 ? (
              <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                {file.previews.slice(0, 3).map((pf, i) => (
                  <div key={i} className={`${i < 2 ? 'col-span-1 row-span-1' : 'col-span-2 row-span-1'} relative overflow-hidden flex items-center justify-center`}>
                    <ThumbnailImage src={getThumbnailUrl(pf)} alt={pf.name} file={pf} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 grid-rows-2 w-full h-full bg-neutral-900">
                {file.previews.slice(0, 4).map((pf, i) => (
                  <div key={i} className="w-full h-full relative overflow-hidden flex items-center justify-center">
                  <ThumbnailImage src={getThumbnailUrl(pf)} alt={pf.name} file={pf} />
                </div>
              ))}
            </div>
            )}
            {selectionMode && (
              <div className="absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10"
                style={{ borderColor: isSelected ? '#38bdf8' : 'rgba(255,255,255,0.5)', background: isSelected ? 'rgba(56,189,248,0.2)' : 'rgba(0,0,0,0.4)' }}>
                {isSelected && <svg className="w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            )}
            <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-blue-900/75 rounded text-[8px] font-bold tracking-wide text-blue-300">
               {file.subfolder_count} subfolder{file.subfolder_count > 1 ? 's' : ''}
            </div>
            <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/75 rounded text-[8px] font-bold tracking-wide text-white/90 uppercase">FOLDER</div>
          </div>
          <div className="h-[44px] p-2 bg-neutral-900 border-t border-neutral-800/60 flex flex-col justify-center flex-shrink-0 w-full overflow-hidden">
            <p className="text-[10px] sm:text-[11px] font-medium truncate text-neutral-200 w-full leading-tight">{file.name}</p>
            <p className="text-[9px] text-neutral-500 mt-0.5 font-mono truncate">
              {file.file_count || 0} files{file.total_size ? ` • ${formatSize(file.total_size)}` : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: itemWidth, height: cardHeight, contentVisibility: 'auto' }} className="flex flex-col flex-shrink-0 select-none">
      <div
        data-debug-id="1.1.6.1"
        data-debug-name="MediaRow"
        data-debug-type="card"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="group relative rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800/80 w-full h-full cursor-pointer flex flex-col flex-shrink-0 select-none"
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        <div data-debug-id="1.1.6.1.1" data-debug-name="Thumbnail" data-debug-type="other" className="w-full flex-1 min-h-0 bg-black/40 flex items-center justify-center overflow-hidden relative">
          {thumbnailUrl ? (            <ThumbnailImage src={thumbnailUrl} alt={file.name} file={file} />
           ) : (
             <div className="text-neutral-600 flex flex-col items-center justify-center">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
               </svg>
             </div>
            )}
            {selectionMode && (
              <div className="absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10"
                style={{ borderColor: isSelected ? '#38bdf8' : 'rgba(255,255,255,0.5)', background: isSelected ? 'rgba(56,189,248,0.2)' : 'rgba(0,0,0,0.4)' }}>
                {isSelected && <svg className="w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
            )}
            <div data-debug-id="1.1.6.1.4" data-debug-name="GridTypeIcon" data-debug-type="other" className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/75 rounded text-[8px] font-bold tracking-wide text-white/90 uppercase">{file.type || 'FILE'}</div>
            {file.type !== 'folder' && !selectionMode && (
             <button
               onClick={handleFavorite}
               className="absolute top-1 left-1 p-1 rounded-full bg-black/50 backdrop-blur-sm transition-transform active:scale-90 z-10"
               title={isFav ? 'Remove from favorites' : 'Add to favorites'}
             >
               <Heart
                 size={14}
                 className={isFav ? 'text-red-500 fill-red-500' : 'text-white/70'}
               />
             </button>
           )}
         </div>
          <div data-debug-id="1.1.6.1.2" data-debug-name="GridMeta" data-debug-type="other" className="h-[44px] p-2 bg-neutral-900 border-t border-neutral-800/60 flex flex-col justify-center flex-shrink-0 w-full overflow-hidden">
            {file.type === 'audio' ? (
              <>
                <p className="text-[10px] sm:text-[11px] font-medium truncate text-neutral-200 w-full leading-tight">{file.display_name || file.name}</p>
                <p className="text-[9px] text-neutral-500 mt-0.5 font-mono">{file.duration ? formatDuration(file.duration) : (file.size ? formatSize(file.size) : '0 MB')}</p>
              </>
            ) : (
              <>
                <p className="text-[10px] sm:text-[11px] font-medium truncate text-neutral-200 w-full leading-tight">{file.name}</p>
                <p className="text-[9px] text-neutral-500 mt-0.5 font-mono">{file.size ? formatSize(file.size) : '0 MB'}</p>
              </>
            )}
          </div>
       </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.file?.id === nextProps.file?.id && prevProps.file?.is_favorite === nextProps.file?.is_favorite && prevProps.onSelect === nextProps.onSelect && prevProps.onToggleFavorite === nextProps.onToggleFavorite && prevProps.itemWidth === nextProps.itemWidth && prevProps.cardHeight === nextProps.cardHeight;
});

const Row = memo(({ index, style, data }) => {
  const { rows, onSelect, onToggleFavorite, itemWidth, cardHeight, columnCount, selectionMode, selectedIds, onToggleSelect } = data;
  const row = rows[index];

  if (row.type === 'separator') {
    return (
      <div style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        paddingLeft: '12px',
        paddingBottom: '6px',
      }}>
        <GroupDivider label={row.label} folderPath={row.folderPath} />
      </div>
    );
  }

  return (
    <div style={{
      ...style,
      padding: `${GUTTER / 2}px 0`,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columnCount}, ${itemWidth}px)`,
        gap: GUTTER,
        justifyContent: 'center',
      }}>
        {row.items.map(item => (
          <VirtualizedMediaCard key={item.id} file={item} onSelect={onSelect} onToggleFavorite={onToggleFavorite} itemWidth={itemWidth} cardHeight={cardHeight} selectionMode={selectionMode} isSelected={selectedIds.has(item.id)} onToggleSelect={onToggleSelect} />
        ))}
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.index !== next.index) return false;
  if (prev.style !== next.style) return false;
  const prevRow = prev.data.rows[prev.index];
  const nextRow = next.data.rows[next.index];
  if (prevRow !== nextRow) return false;
  if (prev.data.onSelect !== next.data.onSelect) return false;
  if (prev.data.onToggleFavorite !== next.data.onToggleFavorite) return false;
  if (prev.data.itemWidth !== next.data.itemWidth) return false;
  if (prev.data.cardHeight !== next.data.cardHeight) return false;
  if (prev.data.columnCount !== next.data.columnCount) return false;
  if (prev.data.selectionMode !== next.data.selectionMode) return false;
  if (prev.data.selectedIds !== next.data.selectedIds) return false;
  if (prev.data.onToggleSelect !== next.data.onToggleSelect) return false;
  return true;
});

const MediaGrid = forwardRef(({ folders = [], files = [], onSelect, onToggleFavorite, hasMore, fetchingMore, onLoadMore, sortBy = null, sortOrder = 'asc', groupByFolder = false, onNearTop = null, selectionMode = false, selectedIds, onToggleSelect }, ref) => {
  const listRef = useRef(null);
  const outerListRef = useRef(null);
  const hasDividers = sortBy && sortBy !== 'size';
  const rowsRef = useRef([]);

  useImperativeHandle(ref, () => ({
    scrollToFile(fileId) {
      if (!listRef.current) return;
      const rows = rowsRef.current;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.type === 'separator') continue;
        if (row.items.some(item => item.id === fileId)) {
          listRef.current.scrollToItem(i, 'center');
          return;
        }
      }
    }
  }), []);

  // === INFINITE SCROLL DETECTION ===
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  // Primary: react-window onItemsRendered with overscanStopIndex for earlier detection
  const handleItemsRendered = useCallback(({ overscanStopIndex }) => {
    if (!hasMore || fetchingMore) return;
    const totalRows = rowsRef.current.length;
    if (totalRows === 0) return;
    if (overscanStopIndex >= totalRows - 2) {
      onLoadMoreRef.current();
    }
  }, [hasMore, fetchingMore]);

  // Fallback: scroll event listener on List's outer element
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
      if (onNearTop && el.scrollTop < 120 && !guard) {
        guard = true;
        onNearTop();
        requestAnimationFrame(() => { guard = false; });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, fetchingMore, onNearTop]);

  const flatItems = useMemo(() => {
    const result = [];

    if (groupByFolder) {
      const folderMap = {};
      for (const file of files) {
        const p = file.dir_path || '/';
        if (!folderMap[p]) folderMap[p] = [];
        folderMap[p].push(file);
      }
      const sortedPaths = Object.keys(folderMap).sort((a, b) => a.localeCompare(b));

      for (const path of sortedPaths) {
        const pathFiles = folderMap[path];
        if (hasDividers) {
          let lastLabel = null;
          for (const file of pathFiles) {
            const label = getGroupLabel(file, sortBy);
            if (label !== lastLabel) {
              lastLabel = label;
              result.push({ _separator: true, _folderPath: path, _label: label });
            }
            result.push(file);
          }
        } else {
          result.push({ _separator: true, _folderPath: path, _label: null });
          result.push(...pathFiles);
        }
      }
    } else {
      if (folders.length > 0) {
        result.push({ _separator: true, _label: 'Folders' });
        result.push(...folders);
      }
      if (files.length > 0) {
        result.push({ _separator: true, _label: 'Files' });
      }
      if (hasDividers) {
        let lastLabel = null;
        for (const file of files) {
          const label = getGroupLabel(file, sortBy);
          if (label !== lastLabel) {
            lastLabel = label;
            result.push({ _separator: true, _label: label });
          }
          result.push(file);
        }
      } else {
        result.push(...files);
      }
    }

    return result;
  }, [folders, files, hasDividers, sortBy, groupByFolder]);

  const items = flatItems || [...folders, ...files];

  // Debounce resetAfterIndex to avoid layout thrash during pagination.
  // useLayoutEffect blocks paint; useEffect + rAF lets the browser paint first.
  const resetTimerRef = useRef(null);
  useEffect(() => {
    if (resetTimerRef.current) cancelAnimationFrame(resetTimerRef.current);
    resetTimerRef.current = requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.resetAfterIndex(0);
      }
    });
    return () => {
      if (resetTimerRef.current) cancelAnimationFrame(resetTimerRef.current);
    };
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        No items found
      </div>
    );
  }

  return (
    <div
      data-debug-id="1.1.6"
      data-debug-name="MediaGrid"
      data-debug-type="grid"
      data-total-items={items.length}
      className="w-full h-full"
    >
      <div className="h-full" style={{ maxWidth: CONTAINER_MAX, marginInline: 'auto' }}>
        <AutoSizer>
          {({ height, width }) => {
            if (height <= 0 || width <= 0) {
              return <div className="w-full h-full" />;
            }
            const effectiveWidth = Math.min(width, CONTAINER_MAX);
            const ITEM_WIDTH = Math.min(MAX_CARD, Math.max(MIN_CARD, Math.round(effectiveWidth * 0.10)));
            const CARD_HEIGHT = ITEM_WIDTH + META_HEIGHT;
            const columnCount = Math.max(1, Math.min(MAX_COLUMNS, Math.floor((effectiveWidth - GUTTER) / (ITEM_WIDTH + GUTTER))));
            const gridHeight = Math.max(0, height - GUTTER);

            const rows = [];
            let currentRow = { items: [] };
            for (const item of items) {
              if (item._separator) {
                if (currentRow.items.length > 0) {
                  rows.push(currentRow);
                  currentRow = { items: [] };
                }
                rows.push({ type: 'separator', label: item._label, folderPath: item._folderPath });
              } else {
                currentRow.items.push(item);
                if (currentRow.items.length === columnCount) {
                  rows.push(currentRow);
                  currentRow = { items: [] };
                }
              }
            }
            if (currentRow.items.length > 0) rows.push(currentRow);
            rowsRef.current = rows;

            if (rows.length === 0) {
              return <div className="w-full h-full" />;
            }

            const getRowHeight = (index) => {
              const row = rows[index];
              return row.type === 'separator' ? 44 : CARD_HEIGHT + GUTTER;
            };

            const itemData = { rows, onSelect, onToggleFavorite, itemWidth: ITEM_WIDTH, cardHeight: CARD_HEIGHT, columnCount, selectionMode, selectedIds, onToggleSelect };

            return (
              <List
                ref={listRef}
                outerRef={outerListRef}
                height={gridHeight}
                width={width}
                itemCount={rows.length}
                itemSize={getRowHeight}
                overscanCount={2}
                itemData={itemData}
                onItemsRendered={handleItemsRendered}
                style={{
                  overscrollBehavior: 'none',
                  scrollBehavior: 'auto',
                }}
              >
                {Row}
              </List>
            );
          }}
        </AutoSizer>
        {fetchingMore && (
          <div className="flex items-center justify-center py-4">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
});

export default memo(MediaGrid);
