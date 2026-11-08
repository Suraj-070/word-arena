import { describe, expect, it } from 'vitest';
import {
  applyMatchAction,
  arrangeRack,
  createMatch,
  createTileBag,
  dealMatch,
  renamePlayer,
  tileTotal,
  type RandomSource,
  type Rules,
  type TileInstance,
  type TilePlacement,
} from '../src/index';
import { fixtureDictionary, withRules } from './helpers';

const zero: RandomSource = () => 0;

function smallRules(change?: (rules: Rules) => Rules): Rules {
  return withRules((rules) => {
    const next = {
      ...rules,
      boardSize: 9,
      rackSize: 2,
      passRoundLimit: 1,
      tileSet: [
        { kind: 'letter' as const, letter: 'A' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'T' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'E' as const, count: 2, points: 1 },
        { kind: 'blank' as const, count: 1, points: 0 as const },
      ],
    };
    return change ? change(next) : next;
  });
}

function ordered(rules: Rules, ids: readonly string[]): TileInstance[] {
  const bag = createTileBag(rules);
  const byId = new Map(bag.map((tile) => [tile.id, tile]));
  const front = ids.map((id) => {
    const tile = byId.get(id);
    if (!tile) throw new Error(`missing ${id}`);
    return tile;
  });
  const used = new Set(ids);
  return [...front, ...bag.filter((tile) => !used.has(tile.id))];
}

function place(tiles: readonly TileInstance[], cells: readonly { row: number; col: number; letter?: 'A' }[]): TilePlacement[] {
  return cells.map((cell, index) => {
    const tile = tiles[index];
    if (!tile) throw new Error('missing placement tile');
    return {
      row: cell.row,
      col: cell.col,
      tile,
      ...(tile.letter === null ? { assignedLetter: cell.letter ?? 'A' } : {}),
    };
  });
}

