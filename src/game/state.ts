import type { GameLocation, LatLng, RoundResult } from '../types';

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
};

export const isEndlessGame = (state: GameState): boolean => state.roundCount === null;

export const currentLocation = (state: GameState): GameLocation | null =>
  state.locations[state.roundIndex] ?? null;
