import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_OUTBOX_KEY,
  MAX_OUTBOX_ENTRIES,
  clearOutbox,
  isServerHistoryAvailable,
  queueRoundForSync,
  readOutbox,
  syncLocationHistory,
} from './historySync';
import { readLocationHistory, recordPlayedLocations } from '../utils/locationHistory';

const pushLocationHistory = vi.fn<(ids: readonly string[]) => Promise<number>>();
const fetchLocationHistory = vi.fn<() => Promise<string[]>>();

vi.mock('./historyApi', () => ({
  pushLocationHistory: (ids: readonly string[]) => pushLocationHistory(ids),
  fetchLocationHistory: () => fetchLocationHistory(),
  resetServerLocationHistory: () => Promise.resolve(),
}));

const hasSupabaseConfig = vi.fn(() => true);
vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return { ...actual, hasSupabaseConfig: () => hasSupabaseConfig() };
});

beforeEach(() => {
  window.localStorage.clear();
  pushLocationHistory.mockReset().mockResolvedValue(1);
  fetchLocationHistory.mockReset().mockResolvedValue([]);
  hasSupabaseConfig.mockReturnValue(true);
});

afterEach(() => {
  window.localStorage.clear();
});

/** Let the fire-and-forget push settle. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('isServerHistoryAvailable', () => {
  it('follows the Supabase configuration', () => {
    expect(isServerHistoryAvailable()).toBe(true);
    hasSupabaseConfig.mockReturnValue(false);
    expect(isServerHistoryAvailable()).toBe(false);
  });
});

describe('queueRoundForSync', () => {
  it('pushes to the server without the caller awaiting anything', async () => {
    queueRoundForSync('paris-eiffel', { difficulty: 'normal', mode: 'solo' });
    await flushMicrotasks();
    expect(pushLocationHistory).toHaveBeenCalledWith(['paris-eiffel']);
    expect(readOutbox()).toEqual([]);
  });

  it('queues the entry when the push fails', async () => {
    pushLocationHistory.mockRejectedValue(new Error('offline'));
    queueRoundForSync('tokyo-shibuya', { difficulty: 'hard', mode: 'endless' });
    await flushMicrotasks();
    expect(readOutbox()).toEqual([
      { groupId: 'tokyo-shibuya', difficulty: 'hard', collection: 'world', mode: 'endless' },
    ]);
  });

  it('never throws when the push rejects', async () => {
    pushLocationHistory.mockRejectedValue(new Error('boom'));
    expect(() => queueRoundForSync('x')).not.toThrow();
    await flushMicrotasks();
  });

  it('does nothing without a backend', async () => {
    hasSupabaseConfig.mockReturnValue(false);
    queueRoundForSync('paris-eiffel');
    await flushMicrotasks();
    expect(pushLocationHistory).not.toHaveBeenCalled();
    expect(readOutbox()).toEqual([]);
  });

  it('ignores an empty group id', async () => {
    queueRoundForSync('');
    await flushMicrotasks();
    expect(pushLocationHistory).not.toHaveBeenCalled();
  });

  it('keeps the outbox bounded', async () => {
    pushLocationHistory.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < MAX_OUTBOX_ENTRIES + 20; i++) {
      queueRoundForSync(`g-${i}`);
      await flushMicrotasks();
    }
    const outbox = readOutbox();
    expect(outbox).toHaveLength(MAX_OUTBOX_ENTRIES);
    // The newest entries survive — they matter most to novelty.
    expect(outbox[outbox.length - 1].groupId).toBe(`g-${MAX_OUTBOX_ENTRIES + 19}`);
  });

  it('does not queue the same place twice', async () => {
    pushLocationHistory.mockRejectedValue(new Error('offline'));
    queueRoundForSync('same');
    await flushMicrotasks();
    queueRoundForSync('same');
    await flushMicrotasks();
    expect(readOutbox()).toHaveLength(1);
  });
});

describe('readOutbox', () => {
  it('reads malformed storage as empty', () => {
    window.localStorage.setItem(HISTORY_OUTBOX_KEY, '{not json');
    expect(readOutbox()).toEqual([]);
  });

  it('drops junk entries but keeps valid ones', () => {
    window.localStorage.setItem(
      HISTORY_OUTBOX_KEY,
      JSON.stringify({
        version: 1,
        entries: [null, { groupId: '' }, { groupId: 'ok', difficulty: 'bogus', mode: 'hacking' }],
      }),
    );
    expect(readOutbox()).toEqual([
      { groupId: 'ok', difficulty: 'normal', collection: 'world', mode: 'solo' },
    ]);
  });
});

describe('syncLocationHistory', () => {
  it('skips entirely without a backend', async () => {
    hasSupabaseConfig.mockReturnValue(false);
    await expect(syncLocationHistory()).resolves.toEqual({ flushed: 0, merged: 0, skipped: true });
    expect(fetchLocationHistory).not.toHaveBeenCalled();
  });

  it('merges server history behind the local entries', async () => {
    recordPlayedLocations(['local-new']);
    fetchLocationHistory.mockResolvedValue(['server-a', 'server-b']);

    const result = await syncLocationHistory();

    expect(result.merged).toBe(2);
    // Local stays newest: it is what this device just played.
    expect(readLocationHistory()).toEqual(['local-new', 'server-a', 'server-b']);
  });

  it('does not duplicate places the local cache already knows', async () => {
    recordPlayedLocations(['shared']);
    fetchLocationHistory.mockResolvedValue(['shared', 'new-one']);

    const result = await syncLocationHistory();

    expect(result.merged).toBe(1);
    expect(readLocationHistory()).toEqual(['shared', 'new-one']);
  });

  it('flushes the outbox before pulling', async () => {
    pushLocationHistory.mockRejectedValueOnce(new Error('offline'));
    queueRoundForSync('queued-place');
    await flushMicrotasks();
    expect(readOutbox()).toHaveLength(1);

    const result = await syncLocationHistory();

    expect(result.flushed).toBe(1);
    expect(pushLocationHistory).toHaveBeenLastCalledWith(['queued-place']);
    expect(readOutbox()).toEqual([]);
  });

  it('leaves the local cache untouched when the server fails', async () => {
    recordPlayedLocations(['local-only']);
    fetchLocationHistory.mockRejectedValue(new Error('500'));

    const result = await syncLocationHistory();

    expect(result.skipped).toBe(true);
    expect(readLocationHistory()).toEqual(['local-only']);
  });

  it('ignores a malformed server payload', async () => {
    recordPlayedLocations(['local-only']);
    // historyApi already filters non-strings; this asserts the empty case is
    // handled without corrupting the cache.
    fetchLocationHistory.mockResolvedValue([]);

    const result = await syncLocationHistory();

    expect(result.merged).toBe(0);
    expect(readLocationHistory()).toEqual(['local-only']);
  });

  it('never rejects', async () => {
    fetchLocationHistory.mockRejectedValue(new Error('nope'));
    pushLocationHistory.mockRejectedValue(new Error('nope'));
    await expect(syncLocationHistory()).resolves.toBeDefined();
  });
});

describe('clearOutbox', () => {
  it('empties the queue', async () => {
    pushLocationHistory.mockRejectedValue(new Error('offline'));
    queueRoundForSync('g');
    await flushMicrotasks();
    clearOutbox();
    expect(readOutbox()).toEqual([]);
  });
});
