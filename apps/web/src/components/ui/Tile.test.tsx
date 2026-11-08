import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tile } from './Tile';

describe('Tile', () => {
  it('renders a letter and its points', () => {
    render(<Tile letter="Q" points={10} />);

    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders an empty slot without a letter', () => {
    const { container } = render(<Tile />);

    expect(container.querySelector('[data-occupied="false"]')).not.toBeNull();
    expect(screen.queryByText(/[A-Z]/)).not.toBeInTheDocument();
  });

  it('can receive keyboard focus when interactive', () => {
    render(<Tile letter="A" points={1} interactive />);

    const tile = screen.getByRole('button', { name: 'A, 1 point' });
    tile.focus();
    expect(tile).toHaveFocus();
  });
});
