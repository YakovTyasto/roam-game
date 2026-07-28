/**
 * Shuffle-bag cycling — the replacement for repeated independent random draws.
 *
 * The V3 selector drew fresh randomness every game and leaned on a "recently
 * played" list to suppress repeats. That degrades badly on a small catalog: as
 * soon as the history covers the pool, the suppression has nothing left to
 * prefer and the selector falls back to a deterministic least-recently-played
 * order — the same places, in the same rotation, forever.
 *
 * A shuffle bag inverts the guarantee. Every eligible canonical group is dealt
 * exactly once before any group is dealt a second time, and each new cycle is
 * reshuffled. Coverage is a property of the structure rather than something the
 * randomness is asked to approximate.
 *
 * Design notes:
 *   • The bag holds **canonical group ids**, never location ids — see
 *     `utils/canonicalGroup.ts`. Two entries for one place consume one slot.
 *   • State is the set of groups already dealt *in the current cycle*, so it is
 *     bounded by the pool size and self-clears on cycle completion. There is no
 *     unbounded log.
 *   • Drawing is pure and never mutates state. The caller commits the returned
 *     state only once the round has genuinely started, so an abandoned game or
 *     a failed panorama lookup never burns freshness.
 *   • Order is always produced by a Fisher–Yates shuffle over an injectable
 *     RNG. Nothing is ever ordered by id, so selection cannot be predicted from
 *     public sequential identifiers.
 */

import { STANDARD_ROUND_COUNT } from '../config/diversity';

/** Persisted state of one bag. Bounded by the size of its pool. */
export interface BagState {
  /** Canonical group ids already dealt in the current cycle. */
  drawn: readonly string[];
  /** Completed cycles. Diagnostics only — never affects selection. */
  cycle: number;
}

/** A bag that has dealt nothing yet. */
export const EMPTY_BAG: BagState = { drawn: [], cycle: 0 };

export interface BagDraw<T> {
  /** The chosen items, in play order. Never contains two items of one group. */
  picked: T[];
  /**
   * Ordered spares beyond `count`, for transparently replacing a pick whose
   * panorama cannot be resolved. Drawn from the same ranking, so a spare is as
   * fresh as the pick it replaces.
   */
  backups: T[];
  /** State to persist *after* the round(s) actually start. */
  nextState: BagState;
  /** True when the draw exhausted the cycle and reshuffled into a new one. */
  startedNewCycle: boolean;
}

/**
 * In-place Fisher–Yates shuffle of the first `n` positions. `rng` must return
 * a value in [0, 1). Exported for reuse — the codebase must never use the
 * `sort(() => Math.random() - 0.5)` idiom, which is neither uniform nor a
 * shuffle.
 */
export function fisherYatesShuffle<T>(items: readonly T[], rng: () => number, n?: number): T[] {
  const out = [...items];
  const limit = Math.min(n ?? out.length, out.length);
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(rng() * (out.length - i));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * How many history entries count as "equally recent".
 *
 * Ordering the seen items by their exact history position would be a *total*
 * order, and a total order is deterministic — which is precisely the V3 failure
 * this module exists to fix. Once a small catalog is fully covered by history,
 * strict least-recently-played ordering serves the same places in the same
 * rotation forever, and the reshuffle at each new cycle achieves nothing.
 *
 * History is recorded one entry per round, so a block of `STANDARD_ROUND_COUNT`
 * entries is roughly "one game ago". Bucketing at that granularity keeps the
 * meaningful preference (a place from ten games back beats one from last game)
 * while leaving the order inside a bucket genuinely random.
 */
export const RECENCY_BUCKET_SIZE = STANDARD_ROUND_COUNT;

/**
 * Rank candidates by novelty: never-recently-seen items first (shuffled), then
 * recently-seen ones oldest-bucket-first, shuffled within each bucket.
 *
 * Within a bag cycle this is a tie-break, not the main mechanism — but it is
 * what makes a *fresh* bag (new device, cleared storage, a brand-new
 * collection) still respect the player's cross-device history from the very
 * first game.
 *
 * `recentKeys` is newest-first, exactly as stored by the history layer.
 */
export function orderByNovelty<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  recentKeys: readonly string[],
  rng: () => number,
): T[] {
  const rank = new Map<string, number>();
  recentKeys.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });

  const fresh: T[] = [];
  const seen: T[] = [];
  for (const item of items) {
    (rank.has(keyOf(item)) ? seen : fresh).push(item);
  }

  // Shuffle first, then stable-sort by recency *bucket*: items in the same
  // bucket keep their randomised order instead of a fixed one.
  const bucketOf = (item: T): number =>
    Math.floor((rank.get(keyOf(item)) ?? 0) / RECENCY_BUCKET_SIZE);
  const shuffledSeen = fisherYatesShuffle(seen, rng);
  shuffledSeen.sort((a, b) => bucketOf(b) - bucketOf(a));

  return [...fisherYatesShuffle(fresh, rng), ...shuffledSeen];
}

