import type { Board, BonusSquare, Letter, MatchEnd, ScoreBreakdown, Seat, TileInstance, TileUpgrade } from '@word-arena/engine';

export type RoomStatus = 'waiting' | 'ready' | 'playing' | 'cancelled' | 'finished';

export type OnlineFailure = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

export type MemberView = {
  readonly userId: string;
  readonly seat: Seat;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly displayName: string;
};

export type RoomView = {
  readonly id: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly hostId: string;
  readonly youAreHost: boolean;
  readonly yourSeat: Seat;
  readonly expiresAt: string;
  readonly matchId: string | null;
  readonly members: readonly MemberView[];
};

export type PublicMatch = {
  readonly matchId: string;
  readonly roomId: string;
  readonly version: number;
  readonly turn: Seat;
  readonly status: 'playing' | 'finished';
  readonly consecutivePasses: number;
  readonly board: Board;
  readonly boardSize: number;
  readonly scores: readonly [number, number];
  readonly names: readonly [string, string];
  readonly rackCounts: readonly [number, number];
  readonly end: MatchEnd | null;
  readonly last: {
    readonly kind: 'play' | 'pass' | 'exchange' | 'resign';
    readonly seat: Seat;
    readonly total: number | null;
    readonly score: ScoreBreakdown | null;
  } | null;
  readonly dictionaryAvailable: boolean;
  readonly dictionaryVersionId: string;
  readonly exchangeAllowed: boolean;
  readonly bonuses: readonly BonusSquare[];
  readonly centerWordMultiplier: number;
  /** Taken from the match snapshot. A client cannot change it after the start. */
  readonly tileUpgrade: TileUpgrade;
};

/** Authorised view for one player. The opponent's rack and the bag are absent. */
export type PlayerMatch = PublicMatch & {
  readonly yourSeat: Seat;
  readonly rack: readonly TileInstance[];
};

export type PlayPlacement = {
  readonly row: number;
  readonly col: number;
  readonly tileId: string;
  readonly assignedLetter?: Letter;
};

export type MatchCommand =
  | { readonly type: 'play'; readonly placements: readonly PlayPlacement[] }
  | { readonly type: 'pass' }
  | { readonly type: 'exchange'; readonly tileIds: readonly string[] }
  | { readonly type: 'resign' };

export type MatchNotice = {
  readonly matchId: string;
  readonly version: number;
};

export type RoomResult = { readonly ok: true; readonly room: RoomView } | OnlineFailure;
export type MatchResult = { readonly ok: true; readonly match: PlayerMatch } | OnlineFailure;
