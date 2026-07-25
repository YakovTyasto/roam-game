import type { NormalizedError } from './types';

/**
 * Provider-neutral error reporting. Nothing here talks to a paid vendor —
 * by default it only logs to the console in development. To connect Sentry
 * (or any other provider) later, replace the body of `report()` with that
 * provider's SDK call; every call site in this codebase already goes
 * through `reportError`, so no call sites need to change.
 *
 * Never includes: API keys/tokens, full database rows, or precise personal
 * identifiers. `context` should stay to small, non-sensitive hints (a
 * screen name, an action name) — never raw RPC payloads or auth tokens.
 */
export interface ErrorReportContext {
  /** Where the error surfaced, e.g. 'GameScreen', 'mp_create_room'. */
  scope?: string;
  [key: string]: string | number | boolean | undefined;
}

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export function reportError(error: NormalizedError, context: ErrorReportContext = {}): void {
  if (isDev) {
    console.error(`[${error.code}]`, error.devMessage, context);
    return;
  }
  // Production, no provider configured: stay silent rather than spamming the
  // console for real users. Swap this branch for a provider SDK call (e.g.
  // Sentry.captureException) once one is connected — see docs/OPERATIONS.md.
}
