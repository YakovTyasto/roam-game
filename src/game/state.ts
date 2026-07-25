import type { GameLocation, LatLng, PanoramaTarget, RoundResult } from '../types';

/**
 * Explicit game states. `exploring` and `selectingGuess` are distinct so the
 * UI can react to the guessing map being open, but both represent an active,
 * not-yet-submitted round.
 */
export type GameStatus =
  | 'welcome'
  | 'loadingRound'
  | 'exploring'
  | 'selectingGuess'
  | 'roundResult'
  | 'finalResult'
  | 'error';

export interface GameState {
  status: GameStatus;
  /** The locations chosen for the current game (one per round). */
  locations: GameLocation[];
  /** Spare locations used to transparently replace ones with no panorama. */
  backups: GameLocation[];
  /** 0-based index of the current round. */
  roundIndex: number;
  /** Pending guess for the current round, or null if none placed yet. */
  guess: LatLng | null;
  /** Completed round results, in order. */
  results: RoundResult[];
  /** Human-readable error message when status is 'error'. */
  error: string | null;
  /** Total rounds for a fixed game, or null for Endless (no fixed end). */
  roundCount: number | null;
  /** Per-round timer in seconds, or null for No Timer. */
  timerSeconds: number | null;
  /**
   * Set only when the CURRENT round was restored from a server-tracked run
   * (see solo/resume.ts) and hasn't been guessed yet — its answer is still
   * hidden, so it's rendered by pano id alone, exactly like multiplayer.
   * Cleared the moment that round is guessed.
   */
  resumePanorama: (PanoramaTarget & { locationId: string }) | null;
}

export type GameAction =
  | {
      type: 'START_GAME';
      locations: GameLocation[];
      backups: GameLocation[];
      roundCount: number | null;
      timerSeconds: number | null;
    }
  | { type: 'ROUND_READY' }
  | { type: 'OPEN_MAP' }
  | { type: 'CLOSE_MAP' }
  | { type: 'PLACE_GUESS'; guess: LatLng }
  | { type: 'SUBMIT_GUESS'; result: RoundResult }
  | { type: 'NEXT_ROUND' }
  /** Endless only: append the next generated location once it's ready. */
  | { type: 'ADD_ROUND'; location: GameLocation }
  /** Endless only: end the session on demand and show the summary. */
  | { type: 'FINISH_ENDLESS' }
  /** Restore a server-tracked run — see solo/resume.ts for how this is built. */
  | {
      type: 'RESUME_GAME';
      /** Completed-round locations, indexed by round position. */
      locations: GameLocation[];
      results: RoundResult[];
      roundIndex: number;
      roundCount: number | null;
      timerSeconds: number | null;
      resumePanorama: (PanoramaTarget & { locationId: string }) | null;
    }
  | { type: 'REPLACE_CURRENT_LOCATION' }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'RESET' };

export const initialGameState: GameState = {
  status: 'welcome',
  locations: [],
  backups: [],
  roundIndex: 0,
  guess: null,
  results: [],
  error: null,
  roundCount: null,
  timerSeconds: null,
  resumePanorama: null,
};

export const isEndlessGame = (state: GameState): boolean => state.roundCount === null;

export const currentLocation = (state: GameState): GameLocation | null =>
  state.locations[state.roundIndex] ?? null;
