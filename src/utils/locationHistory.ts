/**
 * Persistent, versioned record of recently played location ids — a
 * cross-match cooldown shared by solo and multiplayer selection so the same
 * spot doesn't resurface right away. This module only stores/reads ids; the
 * actual preference logic lives in `selectRounds.ts`.
 */

export const LOCATION_HISTORY_KEY = 'roam.locationHistory.v1';

/** Maximum number of unique location ids retained, newest-first. */
export const LOCATION_HISTORY_LIMIT = 100;

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
