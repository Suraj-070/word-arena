import type { BonusMark } from '../../features/match/board-marks';
import { BONUS_NAME } from '../../features/match/board-marks';
import type { SquareEffect } from '../../features/match/celebration';
import { Tile } from './Tile';

type SquareFace = {
  letter: string;
  points: number;
  draft: boolean;
  upgraded?: boolean;
  fresh?: boolean;
};

type SquareProps = {
  row: number;
  col: number;
  tabIndex: number;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onPress?: () => void;
  face?: SquareFace;
  bonus?: BonusMark;
  effect?: SquareEffect;
};

/**
 * A board square.
 * The two surface tones are a weave so the grid reads on the felt.
 * Bonus text is only shown when the rules list a class for this square.
 */
export function Square({ row, col, tabIndex, buttonRef, onFocus, onPress, face, bonus, effect }: SquareProps) {
  const weave = (row + col) % 2 === 0 ? 'square bg-square' : 'square bg-square-alt';
  const position = `row ${row + 1}, column ${col + 1}`;
  const spent = Boolean(face && !face.draft);
  const bonusText = bonus && !spent ? `, ${BONUS_NAME[bonus.kind]}` : '';
  const upgraded = face?.upgraded ? ', upgraded' : '';
  const label = face
    ? `${face.letter}, ${face.points} ${face.points === 1 ? 'point' : 'points'}${upgraded}, ${position}${face.draft ? ', not submitted' : ''}${bonusText}`
    : `Empty square, ${position}${bonusText}`;
  return (
    <button
      type="button"
      role="gridcell"
      ref={buttonRef}
      tabIndex={tabIndex}
      className={weave}
      data-row={row}
      data-col={col}
      data-draft={face?.draft ? 'true' : 'false'}
      data-bonus={bonus?.kind}
      data-spent={spent && bonus ? 'true' : 'false'}
      data-effect={effect}
      aria-rowindex={row + 1}
      aria-colindex={col + 1}
      aria-label={label}
      onFocus={onFocus}
      onClick={onPress}
    >
      {bonus && !spent ? <span className="square-bonus">{bonus.label}</span> : null}
      {face ? (
        <Tile
          letter={face.letter}
          points={face.points}
          placed={face.draft || face.fresh === true}
          upgraded={face.upgraded === true && !face.draft}
          fresh={face.fresh === true && face.upgraded === true && !face.draft}
        />
      ) : null}
    </button>
  );
}
