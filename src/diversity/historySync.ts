/**
 * Durable-history synchronisation.
 *
 * The local cache stays the authority for *reads*: selection calls
 * `readDiversityState()` synchronously, with no await and no network, which is
 * what keeps the Diversity Engine off the first-paint critical path. This
 * module's whole job is to keep that cache fed from the server in the
 * background, and to get locally-played places up to the server eventually.
 *
 * Rules it exists to honour:
 *   • **Never block interactivity.** Sync is fire-and-forget, bounded by a
 *     timeout, and every failure path is a no-op. There is no state in which a
 *     slow or hung backend can gate a button, a screen, or a game start.
 *   • **Never lose a played place.** A push that fails goes into a small,
 *     bounded outbox and is retried on the next sync. Losing an entry costs
 *     some novelty, never correctness — so the outbox is deliberately capped
 *     rather than unbounded.
 *   • **Never trust the response.** A malformed payload degrades to "no server
 *     history"; it must not be able to poison the local cache that selection
 *     actually reads.
 */

import { hasSupabaseConfig } from '../config/env';
import type { Difficulty } from '../config/difficulty';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { DEFAULT_COLLECTION } from '../config/collections';
import { HISTORY_LIMIT_GROUPS } from '../config/diversity';
import { withTimeout } from '../utils/withTimeout';
import { readLocationHistory, recordPlayedLocations } from '../utils/locationHistory';
import type { HistoryMeta, HistoryMode } from './historyApi';

/** Bounded queue of pushes that have not reached the server yet. */
export const HISTORY_OUTBOX_KEY = 'roam.locationHistory.outbox.v1';

/** Cap on queued entries. Beyond this the oldest are dropped. */
export const MAX_OUTBOX_ENTRIES = 60;

/**
 * How long a sync may take before it is abandoned. Generous enough for a slow
 * mobile connection, short enough that nothing observable waits on it — and
 * nothing does, because sync never gates the UI.
 */
export const HISTORY_SYNC_TIMEOUT_MS = 8000;

interface OutboxEntry {
  groupId: string;
  difficulty: Difficulty;
  collection: CollectionId;
  mode: HistoryMode;
}

interface StoredOutbox {
  version: 1;
  entries: OutboxEntry[];
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function isMode(value: unknown): value is HistoryMode {
  return (
    value === 'solo' ||
    value === 'endless' ||
    value === 'multiplayer' ||
    value === 'daily' ||
    value === 'challenge' ||
    value === 'streak'
  );
}

function sanitizeEntry(value: unknown): OutboxEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<OutboxEntry>;
  if (typeof raw.groupId !== 'string' || raw.groupId.length === 0) return null;
  return {
    groupId: raw.groupId,
    difficulty:
      raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard'
        ? raw.difficulty
        : DEFAULT_DIFFICULTY,
    collection: typeof raw.collection === 'string' ? (raw.collection as CollectionId) : DEFAULT_COLLECTION,
    mode: isMode(raw.mode) ? raw.mode : 'solo',
  };
}

/** Read the outbox. Malformed storage reads as empty — never throws. */
export function readOutbox(): OutboxEntry[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredOutbox> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .map(sanitizeEntry)
      .filter((e): e is OutboxEntry => e !== null)
      .slice(-MAX_OUTBOX_ENTRIES);
  } catch {
    return [];
  }
}

