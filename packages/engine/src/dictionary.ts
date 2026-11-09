import type { DictionaryProvider } from './types';
import { LEXICON_TEXT } from './lexicon-data';

/**
 * ESDB rel-2026.02.25, size 60, variant level 1.
 * Australian is the default. Oxford -ize (Z) and Canadian (C) are generated
 * and are not licence-cleared. The bit is private to the shared lexicon.
 */
export const DICTIONARY_PRESETS = [
  {
    id: 'esdb-rel-2026.02.25-D-60-v1',
    language: 'en',
    spelling: 'D',
    label: 'Australian English',
    bit: 1,
  },
  {
    id: 'esdb-rel-2026.02.25-B-60-v1',
    language: 'en',
    spelling: 'B',
    label: 'British English (-ise)',
    bit: 2,
  },
  {
    id: 'esdb-rel-2026.02.25-Z-60-v1',
    language: 'en',
    spelling: 'Z',
    label: 'Oxford English (-ize)',
    bit: 4,
  },
  {
    id: 'esdb-rel-2026.02.25-A-60-v1',
    language: 'en',
    spelling: 'A',
    label: 'American English',
    bit: 8,
  },
  {
    id: 'esdb-rel-2026.02.25-C-60-v1',
    language: 'en',
    spelling: 'C',
    label: 'Canadian English',
    bit: 16,
  },
] as const;

export type DictionaryPreset = (typeof DICTIONARY_PRESETS)[number];

export const DEFAULT_DICTIONARY_PRESET_ID = DICTIONARY_PRESETS[0].id;

const PRESETS_BY_ID = new Map<string, DictionaryPreset>(DICTIONARY_PRESETS.map((preset) => [preset.id, preset]));

export function isDictionaryPresetId(value: string): boolean {
  return PRESETS_BY_ID.has(value);
}

export function dictionaryPreset(versionId: string): DictionaryPreset | null {
  return PRESETS_BY_ID.get(versionId) ?? null;
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

/** In-memory fixture. This is not the shipped lexicon. */
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

let lexicon: Map<string, number> | null = null;

/** One table for every preset. A word's bits say which presets accept it. */
export function sharedLexicon(): ReadonlyMap<string, number> {
  if (lexicon) return lexicon;
  const table = new Map<string, number>();
  for (const line of LEXICON_TEXT.split('\n')) {
    if (line.length === 0) continue;
    const space = line.lastIndexOf(' ');
    const word = line.slice(0, space);
    const mask = Number(line.slice(space + 1));
    table.set(word, mask);
  }
  lexicon = table;
  return table;
}

/** The preset's own list. Membership in another preset does not count. */
export function dictionaryForPreset(versionId: string): DictionaryProvider | null {
  const preset = PRESETS_BY_ID.get(versionId);
  if (!preset) return null;
  const bit = preset.bit;
  return {
    versionId: preset.id,
    contains(word: string): boolean {
      const normalised = normalisePlayWord(word);
      if (!normalised.ok) return false;
      const mask = sharedLexicon().get(normalised.word);
      return mask !== undefined && (mask & bit) !== 0;
    },
  };
}

export function sharedDictionaries(): ReadonlyMap<string, DictionaryProvider> {
  return new Map(DICTIONARY_PRESETS.map((preset) => [preset.id, dictionaryForPreset(preset.id) as DictionaryProvider]));
}
