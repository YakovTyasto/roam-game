import type { RoomSnapshot } from './types';

/**
 * Choose which of two snapshots to keep, tolerating out-of-order arrival.
 *
 * The client refetches the authoritative snapshot after every Realtime event.
 * Because fetches are async, an older fetch can resolve AFTER a newer one. We
 * order snapshots by `fetchedAt` (the wall-clock time the fetch was initiated)
 * and keep the newest, so a late-resolving stale fetch never clobbers fresher
 * state.
 *
 * Snapshots for a DIFFERENT room are treated as foreign and ignored (the caller
 * is responsible for resetting state when navigating to a new room, e.g. a
 * rematch). This prevents a stale subscription from a previous room from
 * writing into a newly-joined room.
 */
export function reconcileSnapshot(
  current: RoomSnapshot | null,
  incoming: RoomSnapshot,
): RoomSnapshot {
  if (!current) return incoming;
  if (incoming.room.id !== current.room.id) return current;
  return incoming.fetchedAt >= current.fetchedAt ? incoming : current;
}

/**
 * Whether an incoming snapshot is relevant to the room we currently care about.
 * Used by the hook to drop events/fetches from a stale subscription after the
 * player has moved to another room.
 */
export function isSnapshotForRoom(
  snapshot: RoomSnapshot,
  roomId: string | null,
): boolean {
  return roomId !== null && snapshot.room.id === roomId;
}
