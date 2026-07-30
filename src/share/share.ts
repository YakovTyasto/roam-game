/**
 * Sharing, with honest fallbacks.
 *
 * Three levels, tried in order:
 *   1. `navigator.share` — the native sheet. Only on a secure context, only from
 *      a user gesture, and only when the browser says it can handle the payload
 *      (`canShare`), because iOS Safari rejects a share with files it does not
 *      support *after* the sheet opens, which looks like a crash to the player.
 *   2. `navigator.clipboard.writeText` — copy the text/link.
 *   3. A hidden `<textarea>` + `document.execCommand('copy')` — deprecated, but
 *      still the only thing that works in older iOS Safari and in a non-secure
 *      context, which is exactly where the first two fail.
 *
 * The result says which level was used so the UI can tell the truth: "Shared",
 * "Link copied", or "Couldn't share — here is the link". A silent no-op after a
 * tap is the one outcome this must never produce.
 *
 * A cancelled native share is NOT a failure: the user chose to dismiss it, and
 * falling through to "copied to clipboard" would be doing something they just
 * declined.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unsupported';

export interface ShareResult {
  outcome: ShareOutcome;
  /** Set when nothing could be done automatically — show the text to copy. */
  fallbackText?: string;
}

export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
  /** Optional image (e.g. a result card). Skipped when the platform can't take it. */
  files?: File[];
}

/** What a clipboard fallback should copy: the URL if there is one, else the text. */
function copyText(payload: SharePayload): string {
  return [payload.text, payload.url].filter(Boolean).join(' ').trim();
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or a non-secure context. Fall through.
    }
  }

  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    // Off-screen but still focusable/selectable — `display: none` would break
    // the selection execCommand needs, and a visible element would flash.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Share `payload`, falling back as described above. Must be called directly from
 * a user gesture — both `navigator.share` and the clipboard require one.
 */
export async function share(payload: SharePayload): Promise<ShareResult> {
  const text = copyText(payload);

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    // Ask first when files are involved: iOS Safari opens the sheet and *then*
    // rejects unsupported files, which reads as a broken app.
    const shareable: SharePayload = { ...payload };
    if (shareable.files?.length && nav.canShare && !nav.canShare({ files: shareable.files })) {
      delete shareable.files;
    }
    try {
      await nav.share(shareable);
      return { outcome: 'shared' };
    } catch (err) {
      // The user dismissed the sheet. Respect that instead of copying anyway.
      if (isAbortError(err)) return { outcome: 'cancelled' };
      // Anything else (NotAllowedError, unsupported payload) → try to copy.
    }
  }

  if (await copyToClipboard(text)) return { outcome: 'copied' };

  // Nothing worked. Hand the text back so the UI can show it for manual copying
  // rather than pretending the tap did something.
  return { outcome: 'unsupported', fallbackText: text };
}

/** Copy a link/text without offering the native sheet (an explicit "Copy" button). */
export async function copyLink(text: string): Promise<ShareResult> {
  if (await copyToClipboard(text)) return { outcome: 'copied' };
  return { outcome: 'unsupported', fallbackText: text };
}
