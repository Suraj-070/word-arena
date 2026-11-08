import {
  arenaStandardRules,
  createMemoryDictionary,
  validateRules,
  type BonusSquare,
  type Letter,
  type Rules,
  type TileDefinition,
  type TileInstance,
} from '../src/index';

const STANDARD = arenaStandardRules();

function cloneRules(rules: Rules): Rules {
  return {
    ...rules,
    tileSet: rules.tileSet.map((tile) => ({ ...tile })) as TileDefinition[],
    bonuses: rules.bonuses.map((bonus) => ({ ...bonus })),
    scoring: { ...rules.scoring },
  };
}

export function withRules(change: (rules: Rules) => Rules): Rules {
  const next = change(cloneRules(STANDARD));
  const result = validateRules(next);
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.message).join('\n'));
  return result.rules;
}

export function withBonuses(bonuses: readonly BonusSquare[], extra?: (rules: Rules) => Rules): Rules {
  return withRules((rules) => {
    const patched = extra ? extra({ ...rules, bonuses: [...bonuses] }) : { ...rules, bonuses: [...bonuses] };
    return patched;
  });
}

export function letterTile(id: string, letter: Letter): TileInstance {
  const definition = STANDARD.tileSet.find((tile) => tile.kind === 'letter' && tile.letter === letter);
  if (!definition || definition.kind !== 'letter') throw new Error(`Missing ${letter}`);
  return { id, letter, points: definition.points };
}

export function blankTile(id: string): TileInstance {
  return { id, letter: null, points: 0 };
}

export function fixtureDictionary(words: readonly string[] = ['AT', 'CAT', 'HI', 'HA', 'HAI', 'IT', 'TO', 'AAAAAAA']) {
  return createMemoryDictionary(STANDARD.dictionaryVersionId, words);
}
