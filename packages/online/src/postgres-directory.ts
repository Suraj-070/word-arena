import {
  createMatch,
  arenaStandardRules,
  type DictionaryProvider,
  type MatchState,
  type RandomSource,
  type Rules,
  type Seat,
} from '@word-arena/engine';
import { cleanDisplayName, normaliseCode, roomCode } from './codes';
import {
  canonicalCommand,
  cryptoRandom,
  decideAct,
  playerView,
  type DirectoryOptions,
  type LiveMatch,
  type MatchDirectory,
  type StoredReceipt,
} from './directory';
import type { Sql, SqlDatabase } from './sql';
import type { MatchCommand, MatchResult, MemberView, OnlineFailure, RoomResult, RoomStatus, RoomView } from './types';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

type RoomRow = {
  id: string;
  code: string;
  host_id: string;
  status: string;
  expires_at: unknown;
  match_id: string | null;
};

type MemberRow = {
  user_id: string;
  seat: number | string;
  ready: boolean;
  connected: boolean;
  display_name: string;
};

type LockedMatch = {
  room_id: string;
  version: number | string;
  room_status: string;
  engine: unknown;
  state_version: number | string;
  user_0: string;
  user_1: string;
};

export class PostgresDirectory implements MatchDirectory {
  private readonly now: () => string;
  private readonly random: RandomSource;
  private readonly ids: () => string;
  private readonly dictionary: DictionaryProvider | null;
  private readonly rules: Rules;
  private readonly ttlMs: number;

  constructor(
    private readonly db: SqlDatabase,
    options: DirectoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.random = options.random ?? cryptoRandom;
    this.ids = options.ids ?? (() => globalThis.crypto.randomUUID());
    this.dictionary = options.dictionary === undefined ? null : options.dictionary;
    this.rules = options.rules ?? arenaStandardRules();
    this.ttlMs = options.ttlMs ?? ROOM_TTL_MS;
  }

  createRoom(userId: string, displayName: string): Promise<RoomResult> {
    if (!userId) return Promise.resolve(fail('unauthenticated', 'Sign in before creating a room.'));
    const name = cleanDisplayName(displayName);
    return this.attemptCreate(userId, name, 0);
  }

