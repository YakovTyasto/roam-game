import { isRateLimitedError } from '../utils/rateLimit';
import type { ErrorCode, NormalizedError } from './types';

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

function isOfflineLike(message: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed')
  );
}

function classify(message: string): { code: ErrorCode; userMessage: string } {
  if (isRateLimitedError(message)) {
    return { code: 'rate_limited', userMessage: "You're doing that too often — please wait a moment and try again." };
  }
  if (isOfflineLike(message)) {
    return { code: 'offline', userMessage: 'You appear to be offline. Check your connection and try again.' };
  }
  if (/not configured/i.test(message)) {
    return { code: 'not_configured', userMessage: 'This feature isn’t set up yet.' };
  }
  if (/must be signed in|anonymous sign-in|anonymous session/i.test(message)) {
    return { code: 'auth_unavailable', userMessage: 'Could not verify your session. Please try again.' };
  }
  if (/not found/i.test(message)) {
    return { code: 'not_found', userMessage: 'That no longer exists — it may have expired or been removed.' };
  }
  if (/invalid|must contain|must be between|enter a|required/i.test(message)) {
    return { code: 'validation', userMessage: message || GENERIC_MESSAGE };
  }
  if (message.length > 0) {
    return { code: 'server_rejected', userMessage: GENERIC_MESSAGE };
  }
  return { code: 'unknown', userMessage: GENERIC_MESSAGE };
}

/**
 * Turn any thrown value into a stable, typed shape. `devMessage` is safe to
 * log; `userMessage` is safe to show a player — it never contains a raw
 * database/network message except for validation errors we already write in
 * plain, player-facing language ourselves (see the RPCs' own `raise
 * exception` text).
 */
export function normalizeError(err: unknown): NormalizedError {
  const raw = extractMessage(err);
  const { code, userMessage } = classify(raw);
  return { code, userMessage, devMessage: raw || GENERIC_MESSAGE };
}
