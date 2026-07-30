import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_CODE_LENGTH,
  buildChallengeQueryUrl,
  buildChallengeUrl,
  isValidChallengeCode,
  normalizeChallengeCode,
  parseChallengeCodeFromUrl,
} from './challengeCode';

const CODE = 'A2B3C4D5E6';

describe('normalizeChallengeCode', () => {
  it('uppercases and strips separators people add by hand', () => {
    expect(normalizeChallengeCode('a2b3-c4d5 e6')).toBe(CODE);
  });

  it('drops confusable characters instead of guessing what they meant', () => {
    // Both members of every confusable pair are outside the alphabet, so there is
    // no "intended" character to correct to. Dropping them shortens the code and
    // fails validation, which shows the player an error — far better than
    // silently resolving their typo to a different, valid challenge.
    expect(normalizeChallengeCode('O0I L1')).toBe('');
    expect(isValidChallengeCode(normalizeChallengeCode('A2B3C4D5EO'))).toBe(false);
  });

  it('never returns more than the code length', () => {
    expect(normalizeChallengeCode('A2B3C4D5E6F7G8')).toHaveLength(CHALLENGE_CODE_LENGTH);
  });

  it('handles empty and junk input without throwing', () => {
    expect(normalizeChallengeCode('')).toBe('');
    expect(normalizeChallengeCode('!!!')).toBe('');
    expect(normalizeChallengeCode('   ')).toBe('');
  });
});

describe('isValidChallengeCode', () => {
  it('accepts a full-length code from the alphabet', () => {
    expect(isValidChallengeCode(CODE)).toBe(true);
  });

  it('rejects wrong lengths and out-of-alphabet characters', () => {
    expect(isValidChallengeCode('A2B3C4D5E')).toBe(false);
    expect(isValidChallengeCode('A2B3C4D5E6F')).toBe(false);
    expect(isValidChallengeCode('A2B3C4D5EO')).toBe(false);
    expect(isValidChallengeCode('')).toBe(false);
  });
});

describe('parseChallengeCodeFromUrl', () => {
  it('reads the path form', () => {
    expect(parseChallengeCodeFromUrl(`https://roam.example/challenge/${CODE}`)).toBe(CODE);
    expect(parseChallengeCodeFromUrl(`/challenge/${CODE}`)).toBe(CODE);
    // A trailing slash or extra segment is still the same challenge.
    expect(parseChallengeCodeFromUrl(`/challenge/${CODE}/`)).toBe(CODE);
  });

  it('reads the query fallback form', () => {
    expect(parseChallengeCodeFromUrl(`https://roam.example/?c=${CODE}`)).toBe(CODE);
    expect(parseChallengeCodeFromUrl(`?c=${CODE}`)).toBe(CODE);
    expect(parseChallengeCodeFromUrl(`c=${CODE}`)).toBe(CODE);
  });

  it('normalizes a hand-typed link', () => {
    expect(parseChallengeCodeFromUrl('/challenge/a2b3c4d5e6')).toBe(CODE);
  });

  it('returns null rather than a broken code for junk', () => {
    // A malformed link must land the player on the home screen, not on an error
    // screen they cannot explain.
    expect(parseChallengeCodeFromUrl('https://roam.example/')).toBeNull();
    expect(parseChallengeCodeFromUrl('/challenge/short')).toBeNull();
    expect(parseChallengeCodeFromUrl('?c=nope')).toBeNull();
    expect(parseChallengeCodeFromUrl('')).toBeNull();
    expect(parseChallengeCodeFromUrl(null)).toBeNull();
    expect(parseChallengeCodeFromUrl(undefined)).toBeNull();
  });

  it('does not confuse a room invite with a challenge link', () => {
    expect(parseChallengeCodeFromUrl('https://roam.example/?room=ABC234')).toBeNull();
  });

  it('survives a percent-encoded path', () => {
    expect(parseChallengeCodeFromUrl(`/challenge/${encodeURIComponent(CODE)}`)).toBe(CODE);
  });
});

describe('link building', () => {
  it('builds the shareable path link', () => {
    expect(buildChallengeUrl(CODE, 'https://roam.example')).toBe(
      `https://roam.example/challenge/${CODE}`,
    );
  });

  it('builds the rewrite-free query link', () => {
    expect(buildChallengeQueryUrl(CODE, 'https://roam.example')).toBe(
      `https://roam.example/?c=${CODE}`,
    );
  });

  it('round-trips both forms', () => {
    expect(parseChallengeCodeFromUrl(buildChallengeUrl(CODE, 'https://roam.example'))).toBe(CODE);
    expect(parseChallengeCodeFromUrl(buildChallengeQueryUrl(CODE, 'https://roam.example'))).toBe(
      CODE,
    );
  });

  it('drops any existing query or hash from the origin', () => {
    expect(buildChallengeUrl(CODE, 'https://roam.example/?room=ABC234#x')).toBe(
      `https://roam.example/challenge/${CODE}`,
    );
  });
});
