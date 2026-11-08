import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Rack } from './Rack';

describe('Rack', () => {
  it('renders the supplied number of empty spaces and no letters', () => {
    const { container } = render(<Rack slotCount={7} />);

    expect(screen.getByRole('group', { name: 'Empty rack, 7 spaces' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-occupied="false"]')).toHaveLength(7);
    expect(screen.queryByText(/[A-Z]/)).not.toBeInTheDocument();
  });
});
