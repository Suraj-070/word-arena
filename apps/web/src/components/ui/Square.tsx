type SquareProps = {
  row: number;
  col: number;
  tabIndex: number;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onFocus: () => void;
};

/**
 * An empty board square.
 * The two surface tones are a weave so the grid reads on the felt.
 * They are not bonus squares, and this component has no coordinates of its own.
 */
export function Square({ row, col, tabIndex, buttonRef, onFocus }: SquareProps) {
  const weave = (row + col) % 2 === 0 ? 'square bg-square' : 'square bg-square-alt';
  return (
    <button
      type="button"
      role="gridcell"
      ref={buttonRef}
      tabIndex={tabIndex}
      className={weave}
      data-row={row}
      data-col={col}
      aria-rowindex={row + 1}
      aria-colindex={col + 1}
      aria-label={`Empty square, row ${row + 1}, column ${col + 1}`}
      onFocus={onFocus}
    />
  );
}
