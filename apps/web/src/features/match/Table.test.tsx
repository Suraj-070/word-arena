import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  arenaStandardDefinition,
  createMemoryDictionary,
  createTileBag,
  dealMatch,
  validateRules,
  type Rules,
  type TileInstance,
} from '@word-arena/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMatch, useTableStore } from './table-store';
import { Table } from './Table';

function rulesFor(change: (definition: Record<string, unknown>) => void): Rules {
  const definition = arenaStandardDefinition();
  definition.boardSize = 9;
  definition.rackSize = 2;
  definition.passRoundLimit = 1;
  change(definition);
  const result = validateRules(definition);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(' '));
  return result.rules;
}

function ordered(rules: Rules, ids: readonly string[]): TileInstance[] {
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

const openingRules = rulesFor((definition) => {
  definition.tileSet = [
    { kind: 'letter', letter: 'A', count: 2, points: 1 },
    { kind: 'letter', letter: 'T', count: 2, points: 1 },
    { kind: 'letter', letter: 'E', count: 2, points: 1 },
    { kind: 'blank', count: 1, points: 0 },
  ];
});

function playing() {
  return dealMatch({ rules: openingRules, bag: ordered(openingRules, ['A-1', 'T-1', 'A-2', 'T-2']) });
}

beforeEach(() => {
  installMatch(playing(), createMemoryDictionary(openingRules.dictionaryVersionId, ['AT', 'ATE']));
});

describe('interactive match', () => {
  it('selects a rack tile, places a horizontal word, and shows the engine score', async () => {
    const user = userEvent.setup();
    render(<Table />);

    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    expect(screen.getByRole('button', { name: 'A, 1 point' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }));
    await user.click(screen.getByRole('button', { name: 'T, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 6' }));
    expect(screen.getByRole('gridcell', { name: /A, 1 point, row 5, column 5, not submitted/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText(/Total 54/)).toBeInTheDocument();
    expect(screen.getByText(/Player 2 to move/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Player 2 rack, 2 tiles/ })).toBeInTheDocument();
    expect(useTableStore.getState().match.bag).toHaveLength(1);
  });

  it('places a vertical word from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    screen.getByRole('gridcell', { name: 'Empty square, row 4, column 5' }).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'T, 1 point' }));
    screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(useTableStore.getState().match.last?.score?.words[0]?.direction).toBe('vertical');
  });

  it('asks for a blank letter and keeps its score at zero', async () => {
    installMatch(
      dealMatch({ rules: openingRules, bag: ordered(openingRules, ['blank-1', 'T-1']) }),
      createMemoryDictionary(openingRules.dictionaryVersionId, ['AT']),
    );
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'Blank, 0 points' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a letter for the blank' });
    await user.click(within(dialog).getByRole('button', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'T, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 6' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const cell = useTableStore.getState().match.board.cells[4 * 9 + 4];
    expect(cell?.kind).toBe('occupied');
    if (cell?.kind === 'occupied') expect(cell.points).toBe(0);
  });

  it('rejects a second placement of the same physical tile', () => {
    const id = useTableStore.getState().match.players[0].rack[0]?.id;
    if (!id) throw new Error('rack');
    useTableStore.getState().placeTile(id, 4, 4);
    useTableStore.getState().placeTile(id, 4, 5);
    expect(useTableStore.getState().draft).toHaveLength(1);
    expect(useTableStore.getState().notice).toMatch(/already on the board/);
  });

  it('undoes and clears unsubmitted tiles', async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'A, 1 point' })).toBeInTheDocument();
  });

  it('rearranges the rack from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Table />);
    const before = useTableStore.getState().match.players[0].rack.map((tile) => tile.id);
    const rack = screen.getByRole('group', { name: /Player 1 rack/ });
    await user.type(within(rack).getByRole('button', { name: 'A, 1 point' }), '{ArrowRight}');
    const after = useTableStore.getState().match.players[0].rack.map((tile) => tile.id);
    expect(after).toEqual([before[1], before[0]]);
  });

  it('shows the engine’s reason when a placement is not legal', async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 1, column 1' }));
    await user.click(screen.getByRole('button', { name: 'T, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 1, column 2' }));
    expect(screen.getByText(/centre/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText(/centre/)).toBeInTheDocument();
    expect(useTableStore.getState().match.turn).toBe(0);
  });

  it('does not submit or score a move when no dictionary is configured', async () => {
    installMatch(playing(), null);
    const user = userEvent.setup();
    render(<Table />);
    expect(screen.getByText(/No dictionary is configured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    await user.click(screen.getByRole('gridcell', { name: 'Empty square, row 5, column 5' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(useTableStore.getState().match.turn).toBe(0);
    expect(useTableStore.getState().match.players[0].score).toBe(0);
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it('passes, exchanges, and ends the match', async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'A, 1 point' }));
    await user.click(screen.getByRole('button', { name: 'Exchange' }));
    expect(screen.getAllByText(/Player 2 to move/).length).toBeGreaterThan(0);
    expect(useTableStore.getState().match.players[0].score).toBe(0);

    cleanup();
    installMatch(playing(), createMemoryDictionary(openingRules.dictionaryVersionId, ['AT']));
    render(<Table />);
    await user.click(screen.getByRole('button', { name: 'Pass' }));
    await user.click(screen.getByRole('button', { name: 'Pass' }));
    expect(screen.getByText(/ended after consecutive passes/)).toBeInTheDocument();
    expect(useTableStore.getState().match.status).toBe('finished');
    expect(useTableStore.getState().match.players[0].score).toBeLessThan(0);
  });
});
