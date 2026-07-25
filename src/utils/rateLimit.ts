/**
 * Client-side recognition of the stable "RATE_LIMITED:" prefix raised by
 * roam_check_rate_limit (see supabase/migrations/0010_rate_limiting.sql).
 * Never parses the exact wording — only the prefix, so server-side copy can
 * change freely without breaking client detection.
 */
const RATE_LIMITED_PREFIX = 'RATE_LIMITED:';

export function isRateLimitedError(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes(RATE_LIMITED_PREFIX);
}

/** A stable, user-friendly message — never exposes the raw database error. */
export function friendlyRateLimitMessage(): string {
  return "You're doing that too often — please wait a moment and try again.";
}

/** Map any error message to a user-facing string, softening rate limits. */
export function toFriendlyErrorMessage(message: string): string {
  return isRateLimitedError(message) ? friendlyRateLimitMessage() : message;
}
