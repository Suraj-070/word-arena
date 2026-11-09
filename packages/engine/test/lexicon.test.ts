import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DICTIONARY_PRESETS,
  applyPlay,
  createBoard,
  dictionaryForPreset,
  readCell,
  rulesWithDictionary,
  sharedLexicon,
  validatePlay,
  arenaStandardRules,
  type Letter,
  type TileInstance,
} from '../src/index';
import { LEXICON_COUNTS, LEXICON_SHA256, LEXICON_TEXT } from '../src/lexicon-data';
import { blankTile, letterTile } from './helpers';

const BITS: Record<(typeof DICTIONARY_PRESETS)[number]['spelling'], number> = {
  D: 1,
  B: 2,
  Z: 4,
  A: 8,
  C: 16,
};

function provider(spelling: (typeof DICTIONARY_PRESETS)[number]['spelling']) {
  const preset = DICTIONARY_PRESETS.find((item) => item.spelling === spelling);
  if (!preset) throw new Error(spelling);
  const dictionary = dictionaryForPreset(preset.id);
  if (!dictionary) throw new Error(preset.id);
  return { preset, dictionary };
}

describe('shared ESDB lexicon', () => {
  it('matches the generated counts and sha256', () => {
    const table = sharedLexicon();
    expect(table.size).toBe(LEXICON_COUNTS.unique);
    expect(createHash('sha256').update(LEXICON_TEXT).digest('hex')).toBe(LEXICON_SHA256);
    const counts = { D: 0, B: 0, Z: 0, A: 0, C: 0, shared: 0 };
    for (const mask of table.values()) {
      if (mask === 31) counts.shared += 1;
      for (const preset of DICTIONARY_PRESETS) {
        if ((mask & BITS[preset.spelling]) !== 0) counts[preset.spelling] += 1;
      }
    }
    expect(counts).toEqual({
      D: LEXICON_COUNTS.D,
      B: LEXICON_COUNTS.B,
      Z: LEXICON_COUNTS.Z,
      A: LEXICON_COUNTS.A,
      C: LEXICON_COUNTS.C,
      shared: LEXICON_COUNTS.shared,
    });
  });

  it('keeps spelling differences in each preset and shares words that belong to all five', () => {
    const australian = provider('D').dictionary;
    const british = provider('B').dictionary;
    const oxford = provider('Z').dictionary;
    const american = provider('A').dictionary;
    const canadian = provider('C').dictionary;

    expect(australian.contains('colour')).toBe(true);
    expect(british.contains('colour')).toBe(true);
    expect(oxford.contains('colour')).toBe(true);
    expect(canadian.contains('colour')).toBe(true);
    expect(american.contains('colour')).toBe(false);
    expect(american.contains('color')).toBe(true);
    expect(australian.contains('color')).toBe(false);

    expect(australian.contains('organise')).toBe(true);
    expect(british.contains('organise')).toBe(true);
    expect(oxford.contains('organise')).toBe(false);
    expect(american.contains('organise')).toBe(false);
    expect(canadian.contains('organise')).toBe(false);
    expect(oxford.contains('organize')).toBe(true);
    expect(american.contains('organize')).toBe(true);
    expect(canadian.contains('organize')).toBe(true);
    expect(australian.contains('organize')).toBe(false);
    expect(british.contains('organize')).toBe(false);

    for (const word of ['cat', 'at', 'the']) {
      for (const preset of DICTIONARY_PRESETS) {
        expect(provider(preset.spelling).dictionary.contains(word), `${preset.spelling} ${word}`).toBe(true);
      }
    }
  });

  it('rejects an unknown word, the wrong case form of a non-word, and Unicode that only looks like A–Z', () => {
    const { dictionary } = provider('D');
    expect(dictionary.contains('zzzzqqq')).toBe(false);
    expect(dictionary.contains('COLOUR')).toBe(true);
    expect(dictionary.contains('Colour')).toBe(true);
    expect(dictionary.contains('\u212Aat')).toBe(false);
    expect(dictionary.contains('café')).toBe(false);
    expect(dictionary.contains("don't")).toBe(false);
    expect(dictionary.contains('colour\n')).toBe(false);
  });

  it('rejects a one-letter token and a word longer than the board edge', () => {
    const { dictionary } = provider('A');
    expect(dictionary.contains('a')).toBe(false);
    expect(dictionary.contains('I')).toBe(false);
    expect(dictionary.contains('a'.repeat(32))).toBe(false);
    expect(dictionary.contains('at')).toBe(true);
  });

  it('does not let one preset accept another preset’s spelling', () => {
    const american = provider('A');
    const australian = provider('D');
    expect(american.dictionary.versionId).not.toBe(australian.dictionary.versionId);
    expect(american.dictionary.contains('colour')).toBe(false);
    expect(australian.dictionary.contains('color')).toBe(false);
  });
});

