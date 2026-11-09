import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { arenaStandardRules } from '@word-arena/engine';
import { resetTable, useTableStore } from '../features/match/table-store';
import { THEME_STORAGE_KEY, useThemeStore } from '../stores/theme';
import { App } from './App';

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.reducedMotion = 'false';
    useThemeStore.setState({ theme: 'light' });
    resetTable();
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

  it('builds a match from the Arena Standard rules', () => {
    render(<App />);
    const rules = arenaStandardRules();

    expect(screen.getByRole('grid', { name: 'Board' })).toHaveAttribute('aria-colcount', String(rules.boardSize));
    expect(screen.getAllByRole('gridcell')).toHaveLength(rules.boardSize ** 2);
    expect(screen.getByRole('group', { name: /Player 1 rack, 7 tiles/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/No dictionary is configured/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.queryByText(/L2|L3|W2|W3/)).not.toBeInTheDocument();
  });

  it('uses Classic bonuses for the next match and can switch that match to Wild', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New match' }));
    expect(screen.getAllByText('L2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('L3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('W2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('W3').length).toBeGreaterThan(0);
    expect(useTableStore.getState().match.rules.scoring.tileUpgrade).toBe('classic');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring for the next match' }), 'wild');
    await user.click(screen.getByRole('button', { name: 'New match' }));
    expect(useTableStore.getState().match.rules.scoring.tileUpgrade).toBe('wild');
    expect(screen.getAllByText('L2').length).toBeGreaterThan(0);
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
