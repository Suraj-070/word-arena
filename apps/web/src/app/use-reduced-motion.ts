import { useLayoutEffect } from 'react';

export function useReducedMotionAttribute(): void {
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      document.documentElement.dataset.reducedMotion = media.matches ? 'true' : 'false';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
}
