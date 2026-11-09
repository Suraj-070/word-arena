import {
  applyMatchAction,
  createMatch,
  arenaStandardRules,
  isDictionaryPresetId,
  rulesWithDictionary,
  rulesWithScoringMode,
  type DictionaryProvider,
  type MatchState,
  type RandomSource,
  type Rules,
  type TileUpgrade,
  type Seat,
  type TilePlacement,
} from '@word-arena/engine';
import { cleanDisplayName, normaliseCode, roomCode } from './codes';
import type { MatchCommand, MatchResult, MemberView, OnlineFailure, PlayerMatch, PublicMatch, RoomResult, RoomStatus, RoomView } from './types';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

type Member = MemberView & { readonly roomId: string };

type Room = {
  readonly id: string;
  readonly code: string;
  readonly hostId: string;
  status: RoomStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  matchId: string | null;
};

export type LiveMatch = {
  readonly id: string;
  readonly roomId: string;
  state: MatchState;
  readonly users: readonly [string, string];
  readonly dictionary: DictionaryProvider | null;
};

type Receipt = {
  readonly userId: string;
  readonly command: string;
  readonly result: MatchResult;
};

export interface MatchDirectory {
  createRoom(userId: string, displayName: string): Promise<RoomResult>;
  joinRoom(userId: string, code: string, displayName: string): Promise<RoomResult>;
  setReady(userId: string, roomId: string): Promise<RoomResult>;
  startMatch(userId: string, roomId: string, dictionaryVersionId?: string, scoringMode?: TileUpgrade): Promise<RoomResult>;
  cancelRoom(userId: string, roomId: string): Promise<RoomResult>;
  setPresence(userId: string, roomId: string, connected: boolean): Promise<RoomResult>;
  readRoom(userId: string, roomId: string): Promise<RoomResult>;
  readMatch(userId: string, matchId: string): Promise<MatchResult>;
  act(
    userId: string,
    matchId: string,
    command: MatchCommand,
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<MatchResult>;
}

export type DirectoryOptions = {
  readonly now?: () => string;
  readonly random?: RandomSource;
  readonly ids?: () => string;
  readonly dictionary?: DictionaryProvider | null;
  /** Preset id to provider. When set, a match uses the provider for its own preset. */
  readonly dictionaries?: ReadonlyMap<string, DictionaryProvider>;
  readonly rules?: Rules;
  readonly ttlMs?: number;
};

export class MemoryDirectory {
  private readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, string>();
  private readonly members = new Map<string, Member[]>();
  private readonly matches = new Map<string, LiveMatch>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly now: () => string;
  private readonly random: RandomSource;
  private readonly ids: () => string;
  private readonly dictionary: DictionaryProvider | null;
  private readonly dictionaries: ReadonlyMap<string, DictionaryProvider> | null;
  private readonly rules: Rules;
  private readonly ttlMs: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: DirectoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.random = options.random ?? cryptoRandom;
    this.ids = options.ids ?? (() => globalThis.crypto.randomUUID());
    this.dictionary = options.dictionary ?? null;
    this.dictionaries = options.dictionaries ?? null;
    this.rules = options.rules ?? arenaStandardRules();
    this.ttlMs = options.ttlMs ?? ROOM_TTL_MS;
  }

  createRoom(userId: string, displayName: string): Promise<RoomResult> {
    return this.enqueue(() => this.createRoomNow(userId, displayName));
  }

  joinRoom(userId: string, code: string, displayName = 'Player'): Promise<RoomResult> {
    return this.enqueue(() => this.joinRoomNow(userId, code, displayName));
  }

  setReady(userId: string, roomId: string): Promise<RoomResult> {
    return this.enqueue(() => this.setReadyNow(userId, roomId));
  }

  startMatch(userId: string, roomId: string, dictionaryVersionId?: string, scoringMode?: TileUpgrade): Promise<RoomResult> {
    return this.enqueue(() => this.startMatchNow(userId, roomId, dictionaryVersionId, scoringMode));
  }

