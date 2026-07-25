import { describe, expect, it } from 'vitest';
import { friendlyRateLimitMessage, isRateLimitedError, toFriendlyErrorMessage } from './rateLimit';

describe('isRateLimitedError', () => {
  it('detects the stable RATE_LIMITED prefix anywhere in the message', () => {
    expect(isRateLimitedError('RATE_LIMITED: mp_create_room (max 3 per 60 seconds)')).toBe(true);
    expect(isRateLimitedError('some wrapper: RATE_LIMITED: foo')).toBe(true);
  });

  it('is false for unrelated errors, null, undefined, and empty strings', () => {
    expect(isRateLimitedError('Invalid difficulty.')).toBe(false);
    expect(isRateLimitedError(null)).toBe(false);
    expect(isRateLimitedError(undefined)).toBe(false);
    expect(isRateLimitedError('')).toBe(false);
  });
});

describe('toFriendlyErrorMessage', () => {
  it('replaces a rate-limit error with a stable, user-friendly message', () => {
    expect(toFriendlyErrorMessage('RATE_LIMITED: roam_upsert_profile:burst (max 5 per 60 seconds)')).toBe(
      friendlyRateLimitMessage(),
    );
  });

  it('passes through any other error unchanged', () => {
    expect(toFriendlyErrorMessage('Enter a display name.')).toBe('Enter a display name.');
  });
});
