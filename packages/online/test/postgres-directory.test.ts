import { createMemoryDictionary, validateRules, arenaStandardRules, type Rules } from '@word-arena/engine';
import { describe, expect, it } from 'vitest';
import { PostgresDirectory } from '../src/postgres-directory';
import { pgliteDatabase, type SqlDatabase } from '../src/sql';
import { asUser, GUEST, HOST, insertUsers, openDatabase, OTHER } from './pg';

const ordered = () => 0.999;

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

async function readyDatabase() {
  const db = await openDatabase();
  await insertUsers(db, [
    { id: HOST, email: 'ada@example.com' },
    { id: GUEST, email: 'bea@example.com' },
    { id: OTHER, email: 'cy@example.com' },
  ]);
  return db;
}

function directory(db: Awaited<ReturnType<typeof openDatabase>>, dictionary: ReturnType<typeof createMemoryDictionary> | null = null, database: SqlDatabase = pgliteDatabase(db)) {
  return new PostgresDirectory(database, {
    now: () => '2026-11-09T00:00:00.000Z',
    random: ordered,
    dictionary,
    rules: smallRules(),
    ttlMs: 60_000,
  });
}

async function started(table: PostgresDirectory) {
  const host = await table.createRoom(HOST, 'Ada');
  if (!host.ok) throw new Error(host.message);
  const guest = await table.joinRoom(GUEST, host.room.code, 'Bea');
  if (!guest.ok) throw new Error(guest.message);
  await table.setReady(HOST, host.room.id);
  await table.setReady(GUEST, host.room.id);
  const start = await table.startMatch(HOST, host.room.id);
  if (!start.ok || !start.room.matchId) throw new Error('start');
  return { roomId: host.room.id, matchId: start.room.matchId, code: host.room.code };
}

