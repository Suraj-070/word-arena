import { describe, expect, it } from 'vitest';
import { asUser, GUEST, HOST, openDatabase, OTHER } from './pg';

const ROOM = '44444444-4444-4444-8444-444444444444';
const MATCH = '55555555-5555-4555-8555-555555555555';

async function database() {
  const db = await openDatabase();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${HOST}', 'ada@example.com'),
      ('${GUEST}', 'bea@example.com'),
      ('${OTHER}', 'cy@example.com');
    insert into public.rooms (id, code, host_id, status, expires_at, match_id)
      values ('${ROOM}', 'AB23CD45', '${HOST}', 'playing', now() + interval '1 hour', '${MATCH}');
    insert into public.room_members (room_id, user_id, seat, ready, display_name) values
      ('${ROOM}', '${HOST}', 0, true, 'Ada'),
      ('${ROOM}', '${GUEST}', 1, true, 'Bea');
    insert into public.matches (
      id, room_id, board, score_0, score_1, name_0, name_1,
      rack_count_0, rack_count_1, turn, status, consecutive_passes, version,
      dictionary_available, exchange_allowed, board_size
    ) values (
      '${MATCH}', '${ROOM}', '{"size":9,"cells":[]}'::jsonb, 0, 0, 'Ada', 'Bea',
      2, 2, 0, 'playing', 0, 1, false, true, 9
    );
    insert into arena.secrets (match_id, bag, rack_0, rack_1, user_0, user_1, rules, state_version)
      values (
        '${MATCH}',
        '[{"id":"E-1","letter":"E","points":1}]'::jsonb,
        '[{"id":"A-1","letter":"A","points":1}]'::jsonb,
        '[{"id":"T-1","letter":"T","points":1}]'::jsonb,
        '${HOST}', '${GUEST}', '{}'::jsonb, 1
      );
  `);
  return db;
}

describe('row level security on embedded Postgres', () => {
  it('lets a member read the public match and hides it from everyone else', async () => {
    const db = await database();
    const host = await asUser(db, HOST, `select code, score_0 from public.rooms join public.matches on matches.room_id = rooms.id`);
    expect(host.rows).toHaveLength(1);
    const stranger = await asUser(db, OTHER, 'select id from public.rooms');
    expect(stranger.rows).toHaveLength(0);
    await expect(db.transaction(async (tx) => {
      await tx.exec('set local role anon');
      return tx.query('select id from public.rooms');
    })).rejects.toThrow(/permission denied/);
    await db.close();
  });

  it('does not let the browser read a rack or write the match', async () => {
    const db = await database();
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'matches'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('bag');
    expect(names).not.toContain('rack_0');
    await expect(asUser(db, HOST, 'select rack_0 from arena.secrets')).rejects.toThrow();
    await expect(asUser(db, GUEST, `update public.matches set score_0 = 999 where id = '${MATCH}'`)).rejects.toThrow();
    const unchanged = await db.query<{ score_0: number }>('select score_0 from public.matches');
    expect(unchanged.rows[0]?.score_0).toBe(0);
    await db.close();
  });

  it('commits a new version once inside a transaction and leaves a stale write unchanged', async () => {
    const db = await database();
    const committed = await db.transaction(async (tx) => {
      const locked = await tx.query<{ version: number }>(`select version from public.matches where id = '${MATCH}' for update`);
      expect(locked.rows[0]?.version).toBe(1);
      await tx.query(
        `update public.matches set version = 2, score_0 = 0, updated_at = now() where id = '${MATCH}' and version = 1`,
      );
      await tx.query(`update arena.secrets set state_version = 2 where match_id = '${MATCH}' and state_version = 1`);
      return tx.query<{ version: number }>(`select version from public.matches where id = '${MATCH}'`);
    });
    expect(committed.rows[0]?.version).toBe(2);
    const stale = await db.query<{ count: string }>(
      `with wrote as (
         update public.matches set score_0 = 40 where id = '${MATCH}' and version = 1 returning 1
       ) select count(*)::text as count from wrote`,
    );
    expect(stale.rows[0]?.count).toBe('0');
    const score = await db.query<{ score_0: number }>('select score_0 from public.matches');
    expect(score.rows[0]?.score_0).toBe(0);
    await db.close();
  });
});
