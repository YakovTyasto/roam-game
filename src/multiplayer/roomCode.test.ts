import { describe, it, expect } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from './roomCode';

describe('normalizeRoomCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeRoomCode('  abc234 ')).toBe('ABC234');
  });

  it('strips internal spaces and dashes', () => {
    expect(normalizeRoomCode('ab-c 23')).toBe('ABC23');
  });

  it('clamps to the code length', () => {
    expect(normalizeRoomCode('ABC234EXTRA')).toBe('ABC234');
  });
});

describe('isValidRoomCode', () => {
  it('accepts a well-formed code from the alphabet', () => {
    expect(isValidRoomCode('ABC234')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidRoomCode('ABC23')).toBe(false);
    expect(isValidRoomCode('ABC2345')).toBe(false);
  });

  it('rejects ambiguous characters not in the alphabet (0/O/1/I/L)', () => {
    expect(isValidRoomCode('ABC01O')).toBe(false);
    expect(isValidRoomCode('ILLABC')).toBe(false);
  });
});

describe('generateRoomCode', () => {
  it('produces a valid code of the right length', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(isValidRoomCode(code)).toBe(true);
  });

  it('is deterministic with a seeded rng', () => {
    const rng = () => 0; // always the first alphabet char
    expect(generateRoomCode(rng)).toBe(ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH));
  });

  it('excludes the confusable characters entirely', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
});
