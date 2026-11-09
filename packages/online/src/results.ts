import type { MatchEnd, MatchState, Seat } from '@word-arena/engine';

export type ResultKind = 'win' | 'loss' | 'draw';

export type SeatResult = {
  readonly seat: Seat;
  readonly score: number;
  readonly opponentScore: number;
  readonly result: ResultKind;
  readonly endKind: MatchEnd['kind'];
};

/**
 * Final standing for each seat from the engine state.
 * Resignation uses the engine's winner. Every other ending compares the scores
 * the engine already stored. The client does not supply either value.
 */
export function seatResults(state: MatchState): readonly [SeatResult, SeatResult] | null {
  if (state.status !== 'finished' || state.end === null) return null;
  const leftScore = state.players[0].score;
  const rightScore = state.players[1].score;
  const endKind = state.end.kind;
  const [left, right] = standings(state.end, [leftScore, rightScore]);
  return [
    { seat: 0, score: leftScore, opponentScore: rightScore, result: left, endKind },
    { seat: 1, score: rightScore, opponentScore: leftScore, result: right, endKind },
  ];
}

/**
 * The standing match history stores.
 * Resignation uses the named winner. Going out, consecutive passes, and any
 * other ending compare the scores already stored after the rack adjustment.
 * Clearing a rack does not by itself win the match.
 */
export function standings(end: MatchEnd, scores: readonly [number, number]): readonly [ResultKind, ResultKind] {
  if (end.kind === 'resign') {
    return end.winner === 0 ? ['win', 'loss'] : ['loss', 'win'];
  }
  const [leftScore, rightScore] = scores;
  if (leftScore === rightScore) return ['draw', 'draw'];
  return leftScore > rightScore ? ['win', 'loss'] : ['loss', 'win'];
}
