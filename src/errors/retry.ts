/**
 * Retry a genuinely idempotent action a bounded number of times with linear
 * backoff. Never use this for a non-idempotent action (e.g. anything that
 * creates a new row without a uniqueness guard) — most RPCs in this codebase
 * already are idempotent by design (leave, abandon, finalize, join), which
 * is what makes retrying them here safe.
 */
export async function retryIdempotent<T>(
  action: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 300;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}