  cancelRoom(userId: string, roomId: string): Promise<RoomResult> {
    return this.enqueue(() => this.cancelRoomNow(userId, roomId));
  }

  setPresence(userId: string, roomId: string, connected: boolean): Promise<RoomResult> {
    return this.enqueue(() => this.setPresenceNow(userId, roomId, connected));
  }

  readRoom(userId: string, roomId: string): Promise<RoomResult> {
    return this.enqueue(() => this.readRoomNow(userId, roomId));
  }

  readMatch(userId: string, matchId: string): Promise<MatchResult> {
    return this.enqueue(() => this.readMatchNow(userId, matchId));
  }

  act(userId: string, matchId: string, command: MatchCommand, idempotencyKey: string, expectedVersion?: number): Promise<MatchResult> {
    return this.enqueue(() => this.actNow(userId, matchId, command, idempotencyKey, expectedVersion));
  }

  /** Test aid: the full bag and both racks. Not returned by any player method. */
  secret(matchId: string): { bagIds: readonly string[]; racks: readonly [readonly string[], readonly string[]] } | null {
    const match = this.matches.get(matchId);
    if (!match) return null;
    return {
      bagIds: match.state.bag.map((tile) => tile.id),
      racks: [match.state.players[0].rack.map((tile) => tile.id), match.state.players[1].rack.map((tile) => tile.id)],
    };
  }

  private enqueue<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private createRoomNow(userId: string, displayName: string): RoomResult {
    if (!userId) return fail('unauthenticated', 'Sign in before creating a room.');
    const id = this.ids();
    const code = roomCode(this.random, new Set(this.codes.keys()));
    const createdAt = this.now();
    const expiresAt = new Date(Date.parse(createdAt) + this.ttlMs).toISOString();
    const room: Room = { id, code, hostId: userId, status: 'waiting', createdAt, expiresAt, matchId: null };
    this.rooms.set(id, room);
    this.codes.set(code, id);
    this.members.set(id, [member(id, userId, 0, cleanDisplayName(displayName))]);
    return { ok: true, room: this.roomView(room, userId) };
  }

