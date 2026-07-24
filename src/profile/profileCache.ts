import { sanitizePlayerName } from '../multiplayer/playerName';

/**
 * Local, versioned cache of the player's display name. This is ONLY a cache for
 * instant loading and offline fallback — never an authority. The authoritative
 * identity is always the anonymous Supabase user id, and the authoritative name
 * is the server profile row. Clearing this cache never grants any access.
 */
export const PROFILE_CACHE_KEY = 'roam.playerProfile.v1';

export interface CachedProfile {
  version: 1;
  name: string;
}

export function readCachedProfile(): CachedProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
    if (parsed && parsed.version === 1 && typeof parsed.name === 'string') {
      const name = sanitizePlayerName(parsed.name);
      return name.length > 0 ? { version: 1, name } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCachedProfile(name: string): void {
  try {
    const clean = sanitizePlayerName(name);
    if (clean.length === 0) return;
    window.localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ version: 1, name: clean } satisfies CachedProfile),
    );
  } catch {
    /* storage unavailable — the name simply won't persist locally */
  }
}

export function clearCachedProfile(): void {
  try {
    window.localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
