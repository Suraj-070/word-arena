import { isLegalBoardSize } from './coordinates';
import { isDictionaryPresetId } from './dictionary';
import { isLetter } from './letters';
import type {
  BonusClass,
  BonusSquare,
  Letter,
  Rules,
  RulesError,
  RulesResult,
  ScoringRules,
  TileDefinition,
} from './types';

const FIELDS = [
  'rulesetId',
  'modeId',
  'version',
  'boardSize',
  'rackSize',
  'bingoBonus',
  'minWordLength',
  'firstPlayCoversCenter',
  'centerWordMultiplier',
  'tileSet',
  'bonuses',
  'language',
  'dictionaryVersionId',
  'scoring',
  'passRoundLimit',
  'exchangeAllowed',
] as const;

const BONUS_CLASSES: ReadonlySet<string> = new Set(['letter-2', 'letter-3', 'word-2', 'word-3']);
const RULESET_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function error(code: RulesError['code'], message: string, path?: string): RulesError {
  return path === undefined ? { code, message } : { code, message, path };
}

function freezeRules(rules: Rules): Rules {
  return Object.freeze({
    ...rules,
    tileSet: Object.freeze(rules.tileSet.map((tile) => Object.freeze({ ...tile }))),
    bonuses: Object.freeze(rules.bonuses.map((bonus) => Object.freeze({ ...bonus }))),
    scoring: Object.freeze({ ...rules.scoring }),
  });
}

export function validateRules(input: unknown): RulesResult {
  if (!isRecord(input)) {
    return { ok: false, errors: [error('not-object', 'Rules must be an object.')] };
  }

  const errors: RulesError[] = [];
  for (const key of Object.keys(input)) {
    if (!FIELDS.includes(key as (typeof FIELDS)[number])) {
      errors.push(error('unknown-field', `Unknown rules field "${key}".`, key));
    }
  }
  for (const key of FIELDS) {
    if (!(key in input)) {
      errors.push(error('missing-field', `Missing rules field "${key}".`, key));
    }
  }

  const rulesetId = readRulesetId(input.rulesetId, errors);
  const modeId = readMode(input.modeId, errors);
  const version = readVersion(input.version, errors);
  const boardSize = readBoardSize(input.boardSize, errors);
  const tileSet = readTileSet(input.tileSet, errors);
  const tileTotal = tileSet?.reduce((sum, tile) => sum + tile.count, 0);
  const rackSize = readRackSize(input.rackSize, tileTotal, errors);
  const bingoBonus = readNonNegative(input.bingoBonus, 'bingo', 'Bingo bonus', errors);
  const minWordLength = readMinWordLength(input.minWordLength, boardSize, errors);
  const firstPlayCoversCenter = readBoolean(
    input.firstPlayCoversCenter,
    'center',
    'firstPlayCoversCenter',
    errors,
  );
  const centerWordMultiplier = readCenterMultiplier(input.centerWordMultiplier, errors);
  const bonuses = boardSize === undefined ? undefined : readBonuses(input.bonuses, boardSize, errors);
  const language = readLanguage(input.language, errors);
  const dictionaryVersionId = readDictionary(input.dictionaryVersionId, language, errors);
  const scoring = readScoring(input.scoring, errors);
  const passRoundLimit = readPassLimit(input.passRoundLimit, errors);
  const exchangeAllowed = readBoolean(input.exchangeAllowed, 'exchange', 'exchangeAllowed', errors);

  if (
    errors.length > 0 ||
    rulesetId === undefined ||
    modeId === undefined ||
    version === undefined ||
    boardSize === undefined ||
    rackSize === undefined ||
    bingoBonus === undefined ||
    minWordLength === undefined ||
    firstPlayCoversCenter === undefined ||
    centerWordMultiplier === undefined ||
    tileSet === undefined ||
    bonuses === undefined ||
    language === undefined ||
    dictionaryVersionId === undefined ||
    scoring === undefined ||
    passRoundLimit === undefined ||
    exchangeAllowed === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rules: freezeRules({
      rulesetId,
      modeId,
      version,
      boardSize,
      rackSize,
      bingoBonus,
      minWordLength,
      firstPlayCoversCenter,
      centerWordMultiplier,
      tileSet,
      bonuses,
      language,
      dictionaryVersionId,
      scoring,
      passRoundLimit,
      exchangeAllowed,
    }),
  };
}

