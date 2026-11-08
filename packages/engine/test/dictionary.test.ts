import { describe, expect, it } from 'vitest';
import { createMemoryDictionary, normalisePlayWord } from '../src/index';

describe('play-word normalisation', () => {
  it('accepts A–Z in either case', () => {
    expect(normalisePlayWord('CAT')).toEqual({ ok: true, word: 'cat' });
    expect(normalisePlayWord('at')).toEqual({ ok: true, word: 'at' });
    expect(normalisePlayWord('a'.repeat(31)).ok).toBe(true);
  });

  it('accepts cat and rejects letters that only look like A–Z', () => {
    expect(normalisePlayWord('cat')).toEqual({ ok: true, word: 'cat' });
    expect(normalisePlayWord('CAT')).toEqual({ ok: true, word: 'cat' });

    const rejected = ['\u212AAT', 'café', 'ÉAT', 'AT ', 'A T', "don't", 'A1', '12'] as const;
    for (const input of rejected) {
      const result = normalisePlayWord(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) expect(result.code, input).toBe('character');
    }

    const dictionary = createMemoryDictionary('fixture', ['CAT']);
    expect(dictionary.contains('cat')).toBe(true);
    expect(dictionary.contains('\u212AAT')).toBe(false);
  });

  it('rejects empty input, marks, punctuation, digits, and the wrong length', () => {
    const cases = [
      ['', 'empty'],
      ['A', 'too-short'],
      ['a'.repeat(32), 'too-long'],
      ["don't", 'character'],
      ['café', 'character'],
      ['A1', 'character'],
      ['AT ', 'character'],
    ] as const;
    for (const [input, code] of cases) {
      const result = normalisePlayWord(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });
});

describe('memory dictionary', () => {
  it('matches the normalised form and nothing else', () => {
    const dictionary = createMemoryDictionary('fixture', ['CAT', 'at']);
    expect(dictionary.contains('cat')).toBe(true);
    expect(dictionary.contains('AT')).toBe(true);
    expect(dictionary.contains('dog')).toBe(false);
    expect(dictionary.contains("don't")).toBe(false);
  });

  it('refuses a fixture word that is not A–Z', () => {
    expect(() => createMemoryDictionary('fixture', ['café'])).toThrow(/A–Z/);
  });
});
