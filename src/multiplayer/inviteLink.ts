import { isValidRoomCode, normalizeRoomCode } from './roomCode';

/** Query-string parameter carrying a room code in an invite link. */
export const ROOM_QUERY_PARAM = 'room';

/**
 * Extract a room code from an invite URL/query string.
 *
 * Accepts a full URL (`https://x.y/?room=ABC234`), a bare query string
 * (`?room=abc234` or `room=abc234`), or a raw search value. Returns the
 * normalised code if present and well-formed, else null. Never throws.
 */
export function parseRoomCodeFromUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  let search = '';
  try {
    // Try to parse as a full/relative URL first.
    const url = new URL(input, 'http://local.invalid');
    search = url.search;
  } catch {
    search = input;
  }

  // Fall back to treating the input as a raw query string.
  const qs = search || input;
  const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const raw = params.get(ROOM_QUERY_PARAM);
  if (!raw) return null;

  const code = normalizeRoomCode(raw);
  return isValidRoomCode(code) ? code : null;
}

/**
 * Build a shareable invite URL for a room code, based on an origin (defaults to
 * the current page origin in the browser). Produces e.g. `https://x.y/?room=ABC234`.
 */
export function buildInviteUrl(code: string, origin?: string): string {
  const base =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://roam.example');
  const url = new URL(base);
  // Preserve any base path (e.g. sub-path deploys) but reset the query.
  url.search = '';
  url.searchParams.set(ROOM_QUERY_PARAM, code);
  return url.toString();
}
