import { afterEach, describe, it, expect } from 'vitest';
import { buildManifest, validateManifest } from './manifest';
import type { ManifestRound } from './types';
import type { GameLocation } from '../types';
import { readLocationHistory } from '../utils/locationHistory';

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

/** Minimal fake of the Google Street View service used by `resolvePanoId`. */
function makeFakeGoogle(resolvableIds: ReadonlySet<string>, byLatLng: Map<string, string>) {
  return {
    maps: {
      StreetViewSource: { OUTDOOR: 'outdoor' },
      StreetViewPreference: { NEAREST: 'nearest' },
      StreetViewStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS', UNKNOWN_ERROR: 'UNKNOWN_ERROR' },
      StreetViewService: class {
        getPanorama(
          request: { location: { lat: number; lng: number } },
          callback: (data: { location: { pano: string } } | null, status: string) => void,
        ) {
          const id = byLatLng.get(`${request.location.lat},${request.location.lng}`);
          if (id && resolvableIds.has(id)) {
            callback({ location: { pano: `pano-${id}` } }, 'OK');
          } else {
            callback(null, 'ZERO_RESULTS');
          }
        }
      },
    },
  } as unknown as typeof window.google;
}

describe('buildManifest — candidate ordering and recording', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  const pool: GameLocation[] = Array.from({ length: 6 }, (_, i) => ({
    id: `loc-${i}`,
    lat: i * 10,
    lng: i * 12,
    label: `Location ${i}`,
    country: 'Nowhere',
    difficulty: 'normal',
  }));
  const byLatLng = new Map(pool.map((l) => [`${l.lat},${l.lng}`, l.id]));
  const seeded = () => 0;

  it('honours the caller-supplied candidate order', async () => {
    // Ordering is the Diversity Engine's job; buildManifest must not re-order,
    // or the engine's bag/history guarantees would be silently discarded.
    const google = makeFakeGoogle(new Set(pool.map((l) => l.id)), byLatLng);
    const candidates = [pool[4], pool[5], pool[0], pool[1]];
    const rounds = await buildManifest(google, candidates, 2, { rng: seeded });
    expect(rounds.map((r) => r.location_id)).toEqual(['loc-4', 'loc-5']);
  });

  it('skips candidates without a panorama and uses the next ones in order', async () => {
    const google = makeFakeGoogle(new Set(['loc-2', 'loc-5']), byLatLng);
    const rounds = await buildManifest(google, pool, 2, { rng: seeded });
    expect(rounds.map((r) => r.location_id)).toEqual(['loc-2', 'loc-5']);
  });

  it('records nothing — history advances only when a round starts', async () => {
    // A manifest that the start RPC then rejects must not cost the player any
    // freshness, so buildManifest deliberately has no side effects.
    const google = makeFakeGoogle(new Set(pool.map((l) => l.id)), byLatLng);
    await buildManifest(google, pool, 3, { rng: seeded });
    expect(readLocationHistory()).toEqual([]);
  });

  it('throws when not enough panoramas resolve', async () => {
    const google = makeFakeGoogle(new Set(['loc-0', 'loc-1']), byLatLng);
    await expect(buildManifest(google, pool, 3, { rng: seeded })).rejects.toThrow();
    expect(readLocationHistory()).toEqual([]);
  });
});
