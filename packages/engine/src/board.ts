import { cellKey, inBounds } from './coordinates';
import type { Board, Cell, CellRead, Rules, ValidatedPlay } from './types';

const EMPTY: Cell = Object.freeze({ kind: 'empty' });

export function createBoard(rules: Rules): Board {
  return {
    size: rules.boardSize,
    cells: Array.from({ length: rules.boardSize * rules.boardSize }, () => EMPTY),
  };
}

export function readCell(board: Board, row: number, col: number): CellRead {
  if (!inBounds(board.size, row, col)) return { kind: 'out-of-bounds' };
  return board.cells[row * board.size + col] ?? { kind: 'out-of-bounds' };
}

export function isBoardEmpty(board: Board): boolean {
  return board.cells.every((cell) => cell.kind === 'empty');
}

export function occupiedCells(board: Board): readonly (Cell & { readonly kind: 'occupied'; readonly row: number; readonly col: number })[] {
  const found = [];
  for (let row = 0; row < board.size; row += 1) {
    for (let col = 0; col < board.size; col += 1) {
      const cell = board.cells[row * board.size + col];
      if (cell?.kind === 'occupied') found.push({ ...cell, row, col });
    }
  }
  return found;
}

/** Copies the board. Throws if the play does not match a validated empty target. */
export function applyPlay(board: Board, play: ValidatedPlay, rules?: Rules): Board {
  const upgrades = committedUpgrades(play, rules);
  const cells = board.cells.slice();
  for (const placement of play.placements) {
    if (!inBounds(board.size, placement.row, placement.col)) {
      throw new Error('Validated play left the board.');
    }
    const index = placement.row * board.size + placement.col;
    const current = cells[index];
    if (current === undefined || current.kind !== 'empty') {
      throw new Error('Validated play covers an occupied square.');
    }
    const upgrade = upgrades.get(cellKey(placement.row, placement.col));
    cells[index] = Object.freeze({
      kind: 'occupied',
      tileId: placement.tileId,
      letter: placement.letter,
      assignedLetter: placement.assignedLetter,
      points: upgrade ?? placement.points,
      ...(upgrade !== undefined ? { upgraded: true as const } : {}),
    });
  }
  return { size: board.size, cells };
}

/** Wild letter bonuses are stored once. Word bonuses stay on the score, not on the tile. */
function committedUpgrades(play: ValidatedPlay, rules: Rules | undefined): Map<string, number> {
  const upgrades = new Map<string, number>();
  if (rules?.scoring.tileUpgrade !== 'wild') return upgrades;
  for (const word of play.score.words) {
    for (const letter of word.letters) {
      if (!letter.placedThisTurn || letter.letterMultiplier <= 1 || letter.points === 0) continue;
      upgrades.set(cellKey(letter.row, letter.col), letter.value);
    }
  }
  return upgrades;
}
