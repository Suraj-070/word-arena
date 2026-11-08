import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Board } from './Board';

function cells() {
  return screen.getAllByRole('gridcell');
}

describe('Board', () => {
  it('renders a grid from the supplied edge length', () => {
    render(<Board boardSize={9} />);

    expect(screen.getByRole('grid', { name: 'Empty board' })).toHaveAttribute('aria-colcount', '9');
    expect(cells()).toHaveLength(81);
    expect(screen.queryByText(/L2|L3|W2|W3/)).not.toBeInTheDocument();
  });

  it('uses another supplied edge without assuming 15', () => {
    render(<Board boardSize={11} />);

    expect(cells()).toHaveLength(121);
  });

  it('moves keyboard focus between squares', async () => {
    const user = userEvent.setup();
    render(<Board boardSize={9} />);

    const gridCells = cells();
    const origin = gridCells[0];
    const right = gridCells[1];
    const below = gridCells[10];
    if (!origin || !right || !below) throw new Error('expected a 9 by 9 grid');

    origin.focus();
    expect(origin).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(right).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(below).toHaveFocus();
  });
});
