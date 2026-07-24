import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { hasGoogleMapsKey, hasSupabaseConfig } from '../config/env';
import { locationProvider } from '../providers/LocationProvider';
import { ensureGoogleMaps } from '../hooks/useGoogleMaps';
import { getSupabase } from './supabaseClient';
import { ensureAnonymousSession } from './auth';
import * as api from './api';
import { MultiplayerError } from './api';
import { deriveRoomView, type RoomView } from './machine';
import { reconcileSnapshot } from './reconcile';
import { buildManifest } from './manifest';
import { isRoundExpired, remainingSeconds, toEpochMs } from './timer';
import { validatePlayerName } from './playerName';
import { isValidRoomCode, normalizeRoomCode } from './roomCode';
import type { MpRoom, MultiplayerStatus, RoomSnapshot } from './types';

type PreRoomPhase = 'menu' | 'creating' | 'joining';
type Connection = 'connecting' | 'connected' | 'disconnected';

export interface MultiplayerController {
  status: MultiplayerStatus;
  view: RoomView | null;
  room: MpRoom | null;
  /** Full authoritative snapshot, for the final-results breakdown. */
  snapshot: RoomSnapshot | null;
  /** Inline error for the menu/join form (invalid code, full room, …). */
  menuError: string | null;
  /** Transient in-room notice (submit failed, advance failed, …). */
  notice: string | null;
  /** Fatal pre-room error (anonymous auth failure). */
  authError: string | null;
  busy: boolean;
  secondsLeft: number | null;
  connection: Connection;
  opponentOnline: boolean;
  initialCode: string;
  actions: {
    createRoom: (name: string) => Promise<void>;
    joinRoom: (code: string, name: string) => Promise<void>;
    startMatch: () => Promise<void>;
    submitGuess: (lat: number, lng: number) => Promise<void>;
    advance: () => Promise<void>;
    rematch: () => Promise<void>;
    leaveRoom: () => Promise<void>;
    retryAuth: () => void;
    clearMenuError: () => void;
    clearNotice: () => void;
  };
}

