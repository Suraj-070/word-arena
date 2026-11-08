import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardScroll, measureBoardScroll } from './BoardScroll';

describe('measureBoardScroll', () => {
  it('hides the hint when the board fits', () => {
    const fitted = measureBoardScroll({ scrollLeft: 0, scrollWidth: 600, clientWidth: 600 });
    expect(fitted.overflow).toBe(false);
    expect(fitted.atEnd).toBe(true);

    const subpixel = measureBoardScroll({ scrollLeft: 0, scrollWidth: 602, clientWidth: 600 });
    expect(subpixel.overflow).toBe(false);
  });

  it('shows a start-aligned thumb when columns overflow', () => {
    const hint = measureBoardScroll({ scrollLeft: 0, scrollWidth: 528, clientWidth: 351 });
    expect(hint.overflow).toBe(true);
    expect(hint.atStart).toBe(true);
    expect(hint.atEnd).toBe(false);
    expect(hint.thumbOffset).toBe(0);
    expect(hint.thumbSize).toBeCloseTo(351 / 528, 5);
  });

  it('moves the thumb to the far edge when the board is scrolled there', () => {
    const hint = measureBoardScroll({ scrollLeft: 177, scrollWidth: 528, clientWidth: 351 });
    expect(hint.atStart).toBe(false);
    expect(hint.atEnd).toBe(true);
    expect(hint.thumbOffset).toBeCloseTo(177 / 528, 5);
    expect(hint.thumbOffset + hint.thumbSize).toBeCloseTo(1, 5);
  });
});

describe('BoardScroll', () => {
  it('updates the hint from the scroller metrics', () => {
    const { container } = render(
      <BoardScroll>
        <div />
      </BoardScroll>,
    );
    const hint = container.querySelector('.board-scroll-hint');
    const scroller = container.querySelector('.board-scroll');
    if (!(hint instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
      throw new Error('missing scroll hint');
    }

    expect(hint.hidden).toBe(true);
    expect(hint).toHaveAttribute('aria-hidden', 'true');

    let scrollWidth = 528;
    let clientWidth = 320;
    let scrollLeft = 0;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });

    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(hint.hidden).toBe(false);
    expect(hint).toHaveAttribute('data-scroll-hint', 'visible');
    expect(hint).toHaveAttribute('data-at-start', 'true');
    expect(hint).toHaveAttribute('data-at-end', 'false');

    act(() => {
      scroller.scrollLeft = 208;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(hint).toHaveAttribute('data-at-start', 'false');
    expect(hint).toHaveAttribute('data-at-end', 'true');

    act(() => {
      scrollWidth = 320;
      clientWidth = 320;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(hint.hidden).toBe(true);
    expect(hint).toHaveAttribute('data-scroll-hint', 'hidden');
  });
});
