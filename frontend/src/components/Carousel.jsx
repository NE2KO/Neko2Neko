import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import VideoIcon from './icons/VideoIcon';
import AudioIcon from './icons/AudioIcon';
import ImageIcon from './icons/ImageIcon';
import { Heart } from 'lucide-react';
import { getGroupLabel } from '../utils/grouping';


import { fetchBlob, getCached } from '../utils/thumbCache';
import { useIsFavorite } from '../store/favoritesStore';


// Thumbnail strip item sizing. `lg` is used by the dedicated Music UI so the
// carousel reads as a big, tappable track list (vs the compact media-vault strip).
const ITEM_SIZES = {
  sm: 'w-12 h-12 md:w-14 md:h-14',
  lg: 'w-20 h-20 md:w-24 md:h-24',
};

const CarouselItem = React.memo(React.forwardRef(function CarouselItem({ file, currentFileId, onClick, cacheBust, onToggleFavorite, itemSize = 'sm' }, ref) {
  const isActive = file.id === currentFileId;
  const [imgFailed, setImgFailed] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const fileId = file.file_id || file.id;
  const isFav = useIsFavorite(fileId, file.is_favorite ? 1 : 0);
  const thumbUrl = file.type === 'video' || file.type === 'audio'
    ? `/thumbnails/${file.id}.jpg?v=${cacheBust}`
    : file.type === 'image'
    ? `/file/${file.id}`
    : null;

  const handleFavoriteClick = useCallback((e) => {
    e.stopPropagation();
    if (isToggling) return;
    setIsToggling(true);
    onToggleFavorite(file).finally(() => setIsToggling(false));
  }, [isToggling, onToggleFavorite, file]);

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
    }, { root: null, rootMargin: '50px' });
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
          onClick={handleFavoriteClick}
          className={`absolute top-0.5 right-0.5 p-1 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10 ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={12} className={isFav ? 'text-red-500 fill-red-500' : 'text-white/80'} />
        </span>
      )}
    </div>
  );
}));

export function Carousel({ files, currentFile, onSelect, sortBy = null, sortOrder = 'asc', cacheBust = '', onToggleFavorite = null, autoHide = false, hidden = false, onToggleHidden = () => {}, itemSize = 'sm', restoreScrollKey = null, slide = false }) {
  const currentFileId = currentFile?.id;
  const scrollRef = useRef(null);
  const itemRefs = useRef(new Map());
  const tweenRafRef = useRef(null);
  const targetScrollRef = useRef(null);
  const SCROLL_STORAGE_KEY = `mv_carousel_scroll_${restoreScrollKey || 'default'}`;
  const scrollRestoredRef = useRef(false);

  const showFolderLabels = files?.length > 1 && files.some(f => f.dir_path !== files[0]?.dir_path);

  const getGroupLabelShared = useCallback((item) => getGroupLabel(item, sortBy), [sortBy]);

  const metadataGroupedNodes = useMemo(() => {
    if (!sortBy || sortBy === 'size') return null;
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
  }, [files, sortBy, getGroupLabelShared]);

  const getActiveWindow = useCallback((list, activeId) => {
    if (!list || list.length === 0) return list;
    // Render a tight windowed strip — only the ~25 items nearest the active
    // item stay mounted.  A smaller window means fewer IntersectionObservers,
    // fewer blob fetches and less GPU compositing work.
    if (list.length <= 25) return list;
    let activeIdx = list.findIndex((n) => {
      if (n && n.type === 'item') return n.file && n.file.id === activeId;
      if (n && n.id) return n.id === activeId;
      return false;
    });
    if (activeIdx === -1) return list.slice(0, 25);
    const radius = 12;
    // Expand toward the opposite edge when near start/end so the carousel
    // doesn't show empty space on one side.
    let start = Math.max(0, activeIdx - radius);
    let end = Math.min(list.length, activeIdx + radius + 1);
    const windowLen = end - start;
    if (start === 0 && windowLen < radius * 2 + 1) {
      end = Math.min(list.length, start + radius * 2 + 1);
    } else if (end === list.length && windowLen < radius * 2 + 1) {
      start = Math.max(0, end - radius * 2 - 1);
    }
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
    return (
      <CarouselItem
        key={item.id}
        file={item}
        currentFileId={currentFileId}
        onClick={() => onSelect(item)}
        cacheBust={cacheBust}
        onToggleFavorite={onToggleFavorite}
        itemSize={itemSize}
        ref={setItemRef(item.id)}
      />
    );
  }, [currentFileId, onSelect, cacheBust, onToggleFavorite, setItemRef, itemSize]);

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
    const maxScroll = container.scrollWidth - container.clientWidth;
    const clamped = Math.max(0, Math.min(maxScroll, target));
    const diff = clamped - container.scrollLeft;
    if (Math.abs(diff) < 0.5) {
      container.scrollLeft = clamped;
      tweenRafRef.current = null;
      return;
    }
    container.scrollLeft += diff * 0.12;
    tweenRafRef.current = requestAnimationFrame(easeToTarget);
  }, []);
 

  const slideRafRef = useRef(null);

  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

  const animateSlide = useCallback((container, start, target) => {
    if (slideRafRef.current != null) {
      cancelAnimationFrame(slideRafRef.current);
      slideRafRef.current = null;
    }
    const delta = target - start;
    if (Math.abs(delta) < 0.5) {
      container.scrollLeft = target;
      return;
    }
    const duration = Math.min(700, 350 + Math.abs(delta) * 0.9);
    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      container.scrollLeft = start + delta * easeInOutCubic(t);
      if (t < 1) {
        slideRafRef.current = requestAnimationFrame(step);
      }
    };
    slideRafRef.current = requestAnimationFrame(step);
  }, []);

  // Keep the active item horizontally centered inside the scroll viewport.
  // Always animate to the target — no instant snaps. We defer layout reads
  // to a rAF so the browser has finished laying out the newly-mounted items
  // in the windowed slice, preventing wrong-direction jumps.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !currentFileId) return;

    let retryRaf = null;
    const computeTarget = () => {
      const el = itemRefs.current.get(currentFileId);
      if (!el || !container) {
        retryRaf = requestAnimationFrame(computeTarget);
        return;
      }
      const cWidth = container.clientWidth;
      if (cWidth === 0) {
        retryRaf = requestAnimationFrame(computeTarget);
        return;
      }
      const cLeft = container.scrollLeft;
      const eLeft = el.offsetLeft;
      const eWidth = el.offsetWidth;
      const delta = (eLeft + eWidth / 2) - (cLeft + cWidth / 2);
      const maxScroll = container.scrollWidth - container.clientWidth;
      const target = Math.max(0, Math.min(maxScroll, cLeft + delta));

      if (slide) {
        const startScroll = container.scrollLeft;
        animateSlide(container, startScroll, target);
      } else {
        const diff = target - container.scrollLeft;
        if (Math.abs(diff) < 1) {
          return;
        }
        targetScrollRef.current = target;
        if (tweenRafRef.current == null) {
          tweenRafRef.current = requestAnimationFrame(easeToTarget);
        }
      }
    };

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(computeTarget);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (retryRaf != null) cancelAnimationFrame(retryRaf);
      if (slideRafRef.current != null) cancelAnimationFrame(slideRafRef.current);
    };
  }, [currentFileId, slide, animateSlide]);
  // Scroll restoration: on mount, restore the last scroll position from
  // localStorage so that a tab reload doesn't snap the carousel back to the
  // active item — which causes a long jump when the user was scrolled far away.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !restoreScrollKey) return;
    if (scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    try {
      const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
      if (saved != null) {
        const pos = parseFloat(saved);
        if (!isNaN(pos) && pos > 0) {
          container.scrollLeft = pos;
        }
      }
    } catch {}
  }, [restoreScrollKey, SCROLL_STORAGE_KEY]);

  // Persist scroll position to localStorage on unmount so it can be restored
  // on the next mount (e.g. after a tab reload).
  useEffect(() => {
    if (!restoreScrollKey) return;
    const container = scrollRef.current;
    if (!container) return;
    const save = () => {
      try {
        localStorage.setItem(SCROLL_STORAGE_KEY, String(container.scrollLeft));
      } catch {}
    };
    container.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      container.removeEventListener('scroll', save);
    };
  }, [restoreScrollKey, SCROLL_STORAGE_KEY]);

  if (!files || files.length < 1) return null;

  const items = metadataGroupedNodes ? (() => {
    const windowed = getActiveWindow(metadataGroupedNodes, currentFileId);
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
  })() : showFolderLabels && grouped ? (
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
  ) : (() => {
    const windowed = getActiveWindow(files, currentFileId);
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
          className={`flex gap-2 overflow-x-auto items-stretch py-1 justify-start`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' }}
        >
          {items}
        </div>
      </div>
    </div>
  );
}

export default Carousel;
