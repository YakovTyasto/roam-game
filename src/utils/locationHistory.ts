/**
 * Persistent, versioned record of recently played **canonical group ids** — a
 * cross-match cooldown shared by solo and multiplayer selection so the same
 * place doesn't resurface right away. This module only stores/reads ids; the
 * selection logic lives in `diversity/`.
 *
 * V4 note: entries are canonical *group* ids (see `utils/canonicalGroup.ts`),
 * not raw location ids, so two catalog rows for one place consume one slot.
 * The storage format and key are unchanged because a group id defaults to the
 * location's own id — every value written by V3 is still a valid group id, so
 * existing installs keep their cooldown instead of resetting to zero.
 *
 * This is the *local* cache. From V4 it is backed by an authenticated
 * server-side history (see `diversity/historyApi.ts`) so novelty survives a
 * reinstall or a second device; the local copy remains the offline and
 * not-configured source of truth, and is always readable without a network
 * round-trip so it can never block first paint.
 */

import { HISTORY_LIMIT_GROUPS } from '../config/diversity';

export const LOCATION_HISTORY_KEY = 'roam.locationHistory.v1';

/** Maximum number of unique canonical group ids retained, newest-first. */
export const LOCATION_HISTORY_LIMIT = HISTORY_LIMIT_GROUPS;

interface StoredLocationHistory {
  version: 1;
  ids: string[];
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function dedupeIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Recently played location ids, newest-first. Safe against unavailable,
 * malformed, or otherwise corrupt storage — always falls back to `[]`.
 */
export function readLocationHistory(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCATION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredLocationHistory> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ids)) return [];
    return dedupeIds(parsed.ids).slice(0, LOCATION_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record a completed selection's location ids as most-recently-played.
 * Newly played ids move to the front of the history; the merged list is
 * deduped and capped at `LOCATION_HISTORY_LIMIT` unique ids. No-op when
 * storage is unavailable — never throws.
 */
export function recordPlayedLocations(ids: readonly string[]): void {
  const played = dedupeIds(ids);
  if (played.length === 0) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    const merged = dedupeIds([...played, ...readLocationHistory()]).slice(
      0,
      LOCATION_HISTORY_LIMIT,
    );
    const payload: StoredLocationHistory = { version: 1, ids: merged };
    storage.setItem(LOCATION_HISTORY_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable or full — history simply won't persist */
  }
}

/** Clear all recently played location history ("Reset recently played locations"). */
export function resetLocationHistory(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(LOCATION_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
