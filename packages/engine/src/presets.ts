import { ARENA_BONUS_LAYOUT } from './bonus-layout';
import { DEFAULT_DICTIONARY_PRESET_ID } from './dictionary';
import { validateRules } from './rules';
import type { Letter, Rules, TileDefinition, TileUpgrade } from './types';

const STANDARD_LETTERS: readonly (readonly [Letter, number, number])[] = [
  ['A', 9, 1],
  ['B', 2, 3],
  ['C', 2, 3],
  ['D', 4, 2],
  ['E', 12, 1],
  ['F', 2, 4],
  ['G', 3, 2],
  ['H', 2, 4],
  ['I', 9, 1],
  ['J', 1, 8],
  ['K', 1, 5],
  ['L', 4, 1],
  ['M', 2, 3],
  ['N', 6, 1],
  ['O', 8, 1],
  ['P', 2, 3],
  ['Q', 1, 10],
  ['R', 6, 1],
  ['S', 4, 1],
  ['T', 6, 1],
  ['U', 4, 1],
  ['V', 2, 4],
  ['W', 2, 4],
  ['X', 1, 8],
  ['Y', 2, 4],
  ['Z', 1, 10],
];

function standardTileSet(): TileDefinition[] {
  const letters: TileDefinition[] = STANDARD_LETTERS.map(([letter, count, points]) => ({
    kind: 'letter',
    letter,
    count,
    points,
  }));
  return [...letters, { kind: 'blank', count: 2, points: 0 }];
}

/** Arena Standard data. The bonus list is empty until a layout is approved. */
export function arenaStandardDefinition(): Record<string, unknown> {
  return {
    rulesetId: 'arena-standard',
    modeId: 'arena-standard',
    version: 1,
    boardSize: 15,
    rackSize: 7,
    bingoBonus: 50,
    minWordLength: 2,
    firstPlayCoversCenter: true,
    centerWordMultiplier: 2,
    tileSet: standardTileSet(),
    bonuses: [],
    language: 'en',
    dictionaryVersionId: DEFAULT_DICTIONARY_PRESET_ID,
    scoring: {
      letterBonusOnNewTilesOnly: true,
      wordMultipliersCombine: 'product',
      tileUpgrade: 'classic',
    },
    passRoundLimit: 2,
    exchangeAllowed: true,
  };
}

export function arenaStandardRules(): Rules {
  const result = validateRules(arenaStandardDefinition());
  if (!result.ok) {
    throw new Error(`Arena Standard preset is invalid: ${result.errors.map((issue) => issue.message).join(' ')}`);
  }
  return result.rules;
}

/**
 * Classic or Wild on a 15-edge board uses the original bonus layout.
 * A smaller board keeps the bonuses it already has, so a custom list is not replaced.
 * Printed tile values stay put in Classic. Wild stores a used letter bonus on the tile.
 */
export function rulesWithScoringMode(base: Rules, mode: TileUpgrade): Rules {
  const bonuses = base.boardSize === ARENA_BONUS_LAYOUT.boardSize ? ARENA_BONUS_LAYOUT.squares : base.bonuses;
  const result = validateRules({
    ...base,
    bonuses,
    scoring: { ...base.scoring, tileUpgrade: mode },
  });
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => issue.message).join(' '));
  }
  return result.rules;
}

/** A copy of `base` that declares one shipped preset. The original rules are unchanged. */
export function rulesWithDictionary(base: Rules, dictionaryVersionId: string): Rules {
  const result = validateRules({ ...base, dictionaryVersionId });
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => issue.message).join(' '));
  }
  return result.rules;
}