  private joinRoomNow(userId: string, rawCode: string, displayName: string): RoomResult {
    if (!userId) return fail('unauthenticated', 'Sign in before joining a room.');
    const code = normaliseCode(rawCode);
    const roomId = this.codes.get(code);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) return fail('invalid-code', 'That room code is not valid.');
    if (room.status === 'cancelled') return fail('cancelled', 'That room was cancelled.');
    const existing = this.memberList(room.id).find((entry) => entry.userId === userId);
    if (existing) return { ok: true, room: this.roomView(room, userId) };
    if (this.expired(room)) return fail('expired', 'That room has expired.');
    if (room.status === 'playing' || room.status === 'finished') return fail('closed', 'That room is not open.');
    if (this.memberList(room.id).length >= 2) return fail('full', 'That room already has two players.');
    this.members.set(room.id, [...this.memberList(room.id), member(room.id, userId, 1, cleanDisplayName(displayName))]);
    return { ok: true, room: this.roomView(room, userId) };
  }

  private setReadyNow(userId: string, roomId: string): RoomResult {
    const room = this.requireMember(userId, roomId);
    if (!room.ok) return room;
    if (room.room.status === 'cancelled' || room.room.status === 'finished') {
      return fail('closed', 'That room is not open.');
    }
    const next = this.memberList(roomId).map((entry) => (entry.userId === userId ? { ...entry, ready: true } : entry));
    this.members.set(roomId, next);
    if (room.room.status === 'waiting' && next.length === 2 && next.every((entry) => entry.ready)) {
      room.room.status = 'ready';
    }
    return { ok: true, room: this.roomView(room.room, userId) };
  }

  private startMatchNow(userId: string, roomId: string, dictionaryVersionId?: string, scoringMode?: TileUpgrade): RoomResult {
    const room = this.requireMember(userId, roomId);
    if (!room.ok) return room;
    if (room.room.hostId !== userId) return fail('not-host', 'Only the host can start the match.');
    const seated = this.memberList(roomId).slice().sort((left, right) => left.seat - right.seat);
    if (seated.length !== 2 || seated.some((entry) => !entry.ready) || room.room.status !== 'ready') {
      return fail('not-ready', 'Both players need to be ready before the match starts.');
    }
    const host = seated[0];
    const guest = seated[1];
    if (!host || !guest) return fail('not-ready', 'Both players need to be ready before the match starts.');
    const rules = rulesForMatch(this.rules, dictionaryVersionId, scoringMode);
    if ('ok' in rules) return rules;
    const state = createMatch({
      rules,
      names: [host.displayName, guest.displayName],
      random: this.random,
    });
    const id = this.ids();
    this.matches.set(id, {
      id,
      roomId,
      state,
      users: [host.userId, guest.userId],
      dictionary: dictionaryForMatch(this.dictionaries, this.dictionary, state),
    });
    room.room.status = 'playing';
    room.room.matchId = id;
    return { ok: true, room: this.roomView(room.room, userId) };
  }

  private cancelRoomNow(userId: string, roomId: string): RoomResult {
    const room = this.requireMember(userId, roomId);
    if (!room.ok) return room;
    if (room.room.hostId !== userId) return fail('not-host', 'Only the host can cancel the room.');
    if (room.room.status === 'playing' || room.room.status === 'finished') {
      return fail('closed', 'A started match stays in place. A player can resign on their turn.');
    }
    room.room.status = 'cancelled';
    return { ok: true, room: this.roomView(room.room, userId) };
  }

  private setPresenceNow(userId: string, roomId: string, connected: boolean): RoomResult {
    const room = this.requireMember(userId, roomId);
    if (!room.ok) return room;
    this.members.set(
      roomId,
      this.memberList(roomId).map((entry) => (entry.userId === userId ? { ...entry, connected } : entry)),
    );
    return { ok: true, room: this.roomView(room.room, userId) };
  }

  private readRoomNow(userId: string, roomId: string): RoomResult {
    const room = this.requireMember(userId, roomId);
    if (!room.ok) return room;
    return { ok: true, room: this.roomView(room.room, userId) };
  }

  private readMatchNow(userId: string, matchId: string): MatchResult {
    const match = this.matches.get(matchId);
    if (!match || !match.users.includes(userId)) return fail('not-member', 'You are not in that match.');
    return { ok: true, match: playerView(match, userId) };
  }

  private actNow(userId: string, matchId: string, command: MatchCommand, idempotencyKey: string, expectedVersion?: number): MatchResult {
    const match = this.matches.get(matchId);
    if (!match || !match.users.includes(userId)) return fail('not-member', 'You are not in that match.');
    const key = `${matchId}:${idempotencyKey}`;
    const decided = decideAct({
      match,
      userId,
      command,
      idempotencyKey,
      expectedVersion,
      prior: this.receipts.get(key) ?? null,
      random: this.random,
    });
    if (decided.storeReceipt) {
      this.matches.set(matchId, decided.match);
      this.receipts.set(key, { userId, command: canonicalCommand(command), result: decided.result });
      if (decided.finished) {
        const room = this.rooms.get(match.roomId);
        if (room) room.status = 'finished';
      }
    }
    return decided.result;
  }

  private requireMember(userId: string, roomId: string): { ok: true; room: Room } | OnlineFailure {
    const room = this.rooms.get(roomId);
    if (!room || !this.memberList(roomId).some((entry) => entry.userId === userId)) {
      return fail('not-member', 'You are not in that room.');
    }
    return { ok: true, room };
  }

  private memberList(roomId: string): Member[] {
    return this.members.get(roomId) ?? [];
  }

  private expired(room: Room): boolean {
    return (room.status === 'waiting' || room.status === 'ready') && Date.parse(room.expiresAt) <= Date.parse(this.now());
  }

  private roomView(room: Room, userId: string): RoomView {
    const members = this.memberList(room.id);
    const you = members.find((entry) => entry.userId === userId);
    return {
      id: room.id,
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      youAreHost: room.hostId === userId,
      yourSeat: you?.seat ?? 0,
      expiresAt: room.expiresAt,
      matchId: room.matchId,
      members: members.map(({ userId: id, seat, ready, connected, displayName }) => ({ userId: id, seat, ready, connected, displayName })),
    };
  }
}