describe('match flow', () => {
  it('deals a full Arena Standard bag without calling Math.random', () => {
    const rules = withRules((current) => current);
    const match = createMatch({ rules, random: zero });
    expect(match.players[0].rack).toHaveLength(7);
    expect(match.players[1].rack).toHaveLength(7);
    expect(match.bag).toHaveLength(tileTotal(rules) - 14);
    expect(match.turn).toBe(0);
    expect(match.players[0].name).toBe('Player 1');
    const again = createMatch({ rules, random: zero });
    expect(again.players[0].rack.map((tile) => tile.id)).toEqual(match.players[0].rack.map((tile) => tile.id));
  });

  it('plays a horizontal opening, scores from the engine, and draws replacements', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1', 'A-2', 'T-2']) });
    const rack = started.players[0].rack;
    const played = applyMatchAction(
      started,
      { type: 'play', seat: 0, placements: place(rack, [{ row: 4, col: 4 }, { row: 4, col: 5 }]) },
      { dictionary: fixtureDictionary() },
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.last?.score?.bingo).toBe(50);
    expect(played.state.last?.score?.total).toBe(54);
    expect(played.state.last?.score?.words[0]?.text).toBe('AT');
    expect(played.state.players[0].score).toBe(54);
    expect(played.state.players[0].rack).toHaveLength(2);
    expect(played.state.bag).toHaveLength(1);
    expect(played.state.turn).toBe(1);
    expect(played.state.consecutivePasses).toBe(0);
    expect(started.turn).toBe(0);
    expect(started.board.cells.every((cell) => cell.kind === 'empty')).toBe(true);
  });

  it('plays a vertical opening', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1']) });
    const played = applyMatchAction(
      started,
      {
        type: 'play',
        seat: 0,
        placements: place(started.players[0].rack, [
          { row: 3, col: 4 },
          { row: 4, col: 4 },
        ]),
      },
      { dictionary: fixtureDictionary() },
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.last?.score?.words[0]?.direction).toBe('vertical');
  });

  it('keeps a blank at zero and refuses a second use of the same tile', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['blank-1', 'T-1']) });
    const [blank, tee] = started.players[0].rack;
    if (!blank || !tee) throw new Error('rack');
    const played = applyMatchAction(
      started,
      {
        type: 'play',
        seat: 0,
        placements: [
          { row: 4, col: 4, tile: blank, assignedLetter: 'A' },
          { row: 4, col: 5, tile: tee },
        ],
      },
      { dictionary: fixtureDictionary() },
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.last?.score?.bingo).toBe(50);
    expect(played.state.last?.score?.total).toBe(52);
    const cell = played.state.board.cells[4 * 9 + 4];
    expect(cell?.kind).toBe('occupied');
    if (cell?.kind !== 'occupied') return;
    expect(cell.letter).toBeNull();
    expect(cell.assignedLetter).toBe('A');
    expect(cell.points).toBe(0);

    const duplicate = applyMatchAction(
      started,
      {
        type: 'play',
        seat: 0,
        placements: [
          { row: 4, col: 4, tile: blank, assignedLetter: 'A' },
          { row: 4, col: 5, tile: blank, assignedLetter: 'T' },
        ],
      },
      { dictionary: fixtureDictionary() },
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors.some((error) => error.code === 'duplicate-tile')).toBe(true);
  });

  it('rejects a move when no dictionary is configured and leaves the match unchanged', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1']) });
    const rejected = applyMatchAction(started, {
      type: 'play',
      seat: 0,
      placements: place(started.players[0].rack, [
        { row: 4, col: 4 },
        { row: 4, col: 5 },
      ]),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors[0]?.code).toBe('dictionary-unavailable');
    expect(started.version).toBe(1);
  });

  it('switches turns on pass, draws nothing, and ends after two full rounds', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: createTileBag(rules) });
    const once = applyMatchAction(started, { type: 'pass', seat: 0 });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(once.state.turn).toBe(1);
    expect(once.state.consecutivePasses).toBe(1);
    expect(once.state.players[0].score).toBe(0);
    expect(once.state.status).toBe('playing');

    const twice = applyMatchAction(once.state, { type: 'pass', seat: 1 });
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.state.status).toBe('finished');
    expect(twice.state.end).toEqual({ kind: 'passes' });
    expect(twice.state.players[0].score).toBe(-rackPoints(started.players[0].rack));
    expect(twice.state.players[1].score).toBe(-rackPoints(started.players[1].rack));
    const after = applyMatchAction(twice.state, { type: 'pass', seat: 0 });
    expect(after.ok).toBe(false);
  });

  it('exchanges tiles through the injected shuffle and rejects a short bag', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1', 'E-1', 'E-2']) });
    const exchangedId = started.players[0].rack[0]?.id;
    const exchanged = applyMatchAction(
      started,
      { type: 'exchange', seat: 0, tileIds: exchangedId ? [exchangedId] : [] },
      { random: zero },
    );
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;
    expect(exchanged.state.turn).toBe(1);
    expect(exchanged.state.consecutivePasses).toBe(0);
    expect(exchanged.state.players[0].rack.map((tile) => tile.id)).not.toContain(exchangedId);
    expect(exchanged.state.players[0].score).toBe(0);
    expect(exchanged.state.bag).toHaveLength(started.bag.length);

    const tight = smallRules((current) => ({
      ...current,
      tileSet: [
        { kind: 'letter' as const, letter: 'A' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'T' as const, count: 2, points: 1 },
      ],
    }));
    const emptyBag = dealMatch({ rules: tight, bag: ordered(tight, ['A-1', 'T-1', 'A-2', 'T-2']) });
    const blocked = applyMatchAction(
      emptyBag,
      { type: 'exchange', seat: 0, tileIds: [emptyBag.players[0].rack[0]?.id ?? ''] },
      { random: zero },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors[0]?.code).toBe('exchange-bag');
  });

  it('ends when the bag is empty and a player uses the last rack tile', () => {
    const rules = smallRules((current) => ({
      ...current,
      tileSet: [
        { kind: 'letter' as const, letter: 'A' as const, count: 2, points: 1 },
        { kind: 'letter' as const, letter: 'T' as const, count: 2, points: 1 },
      ],
    }));
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1', 'A-2', 'T-2']) });
    const played = applyMatchAction(
      started,
      { type: 'play', seat: 0, placements: place(started.players[0].rack, [{ row: 4, col: 4 }, { row: 4, col: 5 }]) },
      { dictionary: fixtureDictionary() },
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.end).toEqual({ kind: 'going-out', seat: 0 });
    expect(played.state.players[0].rack).toHaveLength(0);
    expect(played.state.players[0].score).toBe(54 + rackPoints(started.players[1].rack));
    expect(played.state.players[1].score).toBe(-rackPoints(started.players[1].rack));
  });

  it('resigns with the pass-style adjustment and names the other player', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: createTileBag(rules) });
    const resigned = applyMatchAction(started, { type: 'resign', seat: 0 });
    expect(resigned.ok).toBe(true);
    if (!resigned.ok) return;
    expect(resigned.state.end).toEqual({ kind: 'resign', resigned: 0, winner: 1 });
    expect(resigned.state.players[0].score).toBe(-rackPoints(started.players[0].rack));
  });

  it('rearranges only a permutation of the rack and renames a player', () => {
    const rules = smallRules();
    const started = dealMatch({ rules, bag: ordered(rules, ['A-1', 'T-1']) });
    const ids = started.players[0].rack.map((tile) => tile.id);
    const swapped = arrangeRack(started, 0, [ids[1] ?? '', ids[0] ?? '']);
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.state.players[0].rack.map((tile) => tile.id)).toEqual([ids[1], ids[0]]);
    const duplicated = arrangeRack(started, 0, [ids[0] ?? '', ids[0] ?? '']);
    expect(duplicated.ok).toBe(false);

    const renamed = renamePlayer(started, 1, '  Ada  ');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.state.players[1].name).toBe('Ada');
    expect(renamePlayer(started, 0, '   ').ok).toBe(false);
  });
});

function rackPoints(rack: readonly TileInstance[]): number {
  return rack.reduce((sum, tile) => sum + tile.points, 0);
}
