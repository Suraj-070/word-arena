import { describe, expect, it } from 'vitest';
import { MemoryDirectory } from '../src/directory';
import { handleMatchRequest } from '../src/handler';
import { validateRules, arenaStandardRules, type Rules } from '@word-arena/engine';

function rules(): Rules {
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

function deps() {
  const directory = new MemoryDirectory({
    now: () => '2026-11-09T00:00:00.000Z',
    random: () => 0.999,
    ids: (() => {
      let n = 0;
      return () => `id-${n += 1}`;
    })(),
    rules: rules(),
  });
  const names = new Map([['host', 'Ada'], ['guest', 'Bea']]);
  return {
    directory,
    verify: async (token: string) => (token === 'bad' ? null : { id: token }),
    displayName: (userId: string) => names.get(userId) ?? 'Player',
  };
}

function call(body: unknown, token = 'host', extra?: ReturnType<typeof deps>) {
  const used = extra ?? deps();
  return handleMatchRequest(
    new Request('https://arena.local/match', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
    used,
  ).then(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown>, used }));
}

describe('match action handler', () => {
  it('rejects a missing session', async () => {
    const response = await handleMatchRequest(
      new Request('https://arena.local/match', { method: 'POST', body: JSON.stringify({ op: 'create-room' }) }),
      deps(),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a forged user, name, score, rack, bag, or match state', async () => {
    const forged = await call({ op: 'create-room', userId: 'guest', displayName: 'Impostor', score: 99, bag: ['Z-1'], rack: [], state: { version: 9 } });
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe('invalid-command');
    expect(JSON.stringify(forged.body)).not.toContain('Z-1');
    expect(JSON.stringify(forged.body)).not.toContain('Impostor');
    const scored = await call({
      op: 'act',
      matchId: 'id-1',
      idempotencyKey: 'play',
      command: { type: 'play', placements: [{ row: 4, col: 4, tileId: 'A-1', points: 50 }] },
    });
    expect(scored.status).toBe(400);
    expect(scored.body.code).toBe('invalid-command');
  });

  it('uses the verified user and keeps racks out of the other player response', async () => {
    const first = await call({ op: 'create-room' });
    const room = first.body.room as { id: string; code: string; members: { displayName: string }[] };
    expect(room.members[0]?.displayName).toBe('Ada');
    await call({ op: 'join-room', code: room.code }, 'guest', first.used);
    await call({ op: 'set-ready', roomId: room.id }, 'host', first.used);
    await call({ op: 'set-ready', roomId: room.id }, 'guest', first.used);
    const started = await call({ op: 'start-match', roomId: room.id }, 'host', first.used);
    const matchId = (started.body.room as { matchId: string }).matchId;
    const rejected = await call({
      op: 'act',
      matchId,
      idempotencyKey: 'play',
      expectedVersion: 1,
      command: { type: 'play', placements: [{ row: 4, col: 4, tileId: 'A-1' }, { row: 4, col: 5, tileId: 'A-2' }] },
    }, 'host', first.used);
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('dictionary-unavailable');
    const secret = first.used.directory.secret(matchId);
    expect(secret?.bagIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected.body)).not.toContain('A-1');
    const guest = await call({ op: 'read-match', matchId }, 'guest', first.used);
    expect(JSON.stringify(guest.body)).not.toContain('A-1');
    expect(JSON.stringify(guest.body)).toContain('T-1');
  });

  it('does not reveal a room to a non-member', async () => {
    const created = await call({ op: 'create-room' });
    const room = created.body.room as { id: string; code: string };
    const hidden = await call({ op: 'read-room', roomId: room.id }, 'stranger', created.used);
    expect(hidden.status).toBe(403);
    expect(JSON.stringify(hidden.body)).not.toContain(room.code);
  });
});