function readRulesetId(value: unknown, errors: RulesError[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !RULESET_ID.test(value)) {
    errors.push(error('ruleset', 'Ruleset id must be a lowercase slug.', 'rulesetId'));
    return undefined;
  }
  return value;
}

function readMode(value: unknown, errors: RulesError[]): 'arena-standard' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'arena-standard') {
    errors.push(error('mode', 'The only accepted mode is arena-standard.', 'modeId'));
    return undefined;
  }
  return 'arena-standard';
}

function readVersion(value: unknown, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) {
    errors.push(error('version', 'Rules version must be an integer of 1 or more.', 'version'));
    return undefined;
  }
  return value;
}

function readBoardSize(value: unknown, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || !isLegalBoardSize(value)) {
    errors.push(
      error('board-size', 'Board edge must be an odd integer from 9 through 31.', 'boardSize'),
    );
    return undefined;
  }
  return value;
}

function readRackSize(value: unknown, tileTotal: number | undefined, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) {
    errors.push(error('rack-size', 'Rack size must be an integer of 1 or more.', 'rackSize'));
    return undefined;
  }
  if (tileTotal !== undefined && value > tileTotal) {
    errors.push(error('rack-size', 'Rack size cannot exceed the number of tiles.', 'rackSize'));
    return undefined;
  }
  return value;
}

function readNonNegative(
  value: unknown,
  code: 'bingo',
  label: string,
  errors: RulesError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 0) {
    errors.push(error(code, `${label} must be an integer of 0 or more.`, 'bingoBonus'));
    return undefined;
  }
  return value;
}

function readMinWordLength(value: unknown, boardSize: number | undefined, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 2 || (boardSize !== undefined && value > boardSize)) {
    errors.push(
      error('min-word-length', 'Minimum word length must be an integer from 2 through the board edge.', 'minWordLength'),
    );
    return undefined;
  }
  return value;
}

function readCenterMultiplier(value: unknown, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) {
    errors.push(error('center', 'Centre word multiplier must be an integer of 1 or more.', 'centerWordMultiplier'));
    return undefined;
  }
  return value;
}

function readBoolean(
  value: unknown,
  code: 'center' | 'exchange',
  path: string,
  errors: RulesError[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.push(error(code, `${path} must be a boolean.`, path));
    return undefined;
  }
  return value;
}

function readLanguage(value: unknown, errors: RulesError[]): 'en' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'en') {
    errors.push(error('language', 'The only accepted language is en.', 'language'));
    return undefined;
  }
  return 'en';
}

function readDictionary(value: unknown, language: 'en' | undefined, errors: RulesError[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isDictionaryPresetId(value)) {
    errors.push(error('dictionary', 'Dictionary preset is not one of the accepted identifiers.', 'dictionaryVersionId'));
    return undefined;
  }
  if (language === undefined) return undefined;
  return value;
}

function readScoring(value: unknown, errors: RulesError[]): ScoringRules | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(error('scoring', 'Scoring rules must be an object.', 'scoring'));
    return undefined;
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== 'letterBonusOnNewTilesOnly' && key !== 'wordMultipliersCombine') {
      errors.push(error('scoring', `Unknown scoring field "${key}".`, `scoring.${key}`));
    }
  }
  if (value.letterBonusOnNewTilesOnly !== true) {
    errors.push(
      error(
        'scoring',
        'Letter bonuses apply only to tiles placed this turn.',
        'scoring.letterBonusOnNewTilesOnly',
      ),
    );
  }
  if (value.wordMultipliersCombine !== 'product') {
    errors.push(error('scoring', 'Word multipliers combine by product.', 'scoring.wordMultipliersCombine'));
  }
  if (value.letterBonusOnNewTilesOnly !== true || value.wordMultipliersCombine !== 'product') return undefined;
  return { letterBonusOnNewTilesOnly: true, wordMultipliersCombine: 'product' };
}

function readPassLimit(value: unknown, errors: RulesError[]): number | undefined {
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) {
    errors.push(error('pass-limit', 'Pass round limit must be an integer of 1 or more.', 'passRoundLimit'));
    return undefined;
  }
  return value;
}

