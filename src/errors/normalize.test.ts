import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeError } from './normalize';

describe('normalizeError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies a rate-limit error', () => {
    const result = normalizeError(new Error('RATE_LIMITED: mp_create_room (max 3 per 60 seconds)'));
    expect(result.code).toBe('rate_limited');
    expect(result.userMessage).not.toContain('RATE_LIMITED');
  });

  it('classifies a network failure as offline', () => {
    const result = normalizeError(new TypeError('Failed to fetch'));
    expect(result.code).toBe('offline');
  });

  it('classifies navigator.onLine === false as offline regardless of message', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const result = normalizeError(new Error('some unrelated message'));
    expect(result.code).toBe('offline');
  });

  it('classifies a "not configured" error', () => {
    const result = normalizeError(new Error('Multiplayer is not configured.'));
    expect(result.code).toBe('not_configured');
  });

  it('classifies an auth/session error', () => {
    const result = normalizeError(new Error('You must be signed in.'));
    expect(result.code).toBe('auth_unavailable');
  });

  it('classifies a "not found" error', () => {
    const result = normalizeError(new Error('Solo run not found.'));
    expect(result.code).toBe('not_found');
  });

  it('classifies a validation error and preserves the (already player-facing) message', () => {
    const result = normalizeError(new Error('Invalid round count.'));
    expect(result.code).toBe('validation');
    expect(result.userMessage).toBe('Invalid round count.');
  });

  it('falls back to server_rejected for an unrecognized non-empty message', () => {
    const result = normalizeError(new Error('unique_violation on multiplayer_rooms'));
    expect(result.code).toBe('server_rejected');
    expect(result.userMessage).toBe('Something went wrong. Please try again.');
  });

  it('falls back to unknown for a non-Error, non-string thrown value', () => {
    const result = normalizeError({ weird: true });
    expect(result.code).toBe('unknown');
  });

  it('never throws regardless of input shape', () => {
    expect(() => normalizeError(null)).not.toThrow();
    expect(() => normalizeError(undefined)).not.toThrow();
    expect(() => normalizeError(42)).not.toThrow();
    expect(() => normalizeError('a plain string error')).not.toThrow();
  });

  it('always includes a devMessage safe for logging', () => {
    const result = normalizeError(new Error('boom'));
    expect(result.devMessage).toBe('boom');
  });
});
