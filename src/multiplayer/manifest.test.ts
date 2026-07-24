import { describe, it, expect } from 'vitest';
import { validateManifest } from './manifest';
import type { ManifestRound } from './types';

const round = (i: number, overrides: Partial<ManifestRound> = {}): ManifestRound => ({
  location_id: `loc${i}`,
  lat: 10,
  lng: 20,
  label: 'Somewhere',
  country: 'Nowhere',
  pano_id: `pano${i}`,
  heading: 30,
  pitch: 0,
  zoom: 0,
  ...overrides,
});

const five = () => [1, 2, 3, 4, 5].map((i) => round(i));

describe('validateManifest', () => {
  it('accepts a well-formed manifest of the expected length', () => {
    expect(validateManifest(five(), 5)).toEqual({ ok: true });
  });

  it('rejects the wrong round count', () => {
    const r = validateManifest(five().slice(0, 4), 5);
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(validateManifest([round(1, { lat: 100 }), ...five().slice(1)], 5).ok).toBe(false);
    expect(validateManifest([round(1, { lng: 200 }), ...five().slice(1)], 5).ok).toBe(false);
  });

  it('rejects missing panorama / label / country / location id', () => {
    expect(validateManifest([round(1, { pano_id: '' }), ...five().slice(1)], 5).ok).toBe(false);
    expect(validateManifest([round(1, { label: '' }), ...five().slice(1)], 5).ok).toBe(false);
    expect(validateManifest([round(1, { country: '' }), ...five().slice(1)], 5).ok).toBe(false);
    expect(validateManifest([round(1, { location_id: '' }), ...five().slice(1)], 5).ok).toBe(false);
  });

  it('rejects an out-of-range heading', () => {
    expect(validateManifest([round(1, { heading: 400 }), ...five().slice(1)], 5).ok).toBe(false);
  });

  it('rejects duplicate locations', () => {
    const dup = [round(1), round(1), round(3), round(4), round(5)];
    const r = validateManifest(dup, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate/i);
  });
});
