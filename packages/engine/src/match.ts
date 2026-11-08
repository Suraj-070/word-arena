import { applyPlay, createBoard } from './board';
import { validatePlay } from './placement';
import { pointsFor } from './rules';
import type {
  Board,
  DictionaryProvider,
  MatchEnd,
  MatchError,
  MatchState,
  PlayerState,
  RandomSource,
  Rules,
  Seat,
  TileInstance,
  TilePlacement,
} from './types';

export type MatchAction =
  | { readonly type: 'play'; readonly seat: Seat; readonly placements: readonly TilePlacement[] }
  | { readonly type: 'pass'; readonly seat: Seat }
  | { readonly type: 'exchange'; readonly seat: Seat; readonly tileIds: readonly string[] }
  | { readonly type: 'resign'; readonly seat: Seat };

export type MatchResult =
  | { readonly ok: true; readonly state: MatchState }
  | { readonly ok: false; readonly errors: readonly MatchError[] };

/** Builds one physical tile for every count in the rules. Ids are stable. */
export function createTileBag(rules: Rules): TileInstance[] {
  const tiles: TileInstance[] = [];
  for (const definition of rules.tileSet) {
    for (let index = 0; index < definition.count; index += 1) {
      if (definition.kind === 'blank') {
        tiles.push({ id: `blank-${index + 1}`, letter: null, points: 0 });
      } else {
        tiles.push({
          id: `${definition.letter}-${index + 1}`,
          letter: definition.letter,
          points: definition.points,
        });
      }
    }
  }
  return tiles;
}

/**
 * Fisher-Yates. `random` must return a finite number in the range [0, 1).
 * This function does not call `Math.random`.
 */
export function shuffleTiles<T>(tiles: readonly T[], random: RandomSource): T[] {
  const next = tiles.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const roll = random();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new Error('Random source must return a finite number in the range [0, 1).');
    }
    const swap = Math.floor(roll * (index + 1));
    const current = next[index];
    const other = next[swap];
    if (current === undefined || other === undefined) {
      throw new Error('Shuffle index was outside the bag.');
    }
    next[index] = other;
    next[swap] = current;
  }
  return next;
}

export function createMatch(input: {
  readonly rules: Rules;
  readonly names?: readonly [string, string];
  readonly random: RandomSource;
}): MatchState {
  return dealMatch({
    rules: input.rules,
    names: input.names,
    bag: shuffleTiles(createTileBag(input.rules), input.random),
  });
}

/** Deals from the front of `bag`. The bag must be exactly the rules distribution. */
export function dealMatch(input: {
  readonly rules: Rules;
  readonly names?: readonly [string, string];
  readonly bag: readonly TileInstance[];
}): MatchState {
  if (!sameDistribution(input.rules, input.bag)) {
    throw new Error('The bag does not match the rules distribution.');
  }
  const names = input.names ?? ['Player 1', 'Player 2'];
  let bag = input.bag.slice();
  const first = draw(bag, input.rules.rackSize);
  bag = first.bag;
  const second = draw(bag, input.rules.rackSize);
  return {
    rules: input.rules,
    players: [
      { name: cleanName(names[0], 'Player 1'), rack: first.drawn, score: 0 },
      { name: cleanName(names[1], 'Player 2'), rack: second.drawn, score: 0 },
    ],
    bag: second.bag,
    board: createBoard(input.rules),
    turn: 0,
    consecutivePasses: 0,
    status: 'playing',
    end: null,
    version: 1,
    last: null,
  };
}

export function applyMatchAction(
  state: MatchState,
  action: MatchAction,
  context: { readonly dictionary?: DictionaryProvider | null; readonly random?: RandomSource } = {},
): MatchResult {
  if (state.status !== 'playing') {
    return failure('match-finished', 'The match is over.');
  }
  if (action.seat !== state.turn) {
    return failure('wrong-seat', 'It is not that player’s turn.');
  }

  switch (action.type) {
    case 'play':
      return play(state, action.placements, context.dictionary ?? null);
    case 'pass':
      return pass(state);
    case 'exchange':
      return exchange(state, action.tileIds, context.random);
    case 'resign':
      return resign(state);
    default:
      return failure('match-finished', 'The action is not supported.');
  }
}

