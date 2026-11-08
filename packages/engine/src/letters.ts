import type { Letter } from './types';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const LETTER_SET: ReadonlySet<string> = new Set(LETTERS);

export function isLetter(value: unknown): value is Letter {
  return typeof value === 'string' && value.length === 1 && LETTER_SET.has(value);
}
