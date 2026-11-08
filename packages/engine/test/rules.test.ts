import { describe, expect, it } from 'vitest';
import {
  DICTIONARY_PRESETS,
  NAMED_BOARD_SIZES,
  arenaStandardDefinition,
  arenaStandardRules,
  tileTotal,
  validateRules,
} from '../src/index';

const rules = arenaStandardRules();

describe('Arena Standard configuration', () => {
  it('uses the approved defaults and an empty bonus list', () => {
    expect(rules.rulesetId).toBe('arena-standard');
    expect(rules.modeId).toBe('arena-standard');
    expect(rules.version).toBe(1);
    expect(rules.boardSize).toBe(15);
    expect(rules.rackSize).toBe(7);
    expect(rules.bingoBonus).toBe(50);
    expect(rules.minWordLength).toBe(2);
    expect(rules.firstPlayCoversCenter).toBe(true);
    expect(rules.centerWordMultiplier).toBe(2);
    expect(rules.bonuses).toEqual([]);
    expect(rules.language).toBe('en');
    expect(rules.dictionaryVersionId).toBe(DICTIONARY_PRESETS[0].id);
    expect(tileTotal(rules)).toBe(100);
    expect(rules.passRoundLimit).toBe(2);
    expect(rules.exchangeAllowed).toBe(true);
    const blank = rules.tileSet.find((tile) => tile.kind === 'blank');
    expect(blank).toEqual({ kind: 'blank', count: 2, points: 0 });
    expect(rules.tileSet.find((tile) => tile.kind === 'letter' && tile.letter === 'Q')).toMatchObject({
      count: 1,
      points: 10,
    });
  });

  it('accepts the named sizes and other odd edges, and rejects the rest', () => {
    for (const boardSize of [9, 11, 13, 15, 17, 19, 21, 31]) {
      const result = validateRules({ ...arenaStandardDefinition(), boardSize });
      expect(result.ok, String(boardSize)).toBe(true);
    }
    expect(NAMED_BOARD_SIZES).toEqual([9, 11, 13, 15, 19]);

    for (const boardSize of [7, 8, 10, 32, 33, 15.5]) {
      const input = { ...arenaStandardDefinition(), boardSize };
      const result = validateRules(input);
      expect(result.ok, String(boardSize)).toBe(false);
      if (!result.ok) expect(result.errors.some((issue) => issue.code === 'board-size')).toBe(true);
      expect(input.boardSize).toBe(boardSize);
    }
  });
});

describe('validateRules', () => {
  it('rejects an unknown mode and an unknown field without repairing them', () => {
    const mode = validateRules({ ...arenaStandardDefinition(), modeId: 'speed' });
    expect(mode.ok).toBe(false);
    if (!mode.ok) expect(mode.errors.map((issue) => issue.code)).toContain('mode');

    const extra = validateRules({ ...arenaStandardDefinition(), theme: 'dark' });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors.map((issue) => issue.code)).toContain('unknown-field');
  });

  it('rejects a blank that scores, a rack larger than the bag, and a short word length', () => {
    const tiles = arenaStandardRules().tileSet.map((tile) =>
      tile.kind === 'blank' ? { ...tile, points: 3 } : { ...tile },
    );
    const blank = validateRules({ ...arenaStandardDefinition(), tileSet: tiles });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.some((issue) => issue.code === 'tile-set')).toBe(true);

    const rack = validateRules({ ...arenaStandardDefinition(), rackSize: 101 });
    expect(rack.ok).toBe(false);
    if (!rack.ok) expect(rack.errors.some((issue) => issue.code === 'rack-size')).toBe(true);

    const length = validateRules({ ...arenaStandardDefinition(), minWordLength: 1 });
    expect(length.ok).toBe(false);
    if (!length.ok) expect(length.errors.some((issue) => issue.code === 'min-word-length')).toBe(true);
  });

  it('rejects bonus squares that fall outside the board or share a square', () => {
    const outside = validateRules({
      ...arenaStandardDefinition(),
      bonuses: [{ row: 15, col: 0, class: 'letter-2' }],
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.errors.some((issue) => issue.code === 'bonus')).toBe(true);

    const shared = validateRules({
      ...arenaStandardDefinition(),
      bonuses: [
        { row: 0, col: 0, class: 'word-2' },
        { row: 0, col: 0, class: 'letter-3' },
      ],
    });
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.errors.some((issue) => issue.message.includes('same square'))).toBe(true);
  });

  it('rejects a dictionary id that has not been accepted', () => {
    const result = validateRules({
      ...arenaStandardDefinition(),
      dictionaryVersionId: 'esdb-rel-2026.02.25-Z-60-v1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((issue) => issue.code === 'dictionary')).toBe(true);
  });

  it('rejects scoring that would reapply bonuses to old tiles', () => {
    const result = validateRules({
      ...arenaStandardDefinition(),
      scoring: { letterBonusOnNewTilesOnly: false, wordMultipliersCombine: 'product' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((issue) => issue.code === 'scoring')).toBe(true);
  });
});