export function arrangeRack(state: MatchState, seat: Seat, orderedIds: readonly string[]): MatchResult {
  if (state.status !== 'playing') return failure('match-finished', 'The match is over.');
  if (seat !== state.turn) return failure('wrong-seat', 'Only the player to move can rearrange a rack.');
  const player = state.players[seat];
  if (!sameIds(player.rack, orderedIds)) {
    return failure('rack-order', 'The rack order must list each current tile once.');
  }
  const byId = new Map(player.rack.map((tile) => [tile.id, tile]));
  const rack = orderedIds.map((id) => byId.get(id)).filter((tile): tile is TileInstance => tile !== undefined);
  return { ok: true, state: replacePlayer(state, seat, { ...player, rack }) };
}

export function renamePlayer(state: MatchState, seat: Seat, name: string): MatchResult {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 24) {
    return failure('name', 'A player name needs 1 to 24 characters.');
  }
  const player = state.players[seat];
  return { ok: true, state: replacePlayer(state, seat, { ...player, name: trimmed }) };
}

function play(
  state: MatchState,
  placements: readonly TilePlacement[],
  dictionary: DictionaryProvider | null,
): MatchResult {
  if (!dictionary) {
    return failure('dictionary-unavailable', 'No dictionary is configured, so this move cannot be checked or submitted.');
  }
  const player = state.players[state.turn];
  const checked = validatePlay({
    rules: state.rules,
    board: state.board,
    rack: player.rack,
    placements,
    dictionary,
  });
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const used = new Set(checked.play.placements.map((placement) => placement.tileId));
  const kept = player.rack.filter((tile) => !used.has(tile.id));
  const filled = refill(kept, state.bag, state.rules.rackSize);
  const scored = { ...player, rack: filled.rack, score: player.score + checked.play.score.total };
  const players = withPlayer(state, state.turn, scored);
  const wentOut = filled.rack.length === 0 && filled.bag.length === 0;
  if (wentOut) {
    return {
      ok: true,
      state: finish(state, {
        players: payGoingOut(players, state.turn),
        bag: filled.bag,
        board: applyPlay(state.board, checked.play),
        end: { kind: 'going-out', seat: state.turn },
        last: { kind: 'play', seat: state.turn, score: checked.play.score },
      }),
    };
  }

  return {
    ok: true,
    state: advance(state, {
      players,
      bag: filled.bag,
      board: applyPlay(state.board, checked.play),
      consecutivePasses: 0,
      last: { kind: 'play', seat: state.turn, score: checked.play.score },
    }),
  };
}

function pass(state: MatchState): MatchResult {
  const consecutivePasses = state.consecutivePasses + 1;
  const last = { kind: 'pass' as const, seat: state.turn, score: null };
  if (consecutivePasses >= state.rules.passRoundLimit * state.players.length) {
    return {
      ok: true,
      state: finish(state, {
        players: subtractRemaining(state.players),
        bag: state.bag,
        board: state.board,
        end: { kind: 'passes' },
        last,
      }),
    };
  }
  return {
    ok: true,
    state: advance(state, {
      players: state.players,
      bag: state.bag,
      board: state.board,
      consecutivePasses,
      last,
    }),
  };
}

function exchange(state: MatchState, tileIds: readonly string[], random: RandomSource | undefined): MatchResult {
  if (!state.rules.exchangeAllowed) {
    return failure('exchange-disabled', 'These rules do not allow an exchange.');
  }
  if (!random) return failure('random-rejected', 'Exchange needs an injected shuffle.');
  const unique = new Set(tileIds);
  if (tileIds.length === 0 || unique.size !== tileIds.length) {
    return failure('exchange-empty', 'Choose one or more rack tiles to exchange.');
  }
  const player = state.players[state.turn];
  const held = new Set(player.rack.map((tile) => tile.id));
  if (tileIds.some((id) => !held.has(id))) {
    return failure('exchange-tile', 'Exchange only tiles on the current rack.');
  }
  if (state.bag.length < tileIds.length) {
    return failure('exchange-bag', 'The bag does not have enough tiles to exchange.');
  }

  const returning = player.rack.filter((tile) => unique.has(tile.id));
  const kept = player.rack.filter((tile) => !unique.has(tile.id));
  const drawn = draw(state.bag, returning.length);
  const bag = shuffleTiles([...drawn.bag, ...returning], random);
  const players = withPlayer(state, state.turn, { ...player, rack: [...kept, ...drawn.drawn] });
  return {
    ok: true,
    state: advance(state, {
      players,
      bag,
      board: state.board,
      consecutivePasses: 0,
      last: { kind: 'exchange', seat: state.turn, score: null },
    }),
  };
}

