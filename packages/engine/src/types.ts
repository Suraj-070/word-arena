/**
 * Coordinates are zero-based.
 * Row 0 is the top edge and increases downward.
 * Column 0 is the left edge and increases to the right.
 * The centre of an odd board is ((size - 1) / 2, (size - 1) / 2).
 * The shell's accessible row and column numbers are these values plus one.
 */
export type Coordinate = {
  readonly row: number;
  readonly col: number;
};

export type Letter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

export type BonusClass = 'letter-2' | 'letter-3' | 'word-2' | 'word-3';

export type TileDefinition =
  | {
      readonly kind: 'letter';
      readonly letter: Letter;
      readonly count: number;
      readonly points: number;
    }
  | {
      readonly kind: 'blank';
      readonly count: number;
      readonly points: 0;
    };

/** A physical tile. A blank keeps letter null and points 0 for its whole life. */
export type TileInstance = {
  readonly id: string;
  readonly letter: Letter | null;
  readonly points: number;
};

export type BonusSquare = Coordinate & {
  readonly class: BonusClass;
};

export type ScoringRules = {
  /** The engine rejects false. Letter bonuses apply only to tiles placed this turn. */
  readonly letterBonusOnNewTilesOnly: true;
  /** The engine rejects any other combination. */
  readonly wordMultipliersCombine: 'product';
};

/**
 * Validated rules. Build one with `validateRules` or `arenaStandardRules`.
 * `passRoundLimit` is the number of full rounds of consecutive passes that end a match.
 * With two seats, the match ends when consecutive passes reach `passRoundLimit * 2`.
 */
export type Rules = {
  readonly rulesetId: string;
  readonly modeId: 'arena-standard';
  readonly version: number;
  readonly boardSize: number;
  readonly rackSize: number;
  readonly bingoBonus: number;
  readonly minWordLength: number;
  readonly firstPlayCoversCenter: boolean;
  readonly centerWordMultiplier: number;
  readonly tileSet: readonly TileDefinition[];
  readonly bonuses: readonly BonusSquare[];
  readonly language: 'en';
  readonly dictionaryVersionId: string;
  readonly scoring: ScoringRules;
  readonly passRoundLimit: number;
  readonly exchangeAllowed: boolean;
};

export type RulesErrorCode =
  | 'not-object'
  | 'unknown-field'
  | 'missing-field'
  | 'ruleset'
  | 'mode'
  | 'version'
  | 'board-size'
  | 'rack-size'
  | 'tile-set'
  | 'bingo'
  | 'min-word-length'
  | 'center'
  | 'bonus'
  | 'language'
  | 'dictionary'
  | 'scoring'
  | 'pass-limit'
  | 'exchange';

export type RulesError = {
  readonly code: RulesErrorCode;
  readonly message: string;
  readonly path?: string;
};

export type RulesResult =
  | { readonly ok: true; readonly rules: Rules }
  | { readonly ok: false; readonly errors: readonly RulesError[] };

export type Cell =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'occupied';
      readonly tileId: string;
      /** Null when the physical tile is a blank. */
      readonly letter: Letter | null;
      /** The letter a blank shows. Null on a letter tile. */
      readonly assignedLetter: Letter | null;
      readonly points: number;
    };

export type Board = {
  readonly size: number;
  readonly cells: readonly Cell[];
};

export type CellRead = Cell | { readonly kind: 'out-of-bounds' };

export type TilePlacement = {
  readonly row: number;
  readonly col: number;
  readonly tile: TileInstance;
  /** Required for a blank. Forbidden on a letter tile. */
  readonly assignedLetter?: Letter;
};

export type FormedLetter = {
  readonly row: number;
  readonly col: number;
  readonly letter: Letter;
  readonly points: number;
  readonly placedThisTurn: boolean;
  readonly tileId: string;
};

export type FormedWord = {
  readonly direction: 'horizontal' | 'vertical';
  readonly start: Coordinate;
  readonly letters: readonly FormedLetter[];
  readonly text: string;
};

