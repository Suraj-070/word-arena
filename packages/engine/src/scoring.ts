import { cellKey, centerCoordinate } from './coordinates';
import type { BonusClass, FormedWord, Rules, ScoreBreakdown, ScoredLetter, ScoredWord } from './types';

export function bonusAt(rules: Rules, row: number, col: number): BonusClass | undefined {
  return rules.bonuses.find((bonus) => bonus.row === row && bonus.col === col)?.class;
}

/** Bingo is once, and only when the play uses an entire full rack. */
export function bingoAward(rules: Rules, tilesPlaced: number, rackCount: number): number {
  if (tilesPlaced !== rackCount || rackCount !== rules.rackSize) return 0;
  return rules.bingoBonus;
}

export function scoreFormedWords(rules: Rules, words: readonly FormedWord[], bingo: number): ScoreBreakdown {
  const center = centerCoordinate(rules.boardSize);
  const centerKey = cellKey(center.row, center.col);
  const scored = words.map((word) => scoreWord(rules, word, centerKey));
  const wordTotal = scored.reduce((sum, word) => sum + word.score, 0);
  return {
    words: scored,
    bingo,
    total: wordTotal + bingo,
  };
}

function scoreWord(rules: Rules, word: FormedWord, centerKey: string): ScoredWord {
  let wordMultiplier = 1;
  const letters: ScoredLetter[] = word.letters.map((letter) => {
    const bonus = bonusAt(rules, letter.row, letter.col);
    const letterMultiplier = letter.placedThisTurn ? letterFactor(bonus) : 1;
    if (letter.placedThisTurn) wordMultiplier *= wordFactor(bonus);
    if (letter.placedThisTurn && cellKey(letter.row, letter.col) === centerKey) {
      wordMultiplier *= rules.centerWordMultiplier;
    }
    return {
      ...letter,
      letterMultiplier,
      value: letter.points * letterMultiplier,
    };
  });
  const raw = letters.reduce((sum, letter) => sum + letter.value, 0);
  return {
    direction: word.direction,
    start: word.start,
    text: word.text,
    letters,
    raw,
    wordMultiplier,
    score: raw * wordMultiplier,
  };
}

function letterFactor(bonus: BonusClass | undefined): number {
  if (bonus === 'letter-2') return 2;
  if (bonus === 'letter-3') return 3;
  return 1;
}

function wordFactor(bonus: BonusClass | undefined): number {
  if (bonus === 'word-2') return 2;
  if (bonus === 'word-3') return 3;
  return 1;
}
