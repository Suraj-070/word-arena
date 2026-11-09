import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchEnd, ScoreBreakdown } from '@word-arena/engine';
import { standings } from '@word-arena/online/client';
import { PlayFeedback, formatBreakdown, type SquareEffect } from './celebration';

const score: ScoreBreakdown = {
  words: [{
    direction: 'horizontal',
    start: { row: 7, col: 7 },
    text: 'AT',
    letters: [
      { row: 7, col: 7, letter: 'A', points: 1, placedThisTurn: true, tileId: 'a', letterMultiplier: 2, value: 2 },
      { row: 7, col: 8, letter: 'T', points: 1, placedThisTurn: true, tileId: 't', letterMultiplier: 1, value: 1 },
    ],
    raw: 3,
    wordMultiplier: 2,
    score: 6,
  }],
  bingo: 50,
  total: 56,
};

function Harness({ version, reduced }: { version: number; reduced: boolean }) {
  const [effects, setEffects] = useState<ReadonlyMap<string, SquareEffect>>(new Map());
  document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
  return (
    <>
      <PlayFeedback
        version={version}
        score={version > 1 ? score : null}
        status="playing"
        end={null}
          names={['Ada', 'Bea']}
          scores={[0, 0]}
          turn={1}
        onEffects={setEffects}
      />
      <p data-testid="effects">{[...effects.keys()].join(',')}</p>
    </>
  );
}

