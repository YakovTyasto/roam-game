import { useEffect, useState } from 'react';

/** Subscribe to a CSS media query, SSR-safe and cleaned up on unmount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Common breakpoints for the layout logic. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsTablet = () =>
  useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
export const usePrefersReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)');
