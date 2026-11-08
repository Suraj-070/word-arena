import { m, useReducedMotion } from 'motion/react';

export type TileProps = {
  letter?: string;
  points?: number;
  /** Focusable tile with hover and focus feedback. Empty rack slots leave this off. */
  interactive?: boolean;
};

export function Tile({ letter, points, interactive = false }: TileProps) {
  const empty = letter === undefined || letter === '';
  const reduceMotion = useReducedMotion() === true;
  const face = empty ? 'tile bg-square' : 'tile bg-tile text-tile-ink';
  const motionProps = {
    className: face,
    'data-tile': '',
    'data-occupied': empty ? 'false' : 'true',
    whileHover: empty || reduceMotion ? undefined : { y: -2 },
    transition: {
      duration: reduceMotion ? 0 : 0.12,
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
    const name = empty
      ? 'Empty tile'
      : `${letter}, ${points ?? 0} ${points === 1 ? 'point' : 'points'}`;
    return (
      <m.button type="button" {...motionProps} aria-label={name}>
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
