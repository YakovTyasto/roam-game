import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, detectBrowserLocale, isLocale } from './locale';

describe('isLocale', () => {
  it('accepts the two supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ru')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(1)).toBe(false);
  });
});

describe('detectBrowserLocale', () => {
  it('matches a supported language from navigator.languages', () => {
    expect(detectBrowserLocale(['ru-RU', 'en-US'])).toBe('ru');
    expect(detectBrowserLocale(['en-GB'])).toBe('en');
  });

  it('is case-insensitive and ignores the region subtag', () => {
    expect(detectBrowserLocale(['RU-ru'])).toBe('ru');
  });

  it('falls back to the default locale when nothing matches', () => {
    expect(detectBrowserLocale(['fr-FR', 'de-DE'])).toBe(DEFAULT_LOCALE);
    expect(detectBrowserLocale([])).toBe(DEFAULT_LOCALE);
  });

  it('picks the first supported language in priority order', () => {
    expect(detectBrowserLocale(['fr-FR', 'ru-RU', 'en-US'])).toBe('ru');
  });
});