function errorMessage(e: unknown): string {
  if (e instanceof MultiplayerError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

// Persist the active room id so a page refresh can resume the same match.
const SAVED_ROOM_KEY = 'roam-mp-room';

function readSavedRoomId(): string | null {
  try {
    return window.localStorage.getItem(SAVED_ROOM_KEY);
  } catch {
    return null;
  }
}

function writeSavedRoomId(id: string): void {
  try {
    window.localStorage.setItem(SAVED_ROOM_KEY, id);
  } catch {
    /* storage unavailable — reconnect-by-refresh simply won't work */
  }
}

function clearSavedRoomId(): void {
  try {
    window.localStorage.removeItem(SAVED_ROOM_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Orchestrates the whole multiplayer session: anonymous auth, room membership,
 * a single Realtime subscription that refetches authoritative state on every
 * event, a server-authoritative countdown, and the finite state machine that
 * drives the UI. The database is always the source of truth.
 */
export function useMultiplayer(initialCode: string): MultiplayerController {
  const supabase = useMemo(() => getSupabase(), []);
  const supaConfigured = hasSupabaseConfig();
  const mapsKey = hasGoogleMapsKey();

  const [userId, setUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PreRoomPhase>('menu');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [opponentOnline, setOpponentOnline] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const roomIdRef = useRef<string | null>(null);
  roomIdRef.current = roomId;
  const offsetRef = useRef(0);
  const submittingRef = useRef(false);
  const refetchTimerRef = useRef<number | null>(null);
  const lastExpireAttemptRef = useRef(0);

  const view = useMemo(
    () => (snapshot && userId ? deriveRoomView(snapshot, userId) : null),
    [snapshot, userId],
  );
  const room = snapshot?.room ?? null;

  // Refs mirror derived state so the 1s interval can read them without needing
  // to re-subscribe every render.
  const viewRef = useRef<RoomView | null>(null);
  viewRef.current = view;
  const roomRef = useRef<MpRoom | null>(null);
  roomRef.current = room;

  // ── Authentication ────────────────────────────────────────────────────
  const authenticate = useCallback(() => {
    if (!supabase) return;
    setAuthError(null);
    ensureAnonymousSession()
      .then((id) => setUserId(id))
      .catch((e) => setAuthError(errorMessage(e)));
  }, [supabase]);

  useEffect(() => {
    if (!supaConfigured || !mapsKey) return;
    authenticate();
  }, [supaConfigured, mapsKey, authenticate]);

  // ── Authoritative refetch (reconcile-on-event) ────────────────────────
  const doRefetch = useCallback(
    async (targetRoomId: string) => {
      if (!supabase) return;
      try {
        const snap = await api.getSnapshot(supabase, targetRoomId);
        if (targetRoomId !== roomIdRef.current) return; // stale subscription
        setSnapshot((prev) => reconcileSnapshot(prev, snap));
      } catch {
        // Transient read failure (brief RLS/network hiccup). The backstop poll
        // and future events recover; don't disrupt the current guess.
      }
    },
    [supabase],
  );

  const scheduleRefetch = useCallback(
    (targetRoomId: string) => {
      if (refetchTimerRef.current !== null) return; // coalesce bursts
      refetchTimerRef.current = window.setTimeout(() => {
        refetchTimerRef.current = null;
        void doRefetch(targetRoomId);
      }, 120);
    },
    [doRefetch],
  );

  const measureOffset = useCallback(async () => {
    if (!supabase) return;
    const t0 = Date.now();
    const s = await api.serverNow(supabase);
    const t1 = Date.now();
    offsetRef.current = s - (t0 + (t1 - t0) / 2);
  }, [supabase]);

  // ── Room navigation helpers ───────────────────────────────────────────
  const enterRoom = useCallback((id: string) => {
    submittingRef.current = false;
    writeSavedRoomId(id);
    setSnapshot(null);
    setConnection('connecting');
    setMenuError(null);
    setNotice(null);
    setPhase('menu');
    setRoomId(id);
  }, []);

  const teardownRoom = useCallback(() => {
    clearSavedRoomId();
    setRoomId(null);
    setSnapshot(null);
    setConnection('connecting');
    setPhase('menu');
  }, []);

  // ── Resume the previous room after a page refresh ─────────────────────
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!supabase || !userId || roomId || resumedRef.current) return;
    resumedRef.current = true;
    const saved = readSavedRoomId();
    if (!saved) return;
    void (async () => {
      try {
        const snap = await api.getSnapshot(supabase, saved);
        if (snap.players.some((p) => p.userId === userId)) {
          setSnapshot(snap);
          setRoomId(saved);
        } else {
          clearSavedRoomId();
        }
      } catch {
        clearSavedRoomId();
      }
    })();
  }, [supabase, userId, roomId]);

  // ── Realtime subscription (one channel per active room) ───────────────
  useEffect(() => {
    if (!supabase || !roomId || !userId) return;
    const myRoomId = roomId;
    let disposed = false;

    setConnection('connecting');
    void doRefetch(myRoomId);
    void measureOffset();

    const channel: RealtimeChannel = supabase.channel(`room:${myRoomId}`, {
      config: { presence: { key: userId } },
    });

    const onChange = () => scheduleRefetch(myRoomId);
    for (const table of [
      'multiplayer_rooms',
      'multiplayer_players',
      'multiplayer_rounds',
      'multiplayer_round_targets',
      'multiplayer_guesses',
    ] as const) {
      const filter =
        table === 'multiplayer_rooms' ? `id=eq.${myRoomId}` : `room_id=eq.${myRoomId}`;
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        onChange,
      );
    }

    const syncPresence = () => {
      if (disposed) return;
      const state = channel.presenceState();
      const others = Object.keys(state).filter((k) => k !== userId);
      setOpponentOnline(others.length > 0);
    };
    channel.on('presence', { event: 'sync' }, syncPresence);
    channel.on('presence', { event: 'join' }, syncPresence);
    channel.on('presence', { event: 'leave' }, syncPresence);

    channel.subscribe((subStatus) => {
      if (disposed) return;
      if (subStatus === 'SUBSCRIBED') {
        setConnection('connected');
        void channel.track({ user_id: userId, online_at: Date.now() });
        // Catch anything missed while (re)connecting.
        void doRefetch(myRoomId);
        void measureOffset();
      } else if (
        subStatus === 'CHANNEL_ERROR' ||
        subStatus === 'TIMED_OUT' ||
        subStatus === 'CLOSED'
      ) {
        setConnection('disconnected');
      }
    });

    return () => {
      disposed = true;
      setOpponentOnline(false);
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, userId, doRefetch, scheduleRefetch, measureOffset]);

  // ── Backstop poll + 1s countdown tick + server-authoritative expiry ───
  useEffect(() => {
    if (!roomId) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      forceTick((t) => t + 1);

      const target = roomIdRef.current;
      if (!target) return;

      // Backstop refetch (every ~4s) tolerates missed/dropped Realtime events
      // without hammering the database; Realtime is the primary update path.
      if (tick % 4 === 0) void doRefetch(target);

      // When the local estimate says time is up, ask the server to lock the
      // round. The RPC re-checks server time and rejects an early call.
      const v = viewRef.current;
      const rm = roomRef.current;
      if (
        supabase &&
        rm &&
        v?.currentRound &&
        v.currentRound.status === 'active' &&
        (v.status === 'active' || v.status === 'submitted')
      ) {
        const startedMs = toEpochMs(v.currentRound.startedAt);
        const serverNowEst = Date.now() + offsetRef.current;
        const expired = isRoundExpired(startedMs, rm.roundDurationSeconds, serverNowEst);
        const now = Date.now();
        if (expired && now - lastExpireAttemptRef.current > 1500) {
          lastExpireAttemptRef.current = now;
          void api.expireRound(supabase, target).then(() => doRefetch(target));
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [roomId, supabase, doRefetch]);

  // ── Auto-join a rematch room the moment it is created ─────────────────
  useEffect(() => {
    const rematchId = snapshot?.room.rematchRoomId;
    if (view?.status === 'final' && rematchId && roomId && rematchId !== roomId) {
      enterRoom(rematchId);
    }
  }, [view?.status, snapshot?.room.rematchRoomId, roomId, enterRoom]);

  // ── Actions ───────────────────────────────────────────────────────────
  const createRoom = useCallback(
    async (name: string) => {
      if (!supabase || !userId) return;
      const valid = validatePlayerName(name);
      if (!valid.ok) {
        setMenuError(valid.error);
        return;
      }
      setMenuError(null);
      setPhase('creating');
      setBusy(true);
      try {
        const ref = await api.createRoom(supabase, valid.name);
        enterRoom(ref.roomId);
      } catch (e) {
        setMenuError(errorMessage(e));
        setPhase('menu');
      } finally {
        setBusy(false);
      }
    },
    [supabase, userId, enterRoom],
  );

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      if (!supabase || !userId) return;
      const normalized = normalizeRoomCode(code);
      if (!isValidRoomCode(normalized)) {
        setMenuError('Enter a valid 6-character room code.');
        return;
      }
      const valid = validatePlayerName(name);
      if (!valid.ok) {
        setMenuError(valid.error);
        return;
      }
      setMenuError(null);
      setPhase('joining');
      setBusy(true);
      try {
        const ref = await api.joinRoom(supabase, normalized, valid.name);
        enterRoom(ref.roomId);
      } catch (e) {
        setMenuError(errorMessage(e));
        setPhase('menu');
      } finally {
        setBusy(false);
      }
    },
    [supabase, userId, enterRoom],
  );

  const startMatch = useCallback(async () => {
    if (!supabase || !roomId || !room) return;
    if (!view?.isHost || !view.bothPlayersPresent) return;
    setNotice(null);
    setBusy(true);
    try {
      const google = await ensureGoogleMaps();
      const pool = await locationProvider.getAll();
      const manifest = await buildManifest(google, pool, room.totalRounds);
      await api.startMatch(supabase, roomId, manifest);
      await doRefetch(roomId);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [supabase, roomId, room, view, doRefetch]);

  const submitGuess = useCallback(
    async (lat: number, lng: number) => {
      if (!supabase || !roomId) return;
      if (submittingRef.current) return; // in-flight de-dupe
      if (viewRef.current?.myGuess) return; // already submitted; guess is locked
      submittingRef.current = true;
      setBusy(true);
      try {
        await api.submitGuess(supabase, roomId, lat, lng);
        await doRefetch(roomId);
      } catch (e) {
        setNotice(errorMessage(e));
      } finally {
        submittingRef.current = false;
        setBusy(false);
      }
    },
    [supabase, roomId, doRefetch],
  );

  const advance = useCallback(async () => {
    const current = viewRef.current;
    if (!supabase || !roomId || !current?.currentRound) return;
    setBusy(true);
    try {
      await api.advanceRound(supabase, roomId, current.currentRound.roundNumber);
      await doRefetch(roomId);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [supabase, roomId, doRefetch]);

  const rematch = useCallback(async () => {
    if (!supabase || !roomId) return;
    setBusy(true);
    try {
      const ref = await api.createRematch(supabase, roomId);
      enterRoom(ref.roomId);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [supabase, roomId, enterRoom]);

  const leaveRoom = useCallback(async () => {
    const current = roomIdRef.current;
    if (supabase && current) {
      try {
        await api.leaveRoom(supabase, current);
      } catch {
        // Best-effort; tear down locally regardless.
      }
    }
    teardownRoom();
  }, [supabase, teardownRoom]);

  // ── Derived status + countdown ────────────────────────────────────────
  const status: MultiplayerStatus = useMemo(() => {
    if (!supaConfigured) return 'config-missing';
    if (!mapsKey) return 'needs-maps-key';
    if (authError) return 'error';
    if (!userId) return 'authenticating';
    if (!roomId) return phase;
    if (!snapshot || !view) return 'reconnecting';
    return view.status;
  }, [supaConfigured, mapsKey, authError, userId, roomId, phase, snapshot, view]);

  // Computed on every render (the 1s interval bumps state to force a render),
  // so the countdown ticks down smoothly and stays server-anchored.
  let secondsLeft: number | null = null;
  if (
    room &&
    view?.currentRound &&
    (view.status === 'active' || view.status === 'submitted')
  ) {
    const startedMs = toEpochMs(view.currentRound.startedAt);
    const serverNowEst = Date.now() + offsetRef.current;
    secondsLeft = remainingSeconds(startedMs, room.roundDurationSeconds, serverNowEst);
  }

  return {
    status,
    view,
    room,
    snapshot,
    menuError,
    notice,
    authError,
    busy,
    secondsLeft,
    connection,
    opponentOnline,
    initialCode,
    actions: {
      createRoom,
      joinRoom,
      startMatch,
      submitGuess,
      advance,
      rematch,
      leaveRoom,
      retryAuth: authenticate,
      clearMenuError: () => setMenuError(null),
      clearNotice: () => setNotice(null),
    },
  };
}
