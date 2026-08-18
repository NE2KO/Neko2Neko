import React, { memo, useMemo, useState, useRef, useEffect } from 'react';
import { FixedSizeList } from 'react-window';
import NetworkImage from './NetworkImage';

const QUEUE_ITEM_HEIGHT = 46;

const QueueRow = memo(function QueueRow({ index, style, data }) {
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
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

export default function NowPlayingPanel({ queue, currentTrackIndex }) {
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
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
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
}
