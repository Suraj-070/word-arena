import { describe, expect, it } from 'vitest';
import type { MatchState } from '@word-arena/engine';
import { seatResults } from '../src/results';

function finished(end: MatchState['end'], left: number, right: number): MatchState {
  return {
    status: 'finished',
    end,
    players: [
      { name: 'Ada', rack: [], score: left },
      { name: 'Bea', rack: [], score: right },
    ],
  } as unknown as MatchState;
}

describe('seat results', () => {
  it('uses the engine winner when a player resigns, even if that seat has fewer points', () => {
    const seats = seatResults(finished({ kind: 'resign', resigned: 1, winner: 0 }, 3, 40));
    expect(seats?.map((seat) => seat.result)).toEqual(['win', 'loss']);
    expect(seats?.[0]).toMatchObject({ score: 3, opponentScore: 40, endKind: 'resign' });
  });

  it('compares the stored scores after a rack is cleared, including a loss and a draw', () => {
    expect(seatResults(finished({ kind: 'going-out', seat: 0 }, 20, 5))?.map((seat) => seat.result)).toEqual(['win', 'loss']);
    expect(seatResults(finished({ kind: 'going-out', seat: 0 }, 4, 10))?.map((seat) => seat.result)).toEqual(['loss', 'win']);
    expect(seatResults(finished({ kind: 'going-out', seat: 1 }, 7, 7))?.map((seat) => seat.result)).toEqual(['draw', 'draw']);
  });

  it('compares the stored scores when the match ends on consecutive passes', () => {
    expect(seatResults(finished({ kind: 'passes' }, 12, 9))?.map((seat) => seat.result)).toEqual(['win', 'loss']);
    expect(seatResults(finished({ kind: 'passes' }, 6, 6))?.map((seat) => seat.result)).toEqual(['draw', 'draw']);
  });

  it('returns nothing while the match is still being played', () => {
    const playing = { ...finished(null, 1, 1), status: 'playing' } as MatchState;
    expect(seatResults(playing)).toBeNull();
  });
});
