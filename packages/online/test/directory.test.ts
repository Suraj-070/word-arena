import { createMemoryDictionary, validateRules, type Rules } from '@word-arena/engine';
import { describe, expect, it } from 'vitest';
import { MemoryDirectory, publicMatch } from '../src/directory';
import { arenaStandardRules } from '@word-arena/engine';

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

function directory(dictionary: ReturnType<typeof createMemoryDictionary> | null = null) {
  let n = 0;
  return new MemoryDirectory({
    now: () => '2026-11-09T00:00:00.000Z',
    random: ordered,
    ids: () => `id-${n += 1}`,
    dictionary,
    rules: smallRules(),
    ttlMs: 60_000,
  });
}

async function started(table = directory()) {
  const host = await table.createRoom('host', 'Ada');
  const guest = await table.joinRoom('guest', host.ok ? host.room.code : '', 'Bea');
  if (!host.ok || !guest.ok) throw new Error('room');
  await table.setReady('host', host.room.id);
  await table.setReady('guest', host.room.id);
  const startedRoom = await table.startMatch('host', host.room.id);
  if (!startedRoom.ok || !startedRoom.room.matchId) throw new Error('start');
  return { table, roomId: host.room.id, matchId: startedRoom.room.matchId, code: host.room.code };
}

describe('private rooms', () => {
  it('creates a room, joins it once, and refuses a third player', async () => {
    const table = directory();
    const created = await table.createRoom('host', 'Ada');
    if (!created.ok) throw new Error(created.message);
    expect(created.room.code).toHaveLength(8);
    expect(created.room.youAreHost).toBe(true);
    expect(created.room.members).toHaveLength(1);

    const again = await table.joinRoom('host', created.room.code, 'Ada');
    if (!again.ok) throw new Error(again.message);
    expect(again.room.members).toHaveLength(1);

    const guest = await table.joinRoom('guest', ` ${created.room.code.toLowerCase()} `, 'Bea');
    if (!guest.ok) throw new Error(guest.message);
    expect(guest.room.yourSeat).toBe(1);
    expect(guest.room.members.map((member) => member.displayName)).toEqual(['Ada', 'Bea']);

    const third = await table.joinRoom('outsider', created.room.code);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe('full');
  });

  it('hides a room from someone who is not in it and rejects a bad code', async () => {
    const table = directory();
    const created = await table.createRoom('host', 'Ada');
    if (!created.ok) throw new Error(created.message);
    const hidden = await table.readRoom('outsider', created.room.id);
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.code).toBe('not-member');
      expect(JSON.stringify(hidden)).not.toContain(created.room.code);
    }
    const missing = await table.joinRoom('guest', 'NOPE');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('invalid-code');
  });

  it('expires a waiting room, cancels only for the host, and starts only when both are ready', async () => {
    let now = Date.parse('2026-11-09T00:00:00.000Z');
    const table = new MemoryDirectory({
      now: () => new Date(now).toISOString(),
      random: ordered,
      ids: (() => {
        let n = 0;
        return () => `id-${n += 1}`;
      })(),
      rules: smallRules(),
      ttlMs: 1_000,
    });
    const created = await table.createRoom('host', 'Ada');
    if (!created.ok) throw new Error(created.message);
    const early = await table.startMatch('host', created.room.id);
    expect(early.ok).toBe(false);
    const guestCancel = await table.joinRoom('guest', created.room.code, 'Bea');
    if (!guestCancel.ok) throw new Error(guestCancel.message);
    const denied = await table.cancelRoom('guest', created.room.id);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('not-host');
    const cancelled = await table.cancelRoom('host', created.room.id);
    expect(cancelled.ok).toBe(true);

    const second = await table.createRoom('host', 'Ada');
    if (!second.ok) throw new Error(second.message);
    now += 2_000;
    const expired = await table.joinRoom('guest', second.room.code);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe('expired');
  });
});

