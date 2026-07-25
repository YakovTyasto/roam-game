import type { GameLocation, RoundResult } from '../types';
import type { Difficulty } from '../config/difficulty';
import { isDifficulty } from '../config/difficulty';

/**
 * Local-only, versioned resume snapshot for solo games that have nothing
 * server-side to fall back on: Endless (always local-only in this phase) and
 * fixed games played with no Supabase configured. Never stores secrets or
 * auth tokens — only gameplay state that's already visible in this browser.
 */
export const LOCAL_RUN_SNAPSHOT_KEY = 'roam.soloRunSnapshot.v1';

/** Mirrors the server run's own 12-hour expiry (see solo_runs.expires_at). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface LocalRunSnapshot {
  version: 1;
  savedAt: string;
  difficulty: Difficulty;
  /** null = Endless. */
  roundCount: number | null;
  timerSeconds: number | null;
  roundIndex: number;
  locations: GameLocation[];
  results: RoundResult[];
}

function isValidLocation(v: unknown): v is GameLocation {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lng === 'number' &&
    typeof o.label === 'string' &&
    typeof o.country === 'string' &&
    isDifficulty(o.difficulty)
  );
}

function isValidResult(v: unknown): v is RoundResult {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    isValidLocation(o.location) &&
    !!o.guess &&
    typeof (o.guess as Record<string, unknown>).lat === 'number' &&
    typeof (o.guess as Record<string, unknown>).lng === 'number' &&
    typeof o.distanceKm === 'number' &&
    typeof o.score === 'number'
  );
}

function validate(parsed: unknown): LocalRunSnapshot | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.savedAt !== 'string') return null;
  const savedMs = Date.parse(o.savedAt);
  if (!Number.isFinite(savedMs) || Date.now() - savedMs > MAX_AGE_MS) return null;
  if (!isDifficulty(o.difficulty)) return null;
  if (o.roundCount !== null && typeof o.roundCount !== 'number') return null;
  if (o.timerSeconds !== null && typeof o.timerSeconds !== 'number') return null;
  if (typeof o.roundIndex !== 'number' || o.roundIndex < 0) return null;
  if (!Array.isArray(o.locations) || !o.locations.every(isValidLocation)) return null;
  if (!Array.isArray(o.results) || !o.results.every(isValidResult)) return null;

  return {
    version: 1,
    savedAt: o.savedAt,
    difficulty: o.difficulty,
    roundCount: o.roundCount as number | null,
    timerSeconds: o.timerSeconds as number | null,
    roundIndex: o.roundIndex,
    locations: o.locations,
    results: o.results,
  };
}

export function writeLocalRunSnapshot(snapshot: Omit<LocalRunSnapshot, 'version' | 'savedAt'>): void {
  try {
    const full: LocalRunSnapshot = { version: 1, savedAt: new Date().toISOString(), ...snapshot };
    window.localStorage.setItem(LOCAL_RUN_SNAPSHOT_KEY, JSON.stringify(full));
  } catch {
    /* storage unavailable — resume simply won't be offered next time */
  }
}

/** Fails safe: any corrupt, malformed, or stale snapshot yields null, never a throw. */
export function readLocalRunSnapshot(): LocalRunSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_RUN_SNAPSHOT_KEY);
    if (!raw) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearLocalRunSnapshot(): void {
  try {
    window.localStorage.removeItem(LOCAL_RUN_SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
