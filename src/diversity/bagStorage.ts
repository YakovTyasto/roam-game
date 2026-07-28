/**
 * Local persistence for shuffle bags.
 *
 * Bags are per (difficulty, collection) because that is the unit a player
 * experiences as "a pool": finishing the Easy cycle must not consume the Hard
 * cycle's freshness.
 *
 * Storage is deliberately bounded on three axes, because this is client
 * storage that a long-lived install will keep forever:
 *   • at most `MAX_BAGS` bags, evicting the least recently used;
 *   • at most `MAX_DRAWN_PER_BAG` group ids inside one bag (a corrupt or
 *     hand-edited value can't grow without limit — a real bag is bounded by
 *     its pool size, which is far smaller);
 *   • malformed JSON, wrong version, or unavailable storage degrade to "empty
 *     bag", never to a throw. A broken bag costs some variety; a thrown error
 *     during selection would cost the game.
 */

import type { BagState } from './shuffleBag';
import { EMPTY_BAG } from './shuffleBag';
import type { Difficulty } from '../config/difficulty';
import type { CollectionId } from '../config/collections';

export const SHUFFLE_BAG_KEY = 'roam.shuffleBag.v1';

/** 3 difficulties × the collections a player realistically cycles through. */
export const MAX_BAGS = 24;

/** Hard ceiling on ids inside one bag, well above any real pool size. */
export const MAX_DRAWN_PER_BAG = 1000;

interface StoredBag {
  drawn: string[];
  cycle: number;
  /** Epoch ms of the last write — drives LRU eviction only. */
  updatedAt: number;
}

interface StoredBags {
  version: 1;
  bags: Record<string, StoredBag>;
}

/** Stable storage key for a (difficulty, collection) pair. */
export function bagKey(difficulty: Difficulty, collection: CollectionId): string {
  return `${difficulty}:${collection}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitizeBag(value: unknown): StoredBag | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<StoredBag>;
  if (!Array.isArray(raw.drawn)) return null;

  const seen = new Set<string>();
  for (const id of raw.drawn) {
    if (typeof id !== 'string' || id.length === 0) continue;
    seen.add(id);
    if (seen.size >= MAX_DRAWN_PER_BAG) break;
  }

  return {
    drawn: [...seen],
    cycle: typeof raw.cycle === 'number' && Number.isFinite(raw.cycle) && raw.cycle >= 0
      ? Math.floor(raw.cycle)
      : 0,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

function readAll(): Record<string, StoredBag> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(SHUFFLE_BAG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<StoredBags> | null;
    if (!parsed || parsed.version !== 1 || !parsed.bags || typeof parsed.bags !== 'object') {
      return {};
    }
    const out: Record<string, StoredBag> = {};
    for (const [key, value] of Object.entries(parsed.bags)) {
      const bag = sanitizeBag(value);
      if (bag) out[key] = bag;
    }
    return out;
  } catch {
    return {};
  }
}

/** The stored bag for a key, or an empty bag. Never throws. */
export function readBag(key: string): BagState {
  const bag = readAll()[key];
  return bag ? { drawn: bag.drawn, cycle: bag.cycle } : EMPTY_BAG;
}

/**
 * Persist a bag, evicting the least recently used bags beyond `MAX_BAGS`.
 * No-op when storage is unavailable or full — variety degrades, nothing breaks.
 */
export function writeBag(key: string, state: BagState, now: number = Date.now()): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const bags = readAll();
    bags[key] = {
      drawn: [...new Set(state.drawn)].slice(0, MAX_DRAWN_PER_BAG),
      cycle: state.cycle,
      updatedAt: now,
    };

    const entries = Object.entries(bags).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const kept: Record<string, StoredBag> = {};
    for (const [k, v] of entries.slice(0, MAX_BAGS)) kept[k] = v;

    const payload: StoredBags = { version: 1, bags: kept };
    storage.setItem(SHUFFLE_BAG_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable or full — the bag simply won't persist */
  }
}

/** Clear every bag ("Reset recently played locations"). */
export function resetBags(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(SHUFFLE_BAG_KEY);
  } catch {
    /* ignore */
  }
}
