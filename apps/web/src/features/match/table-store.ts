import {
  applyMatchAction,
  arrangeRack,
  createMatch,
  dealMatch,
  inBounds,
  readCell,
  renamePlayer,
  validatePlay,
  arenaStandardRules,
  type DictionaryProvider,
  type Letter,
  type MatchState,
  type PlayResult,
  type RandomSource,
  type Seat,
  type TileInstance,
  type TilePlacement,
} from '@word-arena/engine';
import { create } from 'zustand';

export type DraftPlacement = {
  readonly tileId: string;
  readonly row: number;
  readonly col: number;
  readonly assignedLetter?: Letter;
};

export type PendingBlank = {
  readonly tileId: string;
  readonly row: number;
  readonly col: number;
};

type TableState = {
  match: MatchState;
  dictionary: DictionaryProvider | null;
  random: RandomSource;
  selected: readonly string[];
  draft: readonly DraftPlacement[];
  pendingBlank: PendingBlank | null;
  notice: string;
  toggleSelected: (tileId: string) => void;
  placeSelected: (row: number, col: number) => void;
  placeTile: (tileId: string, row: number, col: number) => void;
  assignBlank: (letter: Letter) => void;
  cancelBlank: () => void;
  recall: (row: number, col: number) => void;
  undo: () => void;
  clearDraft: () => void;
  moveRackTile: (tileId: string, direction: -1 | 1) => void;
  submit: () => void;
  pass: () => void;
  exchange: () => void;
  resign: () => void;
  rename: (seat: Seat, name: string) => void;
};

const rules = arenaStandardRules();

export const useTableStore = create<TableState>((set, get) => ({
  match: createMatch({ rules, random: liveRandom() }),
  dictionary: null,
  random: liveRandom(),
  selected: [],
  draft: [],
  pendingBlank: null,
  notice: '',
  toggleSelected: (tileId) => {
    const { selected, draft, match } = get();
    if (match.status !== 'playing') return;
    if (draft.some((placement) => placement.tileId === tileId)) return;
    const next = selected.includes(tileId) ? selected.filter((id) => id !== tileId) : [...selected, tileId];
    set({ selected: next, notice: '' });
  },
  placeTile: (tileId, row, col) => {
    set({ selected: [tileId] });
    get().placeSelected(row, col);
  },
  placeSelected: (row, col) => {
    const state = get();
    if (state.match.status !== 'playing' || state.pendingBlank) return;
    const existing = state.draft.find((placement) => placement.row === row && placement.col === col);
    if (existing) {
      set({ draft: state.draft.filter((placement) => placement !== existing), notice: '' });
      return;
    }
    if (state.selected.length !== 1) {
      set({
        notice: state.selected.length === 0 ? 'Select a rack tile first.' : 'Select one tile to place.',
      });
      return;
    }
    const tileId = state.selected[0];
    if (!tileId) return;
    if (state.draft.some((placement) => placement.tileId === tileId)) {
      set({ notice: 'That tile is already on the board.' });
      return;
    }
    const tile = currentRack(state.match).find((candidate) => candidate.id === tileId);
    if (!tile) return;
    if (!inBounds(state.match.rules.boardSize, row, col)) return;
    const cell = readCell(state.match.board, row, col);
    if (cell.kind !== 'empty') {
      set({ notice: 'That square is already taken.' });
      return;
    }
    if (tile.letter === null) {
      set({ pendingBlank: { tileId, row, col }, notice: 'Choose a letter for the blank. It still scores 0.' });
      return;
    }
    set({
      draft: [...state.draft, { tileId, row, col }],
      selected: [],
      notice: '',
    });
  },
  assignBlank: (letter) => {
    const { pendingBlank, draft } = get();
    if (!pendingBlank) return;
    set({
      draft: [...draft, { ...pendingBlank, assignedLetter: letter }],
      pendingBlank: null,
      selected: [],
      notice: '',
    });
  },
  cancelBlank: () => set({ pendingBlank: null }),
  recall: (row, col) => {
    set({
      draft: get().draft.filter((placement) => placement.row !== row || placement.col !== col),
      notice: '',
    });
  },
  undo: () => set({ draft: get().draft.slice(0, -1), notice: '' }),
  clearDraft: () => set({ draft: [], pendingBlank: null, notice: '' }),
  moveRackTile: (tileId, direction) => {
    const { match, draft } = get();
    const hidden = new Set(draft.map((placement) => placement.tileId));
    const ordered = movedOrder(currentRack(match), hidden, tileId, direction);
    if (!ordered) return;
    const result = arrangeRack(match, match.turn, ordered);
    if (!result.ok) {
      set({ notice: result.errors[0]?.message ?? 'The rack could not be rearranged.' });
      return;
    }
    set({ match: result.state });
  },
  submit: () => {
    const state = get();
    if (state.match.status !== 'playing' || state.draft.length === 0) return;
    if (!state.dictionary) {
      set({ notice: 'No dictionary is configured, so this move cannot be checked or submitted.' });
      return;
    }
    const placements = toPlacements(state.match, state.draft);
    if (!placements) {
      set({ notice: 'A placed tile is no longer on the rack.' });
      return;
    }
    const result = applyMatchAction(
      state.match,
      { type: 'play', seat: state.match.turn, placements },
      { dictionary: state.dictionary },
    );
    if (!result.ok) {
      set({ notice: result.errors.map((error) => error.message).join(' ') });
      return;
    }
    set({
      match: result.state,
      draft: [],
      selected: [],
      pendingBlank: null,
      notice: playNotice(result.state),
    });
  },
  pass: () => {
    commit(get, set, { type: 'pass', seat: get().match.turn });
  },
  exchange: () => {
    const state = get();
    const drafted = new Set(state.draft.map((placement) => placement.tileId));
    const tileIds = state.selected.filter((id) => !drafted.has(id));
    if (tileIds.length === 0) {
      set({ notice: 'Select the rack tiles to exchange.' });
      return;
    }
    const result = applyMatchAction(
      state.match,
      { type: 'exchange', seat: state.match.turn, tileIds },
      { random: state.random },
    );
    if (!result.ok) {
      set({ notice: result.errors[0]?.message ?? 'Exchange was rejected.' });
      return;
    }
    set({
      match: result.state,
      selected: [],
      draft: [],
      pendingBlank: null,
      notice: `${result.state.players[result.state.turn].name} to move.`,
    });
  },
  resign: () => {
    commit(get, set, { type: 'resign', seat: get().match.turn });
  },
  rename: (seat, name) => {
    const result = renamePlayer(get().match, seat, name);
    if (!result.ok) {
      set({ notice: result.errors[0]?.message ?? 'That name is not available.' });
      return;
    }
    set({ match: result.state, notice: '' });
  },
}));

