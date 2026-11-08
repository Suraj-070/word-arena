import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const OVERFLOW_THRESHOLD = 2;

export type BoardScrollMeasure = {
  overflow: boolean;
  atStart: boolean;
  atEnd: boolean;
  /** Thumb inset from the start of the track, as a fraction of the track. */
  thumbOffset: number;
  /** Thumb length as a fraction of the track. */
  thumbSize: number;
};

const INITIAL: BoardScrollMeasure = {
  overflow: false,
  atStart: true,
  atEnd: true,
  thumbOffset: 0,
  thumbSize: 1,
};

export function measureBoardScroll(source: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): BoardScrollMeasure {
  const max = source.scrollWidth - source.clientWidth;
  const overflow = max > OVERFLOW_THRESHOLD;
  const thumbSize = source.scrollWidth > 0 ? Math.min(1, source.clientWidth / source.scrollWidth) : 1;
  const thumbOffset = source.scrollWidth > 0 ? Math.max(0, source.scrollLeft) / source.scrollWidth : 0;

  return {
    overflow,
    atStart: source.scrollLeft <= 1,
    atEnd: !overflow || max - source.scrollLeft <= 1,
    thumbOffset,
    thumbSize,
  };
}

function sameMeasure(current: BoardScrollMeasure, next: BoardScrollMeasure): boolean {
  return (
    current.overflow === next.overflow &&
    current.atStart === next.atStart &&
    current.atEnd === next.atEnd &&
    Math.abs(current.thumbOffset - next.thumbOffset) < 0.001 &&
    Math.abs(current.thumbSize - next.thumbSize) < 0.001
  );
}

export function BoardScroll({ children }: { children: ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(INITIAL);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const update = () => {
      const next = measureBoardScroll(scroller);
      setHint((current) => (sameMeasure(current, next) ? current : next));
    };

    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const Observer = globalThis.ResizeObserver;
    const observer = typeof Observer === 'function' ? new Observer(update) : null;
    observer?.observe(scroller);
    const content = scroller.firstElementChild;
    if (content) observer?.observe(content);

    return () => {
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="board-scroll-wrap">
      <div className="board-scroll" ref={scrollerRef}>
        {children}
      </div>
      <div
        className="board-scroll-hint"
        data-scroll-hint={hint.overflow ? 'visible' : 'hidden'}
        data-at-start={hint.atStart ? 'true' : 'false'}
        data-at-end={hint.atEnd ? 'true' : 'false'}
        hidden={!hint.overflow}
        aria-hidden="true"
      >
        <span
          className="board-scroll-thumb"
          style={{
            width: `${hint.thumbSize * 100}%`,
            insetInlineStart: `${hint.thumbOffset * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
