import { APP } from '../config/app';
import type { GameAction, GameState } from './state';
import { initialGameState } from './state';

/**
 * Pure game state-machine reducer. All non-trivial transitions live here so
 * they can be unit-tested without React. Distance/score computation happens
 * in the caller (via the tested utils) and arrives ready-made in SUBMIT_GUESS.
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return {
        ...initialGameState,
        status: 'loadingRound',
        locations: action.locations,
        backups: action.backups,
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

    case 'SUBMIT_GUESS':
      if (state.status !== 'exploring' && state.status !== 'selectingGuess') {
        return state;
      }
      if (!state.guess) return state;
      return {
        ...state,
        status: 'roundResult',
        results: [...state.results, action.result],
      };

    case 'NEXT_ROUND': {
      if (state.status !== 'roundResult') return state;
      const isLast = state.roundIndex + 1 >= APP.roundsPerGame;
      if (isLast) {
        return { ...state, status: 'finalResult' };
      }
      return {
        ...state,
        status: 'loadingRound',
        roundIndex: state.roundIndex + 1,
        guess: null,
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
