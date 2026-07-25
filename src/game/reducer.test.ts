import { describe, it, expect } from 'vitest';
import { gameReducer } from './reducer';
import { initialGameState, type GameState } from './state';
import type { GameLocation, RoundResult } from '../types';

const loc = (id: string): GameLocation => ({
  id,
  lat: 0,
  lng: 0,
  label: `Label ${id}`,
  country: 'Testland',
  difficulty: 'normal',
});

const fiveLocations = ['a', 'b', 'c', 'd', 'e'].map(loc);

const result = (id: string): RoundResult => ({
  location: loc(id),
  guess: { lat: 1, lng: 1 },
  distanceKm: 100,
  score: 4000,
});

const startedGame = (): GameState =>
  gameReducer(initialGameState, {
    type: 'START_GAME',
    locations: fiveLocations,
    backups: [loc('spare1'), loc('spare2')],
    roundCount: 5,
    timerSeconds: 120,
  });

describe('gameReducer', () => {
  it('starts in welcome by default', () => {
    expect(initialGameState.status).toBe('welcome');
  });

  it('START_GAME moves to loadingRound and stores locations', () => {
    const s = startedGame();
    expect(s.status).toBe('loadingRound');
    expect(s.locations).toHaveLength(5);
    expect(s.roundIndex).toBe(0);
    expect(s.results).toHaveLength(0);
  });

  it('ROUND_READY moves loadingRound -> exploring', () => {
    const s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    expect(s.status).toBe('exploring');
  });

  it('ignores ROUND_READY from the wrong state', () => {
    const s = gameReducer(initialGameState, { type: 'ROUND_READY' });
    expect(s.status).toBe('welcome');
  });

  it('OPEN_MAP and CLOSE_MAP toggle between exploring and selectingGuess', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'OPEN_MAP' });
    expect(s.status).toBe('selectingGuess');
    s = gameReducer(s, { type: 'CLOSE_MAP' });
    expect(s.status).toBe('exploring');
  });

  it('PLACE_GUESS records the pending guess', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 5, lng: 6 } });
    expect(s.guess).toEqual({ lat: 5, lng: 6 });
  });

  it('does not SUBMIT_GUESS without a placed guess', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('a') });
    expect(s.status).toBe('exploring');
    expect(s.results).toHaveLength(0);
  });

  it('SUBMIT_GUESS records the result and shows roundResult', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
    s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('a') });
    expect(s.status).toBe('roundResult');
    expect(s.results).toHaveLength(1);
  });

  it('NEXT_ROUND advances the round and clears the guess', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
    s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('a') });
    s = gameReducer(s, { type: 'NEXT_ROUND' });
    expect(s.status).toBe('loadingRound');
    expect(s.roundIndex).toBe(1);
    expect(s.guess).toBeNull();
  });

  it('reaches finalResult after the last round', () => {
    let s = startedGame();
    for (let i = 0; i < 5; i++) {
      s = gameReducer(s, { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
      s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result(`r${i}`) });
      s = gameReducer(s, { type: 'NEXT_ROUND' });
    }
    expect(s.status).toBe('finalResult');
    expect(s.results).toHaveLength(5);
  });

  it('REPLACE_CURRENT_LOCATION swaps in a backup', () => {
    let s = startedGame();
    const originalId = s.locations[0].id;
    s = gameReducer(s, { type: 'REPLACE_CURRENT_LOCATION' });
    expect(s.locations[0].id).not.toBe(originalId);
    expect(s.locations[0].id).toBe('spare1');
    expect(s.backups).toHaveLength(1);
  });

  it('REPLACE_CURRENT_LOCATION errors when no backups remain', () => {
    let s = gameReducer(initialGameState, {
      type: 'START_GAME',
      locations: fiveLocations,
      backups: [],
      roundCount: 5,
      timerSeconds: 120,
    });
    s = gameReducer(s, { type: 'REPLACE_CURRENT_LOCATION' });
    expect(s.status).toBe('error');
    expect(s.error).toBeTruthy();
  });

  it('SET_ERROR transitions to the error state', () => {
    const s = gameReducer(startedGame(), {
      type: 'SET_ERROR',
      message: 'boom',
    });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('RESET returns to the initial state', () => {
    let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
    s = gameReducer(s, { type: 'RESET' });
    expect(s).toEqual(initialGameState);
  });

  describe('configurable round count', () => {
    it('finishes after a custom round count other than 5', () => {
      let s = gameReducer(initialGameState, {
        type: 'START_GAME',
        locations: ['a', 'b', 'c'].map(loc),
        backups: [],
        roundCount: 3,
        timerSeconds: 90,
      });
      for (let i = 0; i < 3; i++) {
        s = gameReducer(s, { type: 'ROUND_READY' });
        s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
        s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result(`r${i}`) });
        s = gameReducer(s, { type: 'NEXT_ROUND' });
      }
      expect(s.status).toBe('finalResult');
      expect(s.results).toHaveLength(3);
    });

    it('stores a null timerSeconds for No Timer', () => {
      const s = gameReducer(initialGameState, {
        type: 'START_GAME',
        locations: fiveLocations,
        backups: [],
        roundCount: 5,
        timerSeconds: null,
      });
      expect(s.timerSeconds).toBeNull();
    });
  });

  describe('Endless mode', () => {
    const startedEndless = (): GameState =>
      gameReducer(initialGameState, {
        type: 'START_GAME',
        locations: [loc('e1')],
        backups: [],
        roundCount: null,
        timerSeconds: 120,
      });

    it('never auto-finishes via NEXT_ROUND', () => {
      let s = startedEndless();
      for (let i = 0; i < 10; i++) {
        s = gameReducer(s, { type: 'ADD_ROUND', location: loc(`gen-${i}`) });
        s = gameReducer(s, { type: 'ROUND_READY' });
        s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
        s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result(`r${i}`) });
        s = gameReducer(s, { type: 'NEXT_ROUND' });
      }
      expect(s.status).toBe('loadingRound');
      expect(s.results).toHaveLength(10);
    });

    it('ADD_ROUND appends a location only when one is actually needed', () => {
      let s = startedEndless(); // roundIndex 0, locations already has index 0
      s = gameReducer(s, { type: 'ADD_ROUND', location: loc('should-be-ignored') });
      expect(s.locations).toHaveLength(1); // not appended — index 0 already exists

      s = gameReducer(s, { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
      s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('e1') });
      s = gameReducer(s, { type: 'NEXT_ROUND' }); // roundIndex -> 1, status loadingRound
      s = gameReducer(s, { type: 'ADD_ROUND', location: loc('e2') });
      expect(s.locations.map((l) => l.id)).toEqual(['e1', 'e2']);
    });

    it('FINISH_ENDLESS ends the session on demand', () => {
      let s = startedEndless();
      s = gameReducer(s, { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
      s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('e1') });
      s = gameReducer(s, { type: 'FINISH_ENDLESS' });
      expect(s.status).toBe('finalResult');
      expect(s.results).toHaveLength(1);
    });

    it('FINISH_ENDLESS is a no-op for a fixed-round game', () => {
      let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'FINISH_ENDLESS' });
      expect(s.status).toBe('exploring');
    });
  });

  describe('resume', () => {
    it('RESUME_GAME restores completed results and a pending round by panorama only', () => {
      const s = gameReducer(initialGameState, {
        type: 'RESUME_GAME',
        locations: [loc('a')],
        results: [result('a')],
        roundIndex: 1,
        roundCount: 5,
        timerSeconds: 120,
        resumePanorama: { locationId: 'b', panoId: 'pano-b', heading: 90, pitch: 0, zoom: 0 },
      });
      expect(s.status).toBe('loadingRound');
      expect(s.results).toHaveLength(1);
      expect(s.roundIndex).toBe(1);
      expect(s.resumePanorama).toEqual({
        locationId: 'b',
        panoId: 'pano-b',
        heading: 90,
        pitch: 0,
        zoom: 0,
      });
    });

    it('SUBMIT_GUESS clears resumePanorama and replaces the placeholder with the revealed location', () => {
      let s = gameReducer(initialGameState, {
        type: 'RESUME_GAME',
        locations: [{ id: 'b', lat: NaN, lng: NaN, label: '', country: '', difficulty: 'normal' }],
        results: [],
        roundIndex: 0,
        roundCount: 5,
        timerSeconds: 120,
        resumePanorama: { locationId: 'b', panoId: 'pano-b', heading: 90, pitch: 0, zoom: 0 },
      });
      s = gameReducer(s, { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
      const revealed = result('b');
      s = gameReducer(s, { type: 'SUBMIT_GUESS', result: revealed });
      expect(s.resumePanorama).toBeNull();
      expect(s.locations[0]).toEqual(revealed.location);
      expect(s.results).toEqual([revealed]);
    });

    it('a normal (non-resumed) SUBMIT_GUESS leaves locations unchanged in effect', () => {
      let s = gameReducer(startedGame(), { type: 'ROUND_READY' });
      s = gameReducer(s, { type: 'PLACE_GUESS', guess: { lat: 1, lng: 1 } });
      const before = s.locations[0];
      s = gameReducer(s, { type: 'SUBMIT_GUESS', result: result('a') });
      expect(s.locations[0]).toEqual(before);
    });
  });
});
