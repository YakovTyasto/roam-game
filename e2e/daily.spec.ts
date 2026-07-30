import { expect, expectReachable, expectTouchTarget, openHome, tapForReal, test } from './support';

/**
 * Daily Challenge, in a real browser.
 *
 * The interesting cases are the ones a unit test cannot reach: that the card is
 * tappable on a phone, that a Daily outage leaves the rest of the home screen
 * alone, and that resuming lands on the round the server says is next rather
 * than restarting the day.
 */

/** A stub status payload for a player who has not played today. */
function freshStatus() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  return {
    utc_day: now.toISOString().slice(0, 10),
    server_now: now.toISOString(),
    next_day_at: nextMidnight.toISOString(),
    round_count: 5,
    difficulty: 'normal',
    timer_seconds: 120,
    players_completed: 128,
    attempt: null,
    previous: null,
  };
}

test.describe('Daily Challenge', () => {
  test('the card is tappable and opens the Daily screen', async ({ page, supabase }) => {
    supabase.setRpc('roam_daily_status', () => freshStatus());
    await openHome(page);

    const card = page.getByRole('button', { name: /daily challenge/i });
    await expectReachable(card, 'Daily card');
    await expectTouchTarget(card, 'Daily card');
    await tapForReal(page, card, 'Daily card');

    await expect(page.getByRole('heading', { name: /daily challenge/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /play today/i })).toBeVisible();
  });

  test('playing starts a server-selected daily run with hidden answers', async ({
    page,
    supabase,
  }) => {
    supabase.setRpc('roam_daily_status', () => freshStatus());
    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /daily challenge/i }), 'Daily card');
    await tapForReal(page, page.getByRole('button', { name: /play today/i }), 'Play today');

    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });
    expect(supabase.callsTo('roam_start_daily_v2')).toHaveLength(1);
    expect(supabase.callsTo('roam_start_daily_v2')[0].p_practice).toBe(false);

    // Same secrecy guarantee as any official run.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Stub Place');
  });

  test('a partially played day resumes at the next round', async ({ page, supabase }) => {
    // The server says two of five rounds are done; the client must open round 3,
    // not restart the day (which would be a second attempt at a scored challenge).
    supabase.setRpc('roam_daily_status', () => ({
      ...freshStatus(),
      attempt: { status: 'active', rounds_played: 2, total_score: 8400 },
    }));
    supabase.setRpc('roam_start_daily_v2', () => {
      const now = new Date();
      const round = (n: number, complete: boolean) => ({
        round_number: n,
        status: complete ? 'complete' : n === 3 ? 'active' : 'pending',
        pano_id: `STUB_PANO_${n}`,
        heading: 0,
        pitch: 0,
        zoom: 0,
        started_at: now.toISOString(),
        expires_at: n === 3 ? new Date(now.getTime() + 120_000).toISOString() : null,
        location_id: complete ? `stub-location-${n}` : null,
        label: complete ? 'Stub Place' : null,
        country: complete ? 'France' : null,
        lat: complete ? 48.8584 : null,
        lng: complete ? 2.2945 : null,
        guess_lat: complete ? 48.85 : null,
        guess_lng: complete ? 2.3 : null,
        distance_km: complete ? 42.5 : null,
        score: complete ? 4200 : null,
      });
      return {
        started: true,
        resumed: true,
        utc_day: freshStatus().utc_day,
        run: {
          found: true,
          run_id: 'daily-run-1',
          mode: 'daily',
          difficulty: 'normal',
          total_rounds: 5,
          round_duration_seconds: 120,
          current_round: 3,
          total_score: 8400,
          status: 'active',
          server_selected: true,
          server_now: now.toISOString(),
          rounds: [round(1, true), round(2, true), round(3, false), round(4, false), round(5, false)],
        },
      };
    });

    await openHome(page);
    await tapForReal(page, page.getByRole('button', { name: /daily challenge/i }), 'Daily card');

    // The card and the screen both offer "continue", not "play".
    const resume = page.getByRole('button', { name: /continue today/i });
    await expectReachable(resume, 'Continue today’s challenge');
    await tapForReal(page, resume, 'Continue today’s challenge');

    await expect(page.getByRole('button', { name: 'Exit game' })).toBeVisible({ timeout: 30_000 });
    // Round 3's panorama — proof the client opened the round the server says is
    // next, rather than restarting a challenge that can only be scored once.
    await expect(page.getByTestId('stub-panorama')).toHaveAttribute('data-pano', 'STUB_PANO_3');
  });

  test('a completed day shows the result and offers only practice', async ({ page, supabase }) => {
    supabase.setRpc('roam_daily_status', () => ({
      ...freshStatus(),
      attempt: {
        status: 'complete',
        total_score: 21500,
        total_distance_km: 190.5,
        duration_ms: 245_000,
        completed_at: new Date().toISOString(),
        rank: 7,
        rounds_played: 5,
      },
    }));
    await openHome(page);

    await expect(page.getByRole('button', { name: /daily challenge.*completed/i })).toBeVisible();
    await tapForReal(page, page.getByRole('button', { name: /daily challenge/i }), 'Daily card');

    await expect(page.getByText('21,500')).toBeVisible();
    await expect(page.getByRole('button', { name: /replay for practice/i })).toBeVisible();
    // Crucially, no way to take a second official attempt.
    await expect(page.getByRole('button', { name: /^play today/i })).toHaveCount(0);
  });

  test('a Daily outage disables only the Daily card', async ({ page, supabase }) => {
    supabase.setRpc('roam_daily_status', () => {
      throw new Error('daily is down');
    });
    await openHome(page);

    const card = page.getByRole('button', { name: /daily challenge/i });
    await expect(card).toBeVisible();
    await expect(card).toBeDisabled();

    // Every other mode still works, and the failure is stated rather than silent.
    await expect(page.getByText(/classic solo still works/i)).toBeVisible();
    await tapForReal(page, page.getByRole('button', { name: /solo game/i }), 'Solo game');
    await expect(page.getByRole('heading', { name: /set up your game/i })).toBeVisible();
  });
});
