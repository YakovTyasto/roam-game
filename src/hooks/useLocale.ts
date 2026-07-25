import { useCallback, useRef, useState } from 'react';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, detectBrowserLocale, isLocale, type Locale } from '../i18n/locale';

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLocale(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(locale));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

function browserDefault(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const languages = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return detectBrowserLocale(languages);
}

export interface LocaleController {
  locale: Locale;
  hadStoredLocale: boolean;
  setLocale: (locale: Locale) => void;
}

/** Local-first locale controller — same shape as useTheme, for the same reasons. */
export function useLocale(): LocaleController {
  const initial = useRef(readStoredLocale()).current;
  const [locale, setLocaleState] = useState<Locale>(initial ?? browserDefault());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  return { locale, hadStoredLocale: initial !== null, setLocale };
}
