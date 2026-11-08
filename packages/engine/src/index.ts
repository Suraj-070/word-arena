export { applyPlay, createBoard, isBoardEmpty, occupiedCells, readCell } from './board';
export {
  MAX_BOARD_SIZE,
  MIN_BOARD_SIZE,
  NAMED_BOARD_SIZES,
  centerCoordinate,
  coversCenter,
  inBounds,
  isLegalBoardSize,
} from './coordinates';
export {
  DEFAULT_DICTIONARY_PRESET_ID,
  DICTIONARY_PRESETS,
  createMemoryDictionary,
  isDictionaryPresetId,
  normalisePlayWord,
} from './dictionary';
export { LETTERS, isLetter } from './letters';
export { validatePlay } from './placement';
export { arenaStandardDefinition, arenaStandardRules } from './presets';
export { pointsFor, tileTotal, validateRules } from './rules';
export { bingoAward, bonusAt, scoreFormedWords } from './scoring';

export type {
  Board,
  BonusClass,
  BonusSquare,
  Cell,
  CellRead,
  Coordinate,
  DictionaryProvider,
  FormedLetter,
  FormedWord,
  Letter,
  PlayError,
  PlayErrorCode,
  PlayInput,
  PlayResult,
  ResolvedPlacement,
  Rules,
  RulesError,
  RulesErrorCode,
  RulesResult,
  ScoreBreakdown,
  ScoredLetter,
  ScoredWord,
  ScoringRules,
  TileDefinition,
  TileInstance,
  TilePlacement,
  ValidatedPlay,
} from './types';
