import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROOM_RECENT,
  buildRoomRecentKeys,
  parseRoomRecentGroups,
  type RoomRecentGroups,
} from './roomDiversity';
import { selectRounds } from '../diversity/engine';
import { seededRng } from '../diversity/__fixtures__/rng';
import type { GameLocation } from '../types';

const iso = (offsetMinutes: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - offsetMinutes * 60_000).toISOString();

function payload(groups: { group_id: string; seen_by: number; last_played_at: string }[]) {
  return { applied: true, reason: 'ok', participants_considered: 3, groups };
}

describe('parseRoomRecentGroups', () => {
  it('parses a well-formed payload', () => {
    const parsed = parseRoomRecentGroups(
      payload([{ group_id: 'paris', seen_by: 2, last_played_at: iso(10) }]),
    );
    expect(parsed.applied).toBe(true);
    expect(parsed.participantsConsidered).toBe(3);
    expect(parsed.groups).toEqual([
      { groupId: 'paris', seenBy: 2, lastPlayedAt: Date.parse(iso(10)) },
    ]);
  });

  it('reports a room that was too small to anonymise', () => {
    const parsed = parseRoomRecentGroups({
      applied: false,
      reason: 'too_few_participants',
      participants_considered: 0,
      groups: [],
    });
    expect(parsed.applied).toBe(false);
    expect(parsed.reason).toBe('too_few_participants');
    expect(parsed.groups).toEqual([]);
  });

  it('degrades to "not applied" for junk input', () => {
    for (const junk of [null, undefined, 'nope', 42, {}, { applied: 'yes' }]) {
      expect(parseRoomRecentGroups(junk).applied).toBe(false);
    }
  });

  it('skips malformed rows but keeps valid ones', () => {
    const parsed = parseRoomRecentGroups({
      applied: true,
      reason: 'ok',
      participants_considered: 2,
      groups: [null, { group_id: '' }, { group_id: 'ok', seen_by: 'x', last_played_at: 'nope' }],
    });
    expect(parsed.groups).toEqual([{ groupId: 'ok', seenBy: 1, lastPlayedAt: 0 }]);
  });

  it('never surfaces a user id even if the payload contains one', () => {
    const parsed = parseRoomRecentGroups({
      applied: true,
      reason: 'ok',
      participants_considered: 2,
      groups: [{ group_id: 'x', seen_by: 1, last_played_at: iso(1), user_id: 'leaked-uuid' }],
    });
    expect(JSON.stringify(parsed)).not.toContain('leaked-uuid');
  });
});

