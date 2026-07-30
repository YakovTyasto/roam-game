import type { GameLocation, LatLng, RoundResult } from '../types';
import type { HiddenPanorama } from '../official/officialRun';

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
   * The CURRENT round's panorama when its answer is not known to this client —
   * rendered by pano id alone, exactly like multiplayer. Cleared the moment the
   * round is guessed (the server's response supplies the real location).
   *
   * Set for two different reasons, which is why it is derived from
   * `hiddenPanoramas` rather than passed around on its own:
   *   • a resumed server-tracked run (see solo/resume.ts), and
   *   • every round of an official, server-selected run (V5) — the answers were
   *     never sent to the browser in the first place.
   */
  hiddenPanorama: HiddenPanorama | null;
  /**
   * Hidden panorama per 0-based round index, for runs whose answers live only on
   * the server. A round drops out of this map once it has been guessed.
   *
   * Empty for a local/offline game, where the client legitimately knows every
   * answer and scores rounds itself.
   */
  hiddenPanoramas: Record<number, HiddenPanorama>;
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
      hiddenPanoramas: Record<number, HiddenPanorama>;
    }
  /**
   * Start an official, server-selected run (V5). The client is given panoramas
   * only: it holds no answer for any round, and each round is scored by the
   * server when it is submitted.
   */
  | {
      type: 'START_OFFICIAL_GAME';
      hiddenPanoramas: Record<number, HiddenPanorama>;
      /** Already-completed rounds, when resuming a partially played run. */
      results: RoundResult[];
      roundIndex: number;
      roundCount: number;
      timerSeconds: number | null;
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
  hiddenPanorama: null,
  hiddenPanoramas: {},
};

export const isEndlessGame = (state: GameState): boolean => state.roundCount === null;

export const currentLocation = (state: GameState): GameLocation | null =>
  state.locations[state.roundIndex] ?? null;

/**
 * Placeholder location for a round whose answer the client does not have.
 *
 * `NaN` coordinates are deliberate and load-bearing: they make it impossible to
 * accidentally score such a round locally (every distance comes out NaN, which
 * is visible immediately) instead of quietly producing a plausible-looking wrong
 * number. The real location replaces this the moment the server reveals it.
 */
export const hiddenLocationPlaceholder = (
  locationId: string,
  difficulty: GameLocation['difficulty'],
): GameLocation => ({
  id: locationId,
  lat: NaN,
  lng: NaN,
  label: '',
  country: '',
  difficulty,
});
