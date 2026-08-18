import React from 'react';
import { Music, Plus } from 'lucide-react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { PlaylistListHeader, PlaylistDetailHeader } from './HeaderComponents';
import PlaylistListRow, { injectPlaylistListRowStyles } from './PlaylistListRow';
import PlaylistTrackGridInner from './PlaylistTrackGridInner';
import { useToast } from './Toast';
import { deletePlaylist } from '../utils/api';

injectPlaylistListRowStyles();

const COLORS = {
  bg: { primary: '#0a0a0a', secondary: '#171717' },
  border: { primary: '#262626', secondary: '#404040' },
  text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373' },
  accent: '#0ea5e9',
};

const CONTAINER_MAX = 1600;
const MIN_CARD = 135;
const MAX_CARD = 165;
const MAX_COLUMNS = 10;
const GUTTER = 8;

export default function PlaylistMiddleModule({
  selectedPlaylist,
  loadingTracks,
  displayMode,
  setDisplayMode,
  playerOpen,
  handlePlay,
  handlePlayShuffle,
  handlePlayTrack,
  handleBulkDelete,
  handleCancelDeleteMode,
  handleOpenPlaylistFilters,
  handleOpenTrackFilters,
  handleImportXSPF,
  handleRefresh,
  handleCreateManualPlaylist,
  fileInputRef,
  coverInputRef,
  playlistSort,
  trackSort,
  trackFilterType,
  playlistSortOptions,
  trackSortOptions,
  trackFilterOptions,
  onPlaylistSortChange,
  onTrackSortChange,
  onTrackFilterTypeChange,
  onFilterApply,
  showFilterPanel,
  setShowFilterPanel,
  filterPanelType,
  setFilterPanelType,
  deleteMode,
  selectedForDelete,
  selectAllForDelete,
  deletingTrackIds,
  playlistDeleteMode,
  selectedPlaylistIds,
  isImporting,
  loading,
  playlists,
  sortedPlaylists,
  displayTracks,
  sortedTracks,
  totalDurationSeconds,
  listItemSize,
  gridItems,
  leavingTrackIds,
  enteringTrackIds,
  shiftAbove,
  playingFileId,
  isPlayingActive,
  detailScrollRef,
  trackCount,
  isLoved,
  showAddMusicPanel,
  setShowAddMusicPanel,
  showCreateModal,
  setShowCreateModal,
  createTitle,
  setCreateTitle,
  isCreating,
  onMenuOpen,
  onToggleOrder,
  toggleSelectForDelete,
  handleRemoveTrack,
  handleListItemsRendered,
  handleGridItemsRendered,
  handleTrackGridSelect,
  PlaylistHeroHeader,
}) {
  const { showToast } = useToast();

  const handleDeleteSelected = async () => {
    if (selectedPlaylistIds.size === 0) return;
    for (const id of selectedPlaylistIds) {
      try { await deletePlaylist(id); } catch {}
    }
    setPlaylists(prev => prev.filter(p => !selectedPlaylistIds.has(p.id)));
    showToast(`${selectedPlaylistIds.size} playlist(s) deleted`, 'success');
    setSelectedPlaylistIds(new Set());
    setPlaylistDeleteMode(false);
  };

  const handleToggleSelect = () => {
    setPlaylistDeleteMode(true);
    setSelectedPlaylistIds(new Set());
  };

  const handleSelectAll = () => {
    if ((Array.isArray(playlists) ? playlists : []).length === selectedPlaylistIds.size) {
      setSelectedPlaylistIds(new Set());
    } else {
      setSelectedPlaylistIds(new Set((Array.isArray(playlists) ? playlists : []).map(p => p.id)));
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 12, overflow: 'hidden' }}>
      {/* List View */}
      {!selectedPlaylist && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          <PlaylistListHeader
            playlistCount={sortedPlaylists.length}
            selectionMode={playlistDeleteMode}
            selectedCount={selectedPlaylistIds.size}
            onMenuOpen={onMenuOpen}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onDeleteSelected={handleDeleteSelected}
            onCancelSelect={() => { setPlaylistDeleteMode(false); setSelectedPlaylistIds(new Set()); }}
            onImport={() => fileInputRef?.current?.click()}
            onRefresh={() => { setLoading?.(true); handleRefresh?.(); }}
            onToggleView={() => setDisplayMode?.(d => d === 'grid' ? 'list' : 'grid')}
            displayMode={displayMode}
            isImporting={isImporting}
            fileInputRef={fileInputRef}
            onImportFile={handleImportXSPF}
            onCreate={() => setShowCreateModal?.(true)}
            sortBy={playlistSort?.by}
            sortOrder={playlistSort?.order}
            onOpenFilters={handleOpenPlaylistFilters}
            onToggleOrder={onToggleOrder}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: COLORS.text.secondary, padding: 24, overflow: 'hidden' }}>
            <Music size={64} style={{ opacity: 0.22, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: COLORS.text.primary }}>Pilih playlist</p>
            <p style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>Pilih salah satu daftar di samping untuk melihat lagunya.</p>
