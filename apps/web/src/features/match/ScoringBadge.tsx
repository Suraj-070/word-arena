import { scoringCopy } from './board-marks';

type ScoringMode = 'classic' | 'wild';

/** The mode name is visible. The sentence is in the accessible name as well. */
export function ScoringBadge({ mode }: { mode: ScoringMode }) {
  const name = mode === 'wild' ? 'Wild' : 'Classic';
  return (
    <span className="scoring-badge" data-mode={mode}>
      <span className="scoring-badge-name">{name}</span>
      <span className="scoring-badge-copy">{scoringCopy(mode)}</span>
    </span>
  );
}
