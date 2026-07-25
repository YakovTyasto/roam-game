import { useEffect, useRef } from 'react';

/**
 * Intercepts browser Back navigation and warns on refresh/tab-close while
 * `active` (there is meaningful unsaved in-progress state — e.g. mid-round),
 * routing Back through `onBackIntercepted` (typically: open the exit dialog)
 * instead of silently leaving the app. Never traps the user: the caller's
 * own exit flow always provides a real way out via in-app navigation.
 */
export function useExitGuard(active: boolean, onBackIntercepted: () => void): void {
  const onBackRef = useRef(onBackIntercepted);
  onBackRef.current = onBackIntercepted;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;

    // A sentinel history entry so the first Back press is intercepted rather
    // than navigating away from the app entirely.
    window.history.pushState({ roamExitGuard: true }, '');

    const onPopState = () => {
      // Re-arm the guard (absorb this Back press) and let the caller decide.
      window.history.pushState({ roamExitGuard: true }, '');
      onBackRef.current();
    };
    window.addEventListener('popstate', onPopState);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
}