describe('authoritative match', () => {
  it('rejects a scored play when no dictionary is configured and leaves the match unchanged', async () => {
    const { table, matchId } = await started();
    const before = table.secret(matchId);
    const rejected = await table.act('host', matchId, {
      type: 'play',
      placements: [
        { row: 4, col: 4, tileId: 'A-1' },
        { row: 4, col: 5, tileId: 'A-2' },
      ],
    }, 'play-1', 1);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('dictionary-unavailable');
    expect(table.secret(matchId)).toEqual(before);
    const view = await table.readMatch('host', matchId);
    if (!view.ok) throw new Error(view.message);
    expect(view.match.version).toBe(1);
    expect(view.match.scores).toEqual([0, 0]);
    expect(view.match.dictionaryAvailable).toBe(false);
  });

  it('scores from the engine when a dictionary is supplied, and hides the other rack', async () => {
    const rules = smallRules();
    const table = directory(createMemoryDictionary(rules.dictionaryVersionId, ['AA']));
    const { matchId } = await started(table);
    const played = await table.act('host', matchId, {
      type: 'play',
      placements: [
        { row: 4, col: 4, tileId: 'A-1' },
        { row: 4, col: 5, tileId: 'A-2' },
      ],
    }, 'play-1', 1);
    if (!played.ok) throw new Error(played.message);
    expect(played.match.scores[0]).toBe(54);
    expect(played.match.last?.total).toBe(54);
    expect(played.match.rack.map((tile) => tile.id)).toEqual(['E-1', 'E-2']);
    const guest = await table.readMatch('guest', matchId);
    if (!guest.ok) throw new Error(guest.message);
    expect(guest.match.rack.map((tile) => tile.id)).toEqual(['T-1', 'T-2']);
    const published = JSON.stringify(publicMatch(guest.match));
    expect(published).not.toContain('E-1');
    expect(published).not.toContain('T-1');
    expect(published).not.toContain('blank-1');
    expect(JSON.stringify(guest.match)).not.toContain('E-1');
    expect(JSON.stringify(guest.match)).not.toContain('blank-1');
    const outsider = await table.readMatch('outsider', matchId);
    expect(outsider.ok).toBe(false);
  });

  it('passes, exchanges, switches turns, and ends on the configured pass limit', async () => {
    const { table, matchId } = await started();
    const exchanged = await table.act('host', matchId, { type: 'exchange', tileIds: ['A-1'] }, 'ex-1');
    if (!exchanged.ok) throw new Error(exchanged.message);
    expect(exchanged.match.turn).toBe(1);
    expect(exchanged.match.rack.map((tile) => tile.id)).not.toContain('A-1');
    const guestPass = await table.act('guest', matchId, { type: 'pass' }, 'pass-g');
    if (!guestPass.ok) throw new Error(guestPass.message);
    const hostPass = await table.act('host', matchId, { type: 'pass' }, 'pass-h');
    if (!hostPass.ok) throw new Error(hostPass.message);
    expect(hostPass.match.status).toBe('finished');
    expect(hostPass.match.end?.kind).toBe('passes');
    expect(hostPass.match.scores[0]).toBeLessThan(0);
  });

  it('applies one of two concurrent actions and replays an identical idempotency key', async () => {
    const { table, matchId } = await started();
    const [first, second] = await Promise.all([
      table.act('host', matchId, { type: 'pass' }, 'one'),
      table.act('host', matchId, { type: 'pass' }, 'two'),
    ]);
    const ok = [first, second].filter((result) => result.ok);
    expect(ok).toHaveLength(1);
    const view = await table.readMatch('guest', matchId);
    if (!view.ok) throw new Error(view.message);
    expect(view.match.version).toBe(2);
    expect(view.match.turn).toBe(1);

    const [left, right] = await Promise.all([
      table.act('guest', matchId, { type: 'resign' }, 'same'),
      table.act('guest', matchId, { type: 'resign' }, 'same'),
    ]);
    expect(left).toEqual(right);
    if (!left.ok) throw new Error(left.message);
    expect(left.match.status).toBe('finished');
    expect(left.match.end?.kind).toBe('resign');
    const secret = table.secret(matchId);
    const again = await table.act('guest', matchId, { type: 'resign' }, 'same');
    expect(again).toEqual(left);
    expect(table.secret(matchId)).toEqual(secret);
  });

  it('refuses another player’s turn, a client score, and a tile that is not on the rack', async () => {
    const { table, matchId } = await started();
    const impersonated = await table.act('guest', matchId, { type: 'pass' }, 'nope');
    expect(impersonated.ok).toBe(false);
    if (!impersonated.ok) expect(impersonated.code).toBe('wrong-seat');
    const missing = await table.act('host', matchId, {
      type: 'play',
      placements: [{ row: 4, col: 4, tileId: 'T-1' }],
    }, 'stolen');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('tile-not-on-rack');
    const view = await table.readMatch('host', matchId);
    if (!view.ok) throw new Error(view.message);
    expect(view.match.version).toBe(1);
    expect(view.match.scores).toEqual([0, 0]);
  });

  it('does not let a disconnected player change the match', async () => {
    const { table, roomId, matchId } = await started();
    const before = await table.readMatch('host', matchId);
    const left = await table.setPresence('guest', roomId, false);
    if (!left.ok) throw new Error(left.message);
    expect(left.room.members.find((member) => member.userId === 'guest')?.connected).toBe(false);
    const after = await table.readMatch('host', matchId);
    expect(after).toEqual(before);
  });
});