/**
 * Fold `keys` into the bag, wrapping into a new cycle whenever the pool is
 * exhausted or a group repeats. Pure; safe to apply key-by-key as rounds start,
 * or in one go — both produce the same state for the same key order.
 *
 * Keys outside `poolKeys` are ignored: a location can leave the catalog, and a
 * stale id must not wedge the cycle.
 */
export function markDrawn(
  state: BagState,
  keys: readonly string[],
  poolKeys: ReadonlySet<string>,
): BagState {
  // Prune first — a shrunken pool must not leave the bag permanently "full".
  let drawn = new Set([...state.drawn].filter((key) => poolKeys.has(key)));
  let cycle = state.cycle;

  for (const key of keys) {
    if (!poolKeys.has(key)) continue;
    if (drawn.has(key)) {
      // A repeat means the previous cycle is over: start a new one holding it.
      drawn = new Set([key]);
      cycle += 1;
      continue;
    }
    drawn.add(key);
    if (drawn.size >= poolKeys.size) {
      // Cycle complete — reshuffle by clearing, which also bounds storage.
      drawn = new Set();
      cycle += 1;
    }
  }

  return { drawn: [...drawn], cycle };
}

export interface DrawOptions<T> {
  /** Eligible items (already filtered by difficulty and collection). */
  items: readonly T[];
  /** How many rounds are needed. Capped at `items.length`. */
  count: number;
  /** Canonical group id of an item. Two items may share one. */
  keyOf: (item: T) => string;
  /** Current bag state. */
  state: BagState;
  /** Recently played group ids, newest-first. */
  recentKeys?: readonly string[];
  /** Injectable RNG in [0, 1). */
  rng?: () => number;
  /** How many ordered spares to return alongside the picks. */
  backupCount?: number;
  /**
   * Optional re-ordering of the ranked candidates, applied *after* novelty
   * ranking and *before* the picks are taken. This is where the soft in-match
   * geographic diversity rules plug in; it may only reorder, never add or
   * remove, and must always terminate.
   *
   * It is applied **separately either side of the cycle boundary**, so a soft
   * preference can never reach into the next cycle while the current one still
   * owes places — see `drawFromBag`. `alreadyPicked` carries the picks made
   * before this segment so the second call can still honour rules that depend
   * on the whole match (e.g. "no two consecutive rounds in one country").
   */
  arrange?: (ranked: T[], count: number, alreadyPicked: readonly T[]) => T[];
}

/**
 * Deal `count` items, preferring groups not yet dealt in the current cycle.
 *
 * Guarantees, in order of precedence:
 *   1. No two picks share a canonical group (no duplicates within a match).
 *   2. Every eligible group is dealt once before any is dealt again, provided
 *      the pool is large enough for the requested count.
 *   3. Within those constraints, order is shuffled — never derived from ids.
 *
 * When the pool is smaller than `count`, the whole pool is returned rather than
 * failing: a short game beats no game, and uniqueness still holds.
 */
