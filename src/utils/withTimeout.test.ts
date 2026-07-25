import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('resolves with the underlying value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects with the underlying error when it rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the promise never settles in time', async () => {
    vi.useFakeTimers();
    const hung = new Promise(() => {}); // never resolves/rejects
    const raced = withTimeout(hung, 5000);
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    vi.useRealTimers();
  });

  it('never leaves a dangling timer once the promise settles (no stray rejection)', async () => {
    vi.useFakeTimers();
    const fast = Promise.resolve('fast');
    await withTimeout(fast, 5000);
    // Advancing well past the timeout after settling must not throw/reject anything.
    await vi.advanceTimersByTimeAsync(10000);
    vi.useRealTimers();
  });
});
