import { describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import { APP } from '../config/app';
import { LOCATIONS } from '../data/locations';
import { validateLocationDataset } from './datasetValidation';

describe('validateLocationDataset — real dataset audit', () => {
  it('reports the bundled dataset as clean', () => {
    const report = validateLocationDataset(LOCATIONS, APP.roundsPerGame);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('validateLocationDataset — synthetic issues', () => {
  it('flags a duplicate id', () => {
    const locations: GameLocation[] = [
      { id: 'a', lat: 0, lng: 0, label: 'A', country: 'X', difficulty: 'easy' },
      { id: 'a', lat: 1, lng: 1, label: 'A2', country: 'X', difficulty: 'easy' },
    ];
    const report = validateLocationDataset(locations, 1);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.type === 'duplicate-id')).toBe(true);
  });

  it('flags out-of-range coordinates', () => {
    const locations: GameLocation[] = [
      { id: 'a', lat: 91, lng: 0, label: 'A', country: 'X', difficulty: 'easy' },
      { id: 'b', lat: 0, lng: -200, label: 'B', country: 'X', difficulty: 'easy' },
      { id: 'c', lat: NaN, lng: 0, label: 'C', country: 'X', difficulty: 'easy' },
    ];
    const report = validateLocationDataset(locations, 1);
    const flagged = report.issues.filter((i) => i.type === 'invalid-coordinates');
    expect(flagged.map((i) => i.locationId)).toEqual(['a', 'b', 'c']);
  });

  it('flags missing label/country as missing panorama data', () => {
    const locations: GameLocation[] = [
      { id: 'a', lat: 0, lng: 0, label: '', country: 'X', difficulty: 'easy' },
      { id: 'b', lat: 0, lng: 0, label: 'B', country: '  ', difficulty: 'easy' },
    ];
    const report = validateLocationDataset(locations, 1);
    expect(report.issues.filter((i) => i.type === 'missing-panorama-data')).toHaveLength(2);
  });

  it('flags an invalid difficulty tag rather than silently accepting it', () => {
    const locations = [
      { id: 'a', lat: 0, lng: 0, label: 'A', country: 'X', difficulty: 'extreme' },
    ] as unknown as GameLocation[];
    const report = validateLocationDataset(locations, 1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ type: 'invalid-difficulty', locationId: 'a' }),
    );
  });

  it('flags an insufficient pool for a difficulty even with adjacent fallback', () => {
    const locations: GameLocation[] = [
      { id: 'a', lat: 0, lng: 0, label: 'A', country: 'X', difficulty: 'easy' },
    ];
    const report = validateLocationDataset(locations, 5);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ type: 'insufficient-pool', difficulty: 'normal' }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ type: 'insufficient-pool', difficulty: 'hard' }),
    );
  });
});
