import type { BonusSquare } from './types';

/**
 * Original 15×15 bonus squares for Classic and Wild.
 * The set is four-fold rotationally symmetric and is not a commercial board.
 * The centre is absent on purpose: Arena Standard already scores it as a word ×2.
 */
const SEEDS: readonly BonusSquare[] = [
  { row: 6, col: 3, class: 'letter-2' },
  { row: 4, col: 2, class: 'letter-3' },
  { row: 3, col: 5, class: 'word-3' },
  { row: 4, col: 7, class: 'word-2' },
];

function rotate(square: BonusSquare, size: number): BonusSquare {
  return { row: square.col, col: size - 1 - square.row, class: square.class };
}

function layout(size: number): BonusSquare[] {
  const squares: BonusSquare[] = [];
  const seen = new Set<string>();
  for (const seed of SEEDS) {
    let current = seed;
    for (let turn = 0; turn < 4; turn += 1) {
      const key = `${current.row}:${current.col}`;
      if (!seen.has(key)) {
        seen.add(key);
        squares.push(current);
      }
      current = rotate(current, size);
    }
  }
  return squares;
}

export const ARENA_BONUS_LAYOUT = {
  boardSize: 15,
  squares: layout(15),
} as const;
