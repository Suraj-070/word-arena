import type { DictionaryProvider } from './types';

/**
 * Preset identifiers for the proposed ESDB release.
 * No word list is shipped. Licensing is not approved.
 * Oxford -ize (spelling Z) is specified in Phase 0 and is not accepted until its source is verified.
 */
export const DICTIONARY_PRESETS = [
  {
    id: 'esdb-rel-2026.02.25-D-60-v1',
    language: 'en',
    spelling: 'D',
    label: 'Australian English',
  },
  {
    id: 'esdb-rel-2026.02.25-A-60-v1',
    language: 'en',
    spelling: 'A',
    label: 'American English',
  },
  {
    id: 'esdb-rel-2026.02.25-B-60-v1',
    language: 'en',
    spelling: 'B',
    label: 'British English (-ise)',
  },
] as const;

export const DEFAULT_DICTIONARY_PRESET_ID = DICTIONARY_PRESETS[0].id;

const PRESET_IDS: ReadonlySet<string> = new Set(DICTIONARY_PRESETS.map((preset) => preset.id));

export function isDictionaryPresetId(value: string): boolean {
  return PRESET_IDS.has(value);
}

export type NormaliseResult =
  | { readonly ok: true; readonly word: string }
  | { readonly ok: false; readonly code: 'empty' | 'character' | 'too-short' | 'too-long' };

/**
 * Every code unit must be ASCII A–Z or a–z.
 * A `$` anchor is not used: in JavaScript it can match before a final line terminator.
 */
function isEntirelyAsciiLetters(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    if (!upper && !lower) return false;
  }
  return true;
}

/**
 * Accepts ASCII A–Z in either case.
 * The original text is checked before lowercasing, so a non-ASCII letter that
 * would lowercase into a–z is rejected. No accents are stripped.
 */
export function normalisePlayWord(input: string): NormaliseResult {
  if (input.length === 0) return { ok: false, code: 'empty' };
  if (!isEntirelyAsciiLetters(input)) return { ok: false, code: 'character' };
  if (input.length < 2) return { ok: false, code: 'too-short' };
  if (input.length > 31) return { ok: false, code: 'too-long' };
  return { ok: true, word: input.toLowerCase() };
}

/** In-memory fixture. This is not a licensed lexicon. */
export function createMemoryDictionary(versionId: string, words: readonly string[]): DictionaryProvider {
  const accepted = new Set<string>();
  for (const word of words) {
    const normalised = normalisePlayWord(word);
    if (!normalised.ok) {
      throw new Error(`Fixture word is not an A–Z play word: ${word}`);
    }
    accepted.add(normalised.word);
  }

  return {
    versionId,
    contains(word: string): boolean {
      const normalised = normalisePlayWord(word);
      if (!normalised.ok) return false;
      return accepted.has(normalised.word);
    },
  };
}
