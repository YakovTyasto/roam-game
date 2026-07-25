/**
 * Race a promise against a bounded timeout. Used anywhere a network round
 * trip gates the UI's very first interactive state (see profile bootstrap in
 * useProfile.ts) — a hung `fetch()` (cold backend, DNS/CORS misconfiguration,
 * a stalled connection) must never leave the app stuck behind a spinner with
 * no working buttons forever. Does not cancel the underlying operation (no
 * AbortController plumbing through the Supabase client) — it only stops
 * *waiting* on it, which is what unblocks the UI.
 */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
