import { describe, it, expect } from 'vitest';
import { calculateScore, performanceMessage } from './score';

describe('calculateScore', () => {
  it('awards the maximum for a perfect guess', () => {
    expect(calculateScore(0)).toBe(5000);
  });

  it('never exceeds the maximum', () => {
    expect(calculateScore(0, { maxScore: 5000 })).toBeLessThanOrEqual(5000);
  });

  it('never returns a negative score', () => {
    expect(calculateScore(40000)).toBeGreaterThanOrEqual(0);
  });

  it('decreases monotonically with distance', () => {
    const a = calculateScore(10);
    const b = calculateScore(100);
    const c = calculateScore(1000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('respects the falloff constant (larger falloff = higher score)', () => {
    const strict = calculateScore(1000, { falloffKm: 500 });
    const lenient = calculateScore(1000, { falloffKm: 4000 });
    expect(lenient).toBeGreaterThan(strict);
  });

  it('returns 0 for invalid input', () => {
    expect(calculateScore(NaN)).toBe(0);
    expect(calculateScore(-5)).toBe(0);
    expect(calculateScore(Infinity)).toBe(0);
  });

  it('is close to but below max for a small distance', () => {
    const s = calculateScore(1, { maxScore: 5000, falloffKm: 2000 });
    expect(s).toBeLessThan(5000);
    expect(s).toBeGreaterThan(4990);
  });
});

describe('performanceMessage', () => {
  it('gives the top message for a near-perfect game', () => {
    expect(performanceMessage(24000, 25000)).toBe('Cartographer');
  });

  it('gives the bottom message for a very low score', () => {
    expect(performanceMessage(500, 25000)).toBe('Off the map');
  });

  it('handles a zero maximum gracefully', () => {
    expect(typeof performanceMessage(0, 0)).toBe('string');
  });
});
