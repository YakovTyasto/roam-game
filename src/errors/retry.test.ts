import { describe, expect, it, vi } from 'vitest';
import { retryIdempotent } from './retry';

describe('retryIdempotent', () => {
  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryIdempotent(fn, { delayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a failing action up to the attempt cap, then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const result = await retryIdempotent(fn, { attempts: 3, delayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries beyond the configured attempt cap (no infinite loop)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryIdempotent(fn, { attempts: 3, delayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('defaults to a bounded number of attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(retryIdempotent(fn, { delayMs: 1 })).rejects.toThrow();
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fn.mock.calls.length).toBeGreaterThan(0);
  });

  it('clamps attempts to at least 1', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await retryIdempotent(fn, { attempts: 0, delayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
