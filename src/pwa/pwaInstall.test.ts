import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_HINT_DISMISSED_KEY,
  isIos,
  isStandalone,
  readInstallHintDismissed,
  shouldShowInstallHint,
  writeInstallHintDismissed,
} from './pwaInstall';

describe('isIos', () => {
  it('detects iPhone/iPad/iPod user agents', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
  });

  it('is false for non-iOS user agents', () => {
    expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isIos('')).toBe(false);
  });
});

describe('isStandalone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when display-mode: standalone matches', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') }));
    expect(isStandalone()).toBe(true);
  });

  it('is false when nothing indicates standalone', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isStandalone()).toBe(false);
  });
});

describe('install hint dismissal', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to not dismissed', () => {
    expect(readInstallHintDismissed()).toBe(false);
  });

  it('remembers a dismissal', () => {
    writeInstallHintDismissed();
    expect(readInstallHintDismissed()).toBe(true);
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe('1');
  });
});

describe('shouldShowInstallHint', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the hint when not installed and never dismissed', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(shouldShowInstallHint()).toBe(true);
  });

  it('never shows once dismissed (no repeated nagging)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    writeInstallHintDismissed();
    expect(shouldShowInstallHint()).toBe(false);
  });

  it('does not show when already running standalone (already installed)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(shouldShowInstallHint()).toBe(false);
  });
});