describe('scoring feedback', () => {
  it('describes letter and word multipliers together', () => {
    expect(formatBreakdown(score)).toContain('A 1×2');
    expect(formatBreakdown(score)).toContain('×2');
    expect(formatBreakdown(score)).toContain('Bingo +50');
  });

  it('does not replay a score when the same version is shown again, and stays quiet under reduced motion', () => {
    const view = render(<Harness version={1} reduced />);
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    view.rerender(<Harness version={2} reduced />);
    expect(screen.getByText('+56')).toBeInTheDocument();
    expect(screen.getByText('+56')).toHaveAttribute('data-reduced', 'true');
    expect(screen.getByText(/Bingo/)).toBeInTheDocument();
    view.rerender(<Harness version={2} reduced />);
    expect(screen.getAllByText('+56')).toHaveLength(1);
  });

  it('uses the history standing for every ending, including going out behind or level', () => {
    const names = ['Ada', 'Bea'] as const;
    const cases: readonly { end: MatchEnd; scores: readonly [number, number]; text: string; standing: readonly ['win' | 'loss' | 'draw', 'win' | 'loss' | 'draw'] }[] = [
      { end: { kind: 'going-out', seat: 0 }, scores: [20, 5], text: 'Ada wins.', standing: ['win', 'loss'] },
      { end: { kind: 'going-out', seat: 0 }, scores: [4, 10], text: 'Bea wins.', standing: ['loss', 'win'] },
      { end: { kind: 'going-out', seat: 1 }, scores: [7, 7], text: 'Drawn.', standing: ['draw', 'draw'] },
      { end: { kind: 'resign', resigned: 1, winner: 0 }, scores: [1, 30], text: 'Ada wins.', standing: ['win', 'loss'] },
      { end: { kind: 'passes' }, scores: [12, 9], text: 'Ada wins.', standing: ['win', 'loss'] },
      { end: { kind: 'passes' }, scores: [6, 6], text: 'Drawn.', standing: ['draw', 'draw'] },
    ];

    for (const sample of cases) {
      expect(standings(sample.end, sample.scores)).toEqual(sample.standing);
      const view = render(
        <PlayFeedback version={1} score={null} status="playing" end={null} names={names} scores={sample.scores} turn={0} onEffects={() => undefined} />,
      );
      view.rerender(
        <PlayFeedback version={2} score={null} status="finished" end={sample.end} names={names} scores={sample.scores} turn={1} onEffects={() => undefined} />,
      );
      expect(screen.getByText(sample.text)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('names a confirmed Wild upgrade and does not say so for Classic', () => {
    const wild = render(
      <PlayFeedback version={1} score={null} status="playing" end={null} names={['Ada', 'Bea']} scores={[0, 0]} turn={0} mode="wild" onEffects={() => undefined} />,
    );
    wild.rerender(
      <PlayFeedback version={2} score={score} status="playing" end={null} names={['Ada', 'Bea']} scores={[56, 0]} turn={1} mode="wild" onEffects={() => undefined} />,
    );
    expect(screen.getByText(/A is now 2/)).toBeInTheDocument();

    const classic = render(
      <PlayFeedback version={1} score={null} status="playing" end={null} names={['Ada', 'Bea']} scores={[0, 0]} turn={0} mode="classic" onEffects={() => undefined} />,
    );
    classic.rerender(
      <PlayFeedback version={2} score={score} status="playing" end={null} names={['Ada', 'Bea']} scores={[56, 0]} turn={1} mode="classic" onEffects={() => undefined} />,
    );
    expect(screen.getAllByText(/A is now 2/)).toHaveLength(1);
  });
});

const later: ScoreBreakdown = {
  words: [{
    direction: 'vertical',
    start: { row: 2, col: 3 },
    text: 'NO',
    letters: [
      { row: 2, col: 3, letter: 'N', points: 1, placedThisTurn: true, tileId: 'n', letterMultiplier: 1, value: 1 },
      { row: 3, col: 3, letter: 'O', points: 1, placedThisTurn: true, tileId: 'o', letterMultiplier: 1, value: 1 },
    ],
    raw: 2,
    wordMultiplier: 1,
    score: 9,
  }],
  bingo: 0,
  total: 9,
};

function playedAgain(value: ScoreBreakdown): ScoreBreakdown {
  return { ...value, words: value.words.map((word) => ({ ...word, letters: word.letters.map((letter) => ({ ...letter })) })) };
}

function Animated({ version, shown, mode = 'classic' }: { version: number; shown: ScoreBreakdown | null; mode?: 'classic' | 'wild' }) {
  const [effects, setEffects] = useState<ReadonlyMap<string, SquareEffect>>(new Map());
  return (
    <>
      <PlayFeedback
        version={version}
        score={shown}
        status="playing"
        end={null}
        names={['Ada', 'Bea']}
        scores={[0, 0]}
        turn={1}
        mode={mode}
        onEffects={setEffects}
      />
      <p data-testid="effects">{[...effects.entries()].map(([key, effect]) => `${key}:${effect}`).sort().join(' ')}</p>
    </>
  );
}

describe('score animation cleanup', () => {
  afterEach(() => {
    document.documentElement.dataset.reducedMotion = 'false';
    vi.useRealTimers();
  });

  it('keeps the cleanup running when the same version is read again', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.reducedMotion = 'false';
    const view = render(<Animated version={1} shown={null} />);
    view.rerender(<Animated version={2} shown={score} />);
    expect(screen.getByText('+56')).toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('7-7:both 7-8:word');

    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByTestId('effects').textContent).toBe('');
    expect(screen.getByText('+56')).toBeInTheDocument();

    view.rerender(<Animated version={2} shown={playedAgain(score)} />);
    expect(screen.getAllByText('+56')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByTestId('effects').textContent).toBe('');
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
  });

  it('replaces an in-progress animation when a newer version arrives, then clears both marks', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.reducedMotion = 'false';
    const view = render(<Animated version={1} shown={null} />);
    view.rerender(<Animated version={2} shown={score} />);
    act(() => { vi.advanceTimersByTime(100); });
    view.rerender(<Animated version={3} shown={later} />);

    expect(screen.getByText('+9')).toBeInTheDocument();
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('2-3:play 3-3:play');

    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByTestId('effects').textContent).toBe('2-3:play 3-3:play');
    expect(screen.getByText('+9')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(70); });
    expect(screen.getByTestId('effects').textContent).toBe('');
    expect(screen.getByText('+9')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(380); });
    expect(screen.queryByText('+9')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('');
  });

  it('does not replay a score that is already on screen at refresh', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.reducedMotion = 'false';
    render(<Animated version={8} shown={score} />);
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('');
  });

  it('does not replay the last score after a reconnect remounts the board', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.reducedMotion = 'false';
    const view = render(<Animated version={1} shown={null} />);
    view.rerender(<Animated version={4} shown={score} />);
    expect(screen.getByText('+56')).toBeInTheDocument();
    view.unmount();

    render(<Animated version={4} shown={score} />);
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('+56')).not.toBeInTheDocument();
    expect(screen.getByTestId('effects').textContent).toBe('');
  });

  it('shows the score text under reduced motion and never leaves a word highlight', () => {
    document.documentElement.dataset.reducedMotion = 'true';
    const view = render(<Animated version={1} shown={null} />);
    view.rerender(<Animated version={2} shown={score} />);
    expect(screen.getByText('+56')).toHaveAttribute('data-reduced', 'true');
    expect(screen.getByTestId('effects').textContent).toBe('');
    view.rerender(<Animated version={2} shown={playedAgain(score)} />);
    expect(screen.getAllByText('+56')).toHaveLength(1);
    expect(screen.getByTestId('effects').textContent).toBe('');
  });
});
