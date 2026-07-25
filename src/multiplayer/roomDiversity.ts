/**
 * Room-wide location novelty for multiplayer selection.
 *
 * Selection stays host-authoritative (the host builds the manifest, the server
 * validates and stores it), so this layer's job is to give the host a *better
 * ranking* — one that accounts for what the whole room has played recently, not
 * just the host.
 *
 * The room aggregate arrives from `roam_room_recent_groups` (migration 0012) as
 * counts over the *other* participants, with no identities and no coordinates.
 * The host never learns who saw what; see the privacy model in that migration.
 *
 * ### Scored fallback, not failure
 *
 * A room of eight players will often have collectively seen most of the pool.
 * Refusing to start would be absurd, so candidates are *ranked* and the best
 * available tier wins:
 *
 *   1. places nobody in the room has played recently;
 *   2. places fresh for most of the room (low `seen_by`);
 *   3. otherwise, least-recently-played first;
 *   4. adjacent difficulty, only if the requested pool cannot fill the game
 *      (unchanged, handled by `buildDifficultyPool`).
 *
 * Tiers 1–3 are expressed as a single ordered "recent keys" list, because that
 * is exactly what `orderByNovelty` consumes: entries absent from the list rank
 * first (tier 1), and entries present rank by position (tiers 2–3). Building
 * one list instead of a bespoke scorer keeps solo and multiplayer on the same
 * tested ranking code.
 */

/** One row of the room aggregate. Contains no identities. */
export interface RoomRecentGroup {
  groupId: string;
  /** How many *other* participants have played it recently. */
  seenBy: number;
  /** Most recent play across those participants, as an epoch millisecond. */
  lastPlayedAt: number;
}

export interface RoomRecentGroups {
  /** False when the room was too small to anonymise the aggregate. */
  applied: boolean;
  /** Why, when `applied` is false. */
  reason: string;
  /** How many other participants the counts range over. */
  participantsConsidered: number;
  groups: RoomRecentGroup[];
}

export const EMPTY_ROOM_RECENT: RoomRecentGroups = {
  applied: false,
  reason: 'unavailable',
  participantsConsidered: 0,
  groups: [],
};

/**
 * Parse the RPC payload defensively. Anything unexpected degrades to "not
 * applied", so a malformed or hostile response can only ever cost the room some
 * novelty — never break a match start.
 */
export function parseRoomRecentGroups(data: unknown): RoomRecentGroups {
  if (!data || typeof data !== 'object') return EMPTY_ROOM_RECENT;
  const raw = data as Record<string, unknown>;
  if (raw.applied !== true) {
    return {
      ...EMPTY_ROOM_RECENT,
      reason: typeof raw.reason === 'string' ? raw.reason : 'unavailable',
    };
  }

  const rows = Array.isArray(raw.groups) ? raw.groups : [];
  const groups: RoomRecentGroup[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.group_id !== 'string' || r.group_id.length === 0) continue;
    const seenBy = typeof r.seen_by === 'number' && Number.isFinite(r.seen_by) ? r.seen_by : 1;
    const parsedAt =
      typeof r.last_played_at === 'string' ? Date.parse(r.last_played_at) : Number.NaN;
    groups.push({
      groupId: r.group_id,
      seenBy: Math.max(0, Math.floor(seenBy)),
      lastPlayedAt: Number.isFinite(parsedAt) ? parsedAt : 0,
    });
  }

  return {
    applied: true,
    reason: 'ok',
    participantsConsidered:
      typeof raw.participants_considered === 'number' && Number.isFinite(raw.participants_considered)
        ? raw.participants_considered
        : 0,
    groups,
  };
}

/**
 * Fold the room aggregate together with the host's own local history into one
 * ordered "recently played" list, worst-first (index 0 is the place the room
 * would least like to see again).
 *
 * Ordering key, in precedence order:
 *   1. how many participants have seen it (the host counts as one);
 *   2. how recently it was last seen.
 *
 * The host's local history is included because their own plays are not in the
 * room aggregate by design — the RPC excludes the caller so they cannot
 * subtract themselves back out to identify anyone else.
 */
export function buildRoomRecentKeys(
  room: RoomRecentGroups,
  hostRecentGroupIds: readonly string[],
): string[] {
  interface Entry {
    seenBy: number;
    lastPlayedAt: number;
  }
  const scores = new Map<string, Entry>();

  for (const group of room.groups) {
    scores.set(group.groupId, { seenBy: group.seenBy, lastPlayedAt: group.lastPlayedAt });
  }

  // The host's local history is newest-first and has no timestamps, so position
  // stands in for recency: index 0 is the most recent. Scaling by a large
  // constant keeps host recency comparable with real timestamps without either
  // signal swamping the other, since `seenBy` is the primary key anyway.
  hostRecentGroupIds.forEach((groupId, index) => {
    const hostRecency = hostRecentGroupIds.length - index;
    const existing = scores.get(groupId);
    if (existing) {
      existing.seenBy += 1;
      existing.lastPlayedAt = Math.max(existing.lastPlayedAt, hostRecency);
    } else {
      scores.set(groupId, { seenBy: 1, lastPlayedAt: hostRecency });
    }
  });

  return [...scores.entries()]
    .sort((a, b) => {
      if (b[1].seenBy !== a[1].seenBy) return b[1].seenBy - a[1].seenBy;
      if (b[1].lastPlayedAt !== a[1].lastPlayedAt) return b[1].lastPlayedAt - a[1].lastPlayedAt;
      // Deterministic final tie-break so two hosts with identical inputs rank
      // identically — but never the *primary* key, so ids stay unpredictable.
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([groupId]) => groupId);
}
