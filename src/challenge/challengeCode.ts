/**
 * Challenge codes and links.
 *
 * A challenge code is 10 characters from the same unambiguous alphabet as room
 * codes: no 0 or O, no 1, I or L. Because BOTH members of each confusable pair
 * are excluded, a misread character has no valid counterpart to be "corrected"
 * to — so normalization drops it, the code fails validation, and the player sees
 * a clear error. Guessing an intended character would be worse than useless
 * here: it could silently open a different, valid challenge.
 *
 * Two link shapes are supported on purpose:
 *   • `/challenge/<CODE>` — the shareable one. Needs an SPA rewrite so a direct
 *     browser navigation reaches index.html (see vercel.json).
 *   • `?c=<CODE>` — a fallback that works on any static host with no rewrite at
 *     all, and the shape the app falls back to if a rewrite is ever missing.
 */

export const CHALLENGE_CODE_LENGTH = 10;
export const CHALLENGE_QUERY_PARAM = 'c';
export const CHALLENGE_PATH_PREFIX = '/challenge/';

/**
 * The alphabet the server generates from (see roam_gen_challenge_code). Must
 * stay in sync with that function — codes are generated server-side.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Uppercase and keep only alphabet characters, so spaces, dashes and the
 * decorations people add when copying a code by hand are ignored. Anything else
 * — including a confusable like O or l — is dropped, which shortens the code and
 * makes it fail validation. Never throws.
 */
export function normalizeChallengeCode(raw: string): string {
  const upper = (raw ?? '').toUpperCase();
  let out = '';
  for (const ch of upper) {
    if (ALPHABET.includes(ch)) out += ch;
    if (out.length >= CHALLENGE_CODE_LENGTH) break;
  }
  return out;
}

export function isValidChallengeCode(code: string): boolean {
  return (
    code.length === CHALLENGE_CODE_LENGTH && [...code].every((ch) => ALPHABET.includes(ch))
  );
}

/**
 * Pull a challenge code out of a URL, a path, or a bare query string. Returns
 * null when there isn't a well-formed one — a malformed code is treated as "no
 * code", so a stray link never sends the player into an error screen on load.
 */
export function parseChallengeCodeFromUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  let pathname = '';
  let search = '';
  try {
    const url = new URL(input, 'http://local.invalid');
    pathname = url.pathname;
    search = url.search;
  } catch {
    search = input;
  }

  if (pathname.startsWith(CHALLENGE_PATH_PREFIX)) {
    const raw = pathname.slice(CHALLENGE_PATH_PREFIX.length).split('/')[0];
    const code = normalizeChallengeCode(decodeURIComponent(raw));
    if (isValidChallengeCode(code)) return code;
  }

  const qs = search || (input.includes('=') ? input : '');
  if (qs) {
    const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
    const raw = params.get(CHALLENGE_QUERY_PARAM);
    if (raw) {
      const code = normalizeChallengeCode(raw);
      if (isValidChallengeCode(code)) return code;
    }
  }

  return null;
}

/**
 * Build the shareable URL for a code. Uses the path form, which is the one
 * meant to be seen; `origin` defaults to the current page's.
 */
export function buildChallengeUrl(code: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://roam.example');
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.pathname = `${CHALLENGE_PATH_PREFIX}${code}`;
  return url.toString();
}

/** The rewrite-free fallback form, for hosts without SPA rewrites. */
export function buildChallengeQueryUrl(code: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://roam.example');
  const url = new URL(base);
  url.pathname = '/';
  url.hash = '';
  url.search = '';
  url.searchParams.set(CHALLENGE_QUERY_PARAM, code);
  return url.toString();
}
