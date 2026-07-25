/** Pure helpers for install guidance — no framework/runtime dependencies. */

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

export function isIos(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

export const INSTALL_HINT_DISMISSED_KEY = 'roam.installHintDismissed.v1';

export function readInstallHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInstallHintDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, '1');
  } catch {
    /* storage unavailable — the hint just won't remember being dismissed */
  }
}

/**
 * Only worth showing when useful: not already installed, and the player
 * hasn't dismissed it before. Never re-nags after a dismissal.
 */
export function shouldShowInstallHint(): boolean {
  return !isStandalone() && !readInstallHintDismissed();
}