export type ResolvedPlacement = {
  readonly row: number;
  readonly col: number;
  readonly tileId: string;
  readonly letter: Letter | null;
  readonly assignedLetter: Letter | null;
  readonly points: number;
  readonly displayLetter: Letter;
};

export type ScoredLetter = FormedLetter & {
  readonly letterMultiplier: number;
  readonly value: number;
};

export type ScoredWord = {
  readonly direction: 'horizontal' | 'vertical';
  readonly start: Coordinate;
  readonly text: string;
  readonly letters: readonly ScoredLetter[];
  readonly raw: number;
  readonly wordMultiplier: number;
  readonly score: number;
};

export type ScoreBreakdown = {
  readonly words: readonly ScoredWord[];
  readonly bingo: number;
  readonly total: number;
};

export type ValidatedPlay = {
  readonly placements: readonly ResolvedPlacement[];
  readonly words: readonly FormedWord[];
  readonly score: ScoreBreakdown;
};

export type PlayErrorCode =
  | 'invalid-input'
  | 'empty-placement'
  | 'duplicate-coordinate'
  | 'duplicate-tile'
  | 'tile-not-on-rack'
  | 'tile-mismatch'
  | 'tile-value'
  | 'assigned-letter'
  | 'out-of-bounds'
  | 'occupied'
  | 'not-straight'
  | 'gap'
  | 'opening-misses-center'
  | 'disconnected'
  | 'word-too-short'
  | 'unknown-word'
  | 'dictionary-mismatch'
  | 'board-mismatch'
  | 'corrupt-cell';

export type PlayError = {
  readonly code: PlayErrorCode;
  readonly message: string;
  readonly row?: number;
  readonly col?: number;
  readonly tileId?: string;
  readonly word?: string;
};

export type PlayResult =
  | { readonly ok: true; readonly play: ValidatedPlay }
  | { readonly ok: false; readonly errors: readonly PlayError[] };

export type DictionaryProvider = {
  readonly versionId: string;
  contains(word: string): boolean;
};

export type PlayInput = {
  readonly rules: Rules;
  readonly board: Board;
  readonly rack: readonly TileInstance[];
  readonly placements: readonly TilePlacement[];
  readonly dictionary: DictionaryProvider;
};

/** Inclusive of 0 and exclusive of 1. Callers supply this. The engine does not call `Math.random`. */
export type RandomSource = () => number;

export type Seat = 0 | 1;

export type PlayerState = {
  readonly name: string;
  readonly rack: readonly TileInstance[];
  readonly score: number;
};

export type MatchEnd =
  | { readonly kind: 'going-out'; readonly seat: Seat }
  | { readonly kind: 'passes' }
  | { readonly kind: 'resign'; readonly resigned: Seat; readonly winner: Seat };

export type MatchLast = {
  readonly kind: 'play' | 'pass' | 'exchange' | 'resign';
  readonly seat: Seat;
  readonly score: ScoreBreakdown | null;
};

export type MatchState = {
  readonly rules: Rules;
  readonly players: readonly [PlayerState, PlayerState];
  readonly bag: readonly TileInstance[];
  readonly board: Board;
  readonly turn: Seat;
  readonly consecutivePasses: number;
  readonly status: 'playing' | 'finished';
  readonly end: MatchEnd | null;
  readonly version: number;
  readonly last: MatchLast | null;
};

export type MatchErrorCode =
  | PlayErrorCode
  | 'match-finished'
  | 'wrong-seat'
  | 'dictionary-unavailable'
  | 'exchange-disabled'
  | 'exchange-empty'
  | 'exchange-bag'
  | 'exchange-tile'
  | 'random-rejected'
  | 'rack-order'
  | 'name';

export type MatchError = {
  readonly code: MatchErrorCode;
  readonly message: string;
  readonly row?: number;
  readonly col?: number;
  readonly tileId?: string;
  readonly word?: string;
};
