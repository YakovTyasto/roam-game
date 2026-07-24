import { afterEach, describe, expect, it } from 'vitest';
import type { GameLocation } from '../types';
import type { Difficulty } from '../config/difficulty';
import { StaticLocationProvider } from './LocationProvider';
import { LOCATION_HISTORY_KEY, readLocationHistory } from '../utils/locationHistory';

function loc(id: string, difficulty: Difficulty = 'normal'): GameLocation {
  return { id, lat: 0, lng: 0, label: id, country: 'Nowhere', difficulty };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('StaticLocationProvider.getGameLocations — recent-location cooldown', () => {
  it('never returns duplicate locations within one match', async () => {
    const pool = Array.from({ length: 20 }, (_, i) => loc(`n${i}`));
    const provider = new StaticLocationProvider(pool);
    const { locations } = await provider.getGameLocations(5, 'normal');
    expect(locations).toHaveLength(5);
    expect(new Set(locations.map((l) => l.id)).size).toBe(5);
  });

  it('avoids recently played locations in the very next match', async () => {
    const pool = Array.from({ length: 10 }, (_, i) => loc(`n${i}`));
    const provider = new StaticLocationProvider(pool);

    const first = await provider.getGameLocations(5, 'normal');
    const firstIds = new Set(first.locations.map((l) => l.id));

    const second = await provider.getGameLocations(5, 'normal');
    const overlap = second.locations.filter((l) => firstIds.has(l.id));
    // The pool has exactly 10 locations; the second 5-round match should draw
    // entirely from the 5 that were not just played.
    expect(overlap).toHaveLength(0);
  });

  it('still applies difficulty filtering with history in play', async () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => loc(`e${i}`, 'easy')),
      ...Array.from({ length: 6 }, (_, i) => loc(`n${i}`, 'normal')),
      ...Array.from({ length: 6 }, (_, i) => loc(`h${i}`, 'hard')),
    ];
    const provider = new StaticLocationProvider(pool);
    await provider.getGameLocations(3, 'easy');
    const { locations } = await provider.getGameLocations(3, 'easy');
    for (const l of locations) {
      expect(l.difficulty).toBe('easy');
    }
  });

  it('falls back to least-recently-played locations instead of failing when history nearly exhausts the pool', async () => {
    const pool = Array.from({ length: 5 }, (_, i) => loc(`n${i}`));
    const provider = new StaticLocationProvider(pool);

    // Mark 4 of the 5 available locations as recently played.
    const first = await provider.getGameLocations(4, 'normal');
    expect(first.locations).toHaveLength(4);

    // The next match needs all 5 — only 1 is untouched by history.
    const second = await provider.getGameLocations(5, 'normal');
    expect(second.locations).toHaveLength(5);
    expect(new Set(second.locations.map((l) => l.id)).size).toBe(5);
  });

  it('records the selected locations to history after a successful selection', async () => {
    const pool = Array.from({ length: 5 }, (_, i) => loc(`n${i}`));
    const provider = new StaticLocationProvider(pool);
    const { locations } = await provider.getGameLocations(5, 'normal');
    expect(readLocationHistory().sort()).toEqual(locations.map((l) => l.id).sort());
  });

  it('keeps working when stored history is malformed', async () => {
    window.localStorage.setItem(LOCATION_HISTORY_KEY, '{not json');
    const pool = Array.from({ length: 5 }, (_, i) => loc(`n${i}`));
    const provider = new StaticLocationProvider(pool);
    const { locations } = await provider.getGameLocations(5, 'normal');
    expect(locations).toHaveLength(5);
    expect(new Set(locations.map((l) => l.id)).size).toBe(5);
  });
});
