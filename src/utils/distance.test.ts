import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, formatDistance } from './distance';

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 40.0, lng: -74.0 };
    expect(haversineDistanceKm(p, p)).toBe(0);
  });

  it('computes a known distance (London to Paris) within tolerance', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const d = haversineDistanceKm(london, paris);
    // Real-world great-circle distance is ~343 km.
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(355);
  });

  it('computes a known distance (New York to Los Angeles)', () => {
    const ny = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const d = haversineDistanceKm(ny, la);
    // ~3936 km.
    expect(d).toBeGreaterThan(3900);
    expect(d).toBeLessThan(3980);
  });

  it('is symmetric', () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: -30, lng: 100 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 6);
  });

  it('handles antipodal-ish points (roughly half the circumference)', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 180 };
    const d = haversineDistanceKm(a, b);
    // Half the equatorial circumference ~= 20015 km.
    expect(d).toBeGreaterThan(19900);
    expect(d).toBeLessThan(20100);
  });
});

describe('formatDistance', () => {
  it('uses metres below 1 km', () => {
    expect(formatDistance(0.42)).toBe('420 m');
  });

  it('uses one decimal for short kilometre distances', () => {
    expect(formatDistance(4.25)).toBe('4.3 km');
  });

  it('rounds and groups long distances', () => {
    expect(formatDistance(3936)).toBe('3,936 km');
  });

  it('supports imperial feet for very short distances', () => {
    expect(formatDistance(0.01, 'imperial')).toMatch(/ft$/);
  });

  it('supports imperial miles', () => {
    expect(formatDistance(100, 'imperial')).toMatch(/mi$/);
  });
});
