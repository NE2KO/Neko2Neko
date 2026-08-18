import React from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import NowPlayingPanel from './NowPlayingPanel';
import LeaderboardPanel from './LeaderboardPanel';

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626' },
  text: { tertiary: '#a3a3a3' },
};

export default function PlaylistRightModule({
  open,
  mode,
  onModeChange,
  onClose,
  onOpen,
  hasActivePlayback,
  queue,
  currentTrackIndex,
  listeningLeaderboardMetric,
  onMetricChange,
  leaderboardDisplayMode,
  onDisplayModeChange,
  formatListeningDuration,
  rightHovered,
  setRightHovered,
}) {
  if (open) {
    return ( <>
      <div
        style={{
          width: 360,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative', height: '100%', background: '#121212', borderRadius: 0,
        }}
      >
        <div
          onMouseEnter={() => setRightHovered?.(true)}
          onMouseLeave={() => setRightHovered?.(false)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 24,
            zIndex: 40,
            cursor: 'pointer',
          }}
        />
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            left: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 24,
            height: 48,
            borderRadius: '0 8px 8px 0',
            background: COLORS.bg.secondary,
            border: `1px solid ${COLORS.border.primary}`,
            borderLeft: 'none',
            color: COLORS.text.tertiary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 40,
            opacity: rightHovered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: rightHovered ? 'auto' : 'none',
          }}
          title="Hide sidebar"
        >
          <ChevronRight size={16} />
        </button>
        
          <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 }}>
                <button
                  onClick={() => onModeChange?.('nowplaying')}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, textAlign: 'center',
                    background: mode === 'nowplaying' ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: mode === 'nowplaying' ? '#fff' : COLORS.text.tertiary,
                  }}
                >
                  Now Playing
                </button>
                <button
                  onClick={() => onModeChange?.('leaderboard')}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, textAlign: 'center',
                    background: mode === 'leaderboard' ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: mode === 'leaderboard' ? '#fff' : COLORS.text.tertiary,
                  }}
                >
                  Leaderboard
                </button>
              </div>
              <button
                onClick={onClose}
                style={{ width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Close sidebar"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div style={{
  flex: 1,
  background: 'transparent',
  borderRadius: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  padding: 16,
}}>
  {mode === 'nowplaying' && hasActivePlayback && (
    <NowPlayingPanel queue={queue} currentTrackIndex={currentTrackIndex} />
  )}
  {mode === 'nowplaying' && !hasActivePlayback && (
    <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.text.tertiary, fontSize: 13, flexShrink: 0 }}>
      No track is playing
    </div>
  )}
  {mode === 'leaderboard' && (
    <LeaderboardPanel
      listeningLeaderboardMetric={listeningLeaderboardMetric}
      onMetricChange={onMetricChange}
      leaderboardDisplayMode={leaderboardDisplayMode}
      onDisplayModeChange={onDisplayModeChange}
      formatListeningDuration={formatListeningDuration}
    />
  )}
</div>
        
      </div>
</>
);
  }

  return ( <>
    
      <div
        onMouseEnter={() => setRightHovered?.(true)}
        onMouseLeave={() => setRightHovered?.(false)}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 40,
          zIndex: 40,
          cursor: 'pointer',
        }}
      />
      <button
        onClick={onOpen}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 24,
          height: 48,
          borderRadius: '8px 0 0 8px',
          background: COLORS.bg.secondary,
          border: `1px solid ${COLORS.border.primary}`,
          borderRight: 'none',
          color: COLORS.text.secondary,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 40,
          opacity: rightHovered ? 1 : 0,
          transition: 'opacity 0.2s ease',
          pointerEvents: rightHovered ? 'auto' : 'none',
        }}
        title={hasActivePlayback ? "Open Now Playing" : "Open Leaderboard"}
      >
        <ChevronLeft size={16} />
      </button>
    
  </>
);
}
