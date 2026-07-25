import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import type { CollectionId } from '../config/collections';
import { DEFAULT_COLLECTION } from '../config/collections';
import { selectRounds } from '../diversity/engine';
import type { BagState } from '../diversity/shuffleBag';
import { EMPTY_BAG } from '../diversity/shuffleBag';

/**
 * Pick the next single location for an Endless round. Unlike a fixed game
 * (which pre-selects `count` unique locations up front), Endless generates one
 * round at a time — so it asks the Diversity Engine for a single round, passing
 * the session's own canonical groups as a *hard* exclusion.
 *
 * That keeps a session duplicate-free for as long as the pool allows and then,
 * once genuinely exhausted, falls back to repeats rather than stalling the
 * game. Beyond the session, the shuffle bag and cross-match history still apply
 * exactly as they do for fixed games, so a long Endless run does not reset the
 * player's freshness for their next normal game.
 */
export function pickNextEndlessLocation(
  all: readonly GameLocation[],
  difficulty: Difficulty,
  excludeGroupIds: ReadonlySet<string>,
  recentGroupIds: readonly string[] = [],
  rng: () => number = Math.random,
  options: { bag?: BagState; collection?: CollectionId } = {},
): GameLocation | null {
  const request = {
    all,
    count: 1,
    difficulty,
    collection: options.collection ?? DEFAULT_COLLECTION,
    bag: options.bag ?? EMPTY_BAG,
    recentGroupIds,
    rng,
  };

  const fresh = selectRounds({ ...request, excludeGroupIds: [...excludeGroupIds] });
  if (fresh.locations.length > 0) return fresh.locations[0];

  // Session exhausted every distinct place in the pool — allow a repeat rather
  // than ending the run. Uniqueness within a *fixed* match is a hard guarantee;
  // an unbounded Endless session cannot honour it forever and says so.
  const repeat = selectRounds(request);
  return repeat.locations[0] ?? null;
}

/** How often to show the "this uses more Street View quota" notice. */
export const ENDLESS_USAGE_WARNING_INTERVAL = 25;

/** True on round 25, 50, 75, ... (1-based round number just completed). */
export function shouldWarnEndlessUsage(roundNumberCompleted: number): boolean {
  return roundNumberCompleted > 0 && roundNumberCompleted % ENDLESS_USAGE_WARNING_INTERVAL === 0;
}
