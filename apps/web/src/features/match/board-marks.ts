import type { BonusClass, BonusSquare } from '@word-arena/engine';

export type BonusMark = {
  readonly label: string;
  readonly kind: BonusClass;
};

const LABEL: Record<BonusClass, string> = {
  'letter-2': 'L2',
  'letter-3': 'L3',
  'word-2': 'W2',
  'word-3': 'W3',
};

export const BONUS_NAME: Record<BonusClass, string> = {
  'letter-2': 'double letter',
  'letter-3': 'triple letter',
  'word-2': 'double word',
  'word-3': 'triple word',
};

/** Bonus labels come from the match rules. The centre word bonus is labelled only when the layout is in use. */
export function bonusMarks(
  boardSize: number,
  bonuses: readonly BonusSquare[],
  centerWordMultiplier: number,
): Map<string, BonusMark> {
  const marks = new Map<string, BonusMark>();
  for (const bonus of bonuses) {
    marks.set(`${bonus.row}-${bonus.col}`, { label: LABEL[bonus.class], kind: bonus.class });
  }
  if (bonuses.length > 0 && centerWordMultiplier > 1) {
    const center = (boardSize - 1) / 2;
    const key = `${center}-${center}`;
    if (!marks.has(key)) marks.set(key, { label: 'W2', kind: 'word-2' });
  }
  return marks;
}

export function scoringCopy(mode: 'classic' | 'wild'): string {
  if (mode === 'wild') {
    return 'Eligible letter bonuses permanently upgrade the played tile’s value for the remainder of the match.';
  }
  return 'Letter bonuses affect the current play without changing printed tile values.';
}

export function nextMatchCopy(): string {
  return 'This choice starts the next match. It does not change the match in progress.';
}