export type StoredReceipt = {
  readonly userId: string;
  readonly command: string;
  readonly result: MatchResult;
};

export type ActDecision = {
  readonly result: MatchResult;
  readonly match: LiveMatch;
  readonly storeReceipt: boolean;
  readonly finished: boolean;
};

export function canonicalCommand(command: MatchCommand): string {
  if (command.type === 'pass' || command.type === 'resign') return JSON.stringify({ type: command.type });
  if (command.type === 'exchange') return JSON.stringify({ type: 'exchange', tileIds: [...command.tileIds] });
  return JSON.stringify({
    type: 'play',
    placements: command.placements.map((placement) => ({
      row: placement.row,
      col: placement.col,
      tileId: placement.tileId,
      ...(placement.assignedLetter ? { assignedLetter: placement.assignedLetter } : {}),
    })),
  });
}

/** One rules path for memory and Postgres. The caller stores the receipt and the next match together. */
export function decideAct(input: {
  readonly match: LiveMatch;
  readonly userId: string;
  readonly command: MatchCommand;
  readonly idempotencyKey: string;
  readonly expectedVersion?: number;
  readonly prior: StoredReceipt | null;
  readonly random: RandomSource;
}): ActDecision {
  const { match, userId, command, idempotencyKey, expectedVersion, prior, random } = input;
  const keep = (result: MatchResult): ActDecision => ({ result, match, storeReceipt: false, finished: false });
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return keep(fail('invalid-command', 'An action needs an idempotency key.'));
  }
  if (!match.users.includes(userId)) return keep(fail('not-member', 'You are not in that match.'));
  const commandText = canonicalCommand(command);
  if (prior) {
    if (prior.userId !== userId || prior.command !== commandText) {
      return keep(fail('duplicate-command', 'That idempotency key was already used.'));
    }
    return keep(prior.result);
  }
  if (expectedVersion !== undefined && expectedVersion !== match.state.version) {
    return keep(fail('stale', 'The match changed. Load it again before retrying.'));
  }
  const seat = seatOf(match, userId);
  if (match.state.status !== 'playing') return keep(fail('match-finished', 'The match is over.'));
  if (seat !== match.state.turn) return keep(fail('wrong-seat', 'It is not your turn.'));

  const action = toEngineAction(match, seat, command);
  if (!action.ok) return keep(action);
  const applied = applyMatchAction(match.state, action.action, { dictionary: dictionaryOnMatch(match), random });
  if (!applied.ok) {
    const error = applied.errors[0];
    const result = fail(error?.code ?? 'rejected', error?.message ?? 'The action was rejected.');
    return {
      result,
      match,
      storeReceipt: error?.code === 'dictionary-unavailable',
      finished: false,
    };
  }
  const next: LiveMatch = { ...match, state: applied.state };
  return {
    result: { ok: true, match: playerView(next, userId) },
    match: next,
    storeReceipt: true,
    finished: applied.state.status === 'finished',
  };
}

function toEngineAction(
  match: LiveMatch,
  seat: Seat,
  command: MatchCommand,
): { ok: true; action: Parameters<typeof applyMatchAction>[1] } | OnlineFailure {
  if (command.type === 'pass') return { ok: true, action: { type: 'pass', seat } };
  if (command.type === 'resign') return { ok: true, action: { type: 'resign', seat } };
  if (command.type === 'exchange') return { ok: true, action: { type: 'exchange', seat, tileIds: command.tileIds } };
  const rack = match.state.players[seat].rack;
  const placements: TilePlacement[] = [];
  for (const placement of command.placements) {
    const tile = rack.find((candidate) => candidate.id === placement.tileId);
    if (!tile) return fail('tile-not-on-rack', 'That tile is not on your rack.');
    placements.push({
      row: placement.row,
      col: placement.col,
      tile,
      ...(tile.letter === null && placement.assignedLetter ? { assignedLetter: placement.assignedLetter } : {}),
    });
  }
  return { ok: true, action: { type: 'play', seat, placements } };
}

