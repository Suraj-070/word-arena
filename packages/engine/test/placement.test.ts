import { describe, expect, it } from 'vitest';
import {
  applyPlay,
  createBoard,
  createMemoryDictionary,
  readCell,
  validatePlay,
  type PlayError,
  type Rules,
  type TileInstance,
  type TilePlacement,
} from '../src/index';
import { blankTile, fixtureDictionary, letterTile, withBonuses, withRules } from './helpers';

function codes(errors: readonly PlayError[]): PlayError['code'][] {
  return errors.map((error) => error.code);
}

function open(rules: Rules, placements: readonly TilePlacement[], rack: readonly TileInstance[] = placements.map((placement) => placement.tile)) {
  return validatePlay({
    rules,
    board: createBoard(rules),
    rack,
    placements,
    dictionary: fixtureDictionary(),
  });
}

describe('placement validation', () => {
  const rules = withRules((current) => current);
  const centerA = letterTile('a', 'A');
  const centerT = letterTile('t', 'T');

  it('accepts a horizontal opening through the centre and scores it', () => {
    const result = open(rules, [
      { row: 7, col: 6, tile: letterTile('c', 'C') },
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.play.words.map((word) => word.text)).toEqual(['CAT']);
    expect(result.play.score.total).toBe(10);
    expect(result.play.score.bingo).toBe(0);
  });

  it('accepts a vertical opening through the centre', () => {
    const result = open(rules, [
      { row: 6, col: 7, tile: letterTile('c', 'C') },
      { row: 7, col: 7, tile: centerA },
      { row: 8, col: 7, tile: centerT },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.play.words[0]?.direction).toBe('vertical');
    expect(result.play.words[0]?.text).toBe('CAT');
  });

  it('rejects an empty play, a diagonal, a gap, an overlap, and a square off the board', () => {
    const empty = open(rules, []);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(codes(empty.errors)).toContain('empty-placement');

    const diagonal = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 8, col: 8, tile: centerT },
    ]);
    expect(diagonal.ok).toBe(false);
    if (!diagonal.ok) expect(codes(diagonal.errors)).toContain('not-straight');

    const gap = open(rules, [
      { row: 7, col: 6, tile: letterTile('c', 'C') },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.errors.some((error) => error.code === 'gap' && error.col === 7)).toBe(true);

    const outside = open(rules, [
      { row: -1, col: 7, tile: centerA },
      { row: 15, col: 7, tile: centerT },
    ]);
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(codes(outside.errors)).toContain('out-of-bounds');

    const doubled = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 7, tile: centerT },
    ]);
    expect(doubled.ok).toBe(false);
    if (!doubled.ok) expect(codes(doubled.errors)).toContain('duplicate-coordinate');
  });

  it('rejects a tile that is not on the rack, a lied point value, and a bad blank assignment', () => {
    const missing = open(rules, [{ row: 7, col: 7, tile: centerA }], []);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(codes(missing.errors)).toContain('tile-not-on-rack');

    const lied = letterTile('q', 'Q');
    const cheap = open(rules, [
      { row: 7, col: 7, tile: { ...lied, points: 1 } },
      { row: 7, col: 8, tile: centerA },
    ]);
    expect(cheap.ok).toBe(false);
    if (!cheap.ok) expect(codes(cheap.errors)).toContain('tile-value');

    const blank = blankTile('blank');
    const unassigned = open(rules, [
      { row: 7, col: 7, tile: blank },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(unassigned.ok).toBe(false);
    if (!unassigned.ok) expect(codes(unassigned.errors)).toContain('assigned-letter');

    const reassigned = open(rules, [{ row: 7, col: 7, tile: centerA, assignedLetter: 'Z' }]);
    expect(reassigned.ok).toBe(false);
    if (!reassigned.ok) expect(codes(reassigned.errors)).toContain('assigned-letter');
  });

  it('keeps a blank at zero points and uses its assigned letter', () => {
    const blank = blankTile('blank');
    const result = open(rules, [
      { row: 7, col: 7, tile: blank, assignedLetter: 'A' },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.play.words[0]?.text).toBe('AT');
    expect(result.play.placements[0]?.points).toBe(0);
    expect(result.play.placements[0]?.letter).toBeNull();
    expect(result.play.score.total).toBe(2);
    const board = applyPlay(createBoard(rules), result.play);
    expect(readCell(board, 7, 7)).toMatchObject({ letter: null, assignedLetter: 'A', points: 0 });
  });

  it('rejects an opening that misses the centre and a later play that does not connect', () => {
    const missed = open(rules, [
      { row: 0, col: 0, tile: letterTile('c', 'C') },
      { row: 0, col: 1, tile: centerA },
      { row: 0, col: 2, tile: centerT },
    ]);
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(codes(missed.errors)).toEqual(['opening-misses-center']);

    const opening = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    if (!opening.ok) throw new Error('opening failed');
    const board = applyPlay(createBoard(rules), opening.play);
    const island = validatePlay({
      rules,
      board,
      rack: [letterTile('h', 'H'), letterTile('i', 'I')],
      placements: [
        { row: 2, col: 2, tile: letterTile('h', 'H') },
        { row: 2, col: 3, tile: letterTile('i', 'I') },
      ],
      dictionary: fixtureDictionary(),
    });
    expect(island.ok).toBe(false);
    if (!island.ok) expect(codes(island.errors)).toContain('disconnected');
  });

  it('fills a gap with an existing tile, hooks a cross word, and rejects an unknown word', () => {
    const opening = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    if (!opening.ok) throw new Error('opening failed');
    const board = applyPlay(createBoard(rules), opening.play);

    const hooked = validatePlay({
      rules,
      board,
      rack: [letterTile('h', 'H'), letterTile('i', 'I')],
      placements: [
        { row: 6, col: 7, tile: letterTile('h', 'H') },
        { row: 6, col: 8, tile: letterTile('i', 'I') },
      ],
      dictionary: fixtureDictionary(),
    });
    expect(hooked.ok).toBe(true);
    if (!hooked.ok) return;
    expect(hooked.play.words.map((word) => word.text)).toEqual(['HI', 'HA', 'IT']);
    expect(hooked.play.score.total).toBe(12);

    const gap = validatePlay({
      rules,
      board,
      rack: [letterTile('c', 'C'), letterTile('i', 'I')],
      placements: [
        { row: 7, col: 5, tile: letterTile('c', 'C') },
        { row: 7, col: 9, tile: letterTile('i', 'I') },
      ],
      dictionary: fixtureDictionary(),
    });
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(codes(gap.errors)).toContain('gap');

    const bridge = validatePlay({
      rules,
      board,
      rack: [letterTile('c2', 'C'), letterTile('i2', 'I')],
      placements: [
        { row: 7, col: 6, tile: letterTile('c2', 'C') },
        { row: 7, col: 9, tile: letterTile('i2', 'I') },
      ],
      dictionary: fixtureDictionary(['CATI', 'AT', 'CAT']),
    });
    expect(bridge.ok).toBe(true);
    if (!bridge.ok) return;
    expect(bridge.play.words[0]?.text).toBe('CATI');

    const extended = validatePlay({
      rules,
      board,
      rack: [letterTile('c', 'C')],
      placements: [{ row: 7, col: 6, tile: letterTile('c', 'C') }],
      dictionary: fixtureDictionary(),
    });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(extended.play.words[0]?.text).toBe('CAT');
    expect(extended.play.score.bingo).toBe(0);
    expect(extended.play.score.words[0]?.wordMultiplier).toBe(1);

    const unknown = validatePlay({
      rules,
      board,
      rack: [letterTile('z', 'Z')],
      placements: [{ row: 7, col: 9, tile: letterTile('z', 'Z') }],
      dictionary: fixtureDictionary(),
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.some((error) => error.code === 'unknown-word' && error.word === 'ATZ')).toBe(true);
  });

  it('rejects a word the fixture dictionary does not contain and a mismatched dictionary id', () => {
    const result = open(rules, [
      { row: 7, col: 7, tile: letterTile('d', 'D') },
      { row: 7, col: 8, tile: letterTile('o', 'O') },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.word === 'DO')).toBe(true);

    const mismatch = validatePlay({
      rules,
      board: createBoard(rules),
      rack: [centerA, centerT],
      placements: [
        { row: 7, col: 7, tile: centerA },
        { row: 7, col: 8, tile: centerT },
      ],
      dictionary: createMemoryDictionary('someone-elses-list', ['AT']),
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(codes(mismatch.errors)).toContain('dictionary-mismatch');
  });

  it('awards bingo once when the whole rack of seven is played', () => {
    const tiles = Array.from({ length: 7 }, (_, index) => letterTile(`a${index}`, 'A'));
    const result = open(
      rules,
      tiles.map((tile, index) => ({ row: 7, col: 4 + index, tile })),
      tiles,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.play.words[0]?.text).toBe('AAAAAAA');
    expect(result.play.score.bingo).toBe(50);
    expect(result.play.score.total).toBe(64);
  });

  it('does not give an old centre tile a new bonus', () => {
    const boosted = withBonuses([{ row: 7, col: 7, class: 'letter-3' }]);
    const opening = open(boosted, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    expect(opening.play.score.total).toBe(8);
    const board = applyPlay(createBoard(boosted), opening.play);
    const next = validatePlay({
      rules: boosted,
      board,
      rack: [letterTile('c', 'C')],
      placements: [{ row: 7, col: 6, tile: letterTile('c', 'C') }],
      dictionary: fixtureDictionary(),
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.play.words[0]?.text).toBe('CAT');
    expect(next.play.score.total).toBe(5);
  });

  it('covers an occupied square only on a later play', () => {
    const opening = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    if (!opening.ok) throw new Error('opening failed');
    const board = applyPlay(createBoard(rules), opening.play);
    const overlap = validatePlay({
      rules,
      board,
      rack: [letterTile('c', 'C')],
      placements: [{ row: 7, col: 7, tile: letterTile('c', 'C') }],
      dictionary: fixtureDictionary(),
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(codes(overlap.errors)).toContain('occupied');
  });

  it('accepts a one-tile hook and rejects a one-letter opening', () => {
    const opening = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    const board = applyPlay(createBoard(rules), opening.play);
    const hook = validatePlay({
      rules,
      board,
      rack: [letterTile('h', 'H')],
      placements: [{ row: 6, col: 7, tile: letterTile('h', 'H') }],
      dictionary: fixtureDictionary(),
    });
    expect(hook.ok).toBe(true);
    if (!hook.ok) return;
    expect(hook.play.words.map((word) => word.text)).toEqual(['HA']);
    expect(hook.play.score.total).toBe(5);

    const alone = open(rules, [{ row: 7, col: 7, tile: letterTile('a2', 'A') }]);
    expect(alone.ok).toBe(false);
    if (!alone.ok) expect(codes(alone.errors)).toContain('word-too-short');
  });

  it('rejects one physical tile placed on two squares, and a diagonal neighbour', () => {
    const twice = validatePlay({
      rules,
      board: createBoard(rules),
      rack: [centerA, centerT],
      placements: [
        { row: 7, col: 7, tile: centerA },
        { row: 7, col: 8, tile: centerA },
      ],
      dictionary: fixtureDictionary(),
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(codes(twice.errors)).toContain('duplicate-tile');

    const opening = open(rules, [
      { row: 7, col: 7, tile: centerA },
      { row: 7, col: 8, tile: centerT },
    ]);
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    const board = applyPlay(createBoard(rules), opening.play);
    const diagonal = validatePlay({
      rules,
      board,
      rack: [letterTile('h', 'H'), letterTile('i', 'I')],
      placements: [
        { row: 6, col: 5, tile: letterTile('h', 'H') },
        { row: 6, col: 6, tile: letterTile('i', 'I') },
      ],
      dictionary: fixtureDictionary(),
    });
    expect(diagonal.ok).toBe(false);
    if (!diagonal.ok) expect(codes(diagonal.errors)).toContain('disconnected');
  });
});
