import type { GameAction, GameState } from './state';
import { hiddenLocationPlaceholder, initialGameState } from './state';

/**
 * Pure game state-machine reducer. All non-trivial transitions live here so
 * they can be unit-tested without React. Distance/score computation happens
 * in the caller (via the tested utils) and arrives ready-made in SUBMIT_GUESS.
 *
 * `roundCount` (null = Endless) and `timerSeconds` (null = No Timer) come from
 * the game's config (see config/gameConfig.ts) rather than a hardcoded
 * constant, so fixed round counts of any size and Endless share this same
 * state machine.
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return {
        ...initialGameState,
        status: 'loadingRound',
        locations: action.locations,
        backups: action.backups,
        roundCount: action.roundCount,
        timerSeconds: action.timerSeconds,
      };

    case 'ROUND_READY':
      if (state.status !== 'loadingRound') return state;
      return { ...state, status: 'exploring', guess: null };

    case 'OPEN_MAP':
      if (state.status !== 'exploring' && state.status !== 'selectingGuess') {
        return state;
      }
      return { ...state, status: 'selectingGuess' };

    case 'CLOSE_MAP':
      if (state.status !== 'selectingGuess') return state;
      return { ...state, status: 'exploring' };

    case 'PLACE_GUESS':
      if (state.status !== 'exploring' && state.status !== 'selectingGuess') {
        return state;
      }
      return { ...state, guess: action.guess };

    case 'SUBMIT_GUESS': {
      if (state.status !== 'exploring' && state.status !== 'selectingGuess') {
        return state;
      }
      if (!state.guess) return state;
      // Keep locations[roundIndex] in sync with the authoritative location
      // the result carries — a no-op for a normal round (same object), but
      // corrects a resumed round's hidden-answer placeholder to the real,
      // server-revealed location now that it's been guessed.
      const locations = [...state.locations];
      locations[state.roundIndex] = action.result.location;
      // Drop this round from the hidden map: its answer is now known, so it
      // must render like any other completed round (and must never be
      // re-submitted to the server as if still hidden).
      const hiddenPanoramas = { ...state.hiddenPanoramas };
      delete hiddenPanoramas[state.roundIndex];
      return {
        ...state,
        status: 'roundResult',
        locations,
        results: [...state.results, action.result],
        hiddenPanorama: null,
        hiddenPanoramas,
      };
    }

    case 'NEXT_ROUND': {
      if (state.status !== 'roundResult') return state;
      // roundCount === null means Endless: it never auto-finishes here, only
      // via FINISH_ENDLESS (an explicit player action).
      const isLast = state.roundCount !== null && state.roundIndex + 1 >= state.roundCount;
      if (isLast) {
        return { ...state, status: 'finalResult' };
      }
      const nextIndex = state.roundIndex + 1;
      return {
        ...state,
        status: 'loadingRound',
        roundIndex: nextIndex,
        guess: null,
        // An official run's every round is hidden, so the next one's panorama
        // becomes current here. Local games have an empty map and get null.
        hiddenPanorama: state.hiddenPanoramas[nextIndex] ?? null,
      };
    }

    case 'ADD_ROUND':
      if (state.status !== 'loadingRound') return state;
      if (state.roundIndex < state.locations.length) return state; // already have one
      return { ...state, locations: [...state.locations, action.location] };

    case 'FINISH_ENDLESS':
      if (state.roundCount !== null) return state; // only meaningful for Endless
      if (state.status !== 'roundResult' && state.status !== 'exploring' && state.status !== 'selectingGuess') {
        return state;
      }
      return { ...state, status: 'finalResult' };

    case 'RESUME_GAME':
      return {
        ...initialGameState,
        status: 'loadingRound',
        locations: action.locations,
        backups: [],
        results: action.results,
        roundIndex: action.roundIndex,
        roundCount: action.roundCount,
        timerSeconds: action.timerSeconds,
        hiddenPanoramas: action.hiddenPanoramas,
        hiddenPanorama: action.hiddenPanoramas[action.roundIndex] ?? null,
      };

    case 'START_OFFICIAL_GAME': {
      // The client holds no answers here. `locations` is filled with NaN-coord
      // placeholders for every un-played round so the rest of the machine (which
      // indexes locations by round) keeps working, while making a local scoring
      // attempt fail loudly rather than silently produce a wrong distance.
      const locations = [...Array(action.roundCount).keys()].map((i) => {
        const played = action.results[i];
        if (played) return played.location;
        const hidden = action.hiddenPanoramas[i];
        return hiddenLocationPlaceholder(hidden?.locationId ?? `round-${i + 1}`, 'normal');
      });
      return {
        ...initialGameState,
        status: 'loadingRound',
        locations,
        backups: [],
        results: action.results,
        roundIndex: action.roundIndex,
        roundCount: action.roundCount,
        timerSeconds: action.timerSeconds,
        hiddenPanoramas: action.hiddenPanoramas,
        hiddenPanorama: action.hiddenPanoramas[action.roundIndex] ?? null,
      };
    }

    case 'REPLACE_CURRENT_LOCATION': {
      // Swap in a spare location when the current one has no panorama.
      if (state.backups.length === 0) {
        return {
          ...state,
          status: 'error',
          error: 'No Street View location could be loaded. Please try again.',
        };
      }
      const [next, ...restBackups] = state.backups;
      const locations = [...state.locations];
      locations[state.roundIndex] = next;
      return { ...state, locations, backups: restBackups };
    }

    case 'SET_ERROR':
      return { ...state, status: 'error', error: action.message };

    case 'RESET':
      return { ...initialGameState };

    default:
      return state;
  }
}
