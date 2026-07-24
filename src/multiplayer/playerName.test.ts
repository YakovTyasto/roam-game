import { describe, it, expect } from 'vitest';
import {
  MAX_PLAYER_NAME_LENGTH,
  isValidPlayerName,
  sanitizePlayerName,
  validatePlayerName,
} from './playerName';

const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe('sanitizePlayerName', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizePlayerName('  Alex   Doe  ')).toBe('Alex Doe');
  });

  it('strips angle brackets (defence against markup)', () => {
    expect(sanitizePlayerName('<b>Alex</b>')).toBe('bAlex/b');
  });

  it('strips control characters', () => {
    expect(sanitizePlayerName('Al' + NUL + 'e' + DEL + 'x')).toBe('Alex');
  });

  it('clamps to the max length', () => {
    const long = 'x'.repeat(50);
    expect(sanitizePlayerName(long)).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });
});

describe('isValidPlayerName', () => {
  it('accepts a normal name', () => {
    expect(isValidPlayerName('Alex')).toBe(true);
  });

  it('rejects blank / whitespace-only', () => {
    expect(isValidPlayerName('   ')).toBe(false);
    expect(isValidPlayerName('')).toBe(false);
  });

  it('rejects names with no usable characters after sanitising', () => {
    expect(isValidPlayerName('<>')).toBe(false);
  });
});

describe('validatePlayerName', () => {
  it('returns the sanitised name on success', () => {
    expect(validatePlayerName('  Alex  ')).toEqual({ ok: true, name: 'Alex' });
  });

  it('reports an error for a blank name', () => {
    const r = validatePlayerName('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/display name/i);
  });
});
