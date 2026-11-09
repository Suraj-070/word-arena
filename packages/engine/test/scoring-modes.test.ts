import { describe, expect, it } from 'vitest';
import {
  ARENA_BONUS_LAYOUT,
  applyMatchAction,
  applyPlay,
  arenaStandardRules,
  createBoard,
  dealMatch,
  rulesWithScoringMode,
  scoreFormedWords,
  validateRules,
  type FormedWord,
  type Letter,
} from '../src/index';
import { fixtureDictionary, letterTile, withBonuses, withRules } from './helpers';

function word(letters: FormedWord['letters']): FormedWord {
  const start = letters[0];
  if (!start) throw new Error('empty word');
  return {
    direction: 'horizontal',
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

describe('bonus layout', () => {
  it('is an original 15-edge set with one of each class and no centre square', () => {
    const squares = ARENA_BONUS_LAYOUT.squares;
    const keys = squares.map((square) => `${square.row}:${square.col}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('7:7');
    expect(squares.filter((square) => square.class === 'letter-2')).toHaveLength(4);
    expect(squares.filter((square) => square.class === 'letter-3')).toHaveLength(4);
    expect(squares.filter((square) => square.class === 'word-2')).toHaveLength(4);
    expect(squares.filter((square) => square.class === 'word-3')).toHaveLength(4);
    const classic = rulesWithScoringMode(arenaStandardRules(), 'classic');
    const wild = rulesWithScoringMode(arenaStandardRules(), 'wild');
    expect(classic.scoring.tileUpgrade).toBe('classic');
    expect(wild.scoring.tileUpgrade).toBe('wild');
    expect(classic.bonuses).toEqual(squares);
    expect(arenaStandardRules().bonuses).toEqual([]);
  });
});

describe('multiplier scoring', () => {
  const quiet = (current: ReturnType<typeof arenaStandardRules>) => ({ ...current, centerWordMultiplier: 1 });

  it('applies each letter and word multiplier only to a tile placed this turn', () => {
    const letter2 = scoreFormedWords(withBonuses([{ row: 0, col: 0, class: 'letter-2' }], quiet), [word([letter(0, 0, 'H', 4, true)])], 0);
    const letter3 = scoreFormedWords(withBonuses([{ row: 0, col: 0, class: 'letter-3' }], quiet), [word([letter(0, 0, 'H', 4, true)])], 0);
    const word2 = scoreFormedWords(withBonuses([{ row: 0, col: 0, class: 'word-2' }], quiet), [word([letter(0, 0, 'H', 4, true), letter(0, 1, 'I', 1, true)])], 0);
    const word3 = scoreFormedWords(withBonuses([{ row: 0, col: 0, class: 'word-3' }], quiet), [word([letter(0, 0, 'H', 4, true), letter(0, 1, 'I', 1, true)])], 0);
    expect(letter2.total).toBe(8);
    expect(letter3.total).toBe(12);
    expect(word2.words[0]?.wordMultiplier).toBe(2);
    expect(word2.total).toBe(10);
    expect(word3.words[0]?.wordMultiplier).toBe(3);
    expect(word3.total).toBe(15);
  });

  it('multiplies several bonuses in one word and scores a cross word from the same new tile', () => {
    const rules = withBonuses(
      [
        { row: 0, col: 0, class: 'letter-2' },
        { row: 0, col: 1, class: 'word-3' },
      ],
      quiet,
    );
    const scored = scoreFormedWords(
      rules,
      [
        word([letter(0, 0, 'H', 4, true), letter(0, 1, 'I', 1, true)]),
        word([letter(0, 1, 'I', 1, true), letter(1, 1, 'T', 1, false)]),
      ],
      0,
    );
    expect(scored.words[0]?.wordMultiplier).toBe(3);
    expect(scored.words[0]?.score).toBe(27);
    expect(scored.words[1]?.wordMultiplier).toBe(3);
    expect(scored.words[1]?.score).toBe(6);
    expect(scored.total).toBe(33);
  });

  it('keeps the printed value in Classic and stores the letter bonus in Wild', () => {
    const bonuses = [{ row: 4, col: 5, class: 'letter-2' as const }];
    const classic = withRules((current) => ({
      ...current,
      boardSize: 9,
      centerWordMultiplier: 1,
      bonuses,
      scoring: { ...current.scoring, tileUpgrade: 'classic' as const },
    }));
    const wild = withRules((current) => ({ ...classic, scoring: { ...classic.scoring, tileUpgrade: 'wild' as const } }));
    const played = scoreFormedWords(wild, [word([letter(4, 4, 'A', 1, true), letter(4, 5, 'H', 4, true)])], 0);
    const board = createBoard(wild);
    const play = {
      placements: [
        { row: 4, col: 4, tileId: 'a', letter: 'A' as const, assignedLetter: null, points: 1, displayLetter: 'A' as const },
        { row: 4, col: 5, tileId: 'h', letter: 'H' as const, assignedLetter: null, points: 4, displayLetter: 'H' as const },
      ],
      words: played.words.map((entry) => ({ ...entry, letters: entry.letters })),
      score: played,
    };
    const classicBoard = applyPlay(board, play, classic);
    const wildBoard = applyPlay(board, play, wild);
    const classicCell = classicBoard.cells[4 * 9 + 5];
    const wildCell = wildBoard.cells[4 * 9 + 5];
    expect(classicCell).toMatchObject({ points: 4 });
    expect(classicCell && 'upgraded' in classicCell).toBe(false);
    expect(wildCell).toMatchObject({ points: 8, upgraded: true });

    const again = scoreFormedWords(wild, [word([letter(4, 5, 'H', 8, false), letter(4, 6, 'I', 1, true)])], 0);
    expect(again.words[0]?.letters[0]).toMatchObject({ letterMultiplier: 1, value: 8 });
    expect(again.total).toBe(9);
    const classicAgain = scoreFormedWords(classic, [word([letter(4, 5, 'H', 4, false), letter(4, 6, 'I', 1, true)])], 0);
    expect(classicAgain.words[0]?.letters[0]).toMatchObject({ letterMultiplier: 1, value: 4 });
    expect(classicAgain.total).toBe(5);

    const blank = scoreFormedWords(wild, [word([letter(4, 4, 'A', 1, true), letter(4, 5, 'A', 0, true)])], 0);
    const blankBoard = applyPlay(board, {
      placements: [
        { row: 4, col: 4, tileId: 'a', letter: 'A', assignedLetter: null, points: 1, displayLetter: 'A' },
        { row: 4, col: 5, tileId: 'blank', letter: null, assignedLetter: 'A', points: 0, displayLetter: 'A' },
      ],
      words: blank.words,
      score: blank,
    }, wild);
    const blankCell = blankBoard.cells[4 * 9 + 5];
    expect(blankCell).toMatchObject({ points: 0 });
    expect(blankCell && 'upgraded' in blankCell).toBe(false);
  });
});

describe('wild match persistence', () => {
  it('writes the upgrade into the match and refuses a forged tile value', () => {
    const rules = withRules((current) => ({
      ...current,
      boardSize: 9,
      rackSize: 2,
      centerWordMultiplier: 1,
      firstPlayCoversCenter: true,
      bonuses: [{ row: 4, col: 5, class: 'letter-2' as const }],
      scoring: { ...current.scoring, tileUpgrade: 'wild' as const },
      tileSet: [
        { kind: 'letter' as const, letter: 'A' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'T' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'H' as const, count: 2, points: 4 },
        { kind: 'blank' as const, count: 0, points: 0 as const },
      ],
    }));
    const started = dealMatch({
      rules,
      bag: ['A-1', 'H-1', 'A-2', 'T-1', 'T-2', 'H-2'].map((id) => {
        const letter = id[0] as Letter;
        return letterTile(id, letter);
      }),
    });
    const rack = started.players[0].rack;
    const forged = applyMatchAction(
      started,
      {
        type: 'play',
        seat: 0,
        placements: [
          { row: 4, col: 4, tile: { ...rack[0]!, points: 99 } },
          { row: 4, col: 5, tile: rack[1]! },
        ],
      },
      { dictionary: fixtureDictionary(['AH', 'HA', 'AT', 'TA', 'HT', 'TH']) },
    );
    expect(forged.ok).toBe(false);

    const played = applyMatchAction(
      started,
      {
        type: 'play',
        seat: 0,
        placements: [
          { row: 4, col: 4, tile: rack[0]! },
          { row: 4, col: 5, tile: rack[1]! },
        ],
      },
      { dictionary: fixtureDictionary(['AH', 'HA', 'AT', 'TA', 'HT', 'TH', 'AA', 'HH']) },
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const cell = played.state.board.cells[4 * 9 + 5];
    expect(cell?.kind).toBe('occupied');
    if (cell?.kind !== 'occupied') return;
    const face = rack[1]?.points ?? 0;
    expect(cell.points).toBe(face * 2);
    expect(cell.upgraded).toBe(true);
    expect(played.state.players[0].score).toBe((rack[0]?.points ?? 0) + face * 2 + rules.bingoBonus);
    const saved = validateRules(played.state.rules);
    expect(saved.ok).toBe(true);
  });
});
