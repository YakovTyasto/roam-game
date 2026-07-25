import { describe, expect, it } from 'vitest';
import { t, tPlural } from './t';

describe('t (interpolation + fallback)', () => {
  it('translates a simple key in English', () => {
    expect(t('en', 'settings.appearance.label')).toBe('Appearance');
  });

  it('translates the same key in Russian', () => {
    expect(t('ru', 'settings.appearance.label')).toBe('Оформление');
  });

  it('interpolates a parameter', () => {
    expect(t('en', 'settings.title', { name: 'Roam' })).toBe('Roam settings');
    expect(t('ru', 'settings.title', { name: 'Roam' })).toBe('Настройки Roam');
  });

  it('leaves an unmatched placeholder untouched rather than throwing', () => {
    expect(t('en', 'settings.title')).toBe('{name} settings');
  });

  it('falls back to English for a locale with a missing/corrupt key', () => {
    // Every real key exists in both dictionaries by construction (enforced
    // at compile time via `satisfies MessageDict`), so simulate a lookup
    // for a locale that isn't in the dictionary map at all.
    // @ts-expect-error deliberately an unsupported locale for the fallback test
    expect(t('fr', 'settings.appearance.label')).toBe('Appearance');
  });

  it('falls back to the raw key when even English has no match', () => {
    // @ts-expect-error deliberately an invalid key to exercise the safety net
    expect(t('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

describe('tPlural (Russian plural rules)', () => {
  it('English: singular for 1, plural otherwise', () => {
    expect(tPlural('en', 'rounds', 1)).toBe('1 round');
    expect(tPlural('en', 'rounds', 0)).toBe('0 rounds');
    expect(tPlural('en', 'rounds', 2)).toBe('2 rounds');
    expect(tPlural('en', 'rounds', 21)).toBe('21 rounds');
  });

  it('Russian: one/few/many by the standard last-digit rule', () => {
    expect(tPlural('ru', 'rounds', 1)).toBe('1 раунд'); // one
    expect(tPlural('ru', 'rounds', 21)).toBe('21 раунд'); // one (ends in 1, not 11)
    expect(tPlural('ru', 'rounds', 2)).toBe('2 раунда'); // few
    expect(tPlural('ru', 'rounds', 3)).toBe('3 раунда'); // few
    expect(tPlural('ru', 'rounds', 4)).toBe('4 раунда'); // few
    expect(tPlural('ru', 'rounds', 24)).toBe('24 раунда'); // few
    expect(tPlural('ru', 'rounds', 5)).toBe('5 раундов'); // many
    expect(tPlural('ru', 'rounds', 11)).toBe('11 раундов'); // many (the -teen exception)
    expect(tPlural('ru', 'rounds', 12)).toBe('12 раундов'); // many (the -teen exception)
    expect(tPlural('ru', 'rounds', 0)).toBe('0 раундов'); // many
  });

  it('applies the same rule across different plural keys (players, seconds)', () => {
    expect(tPlural('ru', 'players', 1)).toBe('1 игрок');
    expect(tPlural('ru', 'players', 3)).toBe('3 игрока');
    expect(tPlural('ru', 'players', 5)).toBe('5 игроков');
    expect(tPlural('en', 'seconds', 1)).toBe('1 second');
    expect(tPlural('en', 'seconds', 5)).toBe('5 seconds');
  });
});
