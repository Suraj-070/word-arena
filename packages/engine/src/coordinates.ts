import type { Coordinate } from './types';

export const NAMED_BOARD_SIZES = [9, 11, 13, 15, 19] as const;
export const MIN_BOARD_SIZE = 9;
export const MAX_BOARD_SIZE = 31;

export function isLegalBoardSize(size: number): boolean {
  return Number.isInteger(size) && size >= MIN_BOARD_SIZE && size <= MAX_BOARD_SIZE && size % 2 === 1;
}

/** Middle cell of an odd board. Even edges have no single centre and are rejected. */
export function centerCoordinate(boardSize: number): Coordinate {
  if (!isLegalBoardSize(boardSize)) {
    throw new Error(`Centre is defined for odd board edges from ${MIN_BOARD_SIZE} through ${MAX_BOARD_SIZE}.`);
  }
  const mid = (boardSize - 1) / 2;
  return { row: mid, col: mid };
}

export function inBounds(boardSize: number, row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    col >= 0 &&
    row < boardSize &&
    col < boardSize
  );
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function coversCenter(boardSize: number, cells: readonly Coordinate[]): boolean {
  const center = centerCoordinate(boardSize);
  return cells.some((cell) => cell.row === center.row && cell.col === center.col);
}