  private async attemptCreate(userId: string, name: string, attempt: number): Promise<RoomResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const taken = new Set((await tx.query<{ code: string }>('select code from public.rooms')).rows.map((row) => row.code));
        let code: string;
        try {
          code = roomCode(this.random, taken);
        } catch {
          return fail('invalid-code', 'A room code could not be chosen.');
        }
        const id = this.ids();
        const expiresAt = new Date(Date.parse(this.now()) + this.ttlMs).toISOString();
        await tx.query(
          `insert into public.rooms (id, code, host_id, status, expires_at)
           values ($1, $2, $3, 'waiting', $4)`,
          [id, code, userId, expiresAt],
        );
        await tx.query(
          `insert into public.room_members (room_id, user_id, seat, ready, connected, display_name)
           values ($1, $2, 0, false, true, $3)`,
          [id, userId, name],
        );
        return { ok: true as const, room: await this.roomView(tx, id, userId) };
      });
    } catch (error) {
      if (isForeignKey(error)) return fail('unauthenticated', 'Sign in is required.');
      if (isUnique(error) && attempt < 7) return this.attemptCreate(userId, name, attempt + 1);
      throw error;
    }
  }

  joinRoom(userId: string, rawCode: string, displayName: string): Promise<RoomResult> {
    if (!userId) return Promise.resolve(fail('unauthenticated', 'Sign in before joining a room.'));
    const code = normaliseCode(rawCode);
    const name = cleanDisplayName(displayName);
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, 'code = $1', [code]);
      if (!room) return fail('invalid-code', 'That room code is not valid.');
      if (room.status === 'cancelled') return fail('cancelled', 'That room was cancelled.');
      const members = await this.memberRows(tx, room.id);
      if (members.some((entry) => entry.user_id === userId)) return { ok: true as const, room: await this.roomView(tx, room.id, userId) };
      if (this.expired(room)) return fail('expired', 'That room has expired.');
      if (room.status === 'playing' || room.status === 'finished') return fail('closed', 'That room is not open.');
      if (members.length >= 2) return fail('full', 'That room already has two players.');
      await tx.query(
        `insert into public.room_members (room_id, user_id, seat, ready, connected, display_name)
         values ($1, $2, 1, false, true, $3)`,
        [room.id, userId, name],
      );
      return { ok: true as const, room: await this.roomView(tx, room.id, userId) };
    }).catch((error: unknown) => {
      if (isForeignKey(error)) return fail('unauthenticated', 'Sign in is required.');
      if (isUnique(error)) return fail('full', 'That room already has two players.');
      throw error;
    });
  }

  setReady(userId: string, roomId: string): Promise<RoomResult> {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, 'id = $1', [roomId]);
      const members = room ? await this.memberRows(tx, room.id) : [];
      if (!room || !members.some((entry) => entry.user_id === userId)) return fail('not-member', 'You are not in that room.');
      if (room.status === 'cancelled' || room.status === 'finished') return fail('closed', 'That room is not open.');
      await tx.query(
        'update public.room_members set ready = true where room_id = $1 and user_id = $2',
        [roomId, userId],
      );
      const next = members.map((entry) => (entry.user_id === userId ? { ...entry, ready: true } : entry));
      if (room.status === 'waiting' && next.length === 2 && next.every((entry) => entry.ready)) {
        await tx.query(`update public.rooms set status = 'ready' where id = $1`, [roomId]);
      }
      return { ok: true as const, room: await this.roomView(tx, roomId, userId) };
    });
  }

  startMatch(userId: string, roomId: string): Promise<RoomResult> {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, 'id = $1', [roomId]);
      const members = room ? await this.memberRows(tx, room.id) : [];
      if (!room || !members.some((entry) => entry.user_id === userId)) return fail('not-member', 'You are not in that room.');
      if (room.host_id !== userId) return fail('not-host', 'Only the host can start the match.');
      const seated = [...members].sort((left, right) => Number(left.seat) - Number(right.seat));
      if (seated.length !== 2 || seated.some((entry) => !entry.ready) || room.status !== 'ready') {
        return fail('not-ready', 'Both players need to be ready before the match starts.');
      }
      const host = seated[0];
      const guest = seated[1];
      if (!host || !guest) return fail('not-ready', 'Both players need to be ready before the match starts.');
      const state = createMatch({ rules: this.rules, names: [host.display_name, guest.display_name], random: this.random });
      const id = this.ids();
      await this.insertMatch(tx, id, roomId, state, host.user_id, guest.user_id);
      await tx.query(`update public.rooms set status = 'playing', match_id = $2 where id = $1`, [roomId, id]);
      return { ok: true as const, room: await this.roomView(tx, roomId, userId) };
    });
  }

  cancelRoom(userId: string, roomId: string): Promise<RoomResult> {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, 'id = $1', [roomId]);
      const members = room ? await this.memberRows(tx, room.id) : [];
      if (!room || !members.some((entry) => entry.user_id === userId)) return fail('not-member', 'You are not in that room.');
      if (room.host_id !== userId) return fail('not-host', 'Only the host can cancel the room.');
      if (room.status === 'playing' || room.status === 'finished') {
        return fail('closed', 'A started match stays in place. A player can resign on their turn.');
      }
      await tx.query(`update public.rooms set status = 'cancelled' where id = $1`, [roomId]);
      return { ok: true as const, room: await this.roomView(tx, roomId, userId) };
    });
  }

  setPresence(userId: string, roomId: string, connected: boolean): Promise<RoomResult> {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, 'id = $1', [roomId]);
      const members = room ? await this.memberRows(tx, room.id) : [];
      if (!room || !members.some((entry) => entry.user_id === userId)) return fail('not-member', 'You are not in that room.');
      await tx.query(
        'update public.room_members set connected = $3 where room_id = $1 and user_id = $2',
        [roomId, userId, connected],
      );
      return { ok: true as const, room: await this.roomView(tx, roomId, userId) };
    });
  }

  readRoom(userId: string, roomId: string): Promise<RoomResult> {
    return this.db.transaction(async (tx) => {
      const members = await this.memberRows(tx, roomId);
      if (!members.some((entry) => entry.user_id === userId)) return fail('not-member', 'You are not in that room.');
      return { ok: true as const, room: await this.roomView(tx, roomId, userId) };
    });
  }

  readMatch(userId: string, matchId: string): Promise<MatchResult> {
    return this.db.transaction(async (tx) => {
      const live = await this.loadMatch(tx, matchId, false);
      if (!live || !live.users.includes(userId)) return fail('not-member', 'You are not in that match.');
      return { ok: true, match: playerView(live, userId) };
    });
  }

  async act(
    userId: string,
    matchId: string,
    command: MatchCommand,
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<MatchResult> {
    try {
      return await this.db.transaction((tx) => this.actIn(tx, userId, matchId, command, idempotencyKey, expectedVersion));
    } catch {
      return fail('unavailable', 'The match could not be saved.');
    }
  }

  private async actIn(
    tx: Sql,
    userId: string,
    matchId: string,
    command: MatchCommand,
    idempotencyKey: string,
    expectedVersion?: number,
  ): Promise<MatchResult> {
    const locked = await tx.query<LockedMatch>(
      `select m.room_id, m.version, r.status as room_status, s.engine, s.state_version, s.user_0, s.user_1
       from public.matches m
       join arena.secrets s on s.match_id = m.id
       join public.rooms r on r.id = m.room_id
       where m.id = $1
       for update of m, s, r`,
      [matchId],
    );
    const row = locked.rows[0];
    if (!row) return fail('not-member', 'You are not in that match.');
    const live = this.liveFrom(matchId, row);
    if (!live) return fail('unavailable', 'The match could not be saved.');
    const prior = await this.receipt(tx, matchId, idempotencyKey);
    const version = Number(row.version);
    const decided = decideAct({
      match: live,
      userId,
      command,
      idempotencyKey,
      expectedVersion,
      prior,
      random: this.random,
    });
    if (!decided.storeReceipt) return decided.result;
    const saved = await this.saveMatch(tx, matchId, decided.match.state, version);
    if (!saved) return fail('stale', 'The match changed. Load it again before retrying.');
    await tx.query(
      `insert into arena.receipts (match_id, idempotency_key, user_id, command, outcome)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [matchId, idempotencyKey, userId, JSON.parse(canonicalCommand(command)), decided.result],
    );
    if (decided.finished) {
      await tx.query(`update public.rooms set status = 'finished' where id = $1 and status = 'playing'`, [live.roomId]);
    }
    return decided.result;
  }

  private async insertMatch(tx: Sql, id: string, roomId: string, state: MatchState, hostId: string, guestId: string): Promise<void> {
    const endKind = state.end?.kind ?? null;
    await tx.query(
      `insert into public.matches (
         id, room_id, board, score_0, score_1, name_0, name_1,
         rack_count_0, rack_count_1, turn, status, consecutive_passes, version,
         end_kind, end_state, last_action, dictionary_available, exchange_allowed, board_size
       ) values (
         $1, $2, $3::jsonb, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14, $15::jsonb, $16::jsonb, $17, $18, $19
       )`,
      [
        id,
        roomId,
        state.board,
        state.players[0].score,
        state.players[1].score,
        state.players[0].name,
        state.players[1].name,
        state.players[0].rack.length,
        state.players[1].rack.length,
        state.turn,
        state.status,
        state.consecutivePasses,
        state.version,
        endKind,
        state.end,
        state.last ? publicLast(state) : null,
        this.dictionary !== null,
        state.rules.exchangeAllowed,
        state.rules.boardSize,
      ],
    );
    await tx.query(
      `insert into arena.secrets (match_id, bag, rack_0, rack_1, user_0, user_1, rules, state_version, engine)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8, $9::jsonb)`,
      [
        id,
        state.bag,
        state.players[0].rack,
        state.players[1].rack,
        hostId,
        guestId,
        state.rules,
        state.version,
        state,
      ],
    );
  }

  private async saveMatch(tx: Sql, id: string, state: MatchState, expectedVersion: number): Promise<boolean> {
    const updated = await tx.query(
      `update public.matches set
         board = $2::jsonb,
         score_0 = $3,
         score_1 = $4,
         name_0 = $5,
         name_1 = $6,
         rack_count_0 = $7,
         rack_count_1 = $8,
         turn = $9,
         status = $10,
         consecutive_passes = $11,
         version = $12,
         end_kind = $13,
         end_state = $14::jsonb,
         last_action = $15::jsonb,
         dictionary_available = $16,
         updated_at = now()
       where id = $1 and version = $17
       returning id`,
      [
        id,
        state.board,
        state.players[0].score,
        state.players[1].score,
        state.players[0].name,
        state.players[1].name,
        state.players[0].rack.length,
        state.players[1].rack.length,
        state.turn,
        state.status,
        state.consecutivePasses,
        state.version,
        state.end?.kind ?? null,
        state.end,
        state.last ? publicLast(state) : null,
        this.dictionary !== null,
        expectedVersion,
      ],
    );
    if (updated.rows.length === 0) return false;
    await tx.query(
      `update arena.secrets set
         bag = $2::jsonb,
         rack_0 = $3::jsonb,
         rack_1 = $4::jsonb,
         rules = $5::jsonb,
         state_version = $6,
         engine = $7::jsonb
       where match_id = $1`,
      [
        id,
        state.bag,
        state.players[0].rack,
        state.players[1].rack,
        state.rules,
        state.version,
        state,
      ],
    );
    return true;
  }

  private async loadMatch(tx: Sql, matchId: string, lock: boolean): Promise<LiveMatch | null> {
    const locked = await tx.query<LockedMatch>(
      `select m.room_id, m.version, r.status as room_status, s.engine, s.state_version, s.user_0, s.user_1
       from public.matches m
       join arena.secrets s on s.match_id = m.id
       join public.rooms r on r.id = m.room_id
       where m.id = $1
       ${lock ? 'for update of m, s, r' : ''}`,
      [matchId],
    );
    const row = locked.rows[0];
    if (!row) return null;
    return this.liveFrom(matchId, row);
  }

  private liveFrom(matchId: string, row: LockedMatch): LiveMatch | null {
    const state = asState(row.engine);
    if (!state) return null;
    if (state.version !== Number(row.version) || state.version !== Number(row.state_version)) return null;
    const seat0 = String(row.user_0);
    const seat1 = String(row.user_1);
    return {
      id: matchId,
      roomId: String(row.room_id),
      state,
      users: [seat0, seat1],
      dictionary: this.dictionary ?? null,
    };
  }

  private async receipt(tx: Sql, matchId: string, key: string): Promise<StoredReceipt | null> {
    if (!key) return null;
    const found = await tx.query<{ user_id: string; command: unknown; outcome: unknown }>(
      `select user_id, command, outcome from arena.receipts where match_id = $1 and idempotency_key = $2`,
      [matchId, key],
    );
    const row = found.rows[0];
    if (!row) return null;
    const command = typeof row.command === 'string' ? row.command : canonicalCommand(row.command as MatchCommand);
    return { userId: String(row.user_id), command, result: row.outcome as MatchResult };
  }

  private async lockRoom(tx: Sql, where: string, params: readonly unknown[]): Promise<RoomRow | null> {
    const found = await tx.query<RoomRow>(
      `select id, code, host_id, status, expires_at, match_id from public.rooms where ${where} for update`,
      params,
    );
    return found.rows[0] ?? null;
  }

  private async memberRows(tx: Sql, roomId: string): Promise<MemberRow[]> {
    const found = await tx.query<MemberRow>(
      `select user_id, seat, ready, connected, display_name
       from public.room_members where room_id = $1 order by seat`,
      [roomId],
    );
    return found.rows;
  }

  private async roomView(tx: Sql, roomId: string, userId: string): Promise<RoomView> {
    const room = await tx.query<RoomRow>(
      `select id, code, host_id, status, expires_at, match_id from public.rooms where id = $1`,
      [roomId],
    );
    const row = room.rows[0];
    if (!row) throw new Error('The room row was missing after it was locked.');
    const members = await this.memberRows(tx, roomId);
    const you = members.find((entry) => entry.user_id === userId);
    return {
      id: String(row.id),
      code: String(row.code),
      status: row.status as RoomStatus,
      hostId: String(row.host_id),
      youAreHost: String(row.host_id) === userId,
      yourSeat: Number(you?.seat) === 1 ? 1 : 0,
      expiresAt: iso(row.expires_at),
      matchId: row.match_id ? String(row.match_id) : null,
      members: members.map((entry) => memberView(entry)),
    };
  }

  private expired(room: RoomRow): boolean {
    return (room.status === 'waiting' || room.status === 'ready') && Date.parse(iso(room.expires_at)) <= Date.parse(this.now());
  }
}

function memberView(entry: MemberRow): MemberView {
  const seat: Seat = Number(entry.seat) === 1 ? 1 : 0;
  return {
    userId: String(entry.user_id),
    seat,
    ready: entry.ready === true,
    connected: entry.connected !== false,
    displayName: String(entry.display_name),
  };
}

function publicLast(state: MatchState): { kind: NonNullable<MatchState['last']>['kind']; seat: Seat; total: number | null } | null {
  if (!state.last) return null;
  return { kind: state.last.kind, seat: state.last.seat, total: state.last.score?.total ?? null };
}

function asState(value: unknown): MatchState | null {
  const parsed = typeof value === 'string' ? jsonObject(value) : value;
  if (!parsed || typeof parsed !== 'object') return null;
  const state = parsed as MatchState;
  if (!Number.isInteger(state.version) || !Array.isArray(state.players) || state.players.length !== 2) return null;
  return state;
}

function jsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return error instanceof Error ? error.message : String(error);
}

function isUnique(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('23505') || /duplicate key/i.test(String(error));
}

function isForeignKey(error: unknown): boolean {
  const text = `${errorText(error)} ${String(error)}`;
  return text.includes('23503') || /foreign key/i.test(text);
}

function fail(code: string, message: string): OnlineFailure {
  return { ok: false, code, message };
}