function readTileSet(value: unknown, errors: RulesError[]): readonly TileDefinition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(error('tile-set', 'Tile set must be an array.', 'tileSet'));
    return undefined;
  }

  const tiles: TileDefinition[] = [];
  const seen = new Set<string>();
  let scoringTiles = 0;
  let failed = false;

  for (let index = 0; index < value.length; index += 1) {
    const parsed = readTileDefinition(value[index], index, seen, errors);
    if (!parsed) {
      failed = true;
      continue;
    }
    tiles.push(parsed);
    if (parsed.count > 0 && parsed.points > 0) scoringTiles += parsed.count;
  }

  if (!failed && scoringTiles < 1) {
    errors.push(error('tile-set', 'The tile set needs at least one scoring tile.', 'tileSet'));
    failed = true;
  }

  return failed ? undefined : tiles;
}

function readTileDefinition(
  value: unknown,
  index: number,
  seen: Set<string>,
  errors: RulesError[],
): TileDefinition | undefined {
  const path = `tileSet[${index}]`;
  if (!isRecord(value)) {
    errors.push(error('tile-set', 'A tile definition must be an object.', path));
    return undefined;
  }

  if (value.kind === 'blank') {
    if (seen.has('blank')) {
      errors.push(error('tile-set', 'The blank tile is defined more than once.', path));
      return undefined;
    }
    seen.add('blank');
    if (!isInteger(value.count) || value.count < 0) {
      errors.push(error('tile-set', 'Blank count must be an integer of 0 or more.', `${path}.count`));
      return undefined;
    }
    if (value.points !== 0) {
      errors.push(error('tile-set', 'A blank tile scores 0.', `${path}.points`));
      return undefined;
    }
    return { kind: 'blank', count: value.count, points: 0 };
  }

  if (value.kind !== 'letter') {
    errors.push(error('tile-set', 'Tile kind must be letter or blank.', `${path}.kind`));
    return undefined;
  }
  if (!isLetter(value.letter)) {
    errors.push(error('tile-set', 'Letter must be A through Z.', `${path}.letter`));
    return undefined;
  }
  if (seen.has(value.letter)) {
    errors.push(error('tile-set', `Letter ${value.letter} is defined more than once.`, path));
    return undefined;
  }
  seen.add(value.letter);
  if (!isInteger(value.count) || value.count < 0 || !isInteger(value.points) || value.points < 0) {
    errors.push(error('tile-set', 'Letter count and points must be integers of 0 or more.', path));
    return undefined;
  }
  return { kind: 'letter', letter: value.letter, count: value.count, points: value.points };
}

function readBonuses(value: unknown, boardSize: number, errors: RulesError[]): readonly BonusSquare[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(error('bonus', 'Bonuses must be an array.', 'bonuses'));
    return undefined;
  }

  const bonuses: BonusSquare[] = [];
  const seen = new Set<string>();
  let failed = false;
  for (let index = 0; index < value.length; index += 1) {
    const bonus = readBonus(value[index], index, boardSize, seen, errors);
    if (!bonus) {
      failed = true;
      continue;
    }
    bonuses.push(bonus);
  }
  return failed ? undefined : bonuses;
}

function readBonus(
  value: unknown,
  index: number,
  boardSize: number,
  seen: Set<string>,
  errors: RulesError[],
): BonusSquare | undefined {
  const path = `bonuses[${index}]`;
  if (!isRecord(value)) {
    errors.push(error('bonus', 'A bonus square must be an object.', path));
    return undefined;
  }
  if (!isInteger(value.row) || !isInteger(value.col) || value.row < 0 || value.col < 0 || value.row >= boardSize || value.col >= boardSize) {
    errors.push(error('bonus', 'Bonus square is outside the board.', path));
    return undefined;
  }
  if (typeof value.class !== 'string' || !BONUS_CLASSES.has(value.class)) {
    errors.push(error('bonus', 'Bonus class must be letter-2, letter-3, word-2, or word-3.', `${path}.class`));
    return undefined;
  }
  const key = `${value.row}:${value.col}`;
  if (seen.has(key)) {
    errors.push(error('bonus', 'Two bonuses occupy the same square.', path));
    return undefined;
  }
  seen.add(key);
  return { row: value.row, col: value.col, class: value.class as BonusClass };
}

export function pointsFor(rules: Rules, letter: Letter | null): number | undefined {
  if (letter === null) {
    const blank = rules.tileSet.find((tile) => tile.kind === 'blank');
    return blank?.points;
  }
  const found = rules.tileSet.find((tile) => tile.kind === 'letter' && tile.letter === letter);
  return found?.points;
}

export function tileTotal(rules: Rules): number {
  return rules.tileSet.reduce((sum, tile) => sum + tile.count, 0);
}
