import type { RandomSource } from '@word-arena/engine';

/** Unambiguous characters. The code is a secret shared by the two players. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function roomCode(random: RandomSource, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let code = '';
    for (let index = 0; index < 8; index += 1) {
      const roll = random();
      if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
        throw new Error('Random source must return a finite number in the range [0, 1).');
      }
      const offset = (Math.floor(roll * ROOM_ALPHABET.length) + attempt) % ROOM_ALPHABET.length;
      code += ROOM_ALPHABET[offset];
    }
    if (!taken.has(code)) return code;
  }
  throw new Error('A unique room code could not be chosen.');
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Display only. Membership never uses this value. */
export function cleanDisplayName(name: string): string {
  const trimmed = name.trim().slice(0, 24).trim();
  return trimmed.length > 0 ? trimmed : 'Player';
}
