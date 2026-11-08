import { describe, expect, it } from 'vitest';
import { arenaStandardRules, bingoAward, scoreFormedWords, type FormedWord, type Letter } from '../src/index';
import { withBonuses, withRules } from './helpers';

function word(letters: FormedWord['letters'], direction: FormedWord['direction'] = 'horizontal'): FormedWord {
  const start = letters[0];
  if (!start) throw new Error('empty word');
  return {
    direction,
    start: { row: start.row, col: start.col },
    letters,
    text: letters.map((letter) => letter.letter).join(''),
  };
}

function letter(
  row: number,
  col: number,
  value: Letter,
  points: number,
  placedThisTurn: boolean,
): FormedWord['letters'][number] {
  return { row, col, letter: value, points, placedThisTurn, tileId: `${value}${row}${col}` };
}

describe('scoreFormedWords', () => {
  it('applies the centre word multiplier only to a tile placed this turn', () => {
    const rules = arenaStandardRules();
    const opening = scoreFormedWords(
      rules,
      [word([letter(7, 7, 'A', 1, true), letter(7, 8, 'T', 1, true)])],
      0,
    );
    expect(opening.words[0]?.wordMultiplier).toBe(2);
    expect(opening.total).toBe(4);

    const later = scoreFormedWords(
      rules,
      [word([letter(7, 7, 'A', 1, false), letter(7, 8, 'T', 1, true)])],
      0,
    );
    expect(later.words[0]?.wordMultiplier).toBe(1);
    expect(later.total).toBe(2);
  });

  it('multiplies a new letter and leaves an old letter on a bonus square untouched', () => {
    const rules = withBonuses([{ row: 7, col: 7, class: 'letter-3' }]);
    const scored = scoreFormedWords(
      rules,
      [word([letter(7, 7, 'A', 1, false), letter(7, 8, 'H', 4, true)])],
      0,
    );
    const old = scored.words[0]?.letters[0];
    const fresh = scored.words[0]?.letters[1];
    expect(old?.letterMultiplier).toBe(1);
    expect(old?.value).toBe(1);
    expect(fresh?.value).toBe(4);
    expect(scored.total).toBe(5);
  });

  it('combines word multipliers by product, including a synthetic square on the centre', () => {
    const rules = withBonuses(
      [
        { row: 7, col: 6, class: 'word-2' },
        { row: 7, col: 8, class: 'word-3' },
      ],
      (current) => ({ ...current, centerWordMultiplier: 1 }),
    );
    const scored = scoreFormedWords(
      rules,
      [word([letter(7, 6, 'H', 4, true), letter(7, 8, 'I', 1, true)])],
      0,
    );
    expect(scored.words[0]?.wordMultiplier).toBe(6);
    expect(scored.total).toBe(30);

    const stacked = withBonuses([{ row: 7, col: 7, class: 'word-2' }]);
    const both = scoreFormedWords(stacked, [word([letter(7, 7, 'A', 1, true)])], 0);
    expect(both.words[0]?.wordMultiplier).toBe(4);
    expect(both.total).toBe(4);
  });

  it('scores a blank as zero even on a letter bonus, and adds bingo once', () => {
    const rules = withBonuses([{ row: 7, col: 7, class: 'letter-3' }]);
    const scored = scoreFormedWords(
      rules,
      [word([letter(7, 7, 'A', 0, true), letter(7, 8, 'T', 1, true)])],
      0,
    );
    expect(scored.words[0]?.letters[0]?.value).toBe(0);
    expect(scored.words[0]?.raw).toBe(1);
    expect(scored.total).toBe(2);

    const standard = arenaStandardRules();
    expect(bingoAward(standard, 7, 7)).toBe(50);
    expect(bingoAward(standard, 6, 7)).toBe(0);
    expect(bingoAward(standard, 6, 6)).toBe(0);
    const withBingo = scoreFormedWords(standard, [word([letter(7, 7, 'A', 1, true)])], bingoAward(standard, 7, 7));
    expect(withBingo.bingo).toBe(50);
    expect(withBingo.total).toBe(withBingo.words[0]!.score + 50);
  });

  it('scores a cross word separately from the main word', () => {
    const rules = withRules((current) => ({ ...current, centerWordMultiplier: 1, firstPlayCoversCenter: false }));
    const scored = scoreFormedWords(
      rules,
      [
        word([letter(6, 7, 'H', 4, true), letter(6, 8, 'I', 1, true)]),
        word([letter(6, 7, 'H', 4, true), letter(7, 7, 'A', 1, false)], 'vertical'),
      ],
      0,
    );
    expect(scored.words.map((entry) => entry.score)).toEqual([5, 5]);
    expect(scored.total).toBe(10);
  });
});
