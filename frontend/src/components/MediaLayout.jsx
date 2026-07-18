import React, { useState, useCallback, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import Carousel from './Carousel';

// Idle time before controls + carousel auto-hide (matches the old controls timer
// so the two fade out together).
const IDLE_MS = 3000;

/**
 * Universal layout for media players (audio/video/image).
 * Ensures consistent structure and carousel anchoring across all players.
 *
 * Two layout modes (overlay prop):
 *   - overlay = true  (video / image): the Main media fills the area and the
 *     Controls + Carousel are ABSOLUTE overlays pinned to the bottom. Controls
 *     sit ABOVE the carousel.
 *   - overlay = false (audio): the Controls + Carousel live in the normal
 *     document FLOW, below the audio UI, so they never overlap the audio
 *     player's own content. Controls sit ABOVE the carousel.
 *
 * In both modes the order is: Controls on top, Carousel at the bottom. When the
 * carousel collapses (max-h-0) the controls drop down to the bottom.
 *
 * Two independent concepts drive the carousel:
 *   - `manualHidden` (persisted): user's explicit hide. Stays hidden regardless
 *     of mouse activity — only the toggle button reveals it again.
 *   - `active` (auto-hide / idle): when the player is playing and idle for
 *     IDLE_MS, controls + carousel auto-hide; any pointer/keyboard activity
 *     brings them back.
 */
export default function MediaLayout({
   header,
   children,
   controls,
   bottomBar,
   bottomBarOverlay = false,
   files,
   currentFile,
   onSelect,
   sortBy = null,
   sortOrder = 'asc',
   align = 'center',
   cacheBust = '',
   hideCarousel = false,
   contextLabel = null,
   onToggleFavorite = null,
   autoHide = false,
    overlay = true,
    immersive = false,
    // When true, this layout only renders the header + media (children). The
    // bottom cluster (controls + carousel + send bar) is owned by a persistent
    // parent (e.g. MediaModal's VaultBottomCluster) so it can slide across
    // player-type swaps instead of remounting. Standalone usages keep the full
    // layout by omitting this prop.
    embedded = false,
   // Drives the bottom cluster (carousel + send bar) animation during a
   // video/image <-> audio crossfade in MediaModal:
   //   'down' -> the cluster slides down & the send bar leaves (video->audio)
   //   'up'   -> the cluster slides up from the bottom & the send bar appears (audio->video)
   //   null   -> no special animation (same-type swap or both have a bar)
   bottomClusterAnim = null,
     }) {
    // Show carousel whenever there is at least one file (so the queue player
    // also gets a carousel like the vault player, even with a single item).
    const showCarousel = !hideCarousel && files && files.length >= 1;

   // User's explicit carousel hide (persisted). Independent of auto-hide: a
   // manually hidden carousel stays hidden no matter what the mouse does.
   const [manualHidden, setManualHidden] = useState(() => {
      try { return localStorage.getItem('mv_carousel_hidden') === '1'; } catch { return false; }
   });

    // Auto-hide "active" state (idle detection). Shared by the controls and the
    // carousel so they fade in/out together (seamless). Only engages when
    // autoHide is on (video playing); otherwise everything stays visible.
    //
    // A loop boundary (loop one / all, manual advance) fires a transient
    // pause->play on the media element. That transient pause would otherwise
    // flip autoHide off and re-reveal the controls. We debounce the reveal on a
    // pause by ~200ms: a genuine pause stays paused long enough to reveal, while
    // the sub-frame loop pause is immediately followed by play and cancels the
    // pending reveal — so controls stay hidden after a loop until real activity.
    // Start visible; the idle timer (below) hides them after IDLE_MS while a
    // video plays. We never force-reveal on a transient pause, so a loop
    // boundary (which briefly pauses the element while it reloads) can't pop the
    // controls + carousel back up with no user activity.
    const [active, setActive] = useState(true);

    useEffect(() => {
       if (!autoHide) {
          // Paused / audio / image: keep current visibility. Do NOT force-reveal
          // on a transient pause (e.g. the brief element pause while a video
          // reloads at a loop boundary) — that would pop the controls + carousel
          // back up with no user activity. A genuine user pause still reveals via
          // the activity listener below, because the pause gesture fires while
          // still "playing".
          return undefined;
       }
       let timer;
       const onActivity = () => {
          setActive(true);
          clearTimeout(timer);
          timer = setTimeout(() => setActive(false), IDLE_MS);
       };
       timer = setTimeout(() => setActive(false), IDLE_MS);
       window.addEventListener('pointermove', onActivity);
       window.addEventListener('pointerdown', onActivity);
       window.addEventListener('keydown', onActivity);
       window.addEventListener('touchstart', onActivity);
       return () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', onActivity);
          window.removeEventListener('pointerdown', onActivity);
          window.removeEventListener('keydown', onActivity);
          window.removeEventListener('touchstart', onActivity);
       };
    }, [autoHide, currentFile?.id]);

   const toggleCarouselHidden = useCallback(() => {
      setManualHidden((h) => {
         const next = !h;
         try { localStorage.setItem('mv_carousel_hidden', next ? '1' : '0'); } catch {}
         return next;
      });
   }, []);

   // Carousel shows only when active AND not manually hidden. Controls show
   // whenever active. This is what keeps the timing unified and respects a
   // manual hide across mouse movement.
   const carouselVisible = active && !manualHidden;
   const controlsVisible = active;

   // Controls node — fades / slides on the shared auto-hide timing.
   const controlsNode = controls ? (
      <div className={`pointer-events-auto transition-all duration-300 ease-out ${
         controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}>
         {controls}
      </div>
   ) : null;

    // Carousel node — collapses to zero height when hidden so the controls
    // above it drop down to the bottom. Using a grid-rows 1fr/0fr transition
    // animates the height smoothly and keeps it in sync with the controls'
    // opacity fade (a max-h transition finishes its visible portion early,
    // which is what made the carousel feel "faster" than the controls).
    const carouselNode = showCarousel ? (
       <div className={`pointer-events-auto grid transition-all duration-300 ease-out ${
          carouselVisible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
       }`}>
          <div className="overflow-hidden">
             <Carousel
                files={files}
                currentFile={currentFile}
                onSelect={onSelect}
                sortBy={sortBy}
                sortOrder={sortOrder}
                cacheBust={cacheBust}
                onToggleFavorite={onToggleFavorite}
                autoHide={autoHide}
                hidden={!carouselVisible}
                onToggleHidden={toggleCarouselHidden}
             />
          </div>
       </div>
    ) : null;

    // Carousel hide/unhide toggle — matches the Media Vault player: pinned to the
    // right, 72px above the cluster bottom so it clears the (56px) send bar in
    // video/image mode and sits just above the carousel otherwise. Only shown
    // while the overlay is active so it never floats during idle.
    const toggleNode = showCarousel ? (
       <button
          onClick={toggleCarouselHidden}
           className="absolute right-3 z-40 p-2 rounded-full bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 shadow-lg transition-opacity bottom-[72px]"
          style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
          title={manualHidden ? 'Tampilkan daftar' : 'Sembunyikan daftar'}
       >
          {manualHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
       </button>
    ) : null;

    const rootClass = "w-full h-full flex flex-col bg-neutral-950 text-slate-100 select-none relative";

    // ---- Embedded layout: header + media only ----
    // The bottom cluster (controls + carousel + send bar) is rendered once by the
    // parent (MediaModal) so it persists across type swaps and can slide. We keep
    // the header (with its close / title / favorite) and the media element only.
    if (embedded) {
      const headerWrapClass = header
        ? `relative flex-none h-14 flex items-center justify-between border-b border-white/5 px-4 ${
            immersive ? 'absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/70 to-transparent border-0' : ''
          }`
        : null;
      return (
        <div className={rootClass}>
          {header && (
            <div className={headerWrapClass}>
              {header}
            </div>
          )}
          <div className={`flex-1 min-h-0 flex overflow-hidden relative ${
            align === 'start' ? 'items-start justify-start' : 'items-center justify-center'
          }`}>
            {children}
          </div>
        </div>
      );
    }

    // ---- In-flow layout (audio): controls + carousel below the audio UI ----
   if (!overlay) {
      return (
         <div className={rootClass}>
            {header && (
               <div className="relative flex-none h-14 flex items-center justify-between border-b border-white/5 px-4">
                  {header}
               </div>
            )}
               <div className="flex-1 min-h-0 flex flex-col relative">
                  {children}
                  {controlsNode}
                  {carouselNode}
                  {toggleNode}
               </div>
            {bottomBar && (
               <div className="flex-none">
                  {bottomBar}
               </div>
            )}
         </div>
      );
   }

     // ---- Overlay layout (video / image): controls + carousel on the media ----
     // In `immersive` mode the header + bottomBar become ABSOLUTE overlays so the
     // media fills the ENTIRE root height (no in-flow chrome stealing vertical
     // space) — this is what makes a video feel "full size" instead of boxed in.
     const headerWrapClass = header
       ? `relative flex-none h-14 flex items-center justify-between border-b border-white/5 px-4 ${
           immersive ? 'absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/70 to-transparent border-0' : ''
         }`
       : null;

     // Bottom cluster — mirrors the Media Vault player (VaultBottomCluster):
     // controls on TOP, carousel in the MIDDLE, overlay bottom bar (send / queue
     // actions) at the BOTTOM. Collapsing the carousel (grid 1fr→0fr) drops the
     // controls down to meet the bottom bar, exactly as the vault player does.
      return (
         <div className={rootClass}>
            {header && (
               <div className={headerWrapClass}>
                  {header}
               </div>
            )}

            <div className={`flex-1 min-h-0 flex overflow-hidden relative ${
               align === 'start' ? 'items-start justify-start' : 'items-center justify-center'
            }`}>
                {children}

                {/* Bottom cluster: controls (top) → carousel (middle) → bottom bar. */}
                <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col pointer-events-none">
                   {controlsNode}
                   {showCarousel && (
                      <div
                         className={`${
                           bottomClusterAnim === 'down'
                             ? 'animate-out fade-out slide-out-to-bottom-14 duration-300'
                             : bottomClusterAnim === 'up'
                             ? 'animate-in fade-in slide-in-from-bottom-14 duration-300'
                             : ''
                         }`}
                         style={bottomClusterAnim === 'down' ? { animationFillMode: 'forwards' } : undefined}
                      >
                         {carouselNode}
                      </div>
                   )}
                   {bottomBarOverlay && bottomBar && (
                      <div className="pointer-events-auto">
                         {bottomBar}
                      </div>
                   )}
                </div>

                {toggleNode}
            </div>
         </div>
      );
  }
