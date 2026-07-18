import React, { memo, useMemo } from 'react';
import { PlaylistGridCard } from './PlaylistGridCard';

const GUTTER = 8;

const PlaylistRow = memo(({ index, style, data }) => {
  const { rows, onSelect, onDelete, itemWidth, cardHeight, columnCount, selectedForDelete, deletingTrackIds } = data;
  const row = rows[index];

  const cardItems = useMemo(() => {
    return row.items.map(item => ({
      key: item.id,
      itemObj: {
        title: item._cardTitle,
        subtitle: item._cardSubtitle,
        thumbnailUrl: item._cardThumbnail,
        hasImage: item._cardHasImage,
        isFavorite: item._is_favorite,
      },
      rawItem: item,
    }));
  }, [row]);

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
        {cardItems.map(({ key, itemObj, rawItem }) => (
          <PlaylistGridCard
            key={key}
            item={itemObj}
            typeLabel={rawItem._typeLabel}
            itemWidth={itemWidth}
            cardHeight={cardHeight}
            onSelect={onSelect}
            onDelete={onDelete}
            _rawItem={rawItem}
            isSelected={selectedForDelete?.has(rawItem.id)}
            isDeleting={deletingTrackIds?.has(rawItem.id)}
          />
        ))}
      </div>
    </div>
  );
});

PlaylistRow.displayName = 'PlaylistRow';

export default PlaylistRow;
