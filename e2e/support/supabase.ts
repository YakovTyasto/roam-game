import type { Page, Route } from '@playwright/test';

/**
 * A same-origin, in-Node stand-in for the Supabase backend.
 *
 * `VITE_SUPABASE_URL` points at `<origin>/__supabase` for the e2e build (see
 * playwright.config.ts) for one specific reason: a same-origin base means no
 * CORS preflight, so every request is a plain intercepted POST and the stub
 * cannot fail for reasons that have nothing to do with the app.
 *
 * What this buys us: the browser tests exercise the app in its *configured*
 * shape — anonymous session, profile RPCs, multiplayer menu, official runs —
 * instead of only the "backend missing" fallback screens. The unconfigured
 * paths stay covered by unit tests and by the dedicated offline specs, which
 * block the stub instead of removing it.
 *
 * The stub is deliberately dumb. It is not a second implementation of the SQL:
 * server authority is proven by the SQL verification files, not here. Its only
 * job is to answer plausibly so the UI can be driven.
 */

export interface SupabaseStub {
  /** Every RPC the app called, in order — for asserting what the UI triggered. */
  calls: { name: string; params: Record<string, unknown> }[];
  /** Replace/add an RPC handler mid-test (e.g. to make one endpoint fail). */
  setRpc(name: string, handler: RpcHandler): void;
  /** Make every RPC hang, to prove the UI stays interactive under a dead backend. */
  hangAll(): void;
  /** Make every RPC fail fast with an error payload. */
  failAll(message?: string): void;
  /** Calls recorded for one RPC name. */
  callsTo(name: string): Record<string, unknown>[];
}

export type RpcHandler = (
  params: Record<string, unknown>,
  stub: SupabaseStub,
) => unknown | Promise<unknown>;

const STUB_USER_ID = '11111111-2222-4333-8444-555555555555';

export async function installSupabaseStub(
  page: Page,
  overrides: Record<string, RpcHandler> = {},
): Promise<SupabaseStub> {
  const handlers = new Map<string, RpcHandler>(Object.entries(defaultHandlers()));
  for (const [name, handler] of Object.entries(overrides)) handlers.set(name, handler);

  let mode: 'normal' | 'hang' | 'fail' = 'normal';
  let failMessage = 'stubbed failure';

  const stub: SupabaseStub = {
    calls: [],
    setRpc(name, handler) {
      handlers.set(name, handler);
    },
    hangAll() {
      mode = 'hang';
    },
    failAll(message = 'stubbed failure') {
      mode = 'fail';
      failMessage = message;
    },
    callsTo(name) {
      return stub.calls.filter((c) => c.name === name).map((c) => c.params);
    },
  };

  await page.route('**/__supabase/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    if (path.endsWith('/user')) return json(route, { ...stubUser() });
    // /signup (anonymous sign-in) and /token (refresh) both return a session.
    return json(route, stubSession());
  });

  await page.route('**/__supabase/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    } catch {
      params = {};
    }
    stub.calls.push({ name, params });

    if (mode === 'hang') {
      // Never fulfilled: the request stays pending for the life of the page,
      // which is exactly what a hung backend looks like to the app.
      return;
    }
    if (mode === 'fail') {
      return json(route, { message: failMessage, code: 'PGRST000' }, 500);
    }

    const handler = handlers.get(name);
    if (!handler) {
      return json(
        route,
        { message: `stub has no handler for ${name}`, code: '42883' },
        404,
      );
    }
    return json(route, (await handler(params, stub)) ?? null);
  });

  // Realtime is not stubbed. Aborting the socket is honest: the app must stay
  // usable when realtime is unavailable, and any test that needs live updates
  // should drive them through polling/reconcile instead.
  await page.route('**/__supabase/realtime/**', (route) => route.abort());

  return stub;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

function stubUser() {
  return {
    id: STUB_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    is_anonymous: true,
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
}

/** A structurally valid (unsigned) session: gotrue-js reads `exp` from the JWT. */
function stubSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({ sub: STUB_USER_ID, role: 'authenticated', exp: expiresAt, aud: 'authenticated' }),
    'stub',
  ].join('.');
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'stub-refresh-token',
    user: stubUser(),
  };
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface StubOfficialRun {
  runId: string;
  difficulty: string;
  totalRounds: number;
  timerSeconds: number;
  /** Highest round number that has been guessed. */
  played: number;
  totalScore: number;
}

/**
 * The current stubbed official run. Module-scoped so the handler set below stays
 * a plain object; each `installSupabaseStub` call resets it by starting fresh.
 */
let officialRun: StubOfficialRun | null = null;