export function publicMatch(match: PlayerMatch): PublicMatch {
  const { rack: _rack, yourSeat: _seat, ...rest } = match;
  return rest;
}

export function playerView(match: LiveMatch, userId: string): PlayerMatch {
  const seat = seatOf(match, userId);
  const [left, right] = match.state.players;
  return {
    matchId: match.id,
    roomId: match.roomId,
    version: match.state.version,
    turn: match.state.turn,
    status: match.state.status,
    consecutivePasses: match.state.consecutivePasses,
    board: match.state.board,
    boardSize: match.state.rules.boardSize,
    scores: [left.score, right.score],
    names: [left.name, right.name],
    rackCounts: [left.rack.length, right.rack.length],
    end: match.state.end,
    last: match.state.last
      ? {
          kind: match.state.last.kind,
          seat: match.state.last.seat,
          total: match.state.last.score?.total ?? null,
          score: match.state.last.score,
        }
      : null,
    dictionaryAvailable: dictionaryOnMatch(match) !== null,
    dictionaryVersionId: match.state.rules.dictionaryVersionId,
    exchangeAllowed: match.state.rules.exchangeAllowed,
    bonuses: match.state.rules.bonuses,
    centerWordMultiplier: match.state.rules.centerWordMultiplier,
    tileUpgrade: match.state.rules.scoring?.tileUpgrade === 'wild' ? 'wild' : 'classic',
    yourSeat: seat,
    rack: match.state.players[seat].rack,
  };
}

function seatOf(match: LiveMatch, userId: string): Seat {
  return match.users[1] === userId ? 1 : 0;
}

function member(roomId: string, userId: string, seat: Seat, displayName: string): Member {
  return { roomId, userId, seat, ready: false, connected: true, displayName };
}

export function rulesForMatch(
  base: Rules,
  dictionaryVersionId: string | undefined,
  scoringMode?: TileUpgrade,
): Rules | OnlineFailure {
  if (scoringMode !== undefined && scoringMode !== 'classic' && scoringMode !== 'wild') {
    return fail('invalid-command', 'That scoring mode is not available.');
  }
  const withDictionary = dictionaryVersionId === undefined || dictionaryVersionId === base.dictionaryVersionId
    ? base
    : isDictionaryPresetId(dictionaryVersionId)
      ? rulesWithDictionary(base, dictionaryVersionId)
      : fail('invalid-command', 'That dictionary preset is not available.');
  if ('ok' in withDictionary) return withDictionary;
  if (!scoringMode) return withDictionary;
  return rulesWithScoringMode(withDictionary, scoringMode);
}

export function dictionaryForMatch(
  dictionaries: ReadonlyMap<string, DictionaryProvider> | null,
  fallback: DictionaryProvider | null,
  state: MatchState,
): DictionaryProvider | null {
  const versionId = state.rules.dictionaryVersionId;
  if (dictionaries) {
    const found = dictionaries.get(versionId) ?? null;
    return found && found.versionId === versionId ? found : null;
  }
  if (fallback && fallback.versionId !== versionId) return null;
  return fallback;
}

/** The provider stored on the match counts only when it is the match's preset. */
export function dictionaryOnMatch(match: LiveMatch): DictionaryProvider | null {
  const dictionary = match.dictionary;
  if (!dictionary || dictionary.versionId !== match.state.rules.dictionaryVersionId) return null;
  return dictionary;
}

function fail(code: string, message: string): OnlineFailure {
  return { ok: false, code, message };
}

export function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 4294967296;
}