describe('postgres match directory', () => {
  it('keeps a third player out and rejects a stale or stolen action', async () => {
    const db = await readyDatabase();
    const table = directory(db);
    const host = await table.createRoom(HOST, 'Ada');
    if (!host.ok) throw new Error(host.message);
    await table.joinRoom(GUEST, host.room.code, 'Bea');
    const third = await table.joinRoom(OTHER, host.room.code, 'Cy');
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe('full');
    await table.setReady(HOST, host.room.id);
    await table.setReady(GUEST, host.room.id);
    const start = await table.startMatch(HOST, host.room.id);
    if (!start.ok || !start.room.matchId) throw new Error('start');
    const matchId = start.room.matchId;
    const code = host.room.code;
    const afterStart = await table.joinRoom(OTHER, code, 'Cy');
    expect(afterStart.ok).toBe(false);
    if (!afterStart.ok) expect(afterStart.code).toBe('closed');
    const again = await table.joinRoom(GUEST, code.toLowerCase(), 'Bea');
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.room.yourSeat).toBe(1);
    const outsider = await table.readMatch(OTHER, matchId);
    expect(outsider.ok).toBe(false);
    const early = await table.act(GUEST, matchId, { type: 'pass' }, 'guest-pass', 1);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('wrong-seat');
    const stolen = await table.act(HOST, matchId, {
      type: 'play',
      placements: [{ row: 4, col: 4, tileId: 'T-1' }],
    }, 'stolen', 1);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.code).toBe('tile-not-on-rack');
    const stale = await table.act(HOST, matchId, { type: 'pass' }, 'stale', 0);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('stale');
    const view = await table.readMatch(HOST, matchId);
    if (!view.ok) throw new Error(view.message);
    expect(view.match.version).toBe(1);
    expect(view.match.scores).toEqual([0, 0]);
    await db.close();
  });

  it('replays one key, rejects a different command, and keeps one of two same-version actions', async () => {
    const db = await readyDatabase();
    const table = directory(db);
    const { matchId } = await started(table);
    const [first, second] = await Promise.all([
      table.act(HOST, matchId, { type: 'pass' }, 'one', 1),
      table.act(HOST, matchId, { type: 'pass' }, 'two', 1),
    ]);
    const applied = [first, second].filter((result) => result.ok);
    const stale = [first, second].filter((result) => !result.ok);
    expect(applied).toHaveLength(1);
    expect(stale).toHaveLength(1);
    if (!stale[0]?.ok) expect(stale[0]?.code).toBe('stale');
    const guestView = await table.readMatch(GUEST, matchId);
    if (!guestView.ok) throw new Error(guestView.message);
    expect(guestView.match.version).toBe(2);
    expect(guestView.match.turn).toBe(1);

    const [left, right] = await Promise.all([
      table.act(GUEST, matchId, { type: 'resign' }, 'same', 2),
      table.act(GUEST, matchId, { type: 'resign' }, 'same', 2),
    ]);
    expect(left).toEqual(right);
    if (!left.ok) throw new Error(left.message);
    expect(left.match.status).toBe('finished');
    const changed = await table.act(GUEST, matchId, { type: 'pass' }, 'same', 2);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe('duplicate-command');
    const receipts = await db.query<{ count: number | string }>('select count(*)::int as count from arena.receipts where match_id = $1', [matchId]);
    expect(Number(receipts.rows[0]?.count)).toBe(2);
    const fresh = new PostgresDirectory(pgliteDatabase(db), {
      now: () => '2026-11-09T00:00:00.000Z',
      random: ordered,
      rules: smallRules(),
    });
    const reread = await fresh.readMatch(HOST, matchId);
    if (!reread.ok) throw new Error(reread.message);
    expect(reread.match.status).toBe('finished');
    expect(reread.match.version).toBe(left.match.version);
    const room = await fresh.readRoom(HOST, reread.match.roomId);
    if (!room.ok) throw new Error(room.message);
    expect(room.room.status).toBe('finished');
    await db.close();
  });

  it('rolls the match back when the receipt insert fails', async () => {
    const db = await readyDatabase();
    const flaky = pgliteDatabase({
      transaction(fn) {
        return db.transaction(async (tx) => fn({
          query: (text, params) => {
            if (/insert\s+into\s+arena\.receipts/i.test(text)) throw new Error('receipt write failed');
            return tx.query(text, params ? [...params] : []);
          },
        }));
      },
    });
    const table = directory(db, null, flaky);
    const { matchId } = await started(table);
    const before = await db.query<{ version: number }>('select version from public.matches where id = $1', [matchId]);
    const failed = await table.act(HOST, matchId, { type: 'pass' }, 'roll', 1);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('unavailable');
    const after = await db.query<{ version: number }>('select version from public.matches where id = $1', [matchId]);
    expect(after.rows[0]?.version).toBe(before.rows[0]?.version);
    const receipts = await db.query('select idempotency_key from arena.receipts where match_id = $1', [matchId]);
    expect(receipts.rows).toHaveLength(0);
    const secrets = await db.query<{ state_version: number }>('select state_version from arena.secrets where match_id = $1', [matchId]);
    expect(secrets.rows[0]?.state_version).toBe(1);
    await db.close();
  });

  it('passes, exchanges, resigns, and scores only through the engine', async () => {
    const db = await readyDatabase();
    const plain = directory(db);
    const { matchId, roomId } = await started(plain);
    const blocked = await plain.act(HOST, matchId, {
      type: 'play',
      placements: [
        { row: 4, col: 4, tileId: 'A-1' },
        { row: 4, col: 5, tileId: 'A-2' },
      ],
    }, 'no-dictionary', 1);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('dictionary-unavailable');
    const replay = await plain.act(HOST, matchId, {
      type: 'play',
      placements: [
        { row: 4, col: 4, tileId: 'A-1' },
        { row: 4, col: 5, tileId: 'A-2' },
      ],
    }, 'no-dictionary', 1);
    expect(replay).toEqual(blocked);
    const unchanged = await plain.readMatch(HOST, matchId);
    if (!unchanged.ok) throw new Error(unchanged.message);
    expect(unchanged.match.version).toBe(1);

    const exchanged = await plain.act(HOST, matchId, { type: 'exchange', tileIds: ['A-1'] }, 'exchange', 1);
    if (!exchanged.ok) throw new Error(exchanged.message);
    expect(exchanged.match.turn).toBe(1);
    expect(exchanged.match.rack.map((tile) => tile.id)).not.toContain('A-1');
    const presence = await plain.setPresence(GUEST, roomId, false);
    if (!presence.ok) throw new Error(presence.message);
    expect(presence.room.members.find((member) => member.userId === GUEST)?.connected).toBe(false);
    const afterPresence = await plain.readMatch(HOST, matchId);
    if (!afterPresence.ok) throw new Error(afterPresence.message);
    expect(afterPresence.match.version).toBe(exchanged.match.version);
    const resigned = await plain.act(GUEST, matchId, { type: 'resign' }, 'resign', exchanged.match.version);
    if (!resigned.ok) throw new Error(resigned.message);
    expect(resigned.match.end?.kind).toBe('resign');
    const room = await plain.readRoom(HOST, roomId);
    if (!room.ok) throw new Error(room.message);
    expect(room.room.status).toBe('finished');
    const recorded = await db.query<{ user_id: string; result: string; score: number; end_kind: string }>(
      'select user_id, result, score, end_kind from public.match_results where match_id = $1 order by seat',
      [matchId],
    );
    const publishedScores = await db.query<{ score_0: number; score_1: number }>(
      'select score_0, score_1 from public.matches where id = $1',
      [matchId],
    );
    expect(recorded.rows.map((entry) => entry.user_id)).toEqual([HOST, GUEST]);
    expect(recorded.rows.map((entry) => entry.result)).toEqual(['win', 'loss']);
    expect(recorded.rows.map((entry) => entry.end_kind)).toEqual(['resign', 'resign']);
    expect(recorded.rows[0]?.score).toBe(publishedScores.rows[0]?.score_0);
    expect(recorded.rows[1]?.score).toBe(publishedScores.rows[0]?.score_1);
    const repeated = await plain.act(GUEST, matchId, { type: 'resign' }, 'resign-again', resigned.match.version);
    expect(repeated.ok).toBe(false);
    const stillTwo = await db.query<{ count: string }>('select count(*)::text as count from public.match_results where match_id = $1', [matchId]);
    expect(Number(stillTwo.rows[0]?.count)).toBe(2);

    const scoredDb = await readyDatabase();
    const rules = smallRules();
    const scored = directory(scoredDb, createMemoryDictionary(rules.dictionaryVersionId, ['AA']));
    const deal = await started(scored);
    const played = await scored.act(HOST, deal.matchId, {
      type: 'play',
      placements: [
        { row: 4, col: 4, tileId: 'A-1' },
        { row: 4, col: 5, tileId: 'A-2' },
      ],
    }, 'play', 1);
    if (!played.ok) throw new Error(played.message);
    expect(played.match.scores[0]).toBe(54);
    const guest = await scored.readMatch(GUEST, deal.matchId);
    if (!guest.ok) throw new Error(guest.message);
    expect(guest.match.rack.map((tile) => tile.id)).toEqual(['T-1', 'T-2']);
    expect(JSON.stringify(guest.match)).not.toContain('E-1');
    expect(JSON.stringify(guest.match)).not.toContain('blank-1');
    const visible = await asUser(scoredDb, GUEST, 'select to_jsonb(matches) as row from public.matches');
    const raw = (visible.rows[0] as { row?: unknown } | undefined)?.row;
    const published = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
    expect(published).not.toContain('E-1');
    expect(published).not.toContain('T-1');
    expect(published).not.toContain('blank-1');
    await expect(asUser(scoredDb, GUEST, 'select bag from arena.secrets')).rejects.toThrow(/permission denied/);
    await db.close();
    await scoredDb.close();
  });

  it('refuses a start before both players are ready and a cancel after the match starts', async () => {
    const db = await readyDatabase();
    const table = directory(db);
    const created = await table.createRoom(HOST, 'Ada');
    if (!created.ok) throw new Error(created.message);
    const early = await table.startMatch(HOST, created.room.id);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('not-ready');
    const stranger = await table.cancelRoom(OTHER, created.room.id);
    expect(stranger.ok).toBe(false);
    await table.joinRoom(GUEST, created.room.code, 'Bea');
    await table.setReady(HOST, created.room.id);
    await table.setReady(GUEST, created.room.id);
    const start = await table.startMatch(HOST, created.room.id);
    if (!start.ok || !start.room.matchId) throw new Error('start');
    const matchId = start.room.matchId;
    const cancel = await table.cancelRoom(HOST, created.room.id);
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) expect(cancel.code).toBe('closed');
    const passed = await table.act(HOST, matchId, { type: 'pass' }, 'pass-1', 1);
    if (!passed.ok) throw new Error(passed.message);
    const guestPass = await table.act(GUEST, matchId, { type: 'pass' }, 'pass-2', passed.match.version);
    if (!guestPass.ok) throw new Error(guestPass.message);
    expect(guestPass.match.status).toBe('finished');
    expect(guestPass.match.end?.kind).toBe('passes');
    await db.close();
  });
});
