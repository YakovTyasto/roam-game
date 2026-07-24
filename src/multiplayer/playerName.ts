/** Maximum length of a display name, after sanitising. */
export const MAX_PLAYER_NAME_LENGTH = 24;

/**
 * Sanitise a display name to safe plain text:
 *   • drop control characters (C0 range + DEL) and angle brackets
 *     (defence-in-depth against accidental markup; React escapes on render too)
 *   • collapse internal whitespace runs to single spaces
 *   • trim surrounding whitespace
 *   • clamp to MAX_PLAYER_NAME_LENGTH characters
 *
 * The SQL RPC re-applies the same trim + length rules server-side, so this is a
 * convenience for the UI, not the only line of defence.
 */
export function sanitizePlayerName(raw: string): string {
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f;
    const isAngleBracket = ch === '<' || ch === '>';
    if (isControl || isAngleBracket) continue;
    cleaned += ch;
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYER_NAME_LENGTH);
}

/** Whether a (raw) name yields a non-empty, in-bounds display name. */
export function isValidPlayerName(raw: string): boolean {
  const name = sanitizePlayerName(raw);
  return name.length >= 1 && name.length <= MAX_PLAYER_NAME_LENGTH;
}

/**
 * Validate a name and return either the sanitised value or a user-facing error
 * message. Centralises the messaging used by the entry form.
 */
export function validatePlayerName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  if (raw.trim().length === 0) {
    return { ok: false, error: 'Enter a display name.' };
  }
  const name = sanitizePlayerName(raw);
  if (name.length === 0) {
    return { ok: false, error: 'That name has no usable characters.' };
  }
  return { ok: true, name };
}
