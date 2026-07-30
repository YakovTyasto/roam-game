import { expect, expectReachable, openHome, tapForReal, test } from './support';

/**
 * Shared challenges in a real browser, with the deep link as the headline case:
 * `/challenge/<CODE>` typed straight into the address bar has to work, which
 * depends on an SPA rewrite (vercel.json) that only a real navigation exercises.
 *
 * `vite preview` serves the built app with SPA fallback, so this is a faithful
 * check of the client-side routing half. The rewrite itself is configuration and
 * is verified on the Vercel Preview deployment (see the deployment checklist).
 */

const CODE = 'A2B3C4D5E6';

function challengeInfo(overrides: Record<string, unknown> = {}) {
  return {
    playable: true,
    reason: 'ok',
    code: CODE,
    title: 'Friday five',
    difficulty: 'normal',
    round_count: 5,
    timer_seconds: 120,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    server_now: new Date().toISOString(),
    is_creator: false,
    creator_name: 'Maker',
    players_completed: 3,
    attempt: null,
    ...overrides,
  };
}

test.describe('shared challenges', () => {
  test('a direct deep link opens the challenge', async ({ page, supabase }) => {
    supabase.setRpc('roam_get_challenge_v2', () => challengeInfo());

    // Straight to the path — no home screen, no client-side navigation first.
    await openHome(page, `/challenge/${CODE}`);

    await expect(page.getByRole('heading', { name: 'Friday five' })).toBeVisible();
    await expect(page.getByText(/created by maker/i)).toBeVisible();
    expect(supabase.callsTo('roam_get_challenge_v2')[0].p_code).toBe(CODE);
  });

  test('the query fallback link works too', async ({ page, supabase }) => {
    // The shape that needs no host rewrite at all.
    supabase.setRpc('roam_get_challenge_v2', () => challengeInfo());
    await openHome(page, `/?c=${CODE}`);
    await expect(page.getByRole('heading', { name: 'Friday five' })).toBeVisible();
  });

  test('playing a challenge starts a server-selected run', async ({ page, supabase }) => {
    supabase.setRpc('roam_get_challenge_v2', () => challengeInfo());
    supabase.setRpc('roam_start_challenge_v2', (_p, stub) => {
      void stub;
      return {
        started: true,
        resumed: false,
        code: CODE,
        has_timer: true,
        run: {
          found: true,
          run_id: 'challenge-run-1',
          mode: 'challenge',
          difficulty: 'normal',
          total_rounds: 5,
          round_duration_seconds: 120,
          current_round: 1,
          total_score: 0,
          status: 'active',
          server_selected: true,
          server_now: new Date().toISOString(),
          rounds: Array.from({ length: 5 }, (_, i) => ({
            round_number: i + 1,
            status: i === 0 ? 'active' : 'pending',
            pano_id: `STUB_PANO_${i + 1}`,
            heading: 0,
            pitch: 0,
            zoom: 0,
            started_at: i === 0 ? new Date().toISOString() : null,
            expires_at: i === 0 ? new Date(Date.now() + 120_000).toISOString() : null,
            location_id: null,
            label: null,
            country: null,
            lat: null,
            lng: null,
            guess_lat: null,
            guess_lng: null,
            distance_km: null,
            score: null,
          })),
        },
      };
    });

    await openHome(page, `/challenge/${CODE}`);
    await tapForReal(page, page.getByRole('button', { name: /play this challenge/i }), 'Play');

    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });
    expect(supabase.callsTo('roam_start_challenge_v2')[0].p_code).toBe(CODE);
    // The client sends only the code — never a location list.
    expect(Object.keys(supabase.callsTo('roam_start_challenge_v2')[0])).toEqual(['p_code']);
  });

  test('an invalid code shows an error with a route home', async ({ page, supabase }) => {
    supabase.setRpc('roam_get_challenge_v2', () => ({ playable: false, reason: 'not_found' }));
    await openHome(page, `/challenge/${CODE}`);

    await expect(page.getByRole('heading', { name: /isn.t valid/i })).toBeVisible();
    const home = page.getByRole('button', { name: /back to home/i });
    await expectReachable(home, 'Back to home');
    await tapForReal(page, home, 'Back to home');
    await expect(page.getByRole('button', { name: /solo game/i })).toBeVisible();
  });

  test('an expired challenge says so', async ({ page, supabase }) => {
    supabase.setRpc('roam_get_challenge_v2', () => ({
      playable: false,
      reason: 'expired',
      title: 'Old one',
    }));
    await openHome(page, `/challenge/${CODE}`);
    await expect(page.getByRole('heading', { name: /expired/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /back to home/i })).toBeVisible();
  });

  test('creating a challenge yields a shareable link and a copy fallback', async ({
    page,
    supabase,
  }) => {
    supabase.setRpc('roam_create_challenge_v2', (p) => ({
      code: CODE,
      title: String(p.p_title ?? ''),
      difficulty: p.p_difficulty,
      round_count: p.p_round_count,
      timer_seconds: p.p_timer_seconds,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    supabase.setRpc('roam_get_challenge_v2', () => challengeInfo({ is_creator: true }));

    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /challenge a friend/i }), 'Challenge');

    await page.getByLabel(/challenge name/i).fill('Friday five');
    await tapForReal(
      page,
      page.getByRole('button', { name: /create challenge link/i }),
      'Create challenge link',
    );

    await expect(page.getByRole('heading', { name: 'Friday five' })).toBeVisible();
    expect(supabase.callsTo('roam_create_challenge_v2')[0].p_title).toBe('Friday five');
    // The creator sends configuration only — no locations, no coordinates.
    expect(Object.keys(supabase.callsTo('roam_create_challenge_v2')[0]).sort()).toEqual([
      'p_difficulty',
      'p_expires_hours',
      'p_round_count',
      'p_timer_seconds',
      'p_title',
    ]);

    // The share path must always report an outcome. Clipboard permissions are
    // unavailable in this context, so the fallback branch is what runs — and it
    // has to show the link rather than doing nothing.
    await tapForReal(page, page.getByRole('button', { name: /copy link/i }), 'Copy link');
    await expect(
      page
        .getByText(/link copied/i)
        .or(page.getByText(new RegExp(`/challenge/${CODE}`)))
        .first(),
    ).toBeVisible();
  });

  test('the code shown is the code in the link', async ({ page, supabase }) => {
    supabase.setRpc('roam_get_challenge_v2', () => challengeInfo());
    await openHome(page, `/challenge/${CODE}`);
    // Spoiler-free by construction: a code, never a place.
    await expect(page.getByText(CODE).first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Stub Place');
  });
});