export function placementPreview(match: MatchState, draft: readonly DraftPlacement[], dictionary: DictionaryProvider | null): PlayResult | null {
  if (!dictionary || draft.length === 0 || match.status !== 'playing') return null;
  const placements = toPlacements(match, draft);
  if (!placements) return null;
  return validatePlay({
    rules: match.rules,
    board: match.board,
    rack: currentRack(match),
    placements,
    dictionary,
  });
}

export function resetTable(match = createMatch({ rules, random: () => 0 }), dictionary: DictionaryProvider | null = null): void {
  useTableStore.setState({
    match,
    dictionary,
    random: () => 0,
    selected: [],
    draft: [],
    pendingBlank: null,
    notice: '',
  });
}

export function installMatch(match: MatchState, dictionary: DictionaryProvider | null): void {
  resetTable(match, dictionary);
}

export { dealMatch };

function commit(
  get: () => TableState,
  set: (partial: Partial<TableState>) => void,
  action: Parameters<typeof applyMatchAction>[1],
): void {
  const state = get();
  if (state.draft.length > 0) {
    set({ notice: 'Clear the unsubmitted tiles first.' });
    return;
  }
  const result = applyMatchAction(state.match, action, { dictionary: state.dictionary, random: state.random });
  if (!result.ok) {
    set({ notice: result.errors[0]?.message ?? 'That action was rejected.' });
    return;
  }
  set({
    match: result.state,
    selected: [],
    pendingBlank: null,
    notice: endNotice(result.state),
  });
}

function playNotice(match: MatchState): string {
  const score = match.last?.score;
  if (!score) return endNotice(match);
  const words = score.words.map((word) => `${word.text} ${word.score}`).join(', ');
  const bingo = score.bingo > 0 ? ` Bingo ${score.bingo}.` : '';
  const ended = match.status === 'finished' ? ` ${endNotice(match)}` : '';
  return `${words}. Total ${score.total}.${bingo}${ended}`;
}

function endNotice(match: MatchState): string {
  if (match.end?.kind === 'going-out') return `${match.players[match.end.seat].name} played out.`;
  if (match.end?.kind === 'passes') return 'The match ended after consecutive passes.';
  if (match.end?.kind === 'resign') return `${match.players[match.end.winner].name} wins.`;
  const seat = match.turn;
  return `${match.players[seat].name} to move.`;
}

function currentRack(match: MatchState): readonly TileInstance[] {
  return match.players[match.turn].rack;
}

function toPlacements(match: MatchState, draft: readonly DraftPlacement[]): TilePlacement[] | null {
  const rack = new Map(currentRack(match).map((tile) => [tile.id, tile]));
  const placements: TilePlacement[] = [];
  for (const placement of draft) {
    const tile = rack.get(placement.tileId);
    if (!tile) return null;
    placements.push({
      row: placement.row,
      col: placement.col,
      tile,
      ...(tile.letter === null && placement.assignedLetter ? { assignedLetter: placement.assignedLetter } : {}),
    });
  }
  return placements;
}

function movedOrder(
  rack: readonly TileInstance[],
  hidden: ReadonlySet<string>,
  tileId: string,
  direction: -1 | 1,
): string[] | null {
  const visible = rack.filter((tile) => !hidden.has(tile.id));
  const index = visible.findIndex((tile) => tile.id === tileId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= visible.length) return null;
  const reordered = visible.slice();
  const current = reordered[index];
  const other = reordered[target];
  if (!current || !other) return null;
  reordered[index] = other;
  reordered[target] = current;
  let cursor = 0;
  return rack.map((tile) => {
    if (hidden.has(tile.id)) return tile.id;
    const next = reordered[cursor];
    cursor += 1;
    return next?.id ?? tile.id;
  });
}

function liveRandom(): RandomSource {
  return () => {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 4294967296;
  };
}
