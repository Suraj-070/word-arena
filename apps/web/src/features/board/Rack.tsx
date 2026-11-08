import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Tile } from '../../components/ui/Tile';

export type RackTile = {
  id: string;
  letter: string;
  points: number;
  selected: boolean;
};

type RackProps = {
  slotCount?: number;
  tiles?: readonly RackTile[];
  label?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
  onDragStart?: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd?: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function Rack({ slotCount = 0, tiles, label, onSelect, onMove, onDragStart, onDragMove, onDragEnd }: RackProps) {
  if (tiles === undefined) {
    if (!Number.isInteger(slotCount) || slotCount < 0) {
      throw new Error(`Rack needs a whole number of spaces. Received ${slotCount}.`);
    }
    return (
      <div className="rack" role="group" aria-label={label ?? `Empty rack, ${slotCount} spaces`}>
        {Array.from({ length: slotCount }, (_, index) => (
          <Tile key={index} />
        ))}
      </div>
    );
  }

  function onKeyDown(id: string) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onMove?.(id, -1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onMove?.(id, 1);
      }
    };
  }

  return (
    <div className="rack" role="group" aria-label={label ?? `Rack, ${tiles.length} tiles`}>
      {tiles.map((tile, index) => (
        <Tile
          key={tile.id}
          letter={tile.letter}
          points={tile.points}
          interactive
          selected={tile.selected}
          label={`${tile.letter.trim() === '' ? 'Blank' : tile.letter}, ${tile.points} ${tile.points === 1 ? 'point' : 'points'}`}
          onClick={() => onSelect?.(tile.id)}
          onKeyDown={onKeyDown(tile.id)}
          onPointerDown={(event) => onDragStart?.(tile.id, event)}
          onPointerMove={onDragMove}
          onPointerUp={(event) => onDragEnd?.(tile.id, event)}
          rackIndex={index}
        />
      ))}
    </div>
  );
}
