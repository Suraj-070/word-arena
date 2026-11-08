import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { sampleBoardFrame } from '../features/board/sample-frame';
import { THEME_STORAGE_KEY, useThemeStore } from '../stores/theme';
import { App } from './App';

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.reducedMotion = 'false';
    useThemeStore.setState({ theme: 'light' });
  });

  it('switches the theme and stores the choice', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(screen.getByText('Dark theme')).toBeInTheDocument();
  });

  it('builds the empty table from the sample frame', () => {
    render(<App />);

    expect(screen.getByRole('grid', { name: 'Empty board' })).toHaveAttribute(
      'aria-colcount',
      String(sampleBoardFrame.boardSize),
    );
    expect(screen.getAllByRole('gridcell')).toHaveLength(sampleBoardFrame.boardSize ** 2);
    expect(screen.getByRole('group', { name: `Empty rack, ${sampleBoardFrame.rackSize} spaces` })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText(/L2|L3|W2|W3/)).not.toBeInTheDocument();
  });

  it('marks reduced motion on the document', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      render(<App />);
      expect(document.documentElement.dataset.reducedMotion).toBe('true');
    } finally {
      window.matchMedia = original;
    }
  });
});