describe('buildRoomRecentKeys', () => {
  it('ranks places seen by more of the room as worse', () => {
    const room = parseRoomRecentGroups(
      payload([
        { group_id: 'seen-by-one', seen_by: 1, last_played_at: iso(1) },
        { group_id: 'seen-by-three', seen_by: 3, last_played_at: iso(500) },
      ]),
    );
    // Index 0 is the *worst* candidate. Player count beats recency.
    expect(buildRoomRecentKeys(room, [])).toEqual(['seen-by-three', 'seen-by-one']);
  });

  it('breaks ties on how recently the room saw a place', () => {
    const room = parseRoomRecentGroups(
      payload([
        { group_id: 'older', seen_by: 1, last_played_at: iso(500) },
        { group_id: 'newer', seen_by: 1, last_played_at: iso(1) },
      ]),
    );
    expect(buildRoomRecentKeys(room, [])).toEqual(['newer', 'older']);
  });

  it("counts the host's own history, which the aggregate deliberately omits", () => {
    const room = parseRoomRecentGroups(
      payload([{ group_id: 'guest-place', seen_by: 1, last_played_at: iso(1) }]),
    );
    // The host has played 'shared' too, so it is seen by two people overall.
    const roomWithShared = parseRoomRecentGroups(
      payload([
        { group_id: 'guest-place', seen_by: 1, last_played_at: iso(1) },
        { group_id: 'shared', seen_by: 1, last_played_at: iso(2) },
      ]),
    );
    expect(buildRoomRecentKeys(room, ['host-place'])).toContain('host-place');
    expect(buildRoomRecentKeys(roomWithShared, ['shared'])[0]).toBe('shared');
  });

  it('falls back to host-only history when the aggregate is unavailable', () => {
    expect(buildRoomRecentKeys(EMPTY_ROOM_RECENT, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('is empty when neither source has anything', () => {
    expect(buildRoomRecentKeys(EMPTY_ROOM_RECENT, [])).toEqual([]);
  });

  it('is deterministic for identical inputs', () => {
    const room = parseRoomRecentGroups(
      payload([
        { group_id: 'a', seen_by: 1, last_played_at: iso(5) },
        { group_id: 'b', seen_by: 1, last_played_at: iso(5) },
      ]),
    );
    expect(buildRoomRecentKeys(room, [])).toEqual(buildRoomRecentKeys(room, []));
  });
});

describe('room novelty inside selection', () => {
  const all: GameLocation[] = Array.from({ length: 12 }, (_, i) => ({
    id: `p-${i}`,
    lat: -80 + i * 12,
    lng: -170 + i * 25,
    label: `p-${i}`,
    country: `Country ${i}`,
    continent: (['Europe', 'Asia', 'Africa', 'South America'] as const)[i % 4],
    difficulty: 'normal' as const,
  }));

  const roomHasSeen = (ids: string[]): RoomRecentGroups =>
    parseRoomRecentGroups(
      payload(ids.map((id, i) => ({ group_id: id, seen_by: 2, last_played_at: iso(i) }))),
    );

  it('avoids places the room has collectively played', () => {
    const seen = ['p-0', 'p-1', 'p-2', 'p-3', 'p-4'];
    const result = selectRounds({
      all,
      count: 5,
      recentGroupIds: buildRoomRecentKeys(roomHasSeen(seen), []),
      rng: seededRng(1),
    });
    expect(result.groupIds.filter((id) => seen.includes(id))).toHaveLength(0);
  });

  it('still starts a match when the room has seen almost everything', () => {
    // Eleven of twelve places are burned — a full match must still be dealt.
    const seen = all.slice(0, 11).map((l) => l.id);
    const result = selectRounds({
      all,
      count: 5,
      recentGroupIds: buildRoomRecentKeys(roomHasSeen(seen), []),
      rng: seededRng(2),
    });
    expect(result.locations).toHaveLength(5);
    expect(result.sufficient).toBe(true);
    expect(new Set(result.groupIds).size).toBe(5);
    // The one genuinely fresh place is taken first.
    expect(result.groupIds).toContain('p-11');
  });

  it('prefers the least-recently-played places once everything is burned', () => {
    // All twelve seen; the aggregate is ordered newest-first, so the tail of
    // the list (oldest) must be favoured.
    const seen = all.map((l) => l.id);
    const result = selectRounds({
      all,
      count: 3,
      recentGroupIds: buildRoomRecentKeys(roomHasSeen(seen), []),
      rng: seededRng(3),
    });
    expect(result.locations).toHaveLength(3);
    const positions = result.groupIds.map((id) => seen.indexOf(id));
    // Every pick comes from the older half of the room's history.
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(seen.length / 2 - 1);
  });

  it('gives every player in the room the same locations', () => {
    // Selection is host-authoritative: the manifest the host produces is the
    // single source every client renders, so one draw must serve the room.
    const recent = buildRoomRecentKeys(roomHasSeen(['p-0']), []);
    const hostDraw = selectRounds({ all, count: 5, recentGroupIds: recent, rng: seededRng(7) });
    const replay = selectRounds({ all, count: 5, recentGroupIds: recent, rng: seededRng(7) });
    expect(replay.groupIds).toEqual(hostDraw.groupIds);
  });
});
