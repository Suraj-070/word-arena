import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRules, arenaStandardRules, type Rules } from '@word-arena/engine';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresDirectory } from '../src/postgres-directory';
import { fromPostgresJs, type SqlDatabase } from '../src/sql';
import { GUEST, HOST } from './pg';

const databaseUrl = process.env.WORD_ARENA_POSTGRES_URL;
if (process.env.WORD_ARENA_POSTGRES_REQUIRED === '1' && !databaseUrl) {
  throw new Error('WORD_ARENA_POSTGRES_URL is required for the independent Postgres connection test.');
}

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const sessions: postgres.Sql[] = [];

function assertDisposable(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('The independent-connection test only runs against localhost.');
  }
  if (!parsed.pathname.includes('word_arena')) {
    throw new Error('The independent-connection test only uses a word_arena database.');
  }
}

function session(url: string): postgres.Sql {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    connect_timeout: 10,
    onnotice() {},
  });
  sessions.push(sql);
  return sql;
}

function smallRules(): Rules {
  const result = validateRules({
    ...arenaStandardRules(),
    boardSize: 9,
    rackSize: 2,
    passRoundLimit: 1,
    tileSet: [
      { kind: 'letter', letter: 'A', count: 2, points: 1 },
      { kind: 'letter', letter: 'T', count: 2, points: 1 },
      { kind: 'letter', letter: 'E', count: 2, points: 1 },
      { kind: 'blank', count: 1, points: 0 },
    ],
  });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('\n'));
  return result.rules;
}

function directory(db: SqlDatabase): PostgresDirectory {
  return new PostgresDirectory(db, {
    now: () => '2026-11-09T00:00:00.000Z',
    random: () => 0.999,
    dictionary: null,
    rules: smallRules(),
    ttlMs: 60_000,
  });
}

async function applySchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    drop schema if exists arena cascade;
    drop schema if exists auth cascade;
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to public;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  await sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
    end $$;
  `);
  const files = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(join(migrationDir, file), 'utf8'));
  }
  await sql.unsafe(
    `insert into auth.users (id, email) values ($1, 'ada@example.com'), ($2, 'bea@example.com')`,
    [HOST, GUEST],
  );
}

async function backendPid(sql: postgres.Sql): Promise<number> {
  const rows = await sql.unsafe('select pg_backend_pid() as pid');
  return Number(rows[0]?.pid);
}

async function blockingPids(sql: postgres.Sql, pid: number): Promise<number[]> {
  const rows = await sql.unsafe('select pg_blocking_pids($1) as pids', [pid]);
  return pidList(rows[0]?.pids);
}

function pidList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((item) => Number(item));
  return String(value ?? '').replace(/[{}]/g, '').split(',').filter(Boolean).map((item) => Number(item));
}

async function waitForBlock(watch: postgres.Sql, waiter: number, holder: number): Promise<void> {
  const started = Date.now();
  let seen: number[] = [];
  while (Date.now() - started < 4000) {
    seen = await blockingPids(watch, waiter);
    if (seen.includes(holder)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Connection ${waiter} was not blocked by ${holder}. Blocking pids: ${seen.join(', ') || 'none'}.`);
}

type Snapshot = {
  version: number;
  turn: number;
  score0: number;
  score1: number;
  passes: number;
  rack0: string;
  rack1: string;
  bag: string;
  stateVersion: number;
  receipts: string[];
};

