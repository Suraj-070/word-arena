import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Square } from '../../components/ui/Square';

type BoardProps = {
  boardSize: number;
};

type BoardStyle = CSSProperties & {
  '--board-size': string;
};

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

export function Board({ boardSize }: BoardProps) {
  if (!Number.isInteger(boardSize) || boardSize < 1) {
    throw new Error(`Board frame needs a positive whole edge. Received ${boardSize}.`);
  }

  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [activeKey, setActiveKey] = useState(cellKey(0, 0));
  const style: BoardStyle = { '--board-size': String(boardSize) };

  function remember(key: string) {
    return (node: HTMLButtonElement | null) => {
      if (node) refs.current.set(key, node);
      else refs.current.delete(key);
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.getAttribute('role') !== 'gridcell') {
      return;
    }
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;

    let nextRow = row;
    let nextCol = col;
    switch (event.key) {
      case 'ArrowRight':
        nextCol = col + 1;
        break;
      case 'ArrowLeft':
        nextCol = col - 1;
        break;
      case 'ArrowDown':
        nextRow = row + 1;
        break;
      case 'ArrowUp':
        nextRow = row - 1;
        break;
      case 'Home':
        nextCol = 0;
        if (event.ctrlKey) nextRow = 0;
        break;
      case 'End':
        nextCol = boardSize - 1;
        if (event.ctrlKey) nextRow = boardSize - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextRow < 0 || nextCol < 0 || nextRow >= boardSize || nextCol >= boardSize) return;

    const key = cellKey(nextRow, nextCol);
    setActiveKey(key);
    const node = refs.current.get(key);
    node?.focus();
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  return (
    <div
      className="board bg-grout"
      role="grid"
      aria-label="Empty board"
      aria-rowcount={boardSize}
      aria-colcount={boardSize}
      style={style}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: boardSize }, (_, row) => (
        <div className="board-row" role="row" key={row} aria-rowindex={row + 1}>
          {Array.from({ length: boardSize }, (_, col) => {
            const key = cellKey(row, col);
            return (
              <Square
                key={key}
                row={row}
                col={col}
                tabIndex={activeKey === key ? 0 : -1}
                buttonRef={remember(key)}
                onFocus={() => setActiveKey(key)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
