import { describe, it, expect } from 'vitest';
import { computeMatchOutcome, outcomeForSlot, outcomeFromScores } from './outcome';
import type { MpPlayer } from './types';

const player = (slot: 1 | 2, totalScore: number): MpPlayer => ({
  id: `p${slot}`,
  roomId: 'r',
  userId: `u${slot}`,
  displayName: `Player ${slot}`,
  slot,
  totalScore,
  connectionStatus: 'online',
  joinedAt: '2026-01-01T00:00:00Z',
});

describe('outcomeFromScores', () => {
  it('higher score wins', () => {
    expect(outcomeFromScores(10, 5)).toBe('p1');
    expect(outcomeFromScores(5, 10)).toBe('p2');
  });
  it('equal scores draw', () => {
    expect(outcomeFromScores(7, 7)).toBe('draw');
  });
});

describe('computeMatchOutcome', () => {
  it('resolves regardless of array order', () => {
    expect(computeMatchOutcome([player(2, 9000), player(1, 8000)])).toBe('p2');
    expect(computeMatchOutcome([player(1, 9000), player(2, 8000)])).toBe('p1');
  });
  it('a tie is a draw', () => {
    expect(computeMatchOutcome([player(1, 5000), player(2, 5000)])).toBe('draw');
  });
  it('handles a missing opponent defensively', () => {
    expect(computeMatchOutcome([player(1, 100)])).toBe('p1');
  });
});

describe('outcomeForSlot', () => {
  it('labels win/loss from a slot perspective', () => {
    expect(outcomeForSlot('p1', 1)).toBe('win');
    expect(outcomeForSlot('p1', 2)).toBe('loss');
    expect(outcomeForSlot('p2', 2)).toBe('win');
    expect(outcomeForSlot('draw', 1)).toBe('draw');
  });
});