export function drawFromBag<T>(options: DrawOptions<T>): BagDraw<T> {
  const {
    items,
    keyOf,
    state,
    recentKeys = [],
    rng = Math.random,
    backupCount = 0,
    arrange,
  } = options;

  // One representative per canonical group: this is what makes "no duplicate
  // places in a match" true even when the catalog holds several rows per place.
  const byGroup = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!byGroup.has(key)) byGroup.set(key, item);
  }
  const unique = [...byGroup.values()];
  const poolKeys = new Set(byGroup.keys());

  const count = Math.min(Math.max(0, Math.floor(options.count)), unique.length);
  if (count === 0) {
    return { picked: [], backups: [], nextState: state, startedNewCycle: false };
  }

  const alreadyDrawn = new Set([...state.drawn].filter((key) => poolKeys.has(key)));
  const inCycle = unique.filter((item) => !alreadyDrawn.has(keyOf(item)));
  const usedThisCycle = unique.filter((item) => alreadyDrawn.has(keyOf(item)));

  const rankedInCycle = orderByNovelty(inCycle, keyOf, recentKeys, rng);
  const startedNewCycle = rankedInCycle.length < count;

  // Anything after the current cycle's remainder belongs to the *next* cycle,
  // reshuffled independently so the new cycle isn't a continuation of the old
  // ordering.
  const rankedNextCycle = orderByNovelty(usedThisCycle, keyOf, recentKeys, rng);

  // The soft arrangement is applied to each side of the cycle boundary
  // separately, and never across it. Arranging the concatenated list would let
  // a soft geographic preference pull a place from the *next* cycle while the
  // current one still owed places — silently trading the bag's coverage
  // guarantee for a nicer-looking country spread. Soft rules are subordinate
  // to the bag, so the boundary is enforced structurally rather than trusted.
  const fromCycle = Math.min(count, rankedInCycle.length);
  const firstSegment = applyArrange(rankedInCycle, fromCycle, [], keyOf, arrange);
  const firstPicks = firstSegment.slice(0, fromCycle);
  const secondSegment = applyArrange(
    rankedNextCycle,
    count - fromCycle,
    firstPicks,
    keyOf,
    arrange,
  );

  const usable = [...firstSegment, ...secondSegment];
  const picked = usable.slice(0, count);
  const backups = usable.slice(count, count + Math.max(0, backupCount));

  return {
    picked,
    backups,
    nextState: markDrawn(state, picked.map(keyOf), poolKeys),
    startedNewCycle,
  };
}

/**
 * Run the soft arrangement over one segment, rejecting anything that isn't a
 * permutation of its input.
 *
 * `arrange` is a hook: a future rule, or a caller-supplied one, could add,
 * drop or duplicate entries by mistake. Uniqueness within a match is a hard
 * guarantee, so a misbehaving hook falls back to the trusted ranking rather
 * than being allowed to break it.
 */
function applyArrange<T>(
  ranked: readonly T[],
  count: number,
  alreadyPicked: readonly T[],
  keyOf: (item: T) => string,
  arrange?: (ranked: T[], count: number, alreadyPicked: readonly T[]) => T[],
): T[] {
  if (!arrange || ranked.length === 0) return [...ranked];
  const arranged = arrange([...ranked], count, alreadyPicked);
  const sameSize = arranged.length === ranked.length;
  const sameMembers =
    sameSize && new Set(arranged.map(keyOf)).size === new Set(ranked.map(keyOf)).size;
  return sameMembers ? arranged : [...ranked];
}

/** Groups still undealt in the current cycle. Useful for tests and diagnostics. */
export function remainingInCycle(state: BagState, poolKeys: ReadonlySet<string>): number {
  const drawn = [...state.drawn].filter((key) => poolKeys.has(key));
  return Math.max(0, poolKeys.size - drawn.length);
}
