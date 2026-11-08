import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createEdgeHandler, verifySupabaseUser } from '../src/edge';
import { pgliteDatabase } from '../src/sql';
import { GUEST, HOST, insertUsers, openDatabase } from './pg';

const entry = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/functions/match-action/index.ts'),
  'utf8',
);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|css)$/.test(name)) files.push(path);
  }
  return files;
}

function request(body: unknown, token?: string, method = 'POST') {
  return new Request('https://arena.local/match-action', {
    method,
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
  });
}

describe('match action edge entry', () => {
  it('is wired to the postgres handler and answers preflight without a database', async () => {
    expect(entry).toContain('createEdgeHandler');
    expect(entry).toContain('fromPostgresJs');
    expect(entry).not.toContain('MemoryDirectory');
    expect(entry).not.toContain('not deployed');
    expect(entry).not.toContain('SUPABASE_DB_URL=');
    const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src');
    for (const file of sourceFiles(webRoot)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('SUPABASE_DB_URL');
      expect(text, file).not.toMatch(/postgres:\/\//);
    }
    const handler = createEdgeHandler({}, null);
    const preflight = await handler(request(null, undefined, 'OPTIONS'));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    const wrongMethod = await handler(request(null, undefined, 'GET'));
    expect(wrongMethod.status).toBe(405);
    const missing = await handler(request({ op: 'create-room' }, 'ada'));
    expect(missing.status).toBe(503);
    expect(missing.headers.get('access-control-allow-origin')).toBe('*');
    const body = await missing.json() as { code: string; message: string };
    expect(body.code).toBe('unavailable');
    expect(body.message).toMatch(/database/i);
    expect(body.message).not.toMatch(/memory/i);
  });

  it('checks the bearer token with the publishable key and refuses a secret key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: HOST, email: 'ada@example.com' }), { status: 200 }));
    const user = await verifySupabaseUser(
      { supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' },
      'session-token',
      fetchImpl,
    );
    expect(user).toEqual({ id: HOST, email: 'ada@example.com' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const secret = await verifySupabaseUser(
      { supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_secret_not_for_the_browser' },
      'session-token',
      fetchImpl,
    );
    expect(secret).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects forged fields and serves pass, replay, and an unscored play from postgres', async () => {
    const db = await openDatabase();
    await insertUsers(db, [
      { id: HOST, email: 'ada@example.com' },
      { id: GUEST, email: 'bea@example.com' },
    ]);
    const handler = createEdgeHandler({}, pgliteDatabase(db), {
      verify: async (token) => {
        if (token === 'ada') return { id: HOST, email: 'ada@example.com' };
        if (token === 'bea') return { id: GUEST, email: 'bea@example.com' };
        return null;
      },
    });
    const anonymous = await handler(request({ op: 'create-room' }));
    expect(anonymous.status).toBe(401);
    const forged = await handler(request({
      op: 'create-room',
      userId: GUEST,
      displayName: 'Impostor',
      score: 99,
      bag: ['Z-1'],
      rack: ['A-1'],
      state: { version: 4 },
    }, 'ada'));
    expect(forged.status).toBe(400);
    expect(JSON.stringify(await forged.json())).not.toContain('Z-1');
    const rooms = await db.query('select id from public.rooms');
    expect(rooms.rows).toHaveLength(0);

    const created = await handler(request({ op: 'create-room' }, 'ada'));
    expect(created.status).toBe(200);
    const room = (await created.json() as { room: { id: string; code: string; members: { displayName: string }[] } }).room;
    expect(room.members[0]?.displayName).toBe('ada');
    expect((await handler(request({ op: 'join-room', code: room.code }, 'bea'))).status).toBe(200);
    expect((await handler(request({ op: 'set-ready', roomId: room.id }, 'ada'))).status).toBe(200);
    expect((await handler(request({ op: 'set-ready', roomId: room.id }, 'bea'))).status).toBe(200);
    const started = await handler(request({ op: 'start-match', roomId: room.id }, 'ada'));
    expect(started.status).toBe(200);
    const matchId = (await started.json() as { room: { matchId: string } }).room.matchId;
    const loaded = await handler(request({ op: 'read-match', matchId }, 'ada'));
    const match = (await loaded.json() as { match: { version: number; dictionaryAvailable: boolean; rack: { id: string; letter: string | null }[] } }).match;
    expect(match.dictionaryAvailable).toBe(false);
    expect(match.rack.length).toBeGreaterThan(0);
    const played = await handler(request({
      op: 'act',
      matchId,
      idempotencyKey: 'play',
      expectedVersion: 1,
      command: {
        type: 'play',
        placements: match.rack.map((tile, index) => ({
          row: 7,
          col: 7 + index,
          tileId: tile.id,
          ...(tile.letter === null ? { assignedLetter: 'A' } : {}),
        })),
      },
    }, 'ada'));
    expect(played.status).toBe(422);
    const passed = await handler(request({
      op: 'act',
      matchId,
      idempotencyKey: 'pass',
      expectedVersion: 1,
      command: { type: 'pass' },
    }, 'ada'));
    expect(passed.status).toBe(200);
    const passedBody = await passed.json();
    const replay = await handler(request({
      op: 'act',
      matchId,
      idempotencyKey: 'pass',
      expectedVersion: 1,
      command: { type: 'pass' },
    }, 'ada'));
    expect(await replay.json()).toEqual(passedBody);
    const stored = await db.query<{ version: number | string }>('select version from public.matches where id = $1', [matchId]);
    expect(Number(stored.rows[0]?.version)).toBe(2);
    const guest = await handler(request({ op: 'read-match', matchId }, 'bea'));
    const guestBody = JSON.stringify(await guest.json());
    for (const tile of match.rack) expect(guestBody).not.toContain(tile.id);
    expect(guestBody).toContain('"rack"');
    await db.close();
  });
});