async function snapshot(sql: postgres.Sql, matchId: string): Promise<Snapshot> {
  const match = await sql.unsafe(
    'select version, turn, score_0, score_1, consecutive_passes from public.matches where id = $1',
    [matchId],
  );
  const secret = await sql.unsafe(
    'select rack_0::text as rack_0, rack_1::text as rack_1, bag::text as bag, state_version from arena.secrets where match_id = $1',
    [matchId],
  );
  const receipts = await sql.unsafe(
    'select idempotency_key from arena.receipts where match_id = $1 order by idempotency_key',
    [matchId],
  );
  const row = match[0];
  const hidden = secret[0];
  if (!row || !hidden) throw new Error('The match snapshot was missing.');
  return {
    version: Number(row.version),
    turn: Number(row.turn),
    score0: Number(row.score_0),
    score1: Number(row.score_1),
    passes: Number(row.consecutive_passes),
    rack0: String(hidden.rack_0),
    rack1: String(hidden.rack_1),
    bag: String(hidden.bag),
    stateVersion: Number(hidden.state_version),
    receipts: receipts.map((item) => String(item.idempotency_key)),
  };
}

function tileIds(json: string): string[] {
  const tiles = JSON.parse(json) as { id: string }[];
  if (!Array.isArray(tiles)) throw new Error('A rack or bag was stored as a JSON string.');
  return tiles.map((tile) => tile.id);
}

function afterQuery(db: SqlDatabase, pattern: RegExp, after: () => Promise<void>): SqlDatabase {
  return {
    transaction(fn) {
      return db.transaction((tx) => fn({
        query: async <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => {
          const result = await tx.query<T>(text, params);
          if (pattern.test(text)) await after();
          return result;
        },
      }));
    },
  };
}

function failOnReceipt(db: SqlDatabase, afterMatchUpdate: () => Promise<void>): SqlDatabase {
  return {
    transaction(fn) {
      return db.transaction((tx) => fn({
        query: async <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => {
          if (/insert\s+into\s+arena\.receipts/i.test(text)) throw new Error('receipt write failed');
          const result = await tx.query<T>(text, params);
          if (/update public\.matches set/i.test(text)) await afterMatchUpdate();
          return result;
        },
      }));
    },
  };
}

async function started(sql: postgres.Sql): Promise<string> {
  const table = directory(fromPostgresJs(sql));
  const host = await table.createRoom(HOST, 'Ada');
  if (!host.ok) throw new Error(host.message);
  const guest = await table.joinRoom(GUEST, host.room.code, 'Bea');
  if (!guest.ok) throw new Error(guest.message);
  await table.setReady(HOST, host.room.id);
  await table.setReady(GUEST, host.room.id);
  const start = await table.startMatch(HOST, host.room.id);
  if (!start.ok || !start.room.matchId) throw new Error('start');
  return start.room.matchId;
}

