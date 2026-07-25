export type Locale = 'en' | 'ru';

export const LOCALES: readonly Locale[] = ['en', 'ru'] as const;
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'roam.locale.v1';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ru';
}

/** Best-effort match of the browser's language list to a supported locale. */
export function detectBrowserLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const primary = lang.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