function writeOutbox(entries: readonly OutboxEntry[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    // Keep the newest entries: a place played five minutes ago matters more to
    // novelty than one played during a long offline stretch.
    const payload: StoredOutbox = { version: 1, entries: entries.slice(-MAX_OUTBOX_ENTRIES) };
    storage.setItem(HISTORY_OUTBOX_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable or full — the entry is simply not retried */
  }
}

function enqueue(entry: OutboxEntry): void {
  const existing = readOutbox().filter((e) => e.groupId !== entry.groupId);
  writeOutbox([...existing, entry]);
}

/** Clear the outbox (used after a successful flush, and by tests). */
export function clearOutbox(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(HISTORY_OUTBOX_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a durable history is even possible in this deployment. */
export function isServerHistoryAvailable(): boolean {
  return hasSupabaseConfig();
}

/**
 * Push one played place to the server, in the background.
 *
 * Fire-and-forget by design: callers must not await it, and it never rejects.
 * A failure queues the entry for the next sync instead of surfacing an error —
 * a durable-history hiccup is not something to interrupt a game for.
 */
export function queueRoundForSync(
  groupId: string,
  meta: Partial<HistoryMeta> & { mode?: HistoryMode } = {},
): void {
  if (!groupId || !isServerHistoryAvailable()) return;
  const entry: OutboxEntry = {
    groupId,
    difficulty: meta.difficulty ?? DEFAULT_DIFFICULTY,
    collection: meta.collection ?? DEFAULT_COLLECTION,
    mode: meta.mode ?? 'solo',
  };

  void (async () => {
    try {
      const { pushLocationHistory } = await import('./historyApi');
      await withTimeout(
        pushLocationHistory([entry.groupId], entry),
        HISTORY_SYNC_TIMEOUT_MS,
      );
    } catch {
      enqueue(entry);
    }
  })();
}

export interface SyncResult {
  /** Entries successfully flushed from the outbox. */
  flushed: number;
  /** Server-side places merged into the local cache. */
  merged: number;
  /** True when sync was skipped (no backend, or it failed). */
  skipped: boolean;
}

/**
 * Reconcile local and server history once, in the background.
 *
 * Merge direction is deliberate: server entries are folded into the local cache
 * *behind* the local ones. Local entries are the places this device played most
 * recently, so they must stay at the front of the recency ranking; the server's
 * contribution is the long tail from other devices.
 *
 * Never throws. Never blocks. Safe to call on every app start.
 */
export async function syncLocationHistory(): Promise<SyncResult> {
  const empty: SyncResult = { flushed: 0, merged: 0, skipped: true };
  if (!isServerHistoryAvailable()) return empty;

  try {
    const { pushLocationHistory, fetchLocationHistory } = await import('./historyApi');

    // 1. Flush anything that failed to reach the server earlier. Grouped by
    //    metadata so a long offline stretch costs a handful of calls, not one
    //    per round.
    let flushed = 0;
    const outbox = readOutbox();
    if (outbox.length > 0) {
      const batches = new Map<string, OutboxEntry[]>();
      for (const entry of outbox) {
        const key = `${entry.difficulty}|${entry.collection}|${entry.mode}`;
        const batch = batches.get(key);
        if (batch) batch.push(entry);
        else batches.set(key, [entry]);
      }
      for (const batch of batches.values()) {
        // The RPC caps a call at 25 ids; chunk to stay inside it.
        for (let i = 0; i < batch.length; i += 25) {
          const chunk = batch.slice(i, i + 25);
          await withTimeout(
            pushLocationHistory(chunk.map((e) => e.groupId), chunk[0]),
            HISTORY_SYNC_TIMEOUT_MS,
          );
          flushed += chunk.length;
        }
      }
      clearOutbox();
    }

    // 2. Pull the durable history and fold it in behind the local entries.
    const server = await withTimeout(fetchLocationHistory(), HISTORY_SYNC_TIMEOUT_MS);
    const local = readLocationHistory();
    const known = new Set(local);
    const additions = server.filter((g) => !known.has(g)).slice(0, HISTORY_LIMIT_GROUPS);
    if (additions.length > 0) {
      // `recordPlayedLocations` prepends, so replaying local-then-server keeps
      // the local entries newest while appending the server's tail.
      recordPlayedLocations([...local, ...additions]);
    }

    return { flushed, merged: additions.length, skipped: false };
  } catch {
    // A failed sync is invisible: the local cache is untouched and selection
    // carries on exactly as it would offline.
    return empty;
  }
}