describe.skipIf(!databaseUrl)('independent Postgres connections', () => {
  afterAll(async () => {
    await Promise.all(sessions.map((sql) => sql.end({ timeout: 1 })));
  });

  it('lets one of two connections commit a version and leaves the other stale', async () => {
    if (!databaseUrl) throw new Error('database url');
    assertDisposable(databaseUrl);
    const left = session(databaseUrl);
    const right = session(databaseUrl);
    const watch = session(databaseUrl);
    const [leftPid, rightPid, watchPid] = await Promise.all([backendPid(left), backendPid(right), backendPid(watch)]);
    expect(new Set([leftPid, rightPid, watchPid]).size).toBe(3);
    const version = await watch.unsafe('select version() as version');
    expect(String(version[0]?.version)).toMatch(/PostgreSQL 16\./);

    await applySchema(watch);
    const matchId = await started(watch);
    const before = await snapshot(watch, matchId);
    expect(before.version).toBe(1);
    expect(tileIds(before.rack0)).toEqual(['A-1', 'A-2']);

    let releaseLock!: () => void;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let markLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const leftTable = directory(afterQuery(fromPostgresJs(left), /for update of m, s, r/i, async () => {
      markLocked();
      await holdLock;
    }));
    const rightTable = directory(fromPostgresJs(right));
    const first = leftTable.act(HOST, matchId, { type: 'exchange', tileIds: ['A-1'] }, 'left-exchange', 1);
    await locked;
    const second = rightTable.act(HOST, matchId, { type: 'exchange', tileIds: ['A-2'] }, 'right-exchange', 1);
    await waitForBlock(watch, rightPid, leftPid);
    releaseLock();
    const [leftResult, rightResult] = await Promise.all([first, second]);
    const applied = [leftResult, rightResult].filter((result) => result.ok);
    const rejected = [leftResult, rightResult].filter((result) => !result.ok);
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0] || rejected[0].ok) throw new Error('expected a stale result');
    expect(rejected[0].code).toBe('stale');
    if (!applied[0]?.ok) throw new Error('expected one committed exchange');
    expect(applied[0].match.version).toBe(2);
    expect(applied[0].match.turn).toBe(1);
    expect(applied[0].match.scores).toEqual([0, 0]);
    expect(applied[0].match.rack.map((tile) => tile.id)).not.toContain('A-1');

    const after = await snapshot(watch, matchId);
    expect(after.version).toBe(2);
    expect(after.stateVersion).toBe(2);
    expect(after.turn).toBe(1);
    expect(after.score0).toBe(0);
    expect(after.score1).toBe(0);
    expect(after.passes).toBe(0);
    expect(after.receipts).toEqual(['left-exchange']);
    expect(tileIds(after.rack1)).toEqual(tileIds(before.rack1));
    expect(tileIds(after.rack0)).not.toContain('A-1');
    expect(tileIds(after.rack0)).toHaveLength(tileIds(before.rack0).length);
    expect(tileIds(after.bag)).toHaveLength(tileIds(before.bag).length);
    expect(tileIds(after.bag).sort()).not.toEqual(tileIds(before.bag).sort());
    const engine = await watch.unsafe('select engine from arena.secrets where match_id = $1', [matchId]);
    const state = engine[0]?.engine as {
      version: number;
      players: { rack: { id: string }[]; score: number }[];
      bag: { id: string }[];
    };
    expect(state.version).toBe(2);
    expect(state.players[0]?.score).toBe(0);
    expect(state.players[1]?.score).toBe(0);
    expect(state.players[0]?.rack.map((tile) => tile.id)).toEqual(tileIds(after.rack0));
    expect(state.players[1]?.rack.map((tile) => tile.id)).toEqual(tileIds(after.rack1));
    expect(state.bag.map((tile) => tile.id)).toEqual(tileIds(after.bag));
    const kinds = await watch.unsafe(
      `select jsonb_typeof(rack_0) as rack, jsonb_typeof(bag) as bag, jsonb_typeof(engine) as engine
       from arena.secrets where match_id = $1`,
      [matchId],
    );
    expect(kinds[0]).toMatchObject({ rack: 'array', bag: 'array', engine: 'object' });
  }, 20_000);

  it('hides an uncommitted match update and rolls it back when the receipt insert fails', async () => {
    if (!databaseUrl) throw new Error('database url');
    assertDisposable(databaseUrl);
    const writer = session(databaseUrl);
    const reader = session(databaseUrl);
    const [writerPid, readerPid] = await Promise.all([backendPid(writer), backendPid(reader)]);
    expect(writerPid).not.toBe(readerPid);
    await applySchema(reader);
    const matchId = await started(reader);
    const before = await snapshot(reader, matchId);

    let releaseUpdate!: () => void;
    const holdUpdate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let markUpdated!: () => void;
    const updated = new Promise<void>((resolve) => {
      markUpdated = resolve;
    });
    const failing = directory(failOnReceipt(fromPostgresJs(writer), async () => {
      markUpdated();
      await holdUpdate;
    }));
    const pending = failing.act(HOST, matchId, { type: 'pass' }, 'rollback-pass', 1);
    await updated;
    const during = await snapshot(reader, matchId);
    expect(during).toEqual(before);
    releaseUpdate();
    const failed = await pending;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('unavailable');
    const after = await snapshot(reader, matchId);
    expect(after).toEqual(before);
  }, 20_000);
});