/** Mirror of `roam_run_payload` (migration 0015), including its reveal gate. */
function runPayload(): Record<string, unknown> {
  const run = officialRun!;
  const rounds = Array.from({ length: run.totalRounds }, (_, i) => {
    const n = i + 1;
    const complete = n <= run.played;
    return {
      round_number: n,
      status: complete ? 'complete' : n === run.played + 1 ? 'active' : 'pending',
      pano_id: `STUB_PANO_${n}`,
      heading: (n * 47) % 360,
      pitch: 0,
      zoom: 0,
      started_at: complete || n === run.played + 1 ? new Date().toISOString() : null,
      expires_at:
        n === run.played + 1
          ? new Date(Date.now() + run.timerSeconds * 1000).toISOString()
          : null,
      // The gate: answers exist only for completed rounds.
      location_id: complete ? `stub-location-${n}` : null,
      label: complete ? 'Stub Place' : null,
      country: complete ? 'France' : null,
      lat: complete ? 48.8584 : null,
      lng: complete ? 2.2945 : null,
      guess_lat: complete ? 48.85 : null,
      guess_lng: complete ? 2.3 : null,
      distance_km: complete ? 42.5 : null,
      score: complete ? 4200 : null,
    };
  });
  return {
    found: true,
    run_id: run.runId,
    mode: 'solo',
    difficulty: run.difficulty,
    total_rounds: run.totalRounds,
    round_duration_seconds: run.timerSeconds,
    current_round: Math.min(run.played + 1, run.totalRounds),
    total_score: run.totalScore,
    status: 'active',
    server_selected: true,
    server_now: new Date().toISOString(),
    rounds,
  };
}

/**
 * Defaults describe a brand-new player on a healthy backend: no profile yet, no
 * active run, no history. Specs override only what they care about.
 */
function defaultHandlers(): Record<string, RpcHandler> {
  officialRun = null;
  return {
    roam_get_profile: () => ({ exists: false }),
    roam_upsert_profile: (p) => ({ display_name: String(p.p_name ?? 'Player') }),
    roam_set_preferences: () => ({ ok: true }),
    roam_get_active_solo_run: () => ({ active: false }),
    roam_get_location_history: () => ({ groups: [] }),
    roam_record_location_history: () => ({ recorded: 1 }),
    roam_reset_location_history: () => ({ deleted: 0 }),

    roam_create_solo_run: (p) => ({
      run_id: '99999999-8888-4777-8666-555555555555',
      difficulty: p.p_difficulty,
      total_rounds: p.p_total_rounds,
      round_duration_seconds: 120,
    }),
    roam_submit_solo_guess: () => ({
      score: 4200,
      distance_km: 42.5,
      location_id: 'stub-location',
      lat: 48.8584,
      lng: 2.2945,
      label: 'Stub Place',
      country: 'France',
    }),
    roam_finalize_solo_run: () => ({ total_score: 4200, max_score: 25000, eligible: true }),
    roam_abandon_solo_run: () => ({ ok: true, abandoned: true }),

    roam_leaderboard: () => ({
      week_start: '2026-07-27T00:00:00Z',
      week_end: '2026-08-03T00:00:00Z',
      mode: 'solo',
      difficulty: 'normal',
      entries: [],
      self: null,
    }),

    // ── Official, server-selected runs (migration 0015) ──────────────────
    // A tiny in-memory version of the real run machine, faithful in the one way
    // that matters to the UI: an un-played round carries a panorama and NOTHING
    // else, and the answer appears only in the response to that round's guess.
    roam_catalog_summary: () => ({
      total: 325,
      easy: 90,
      normal: 147,
      hard: 88,
      countries: 79,
      continents: 6,
    }),
    roam_start_official_run_v2: (p, stub) => {
      const rounds = Number(p.p_total_rounds ?? 5);
      officialRun = {
        runId: 'aaaa1111-2222-4333-8444-555555555555',
        difficulty: String(p.p_difficulty ?? 'normal'),
        totalRounds: rounds,
        timerSeconds: Number(p.p_timer_seconds ?? 120),
        played: 0,
        totalScore: 0,
      };
      void stub;
      return runPayload();
    },
    roam_get_official_run_v2: () => (officialRun ? runPayload() : { found: false }),
    roam_submit_official_guess_v2: (p) => {
      if (!officialRun) return { message: 'Run not found.', code: 'P0001' };
      const roundNumber = Number(p.p_round_number ?? 1);
      officialRun.played = Math.max(officialRun.played, roundNumber);
      officialRun.totalScore += 4200;
      return {
        score: 4200,
        distance_km: 42.5,
        location_id: `stub-location-${roundNumber}`,
        lat: 48.8584,
        lng: 2.2945,
        label: 'Stub Place',
        country: 'France',
        already: false,
      };
    },
    roam_finalize_official_run_v2: () => {
      const total = officialRun?.totalScore ?? 0;
      const rounds = officialRun?.totalRounds ?? 5;
      officialRun = null;
      return {
        total_score: total,
        max_score: rounds * 5000,
        total_distance_km: 42.5 * rounds,
        eligible: rounds === 5,
        already: false,
      };
    },
    mp_start_match_v2: () => ({
      room_id: '77777777-6666-4555-8444-333333333333',
      code: 'ABC234',
      server_selected: true,
    }),

    mp_create_room: () => ({ room_id: '77777777-6666-4555-8444-333333333333', code: 'ABC234' }),
    mp_join_room: () => ({ room_id: '77777777-6666-4555-8444-333333333333', code: 'ABC234' }),
    roam_room_recent_groups: () => ({
      applied: false,
      reason: 'too_few_participants',
      participants_considered: 0,
      groups: [],
    }),
  };
}