function resign(state: MatchState): MatchResult {
  const resigned = state.turn;
  const winner: Seat = resigned === 0 ? 1 : 0;
  return {
    ok: true,
    state: finish(state, {
      players: subtractRemaining(state.players),
      bag: state.bag,
      board: state.board,
      end: { kind: 'resign', resigned, winner },
      last: { kind: 'resign', seat: resigned, score: null },
    }),
  };
}

function advance(
  state: MatchState,
  next: {
    readonly players: MatchState['players'];
    readonly bag: readonly TileInstance[];
    readonly board: Board;
    readonly consecutivePasses: number;
    readonly last: MatchState['last'];
  },
): MatchState {
  return {
    ...state,
    players: next.players,
    bag: next.bag,
    board: next.board,
    turn: state.turn === 0 ? 1 : 0,
    consecutivePasses: next.consecutivePasses,
    version: state.version + 1,
    last: next.last,
  };
}

function finish(
  state: MatchState,
  next: {
    readonly players: MatchState['players'];
    readonly bag: readonly TileInstance[];
    readonly board: Board;
    readonly end: MatchEnd;
    readonly last: MatchState['last'];
  },
): MatchState {
  return {
    ...state,
    players: next.players,
    bag: next.bag,
    board: next.board,
    status: 'finished',
    end: next.end,
    version: state.version + 1,
    last: next.last,
  };
}

function replacePlayer(state: MatchState, seat: Seat, player: PlayerState): MatchState {
  return { ...state, players: withPlayer(state, seat, player) };
}

function withPlayer(state: MatchState, seat: Seat, player: PlayerState): MatchState['players'] {
  const [left, right] = state.players;
  return seat === 0 ? [player, right] : [left, player];
}

function draw(bag: readonly TileInstance[], count: number): { drawn: TileInstance[]; bag: TileInstance[] } {
  const take = Math.max(0, Math.min(count, bag.length));
  return { drawn: bag.slice(0, take), bag: bag.slice(take) };
}

function refill(rack: readonly TileInstance[], bag: readonly TileInstance[], rackSize: number) {
  const filled = draw(bag, rackSize - rack.length);
  return { rack: [...rack, ...filled.drawn], bag: filled.bag };
}

function subtractRemaining(players: MatchState['players']): MatchState['players'] {
  const [left, right] = players;
  return [
    { ...left, score: left.score - rackValue(left.rack) },
    { ...right, score: right.score - rackValue(right.rack) },
  ];
}

function payGoingOut(players: MatchState['players'], seat: Seat): MatchState['players'] {
  const other: Seat = seat === 0 ? 1 : 0;
  const bounty = rackValue(players[other].rack);
  const [left, right] = players;
  const paid = (player: PlayerState, delta: number): PlayerState => ({ ...player, score: player.score + delta });
  return seat === 0 ? [paid(left, bounty), paid(right, -bounty)] : [paid(left, -bounty), paid(right, bounty)];
}

function rackValue(rack: readonly TileInstance[]): number {
  return rack.reduce((sum, tile) => sum + tile.points, 0);
}

function cleanName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 24) return fallback;
  return trimmed;
}

function sameIds(rack: readonly TileInstance[], orderedIds: readonly string[]): boolean {
  if (rack.length !== orderedIds.length) return false;
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return rack.every((tile) => seen.has(tile.id));
}

function sameDistribution(rules: Rules, tiles: readonly TileInstance[]): boolean {
  const expected = new Map<string, { count: number; points: number }>();
  for (const definition of rules.tileSet) {
    if (definition.count === 0) continue;
    const key = definition.kind === 'blank' ? '' : definition.letter;
    expected.set(key, { count: definition.count, points: definition.points });
  }
  const seen = new Set<string>();
  const actual = new Map<string, number>();
  for (const tile of tiles) {
    if (seen.has(tile.id) || tile.id.length === 0) return false;
    seen.add(tile.id);
    const key = tile.letter ?? '';
    const definition = expected.get(key);
    const official = pointsFor(rules, tile.letter);
    if (!definition || official !== tile.points) return false;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  if (actual.size !== expected.size) return false;
  for (const [key, definition] of expected) {
    if (actual.get(key) !== definition.count) return false;
  }
  return true;
}

function failure(code: MatchError['code'], message: string): MatchResult {
  return { ok: false, errors: [{ code, message }] };
}
