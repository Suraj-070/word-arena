import { describe, expect, it } from 'vitest';
import {
  applyPlay,
  centerCoordinate,
  createBoard,
  isBoardEmpty,
  occupiedCells,
  readCell,
  validatePlay,
  type Rules,
} from '../src/index';
import { fixtureDictionary, letterTile, withRules } from './helpers';

function playAt(rules: Rules, row: number, col: number) {
  const board = createBoard(rules);
  const tile = letterTile('a', 'A');
  const partner = letterTile('t', 'T');
  const center = centerCoordinate(rules.boardSize);
  return validatePlay({
    rules,
    board,
    rack: [tile, partner],
    placements: [
      { row, col, tile },
      { row, col: col + 1, tile: partner },
    ],
    dictionary: fixtureDictionary(),
  });
}

describe('board', () => {
  it('creates an empty board from the rules and keeps the original empty after a play', () => {
    const rules = withRules((current) => current);
    const board = createBoard(rules);
    expect(board.size).toBe(15);
    expect(board.cells).toHaveLength(225);
    expect(isBoardEmpty(board)).toBe(true);
    expect(readCell(board, 0, 0)).toEqual({ kind: 'empty' });
    expect(readCell(board, -1, 0)).toEqual({ kind: 'out-of-bounds' });
    expect(readCell(board, 15, 0)).toEqual({ kind: 'out-of-bounds' });
    expect(occupiedCells(board)).toEqual([]);

    const result = playAt(rules, 7, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = applyPlay(board, result.play);
    expect(next).not.toBe(board);
    expect(next.cells).not.toBe(board.cells);
    expect(isBoardEmpty(board)).toBe(true);
    expect(readCell(board, 7, 7)).toEqual({ kind: 'empty' });
    expect(readCell(next, 7, 7).kind).toBe('occupied');
    expect(occupiedCells(next)).toHaveLength(2);
  });

  it('uses the middle cell of a 9-edge board and a 19-edge board', () => {
    expect(centerCoordinate(9)).toEqual({ row: 4, col: 4 });
    expect(centerCoordinate(19)).toEqual({ row: 9, col: 9 });
    expect(createBoard(withRules((rules) => ({ ...rules, boardSize: 9 }))).cells).toHaveLength(81);
    expect(createBoard(withRules((rules) => ({ ...rules, boardSize: 19 }))).cells).toHaveLength(361);

    const small = withRules((rules) => ({ ...rules, boardSize: 9 }));
    const missed = playAt(small, 7, 7);
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.errors.some((issue) => issue.code === 'opening-misses-center')).toBe(true);

    const played = playAt(small, 4, 4);
    expect(played.ok).toBe(true);
    const large = playAt(withRules((rules) => ({ ...rules, boardSize: 19 })), 9, 9);
    expect(large.ok).toBe(true);
  });
});
