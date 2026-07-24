import { describe, it, expect } from 'vitest';
import { isSnapshotForRoom, reconcileSnapshot } from './reconcile';
import { makeRoom, makeSnapshot } from './__fixtures__/rooms';

describe('reconcileSnapshot', () => {
  it('accepts the first snapshot', () => {
    const s = makeSnapshot({ fetchedAt: 100 });
    expect(reconcileSnapshot(null, s)).toBe(s);
  });

  it('keeps the newer snapshot (higher fetchedAt wins)', () => {
    const older = makeSnapshot({ fetchedAt: 100 });
    const newer = makeSnapshot({ fetchedAt: 200 });
    expect(reconcileSnapshot(older, newer)).toBe(newer);
  });

  it('rejects an out-of-order (older) snapshot that resolves late', () => {
    const current = makeSnapshot({ fetchedAt: 200 });
    const stale = makeSnapshot({ fetchedAt: 100 });
    // A late-resolving stale fetch must not clobber fresher state.
    expect(reconcileSnapshot(current, stale)).toBe(current);
  });

  it('ignores a snapshot for a different room (stale subscription)', () => {
    const current = makeSnapshot({ room: makeRoom({ id: 'room-1' }), fetchedAt: 100 });
    const foreign = makeSnapshot({ room: makeRoom({ id: 'room-2' }), fetchedAt: 999 });
    expect(reconcileSnapshot(current, foreign)).toBe(current);
  });
});

describe('isSnapshotForRoom', () => {
  it('matches the active room id', () => {
    const s = makeSnapshot({ room: makeRoom({ id: 'room-1' }) });
    expect(isSnapshotForRoom(s, 'room-1')).toBe(true);
    expect(isSnapshotForRoom(s, 'room-2')).toBe(false);
    expect(isSnapshotForRoom(s, null)).toBe(false);
  });
});
