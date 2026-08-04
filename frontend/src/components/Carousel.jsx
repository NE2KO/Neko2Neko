import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import VideoIcon from './icons/VideoIcon';
import AudioIcon from './icons/AudioIcon';
import ImageIcon from './icons/ImageIcon';
import { Heart } from 'lucide-react';
import { getGroupLabel } from '../utils/grouping';

import { useIsFavorite } from '../store/favoritesStore';


// Thumbnail strip item sizing. `lg` is used by the dedicated Music UI so the
// carousel reads as a big, tappable track list (vs the compact media-vault strip).
const ITEM_SIZES = {
  sm: 'w-12 h-12 md:w-14 md:h-14',
  lg: 'w-20 h-20 md:w-24 md:h-24',
};

// Virtualization layout constants. They mirror the previous flex `gap-2` +
// `first:ml-1 last:mr-1` so the rendered spacing is identical:
//   GAP_PX = 8   (flex gap between items) -> implemented as item right-padding
//   LEAD   = 4   (first item left margin)
//   TRAIL  = 4   (last item right margin)
const GAP_PX = 8;
const LEAD = 4;
const TRAIL = 4;
const WINDOW_RADIUS = 12;   // ~25 nodes mounted around the active item initially
const SCROLL_BUFFER = 8;    // extra nodes kept mounted beyond the viewport
const INCLUDE_ACTIVE_MARGIN = 4; // keep the active item mounted near the window edge
const DRAG_THRESHOLD = 4;   // pointer movement before it becomes a drag-scroll
const DEFAULT_PITCH = { sm: 56, lg: 104 }; // item width + gap estimates (md+)

const estimateDividerWidth = (node) => {
  const text = node.folderName || node.label || '';
  return text.length * 7 + 40;
};

