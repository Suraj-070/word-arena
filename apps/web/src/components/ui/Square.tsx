import { Tile } from './Tile';

type SquareFace = {
  letter: string;
  points: number;
  draft: boolean;
};

type SquareProps = {
  row: number;
  col: number;
  tabIndex: number;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onPress?: () => void;
  face?: SquareFace;
  bonus?: string;
};

/**
 * A board square.
 * The two surface tones are a weave so the grid reads on the felt.
 * Bonus text is only shown when the rules list a class for this square.
 */
export function Square({ row, col, tabIndex, buttonRef, onFocus, onPress, face, bonus }: SquareProps) {
  const weave = (row + col) % 2 === 0 ? 'square bg-square' : 'square bg-square-alt';
  const position = `row ${row + 1}, column ${col + 1}`;
  const label = face
    ? `${face.letter}, ${face.points} ${face.points === 1 ? 'point' : 'points'}, ${position}${face.draft ? ', not submitted' : ''}`
    : `Empty square, ${position}`;
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
      aria-rowindex={row + 1}
      aria-colindex={col + 1}
      aria-label={label}
      onFocus={onFocus}
      onClick={onPress}
    >
      {bonus ? <span className="square-bonus">{bonus}</span> : null}
      {face ? <Tile letter={face.letter} points={face.points} /> : null}
    </button>
  );
}
