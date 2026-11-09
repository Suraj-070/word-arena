import { describe, expect, it } from 'vitest';
import {
  DICTIONARY_PRESETS,
  arenaStandardRules,
  createTileBag,
  dealMatch,
  dictionaryForPreset,
  sharedDictionaries,
  validatePlay,
  type TileInstance,
} from '@word-arena/engine';
import { MemoryDirectory, decideAct, type LiveMatch } from '../src/directory';

const rules = arenaStandardRules();
const australian = dictionaryForPreset(rules.dictionaryVersionId);
const american = DICTIONARY_PRESETS.find((preset) => preset.spelling === 'A');
if (!australian || !american) throw new Error('A shipped preset is missing.');
const americanDictionary = dictionaryForPreset(american.id);
if (!americanDictionary) throw new Error(american.id);

function ordered(ids: readonly string[]): TileInstance[] {
  const bag = createTileBag(rules);
  const byId = new Map(bag.map((tile) => [tile.id, tile]));
  const front = ids.map((id) => {
    const tile = byId.get(id);
    if (!tile) throw new Error(id);
    return tile;
  });
  const used = new Set(ids);
  return [...front, ...bag.filter((tile) => !used.has(tile.id))];
}

function live(dictionary: NonNullable<typeof australian>, versionId = rules.dictionaryVersionId): LiveMatch {
  const selected = versionId === rules.dictionaryVersionId
    ? rules
    : { ...rules, dictionaryVersionId: versionId };
  return {
    id: 'match',
    roomId: 'room',
    state: dealMatch({ rules: selected, bag: ordered(['A-1', 'T-1', 'E-1', 'E-2', 'E-3', 'E-4', 'E-5']) }),
    users: ['host', 'guest'],
    dictionary,
  };
}

describe('server lexicon', () => {
  it('scores the play on the server and does not take a score from the command', () => {
    const match = live(australian);
    const rack = match.state.players[0].rack;
    const a = rack.find((tile) => tile.id === 'A-1');
    const t = rack.find((tile) => tile.id === 'T-1');
    if (!a || !t) throw new Error('The rack did not contain the opening tiles.');
    const checked = validatePlay({
      rules: match.state.rules,
      board: match.state.board,
      rack,
      placements: [
        { row: 7, col: 7, tile: a },
        { row: 7, col: 8, tile: t },
      ],
      dictionary: australian,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const decided = decideAct({
      match,
      userId: 'host',
      command: {
        type: 'play',
        placements: [
          { row: 7, col: 7, tileId: 'A-1' },
          { row: 7, col: 8, tileId: 'T-1' },
        ],
      },
      idempotencyKey: 'at',
      expectedVersion: 1,
      prior: null,
      random: () => 0,
    });
    expect(decided.storeReceipt).toBe(true);
    expect(decided.result.ok).toBe(true);
    if (!decided.result.ok) return;
    expect(decided.result.match.scores[0]).toBe(checked.play.score.total);
    expect(decided.result.match.last?.total).toBe(checked.play.score.total);
    expect(decided.result.match.dictionaryVersionId).toBe(rules.dictionaryVersionId);
    expect(decided.match.state.version).toBe(2);
  });

  it('refuses a provider that is not the match preset', () => {
    const match = live(americanDictionary);
    const decided = decideAct({
      match,
      userId: 'host',
      command: {
        type: 'play',
        placements: [
          { row: 7, col: 7, tileId: 'A-1' },
          { row: 7, col: 8, tileId: 'T-1' },
        ],
      },
      idempotencyKey: 'wrong-preset',
      expectedVersion: 1,
      prior: null,
      random: () => 0,
    });
    expect(decided.result.ok).toBe(false);
    if (!decided.result.ok) expect(decided.result.code).toBe('dictionary-unavailable');
    expect(decided.match.state.version).toBe(1);
    expect(decided.match.state.players[0].score).toBe(0);
  });

  it('gives every player the preset declared when the match starts', async () => {
    const table = new MemoryDirectory({
      now: () => '2026-11-09T00:00:00.000Z',
      random: () => 0,
      ids: (() => {
        let n = 0;
        return () => `id-${n += 1}`;
      })(),
      dictionaries: sharedDictionaries(),
    });
    const created = await table.createRoom('host', 'Ada');
    if (!created.ok) throw new Error(created.message);
    await table.joinRoom('guest', created.room.code, 'Bea');
    await table.setReady('host', created.room.id);
    await table.setReady('guest', created.room.id);
    const started = await table.startMatch('host', created.room.id, american.id);
    if (!started.ok || !started.room.matchId) throw new Error('start');
    const host = await table.readMatch('host', started.room.matchId);
    const guest = await table.readMatch('guest', started.room.matchId);
    if (!host.ok || !guest.ok) throw new Error('read');
    expect(host.match.dictionaryVersionId).toBe(american.id);
    expect(guest.match.dictionaryVersionId).toBe(american.id);
    expect(host.match.dictionaryAvailable).toBe(true);
    expect(americanDictionary.contains('color')).toBe(true);
    expect(australian.contains('color')).toBe(false);
  });
});