function requirePreset(versionId: string) {
  const dictionary = dictionaryForPreset(versionId);
  if (!dictionary) throw new Error(versionId);
  return dictionary;
}

describe('plays against the shared lexicon', () => {
  const rules = arenaStandardRules();
  const dictionary = requirePreset(rules.dictionaryVersionId);

  function open(placements: Parameters<typeof validatePlay>[0]['placements']) {
    return validatePlay({
      rules,
      board: createBoard(rules),
      rack: placements.map((placement) => placement.tile),
      placements,
      dictionary,
    });
  }

  it('scores a blank and the cross words from the same preset', () => {
    const blank = blankTile('blank');
    const tee = letterTile('t', 'T');
    const opening = open([
      { row: 7, col: 7, tile: blank, assignedLetter: 'A' },
      { row: 7, col: 8, tile: tee },
    ]);
    expect(opening.ok).toBe(true);
    if (!opening.ok) return;
    expect(opening.play.words[0]?.text).toBe('AT');
    expect(opening.play.placements[0]?.points).toBe(0);
    expect(opening.play.score.total).toBe(2);
    const board = applyPlay(createBoard(rules), opening.play);
    expect(readCell(board, 7, 7)).toMatchObject({ letter: null, assignedLetter: 'A', points: 0 });

    const hooked = validatePlay({
      rules,
      board,
      rack: [letterTile('h', 'H'), letterTile('i', 'I')],
      placements: [
        { row: 6, col: 7, tile: letterTile('h', 'H') },
        { row: 6, col: 8, tile: letterTile('i', 'I') },
      ],
      dictionary,
    });
    expect(hooked.ok).toBe(true);
    if (!hooked.ok) return;
    expect(hooked.play.words.map((word) => word.text)).toEqual(['HI', 'HA', 'IT']);
    const ha = hooked.play.words.find((word) => word.text === 'HA');
    expect(ha?.letters.some((letter) => letter.points === 0)).toBe(true);
    expect(hooked.play.score.total).toBe(11);
  });

  it('rejects a spelling the active preset does not contain, on every preset', () => {
    const samples = [
      { spelling: 'D' as const, word: 'COLOR', legal: 'COLOUR' },
      { spelling: 'B' as const, word: 'ORGANIZE', legal: 'ORGANISE' },
      { spelling: 'Z' as const, word: 'ORGANISE', legal: 'ORGANIZE' },
      { spelling: 'A' as const, word: 'COLOUR', legal: 'COLOR' },
      { spelling: 'C' as const, word: 'ORGANISE', legal: 'ORGANIZE' },
    ];
    for (const sample of samples) {
      const selected = provider(sample.spelling);
      const selectedRules = rulesWithDictionary(rules, selected.preset.id);
      const tiles = [...sample.word].map((letter, index) => letterTile(`${sample.spelling}-${index}`, letter as Letter));
      const rejected = validatePlay({
        rules: selectedRules,
        board: createBoard(selectedRules),
        rack: tiles,
        placements: tiles.map((tile, index) => ({ row: 7, col: 7 + index - Math.floor(tiles.length / 2), tile })),
        dictionary: selected.dictionary,
      });
      expect(rejected.ok, sample.spelling).toBe(false);
      if (!rejected.ok) expect(rejected.errors.some((error) => error.code === 'unknown-word')).toBe(true);

      const legalTiles = [...sample.legal].map((letter, index) => letterTile(`ok-${sample.spelling}-${index}`, letter as Letter));
      const accepted = validatePlay({
        rules: selectedRules,
        board: createBoard(selectedRules),
        rack: legalTiles,
        placements: legalTiles.map((tile, index) => ({ row: 7, col: 7 + index - Math.floor(legalTiles.length / 2), tile })),
        dictionary: selected.dictionary,
      });
      expect(accepted.ok, sample.legal).toBe(true);
    }
  });

  it('uses the provider that matches the match, not a different preset', () => {
    const american = provider('A');
    const tiles: TileInstance[] = [letterTile('c', 'C'), letterTile('o1', 'O'), letterTile('l', 'L'), letterTile('o2', 'O'), letterTile('u', 'U'), letterTile('r', 'R')];
    const mismatch = validatePlay({
      rules: rulesWithDictionary(rules, american.preset.id),
      board: createBoard(rules),
      rack: tiles,
      placements: tiles.map((tile, index) => ({ row: 7, col: 5 + index, tile })),
      dictionary,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.errors.some((error) => error.code === 'dictionary-mismatch')).toBe(true);
  });
});