<button
                onClick={() => setShowCreateModal?.(true)}
                style={{ marginTop: 12, height: 40, padding: '0 18px', borderRadius: 999, border: 'none', background: 'var(--color-primary)', color: 'var(--color-bg-dark)', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                <Plus size={16} /> Buat Playlist
                </button>
          </div>
        </div>
      )}

       {/* Detail View */}
       {selectedPlaylist && (
           <div ref={detailScrollRef} data-debug-id="5.1" data-debug-name="PlaylistView" data-debug-type="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
           <PlaylistDetailHeader
            selectionMode={deleteMode}
            selectedCount={selectedForDelete?.size || 0}
            trackCount={trackCount}
            onSelectAll={() => {
              setSelectAllForDelete?.(true);
              setSelectedForDelete?.(new Set());
            }}
            onDeleteSelected={handleBulkDelete}
            onCancelSelect={handleCancelDeleteMode}
          />
          <PlaylistHeroHeader
            playlist={selectedPlaylist}
            isLoved={isLoved}
            trackCount={trackCount}
            totalDurationSeconds={totalDurationSeconds}
            onPlay={handlePlay}
            onShuffle={handlePlayShuffle}
            onCoverChange={() => coverInputRef?.current?.click()}
            selectionMode={deleteMode}
            selectedCount={selectedForDelete?.size || 0}
            onEnterSelectMode={() => setDeleteMode?.(true)}
            onSelectAll={() => {
              setSelectAllForDelete?.(true);
              setSelectedForDelete?.(new Set());
            }}
            onDeleteSelected={handleBulkDelete}
            onCancelSelect={handleCancelDeleteMode}
            onFilter={handleOpenTrackFilters}
            filterType={trackFilterType}
            onToggleView={() => setDisplayMode?.(d => d === 'grid' ? 'list' : 'grid')}
            displayMode={displayMode}
            onAdd={() => setShowAddMusicPanel?.(true)}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 8 }}>
            <div
              key={`pv-content-${selectedPlaylist?.id}-${loadingTracks ? 'loading' : 'ready'}`}
              className="animate-in fade-in duration-300"
              style={{ flex: 1, minHeight: 0, padding: '0 0 8px', display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden' }}
            >
              {loadingTracks ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                  <div style={{ width: '32px', height: '32px', border: `2px solid ${COLORS.border.primary}`, borderTop: `2px solid ${COLORS.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                </div>
              ) : displayTracks?.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: COLORS.text.secondary }}>
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
                          itemData={{ tracks: displayTracks, deleteMode, selectedForDelete, deletingTrackIds, leavingTrackIds, shiftAbove, enteringTrackIds, itemSize: 64, playingFileId, isPlayingActive, onSelect: (track, index) => { if (deleteMode) { toggleSelectForDelete?.(track.id); return; } if (track.file_id || track.id) handlePlayTrack(track, index); }, onRemove: handleRemoveTrack }}
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
        </div>
      )}
    </div>
  );
}
