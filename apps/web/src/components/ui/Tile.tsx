import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { m, useReducedMotion } from 'motion/react';

export type TileProps = {
  letter?: string;
  points?: number;
  /** Focusable tile with hover and focus feedback. Empty rack slots leave this off. */
  interactive?: boolean;
  selected?: boolean;
  label?: string;
  rackIndex?: number;
  onClick?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  placed?: boolean;
  upgraded?: boolean;
  /** A confirmed upgrade that just arrived. A restored tile leaves this off. */
  fresh?: boolean;
};

export function Tile({
  letter,
  points,
  interactive = false,
  selected = false,
  label,
  rackIndex,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  placed = false,
  upgraded = false,
  fresh = false,
}: TileProps) {
  const empty = letter === undefined || letter === '';
  const reduceMotion = useReducedMotion() === true;
  const face = empty ? 'tile bg-square' : 'tile bg-tile text-tile-ink';
  const motionProps = {
    className: face,
    'data-tile': '',
    'data-occupied': empty ? 'false' : 'true',
    'data-selected': selected ? 'true' : 'false',
    'data-rack-index': rackIndex,
    'data-upgraded': upgraded ? 'true' : 'false',
    'data-fresh': fresh ? 'true' : 'false',
    whileHover: empty || reduceMotion || placed ? undefined : { y: -2 },
    initial: !placed || reduceMotion ? false : { scale: 0.94, y: 3 },
    animate: !placed || reduceMotion ? undefined : { scale: [0.94, 1.04, 1], y: [3, 0, 0] },
    transition: {
      duration: reduceMotion ? 0 : placed ? 0.28 : 0.12,
      ease: [0.2, 0, 0, 1] as const,
    },
  };
  const faceContent = empty ? null : (
    <>
      <span className="tile-letter" translate="no">
        {letter}
      </span>
      {points !== undefined ? <span className="tile-points text-point">{points}</span> : null}
    </>
  );

  if (interactive) {
    const name = label ?? (empty
      ? 'Empty tile'
      : `${letter}, ${points ?? 0} ${points === 1 ? 'point' : 'points'}`);
    return (
      <m.button
        type="button"
        {...motionProps}
        aria-label={name}
        aria-pressed={selected}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {faceContent}
      </m.button>
    );
  }

  return (
    <m.div {...motionProps} aria-hidden={empty ? true : undefined}>
      {faceContent}
    </m.div>
  );
}
