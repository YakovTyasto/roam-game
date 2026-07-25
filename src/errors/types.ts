/**
 * Stable internal error codes. These are what code should branch/log on —
 * never raw error messages, which can change wording at any time (Supabase,
 * Postgres, and the browser's own network stack all phrase things
 * differently across versions).
 */
export type ErrorCode =
  | 'offline'
  | 'rate_limited'
  | 'auth_unavailable'
  | 'not_configured'
  | 'not_found'
  | 'validation'
  | 'server_rejected'
  | 'unknown';

export interface NormalizedError {
  code: ErrorCode;
  /** Safe to show a player directly — never a raw database/network message. */
  userMessage: string;
  /** Original message, for development logging / error reporting only. */
  devMessage: string;
}
