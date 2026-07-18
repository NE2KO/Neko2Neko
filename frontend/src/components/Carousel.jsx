import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import VideoIcon from './icons/VideoIcon';
import AudioIcon from './icons/AudioIcon';
import ImageIcon from './icons/ImageIcon';
import { Heart } from 'lucide-react';
import { getGroupLabel } from '../utils/grouping';


import { fetchBlob, getCached } from '../utils/thumbCache';

// Thumbnail strip item sizing. `lg` is used by the dedicated Music UI so the
// carousel reads as a big, tappable track list (vs the compact media-vault strip).
const ITEM_SIZES = {
  sm: 'w-12 h-12 md:w-14 md:h-14',
  lg: 'w-20 h-20 md:w-24 md:h-24',
};

  const CarouselItem = React.memo(React.forwardRef(function CarouselItem({ file, isActive, onClick, cacheBust, onToggleFavorite, itemSize = 'sm' }, ref) {
   const [imgFailed, setImgFailed] = useState(false);
   const isFav = file.is_favorite === 1 || file.is_favorite === true;
   const thumbUrl = file.type === 'video' || file.type === 'audio'
   ? `/thumbnails/${file.id}.jpg?v=${cacheBust}`
   : file.type === 'image'
   ? `/file/${file.id}`
   : null;

   // Only resolve the thumbnail once the item is near the viewport. The carousel
   // renders a wide windowed strip (up to ~160 items) that is NOT virtualized, so
   // without this every item would fire a thumbnail request on open — that burst
   // is what made opening a media item / folder feel heavy.
   const [blobUrl, setBlobUrl] = useState(() => getCached(thumbUrl) || null);
   const [shouldLoad, setShouldLoad] = useState(() => !!getCached(thumbUrl));
   const localRef = useRef(null);

   const setRefs = useCallback((el) => {
     localRef.current = el;
     if (typeof ref === 'function') ref(el);
     else if (ref) ref.current = el;
   }, [ref]);

   useEffect(() => {
     const el = localRef.current;
     if (!el || !thumbUrl || shouldLoad) return;
     const io = new IntersectionObserver((entries) => {
       for (const e of entries) {
         if (e.isIntersecting) { setShouldLoad(true); io.disconnect(); break; }
       }
      }, { root: null, rootMargin: '150px' });
     io.observe(el);
     return () => io.disconnect();
   }, [thumbUrl, shouldLoad]);

   useEffect(() => {
     if (!shouldLoad || !thumbUrl) return;
     let cancelled = false;
     fetchBlob(thumbUrl, { priority: 'low' }).then((u) => {
       if (!cancelled && u) setBlobUrl(u);
     });
     return () => { cancelled = true; };
   }, [shouldLoad, thumbUrl]);

   const activeBg = { video: 'bg-sky-500/25', audio: 'bg-purple-500/25', image: 'bg-green-500/25' }[file.type] || 'bg-sky-500/25';
  const barColor = { video: 'bg-sky-400', audio: 'bg-purple-400', image: 'bg-green-400' }[file.type] || 'bg-sky-400';
  const typeIcon = { video: <VideoIcon className="w-5 h-5 text-neutral-600" />, audio: <AudioIcon className="w-5 h-5 text-purple-400" />, image: <ImageIcon className="w-5 h-5 text-neutral-600" /> }[file.type] || <VideoIcon className="w-5 h-5 text-neutral-600" />;

  return (
      <div
        ref={setRefs}
        className="relative flex-shrink-0 first:ml-1 last:mr-1"
      >
      <button
        onClick={onClick}
        className={`${ITEM_SIZES[itemSize] || ITEM_SIZES.sm} rounded-lg overflow-hidden relative block transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-60 hover:opacity-90'
        }`}
      >
        {thumbUrl && !imgFailed ? (
          <img
            src={blobUrl || thumbUrl}
            alt={file.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${isActive ? activeBg : 'bg-neutral-800'}`}>
            {typeIcon}
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60">
          <p className="text-[8px] truncate text-white/70">{file.display_name || file.name}</p>
        </div>
      </button>
      {isActive && (
        <div className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-8 rounded-full ${barColor}`} />
      )}
      {onToggleFavorite && (
        <span
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(file); }}
          className="absolute top-0.5 right-0.5 p-1 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10"
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={12} className={isFav ? 'text-red-500 fill-red-500' : 'text-white/80'} />
        </span>
      )}
    </div>
  );
}));

  export function Carousel({ files, currentFile, onSelect, sortBy = null, sortOrder = 'asc', cacheBust = '', onToggleFavorite = null, autoHide = false, hidden = false, onToggleHidden = () => {}, itemSize = 'sm' }) {
  const scrollRef = useRef(null);
  const itemRefs = useRef(new Map());
  const tweenRafRef = useRef(null);
  const targetScrollRef = useRef(null);
  // First centering after the carousel mounts (i.e. when the modal opens from a
  // grid click) must JUMP instantly to the active item — no tween/scroll. After
  // that, in-strip navigation is allowed to animate smoothly.
  const mountedCenterRef = useRef(false);

  const showFolderLabels = files?.length > 1 && files.some(f => f.dir_path !== files[0]?.dir_path);

  const getGroupLabelShared = useCallback((item) => getGroupLabel(item, sortBy), [sortBy]);

  const metadataGroupedNodes = useMemo(() => {
    if (!sortBy || sortBy === 'size' || showFolderLabels) return null;
    const nodes = [];
    let lastLabel = null;
    for (const file of files) {
      const label = getGroupLabelShared(file);
      if (label !== lastLabel) {
        lastLabel = label;
        nodes.push({ type: 'divider', label });
      }
      nodes.push({ type: 'item', file });
    }
    return nodes;
  }, [files, sortBy, getGroupLabelShared, showFolderLabels]);

   const getActiveWindow = useCallback((list, activeId) => {
    if (!list || list.length === 0) return list;
    // Render the whole strip when it fits a comfortable scroll range; only
    // window for larger lists so the carousel stays freely scrollable
    // (the active item is still centered, so this is items-per-side).
    // Kept small (~61 nodes) on purpose: the strip only shows ~21 items at
    // once, so a big window just mounts hundreds of DOM nodes / observers on
    // every modal open — that mount cost is what made opening feel heavy.
    if (list.length <= 61) return list;
    let activeIdx = list.findIndex((n) => {
      if (n && n.type === 'item') return n.file && n.file.id === activeId;
      if (n && n.id) return n.id === activeId;
      return false;
    });
    if (activeIdx === -1) return list.slice(0, 61);
    const radius = 30;
   const start = Math.max(0, activeIdx - radius);
   const end = Math.min(list.length, activeIdx + radius + 1);
   return list.slice(start, end);
   }, []);

  const grouped = useMemo(() => {
    if (!showFolderLabels) return null;
    const groups = [];
    let currentGroup = null;
    for (const file of files) {
      const path = file.dir_path || '/';
      if (!currentGroup || currentGroup.path !== path) {
        currentGroup = { path, files: [] };
        groups.push(currentGroup);
      }
      currentGroup.files.push(file);
    }
    return groups;
  }, [files, showFolderLabels]);

  const setItemRef = useCallback((id) => (el) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const renderItem = useCallback((item) => {
    const isActive = item.id === currentFile?.id;
    return (
      <CarouselItem
        key={item.id}
        file={item}
        isActive={isActive}
        onClick={() => onSelect(item)}
        cacheBust={cacheBust}
        onToggleFavorite={onToggleFavorite}
        itemSize={itemSize}
        ref={setItemRef(item.id)}
      />
    );
  }, [currentFile?.id, onSelect, cacheBust, onToggleFavorite, setItemRef, itemSize]);

  const stopTween = useCallback(() => {
    if (tweenRafRef.current != null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
  }, []);

  const easeToTarget = useCallback(() => {
    const container = scrollRef.current;
    const target = targetScrollRef.current;
    if (!container || target == null) {
      tweenRafRef.current = null;
      return;
    }
    const diff = target - container.scrollLeft;
    if (Math.abs(diff) < 0.5) {
      container.scrollLeft = target;
      tweenRafRef.current = null;
      return;
    }
    container.scrollLeft += diff * 0.2;
    tweenRafRef.current = requestAnimationFrame(easeToTarget);
  }, []);

  // Keep the active item horizontally centered inside the scroll viewport.
  // A single rAF tween continuously eases toward the latest target, replacing
  // any previous smooth-scroll so rapid left/right navigation never oscillates.
  // NOTE: intentionally NOT keyed on `hidden` — auto-hide idle toggles must not
  // re-center (and fight) the user's manual scroll.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !currentFile?.id) return;
    const rafId = requestAnimationFrame(() => {
      const el = itemRefs.current.get(currentFile.id);
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const delta = (eRect.left + eRect.width / 2) - (cRect.left + cRect.width / 2);
      if (Math.abs(delta) < 1) {
        stopTween();
        mountedCenterRef.current = true;
        return;
      }
      // Snap instantly on the first centering after mount (modal opened from a
      // grid click): the strip must jump straight to the active item, never
      // scroll/tween across the width. Snap large jumps too (far-down items),
      // since animating the full distance reads as "load lag". Keep the smooth
      // tween only for nearby navigation (carousel arrows / adjacent clicks).
      const SNAP_THRESHOLD = container.clientWidth * 1.5;
      if (!mountedCenterRef.current || hidden || Math.abs(delta) > SNAP_THRESHOLD) {
        container.scrollLeft += delta;
        stopTween();
        mountedCenterRef.current = true;
        return;
      }
      mountedCenterRef.current = true;
      targetScrollRef.current = container.scrollLeft + delta;
      if (tweenRafRef.current == null) {
        tweenRafRef.current = requestAnimationFrame(easeToTarget);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [currentFile?.id, stopTween, easeToTarget]);

  // Cancel the tween on unmount.
  useEffect(() => () => stopTween(), [stopTween]);

  if (!files || files.length < 1) return null;

  const items = showFolderLabels && grouped ? (
    grouped.map((group, gi) => (
      <React.Fragment key={gi}>
        {gi > 0 && (
          <div className="flex items-center flex-shrink-0 mx-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none">
              <svg className="w-3 h-3 text-neutral-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {group.path.split('/').pop()}
            </div>
          </div>
        )}
        {group.files.map((item) => renderItem(item))}
      </React.Fragment>
    ))
  ) : metadataGroupedNodes ? (() => {
    const windowed = getActiveWindow(metadataGroupedNodes, currentFile?.id);
    return windowed.map((node, idx) => {
      if (node.type === 'divider') {
        return (
          <div key={`div-${idx}`} className="flex items-center flex-shrink-0 mx-3">
            <div className="px-2.5 py-0.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none bg-neutral-900 border border-neutral-700 rounded">
              {node.label}
            </div>
          </div>
        );
      }
      return renderItem(node.file);
    });
  })() : (() => {
    const windowed = getActiveWindow(files, currentFile?.id);
    return windowed.map((item) => renderItem(item));
  })();

  return (
    <div
      data-debug-id="1.1.9.1"
      data-debug-name="Carousel"
      data-debug-type="player"
      className="transition-all duration-300 ease-out"
    >
      <div className="bg-neutral-950/90 backdrop-blur-sm border-t border-white/10 px-2 pt-3 pb-1.5">
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto items-stretch py-1 justify-start"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' }}
        >
          {items}
        </div>
      </div>
    </div>
  );
}

export default Carousel;