const CarouselItem = React.memo(React.forwardRef(function CarouselItem({ file, currentFileId, onClick, cacheBust, onToggleFavorite, itemSize = 'sm' }, ref) {
  const isActive = file.id === currentFileId;
  const [imgFailed, setImgFailed] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const fileId = file.file_id || file.id;
  const isFav = useIsFavorite(fileId, file.is_favorite ? 1 : 0);
  // All types (video / audio / image) use the lightweight 200px thumbnail the
  // backend generates — previously images loaded the full original file here,
  // which is what made the strip heavy when browsing an image gallery.
  const thumbUrl = file.id ? `/thumbnails/${file.id}.jpg?v=${cacheBust}` : null;

  const handleFavoriteClick = useCallback((e) => {
    e.stopPropagation();
    if (isToggling) return;
    setIsToggling(true);
    onToggleFavorite(file).finally(() => setIsToggling(false));
  }, [isToggling, onToggleFavorite, file]);

  const activeBg = { video: 'bg-sky-500/25', audio: 'bg-purple-500/25', image: 'bg-green-500/25' }[file.type] || 'bg-sky-500/25';
  const borderColor = { video: 'border-sky-400', audio: 'border-purple-400', image: 'border-green-400' }[file.type] || 'border-sky-400';
  const typeIcon = { video: <VideoIcon className="w-5 h-5 text-neutral-600" />, audio: <AudioIcon className="w-5 h-5 text-purple-400" />, image: <ImageIcon className="w-5 h-5 text-neutral-600" /> }[file.type] || <VideoIcon className="w-5 h-5 text-neutral-600" />;

  return (
      <div
        ref={ref}
        className="relative flex-shrink-0 select-none"
        style={{ paddingRight: GAP_PX }}
      >
      <button
        onClick={onClick}
        draggable={false}
        className={`${ITEM_SIZES[itemSize] || ITEM_SIZES.sm} rounded-lg overflow-hidden relative block transition-opacity border-2 ${
          isActive ? borderColor : 'border-transparent'
        } ${
          isActive ? 'opacity-100' : 'opacity-60 hover:opacity-90'
        }`}
      >
        {thumbUrl && !imgFailed ? (
          <img
            src={thumbUrl}
            alt={file.name}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="w-full h-full object-cover"
            style={{ WebkitUserDrag: 'none', userSelect: 'none' }}
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
  const SCROLL_STORAGE_KEY = `mv_carousel_scroll_${restoreScrollKey || 'default'}`;
  const scrollRestoredRef = useRef(false);
  const isFirstCenterRef = useRef(true);
  const activeWindowedRef = useRef(false);

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

  // Flat node list: items + dividers (metadata labels or folder labels).
  const nodes = useMemo(() => {
    if (metadataGroupedNodes) return metadataGroupedNodes;
    if (showFolderLabels && grouped) {
      const flat = [];
      for (let gi = 0; gi < grouped.length; gi++) {
        const g = grouped[gi];
        if (gi > 0) flat.push({ type: 'divider', folderName: g.path.split('/').pop() });
        for (const f of g.files) flat.push({ type: 'item', file: f });
      }
      return flat;
    }
    return (files || []).map((f) => ({ type: 'item', file: f }));
  }, [metadataGroupedNodes, showFolderLabels, grouped, files]);

  const [win, setWin] = useState({ start: 0, end: 25 });
  const [pitch, setPitch] = useState(() => DEFAULT_PITCH[itemSize] || 56);
  const [dividerWidths, setDividerWidths] = useState({});

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const winRef = useRef(win);
  winRef.current = win;

  // Prefix sums of node widths: prefix[i] = total width of nodes [0, i). A node's
  // laid-out left edge is LEAD + prefix[i], which is deterministic regardless of
  // which window is mounted — so re-windowing never shifts the visible content.
  const prefix = useMemo(() => {
    const arr = new Array(nodes.length + 1);
    arr[0] = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const w = n.type === 'item'
        ? pitch
        : (dividerWidths[n.folderName || n.label] || estimateDividerWidth(n));
      arr[i + 1] = arr[i] + w;
    }
    return arr;
  }, [nodes, pitch, dividerWidths]);
  const prefixRef = useRef(prefix);
  prefixRef.current = prefix;

  // id -> node index, so the active item lookup is O(1) instead of a scan.
  const nodeIndexById = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'item' && n.file && n.file.id != null && !m.has(n.file.id)) {
        m.set(n.file.id, i);
      }
    }
    return m;
  }, [nodes]);

  const findActiveIndex = useCallback(() => {
    if (!currentFileId) return -1;
    const i = nodeIndexById.get(currentFileId);
    return i == null ? -1 : i;
  }, [currentFileId, nodeIndexById]);

  // Count of nodes entirely to the left of a horizontal position.
  const countLeft = useCallback((arr, pos) => {
    const target = pos - LEAD;
    if (target < 0) return 0;
    let lo = 0, hi = arr.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }, []);

  // Recompute the mounted window. Default mode covers whatever is visible at the
  // current scrollLeft (+ buffer) — it never re-centers on the active item, so
  // unrelated parent re-renders can't yank the window away from where the user
  // is scrolled (that was the "blank strip until you nudge" glitch). The active
  // item is kept mounted when it sits near the window edge so its marker +
  // centering stay resolvable. centerOnActive mode is used only by the centering
  // effect to bring a far-away active item into the window before scrolling to it.
  const recomputeWindow = useCallback((centerOnActive = false) => {
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;
    const arr = prefixRef.current;
    const total = nodesRef.current.length;
    if (total === 0) { setWin({ start: 0, end: 0 }); return; }
    const ai = findActiveIndex();
    let s, e;
    if (centerOnActive && ai >= 0) {
      s = Math.max(0, ai - WINDOW_RADIUS);
      e = Math.min(total, ai + WINDOW_RADIUS + 1);
    } else {
      const x = container.scrollLeft;
      const right = x + container.clientWidth;
      const firstVisible = Math.min(total - 1, countLeft(arr, x));
      const lastVisible = Math.min(total - 1, countLeft(arr, right));
      s = Math.max(0, firstVisible - SCROLL_BUFFER);
      e = Math.min(total, lastVisible + SCROLL_BUFFER + 1);
      if (ai >= 0 && ai >= s - INCLUDE_ACTIVE_MARGIN && ai <= e + INCLUDE_ACTIVE_MARGIN) {
        s = Math.min(s, ai);
        e = Math.max(e, ai + 1);
      }
    }
    const cur = winRef.current;
    if (s !== cur.start || e !== cur.end) setWin({ start: s, end: e });
  }, [countLeft, findActiveIndex]);

  // Refs bridge the latest helpers into the tweens/effects WITHOUT making their
  // identities part of an effect's dependency array. Identity churn from parent
  // re-renders (SendQueue rebuilds `files` on every render) was re-triggering
  // the centering effect and yanking the strip back to the active item each time.
  const findActiveIndexRef = useRef(findActiveIndex);
  findActiveIndexRef.current = findActiveIndex;
  const recomputeWindowRef = useRef(recomputeWindow);
  recomputeWindowRef.current = recomputeWindow;
  const centerFileIdRef = useRef(currentFileId);
  centerFileIdRef.current = currentFileId;

  // Live target that centers the current item's visual button inside the scroll
  // viewport. Recomputed on demand so tween steps chase the item's REAL position
  // — correcting the small drift caused by divider widths being measured (and
  // the prefix sums updating) mid-animation, which left the active item slightly
  // off-center from the play/pause button.
  const computeCenterTarget = useCallback((container, el) => {
    if (!container || !el) return null;
    const cWidth = container.clientWidth;
    if (cWidth === 0) return null;
    const cRect = container.getBoundingClientRect();
    const btn = el.firstElementChild || el;
    const eRect = btn.getBoundingClientRect();
    const eCenter = (eRect.left - cRect.left) + eRect.width / 2;
    const delta = eCenter - cWidth / 2;
    const maxScroll = container.scrollWidth - container.clientWidth;
    return Math.max(0, Math.min(maxScroll, container.scrollLeft + delta));
  }, []);

  // Recompute from the live scroll position whenever the list, measured sizes
  // or visibility change (no scroll event fires in those cases). This removes
  // the "blank until you nudge" glitch and the empty strip after an unhide.
  useEffect(() => {
    recomputeWindow(false);
  }, [nodes, pitch, dividerWidths, hidden, recomputeWindow]);

  // Measure the real item pitch once items render (and re-measure on the
  // md breakpoint via ResizeObserver). Item width = button width + GAP_PX.
  useLayoutEffect(() => {
    const first = itemRefs.current.values().next().value;
    if (!first) return;
    const w = first.offsetWidth;
    if (w > 0 && Math.abs(w - pitch) > 0.5) setPitch(w);
  }, [win, nodes, pitch]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const first = itemRefs.current.values().next().value;
      if (first) {
        const w = first.offsetWidth;
        if (w > 0) setPitch(w);
      }
      recomputeWindow(false);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [recomputeWindow]);

  // Follow the scroll position: mount a small window around what is visible so
  // the whole list can be scrolled without rendering everything. Because node
  // positions are deterministic (LEAD + prefix[i]), no scrollLeft correction is
  // needed — the content stays put while the window slides.
  const scrollRafRef = useRef(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      recomputeWindow(false);
    });
  }, [recomputeWindow]);

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

  const setDividerRef = useCallback((key) => (el) => {
    if (!el) return;
    const isFolder = el.dataset.folder === '1';
    const inner = el.firstElementChild;
    const innerW = inner ? inner.getBoundingClientRect().width : el.getBoundingClientRect().width;
    const margin = isFolder ? 12 : 24; // mx-1.5 (6+6) / mx-3 (12+12)
    const w = innerW + margin;
    setDividerWidths((prev) => {
      if (Math.abs((prev[key] || 0) - w) < 0.5) return prev;
      return { ...prev, [key]: w };
    });
  }, []);

  const easeToTarget = useCallback(() => {
    const container = scrollRef.current;
    const el = centerFileIdRef.current ? itemRefs.current.get(centerFileIdRef.current) : null;
    if (!container || !el) {
      tweenRafRef.current = null;
      return;
    }
    // Live target: chase the item's real position each frame so the active item
    // lands exactly centered even while divider prefix-sums settle.
    const target = computeCenterTarget(container, el);
    if (target == null) {
      tweenRafRef.current = null;
      return;
    }
    const diff = target - container.scrollLeft;
    if (Math.abs(diff) < 0.5) {
      container.scrollLeft = target;
      tweenRafRef.current = null;
      return;
    }
    container.scrollLeft += diff * 0.12;
    tweenRafRef.current = requestAnimationFrame(easeToTarget);
  }, [computeCenterTarget]);

  const slideRafRef = useRef(null);

  const animateSlide = useCallback((container) => {
    if (slideRafRef.current != null) {
      cancelAnimationFrame(slideRafRef.current);
      slideRafRef.current = null;
    }
    const step = () => {
      const el = centerFileIdRef.current ? itemRefs.current.get(centerFileIdRef.current) : null;
      if (!container || !el) {
        slideRafRef.current = null;
        return;
      }
      const target = computeCenterTarget(container, el);
      if (target == null) {
        slideRafRef.current = null;
        return;
      }
      const diff = target - container.scrollLeft;
      if (Math.abs(diff) < 0.5) {
        container.scrollLeft = target;
        slideRafRef.current = null;
        return;
      }
      container.scrollLeft += diff * 0.14;
      slideRafRef.current = requestAnimationFrame(step);
    };
    slideRafRef.current = requestAnimationFrame(step);
  }, [computeCenterTarget]);

  // Keep the active item horizontally centered inside the scroll viewport.
  // Always animate to the target — no instant snaps. We defer layout reads
  // to a rAF so the browser has finished laying out the newly-mounted items
  // in the windowed slice, preventing wrong-direction jumps.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !currentFileId) return;

    // On the very first mount, if a saved scroll position exists, let the
    // scroll-restoration effect keep the user where they were (no long jump
    // back to the active item). handleScroll will re-window as needed.
    if (isFirstCenterRef.current) {
      isFirstCenterRef.current = false;
      if (restoreScrollKey) {
        try {
          const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
          const pos = parseFloat(saved);
          if (!isNaN(pos) && pos > 0) return;
        } catch {}
      }
    }

    let retryRaf = null;
    let frames = 0;
    activeWindowedRef.current = false;
    centerFileIdRef.current = currentFileId;

    const computeTarget = () => {
      if (frames++ > 120) { retryRaf = null; return; }
      if (dragRef.current != null) { retryRaf = requestAnimationFrame(computeTarget); return; }
      const container = scrollRef.current;
      if (!container || container.clientWidth === 0) {
        retryRaf = requestAnimationFrame(computeTarget);
        return;
      }
      if (findActiveIndexRef.current() < 0) return; // active item not in this list — nothing to center
      const el = itemRefs.current.get(currentFileId);
      if (!el) {
        // The active item isn't mounted because the user is scrolled away from
        // it. Bring it into the window once, then keep retrying until it mounts.
        if (!activeWindowedRef.current) {
          activeWindowedRef.current = true;
          recomputeWindowRef.current(true);
        }
        retryRaf = requestAnimationFrame(computeTarget);
        return;
      }
      const target = computeCenterTarget(container, el);
      if (target == null) return;

      if (slide) {
        animateSlide(container);
      } else {
        const diff = target - container.scrollLeft;
        if (Math.abs(diff) < 1) {
          return;
        }
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
    // findActiveIndex/recomputeWindow are intentionally NOT deps: they are
    // recreated on every parent render (SendQueue rebuilds `files` each render),
    // and including them re-triggered centering after every render — yanking the
    // strip back to the active item the moment the user tried to scroll away.
    // The stable refs above always see the latest implementations.
    //
    // pitch / dividerWidths are deps so the active item is re-centered once the
    // real item widths settle (layout drift would otherwise leave a MID-LIST item
    // a few px off-axis from the header + play/pause button). End items clamp to
    // scrollLeft 0 / maxScroll, so they stay pinned at the strip edge.
  }, [currentFileId, slide, animateSlide, easeToTarget, restoreScrollKey, SCROLL_STORAGE_KEY, pitch, dividerWidths]);

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

  // ---- Grab-to-scroll (mouse / pen). Touch keeps native pan-x scrolling so the
  // mobile feel is unchanged; this only fixes desktop drag (hidden scrollbar +
  // native image drag) and long-press. A real drag suppresses the item click.
  // NOTE: no setPointerCapture here — capturing the container retargets the
  // subsequent `click` event to the container, which would break item taps.
  // We listen on `window` during the drag instead.
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const stopAllTweens = useCallback(() => {
    if (tweenRafRef.current != null) {
      cancelAnimationFrame(tweenRafRef.current);
      tweenRafRef.current = null;
    }
    if (slideRafRef.current != null) {
      cancelAnimationFrame(slideRafRef.current);
      slideRafRef.current = null;
    }
  }, []);

  const handlePointerMove = useCallback((e) => {
    const state = dragRef.current;
    const container = scrollRef.current;
    if (!state || !container || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    if (!state.moved && Math.abs(dx) > DRAG_THRESHOLD) state.moved = true;
    if (state.moved) container.scrollLeft = state.startScrollLeft - dx;
  }, []);

  const handlePointerEnd = useCallback((e) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.moved) suppressClickRef.current = true;
    dragRef.current = null;
    const container = scrollRef.current;
    if (container) container.classList.remove('cursor-grabbing');
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove]);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const container = scrollRef.current;
    if (!container) return;
    suppressClickRef.current = false;
    stopAllTweens();
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startScrollLeft: container.scrollLeft, moved: false };
    container.classList.add('cursor-grabbing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove, handlePointerEnd, stopAllTweens]);

  const handleClickCapture = useCallback((e) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }, []);

  const handleDragStart = useCallback((e) => { e.preventDefault(); }, []);
  const handleContextMenu = useCallback((e) => { e.preventDefault(); }, []);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  }, [handlePointerMove, handlePointerEnd]);

  if (!files || files.length < 1) return null;

  const total = nodes.length;
  const start = Math.max(0, Math.min(win.start, total));
  const end = Math.max(start, Math.min(win.end, total));
  const leadingW = LEAD + prefix[start];
  const trailingW = (prefix[total] - prefix[end]) + TRAIL;
  const windowNodes = nodes.slice(start, end);

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
          className={`flex overflow-x-auto items-stretch py-1 justify-start cursor-grab select-none`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
          onPointerDown={handlePointerDown}
          onClickCapture={handleClickCapture}
          onDragStart={handleDragStart}
          onContextMenu={handleContextMenu}
          onScroll={handleScroll}
        >
          {leadingW > 0 && <div aria-hidden="true" style={{ width: leadingW }} className="flex-shrink-0" />}
          {windowNodes.map((node, i) => {
            const nodeIdx = start + i;
            if (node.type === 'divider') {
              const key = node.folderName || node.label;
              if (node.folderName) {
                return (
                  <div key={`div-${nodeIdx}`} ref={setDividerRef(key)} data-folder="1" className="flex items-center flex-shrink-0 mx-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none">
                      <svg className="w-3 h-3 text-neutral-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      {node.folderName}
                    </div>
                  </div>
                );
              }
              return (
                <div key={`div-${nodeIdx}`} ref={setDividerRef(key)} className="flex items-center flex-shrink-0 mx-3">
                  <div className="px-2.5 py-0.5 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider whitespace-nowrap select-none bg-neutral-900 border border-neutral-700 rounded">
                    {node.label}
                  </div>
                </div>
              );
            }
            return renderItem(node.file);
          })}
          {trailingW > 0 && <div aria-hidden="true" style={{ width: trailingW }} className="flex-shrink-0" />}
        </div>
      </div>
    </div>
  );
}

export default Carousel;
