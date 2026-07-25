import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PREFERENCE,
  decideThemeSync,
  isThemePreference,
  resolveTheme,
} from './theme';

describe('theme config', () => {
  it('defaults new players to system', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });

  describe('isThemePreference', () => {
    it('accepts the three known values', () => {
      expect(isThemePreference('dark')).toBe(true);
      expect(isThemePreference('light')).toBe(true);
      expect(isThemePreference('system')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isThemePreference('purple')).toBe(false);
      expect(isThemePreference(null)).toBe(false);
      expect(isThemePreference(undefined)).toBe(false);
      expect(isThemePreference(42)).toBe(false);
      expect(isThemePreference({})).toBe(false);
    });
  });

  describe('resolveTheme', () => {
    it('follows the OS preference when set to system', () => {
      expect(resolveTheme('system', true)).toBe('dark');
      expect(resolveTheme('system', false)).toBe('light');
    });

    it('ignores the OS preference for explicit choices', () => {
      expect(resolveTheme('dark', false)).toBe('dark');
      expect(resolveTheme('light', true)).toBe('light');
    });
  });

  describe('decideThemeSync (profile fallback)', () => {
    it('adopts the server preference for a fresh browser with no local choice', () => {
      expect(decideThemeSync(false, 'system', 'dark')).toEqual({
        action: 'adopt-server',
        theme: 'dark',
      });
    });

    it('pushes the local preference up when this browser already had one', () => {
      expect(decideThemeSync(true, 'light', 'dark')).toEqual({
        action: 'push-local',
        theme: 'light',
      });
    });

    it('pushes the local preference when the server has never synced one', () => {
      expect(decideThemeSync(false, 'system', null)).toEqual({
        action: 'push-local',
        theme: 'system',
      });
    });

    it('ignores a malformed server value and pushes local instead', () => {
      expect(decideThemeSync(false, 'dark', 'not-a-theme')).toEqual({
        action: 'push-local',
        theme: 'dark',
      });
    });
  });
});
