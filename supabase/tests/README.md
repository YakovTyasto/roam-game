# Database migrations & SQL verification

## Exact production application order

Apply every migration below, in this exact order, via the Supabase SQL
Editor (or `supabase db push`) before deploying the corresponding app code.
Each file is idempotent-safe to inspect but **not** designed to be re-run —
apply once, in order, per environment.

| # | File | Adds |
|---|---|---|
| 1 | `0001_multiplayer_schema.sql` | Core multiplayer schema (rooms, players, rounds, guesses), RLS |
| 2 | `0002_multiplayer_functions.sql` | Multiplayer RPCs (create/join/start/submit/advance/leave/rematch) |
| 3 | `0003_difficulty_and_party_rooms.sql` | Difficulty tiers, 2-8 player party rooms, host transfer |
| 4 | `0004_player_profiles_and_leaderboard.sql` | Player profiles, server-tracked solo runs, weekly leaderboard tables |
| 5 | `0005_v2_rpc_functions.sql` | Profile/solo-run/leaderboard RPCs |
| 6 | `0006_theme_locale_preferences.sql` | Nullable `theme_preference`/`locale_preference` profile columns + sync RPC |
| 7 | `0007_custom_round_config.sql` | Widens round count to 1-20; custom solo timer |
| 8 | `0008_solo_run_abandon.sql` | Explicit solo-run abandonment RPC |
| 9 | `0009_solo_run_resume.sql` | Extends the (already-existing) active-run RPC with server-time resume data |
| 10 | `0010_rate_limiting.sql` | Server-side rate limiting (generic counter + 4 wired RPCs) |
| 11 | `0011_location_history.sql` | Durable per-player location history (Diversity Engine V2) |

All of 6-11 are additive/backward-compatible: new nullable columns, widened
check constraints, one new table, and new or same-signature functions —
verified against a database seeded with pre-V3 (0001-0005-only) data and
against one seeded through 0010, see "Upgrade-path verification" below. Never
edit an applied migration file; a fix always ships as a new incremental
migration.

`0011` touches nothing that already exists: it adds one table, two indexes,
four functions and one RLS policy, and modifies no existing table, function,
policy or grant. Applying it cannot affect an active room, run or leaderboard.

## Upgrade-path verification

Three upgrade paths were verified against a real local Postgres instance
(not just a fresh 0001→latest apply):

- **0001→latest (fresh):** every suite below, run after applying all ten
  migrations to an empty database.
- **0005→latest (existing production data):** apply 0001-0005, seed a
  profile row (simulating real V2 production data), then apply 0006-0010 on
  top and re-run every suite — confirming the pre-existing row survives
  unchanged and new nullable columns correctly default to `NULL` rather than
  requiring a backfill.
- **0010→0011 (deployed V3 production schema):** apply 0001-0010, seed a
  profile row and a rate-limit row (simulating real V3 production data), then
  apply `0011` on top and run all seven suites — 122 assertions, all passing,
  with the pre-existing rows intact.

> The verification scripts are **not idempotent across repeated runs on the
> same database** (e.g. `03_theme_locale_verify.sql` asserts that a profile
> starts with `NULL` preferences, which is only true the first time). Run each
> suite once per freshly-migrated database.

## Running the suites locally

`01_multiplayer_verify.sql` exercises the migrations end-to-end and asserts the
security-critical guarantees directly in the database:

- **Scoring parity** — `mp_score` / `mp_haversine_km` match the solo TypeScript
  formula (e.g. `score(0)=5000`, `score(100)=4756`, Paris→London `=4217`).
- **Max two players** — a third `mp_join_room` is rejected; rejoin is idempotent.
- **Host-only start** — a guest calling `mp_start_match` is rejected.
- **Manifest validation** — duplicate locations / bad coordinates are rejected.
- **One guess per player per round** — double submit is idempotent, cannot
  overwrite, and `submitted_count` only counts real inserts.
- **Server-side scoring** — the stored score equals `mp_score(distance)`.
- **Timer** — early `mp_expire_round` is rejected; expiry only succeeds once the
  server clock passes `started_at + round_duration`.
- **Duplicate round advancement is safe** — concurrent `mp_advance_round(…, N)`
  calls advance exactly once (no double-advance).
- **RLS** — participants read their room; pending rounds, round targets, and the
  opponent's guess stay hidden until the round is complete; non-participants read
  nothing.
- **No direct writes** — `authenticated` cannot modify a score, room status, or
  insert a guess directly; `anon` cannot call the RPCs at all.

## Running locally

These scripts are for a **throwaway local Postgres**, not a real Supabase
project (see the warning in `00_local_stubs.sql`). With a local Postgres running:

```bash
createdb roam_mp_test
psql -d roam_mp_test -f supabase/tests/00_local_stubs.sql
psql -d roam_mp_test -f supabase/migrations/0001_multiplayer_schema.sql
psql -d roam_mp_test -f supabase/migrations/0002_multiplayer_functions.sql
psql -d roam_mp_test -f supabase/tests/01_multiplayer_verify.sql   # prints "OK: …" per assertion
```

A `NOTICE: OK: …` line is printed for every passing assertion; any failure
raises `ASSERT FAILED: …` and aborts. The script ends with
`ALL PART 1 TESTS PASSED` / `ALL PART 2 TESTS PASSED`.

## Roam v2 verification (`02_v2_verify.sql`)

`02_v2_verify.sql` exercises the v2 features after applying migrations
`0001`→`0005`:

- **Difficulty + party rooms** — create-room stores difficulty/capacity and
  derives the per-difficulty timer; players join up to capacity; a 9th join is
  rejected; a non-host `mp_start_match` is rejected; the host can start with 2+
  players even when the room isn't full.
- **Dynamic round completion** — a round completes only once *every eligible*
  player has submitted (never a fixed threshold of 2); duplicate submit is
  idempotent.
- **Leave / host transfer** — one player leaving does not destroy a party; a
  departure that leaves everyone else already submitted completes the round; the
  host leaving the lobby transfers host to the earliest remaining player; an
  empty room is abandoned.
- **Multiplayer results** — one `game_results` row per participant, idempotent,
  with competition placement + win flags.
- **Server-authoritative solo** — the answer is hidden for un-guessed rounds;
  each guess is scored server-side; finalize uses the server-summed total (the
  client cannot pass a score) and is idempotent; 5-round runs are eligible.
- **Leaderboard** — sanitized output contains no auth UUIDs; the caller's own
  entry is returned.
- **UTC weeks** — Monday 00:00 UTC boundaries and rollover.

```bash
# after the 0001→0005 apply loop above:
psql -d roam_mp_test -f supabase/migrations/0003_difficulty_and_party_rooms.sql
psql -d roam_mp_test -f supabase/migrations/0004_player_profiles_and_leaderboard.sql
psql -d roam_mp_test -f supabase/migrations/0005_v2_rpc_functions.sql
psql -d roam_mp_test -f supabase/tests/02_v2_verify.sql
```

Ends with `ALL V2 TESTS PASSED` and `ALL V2 HOST/WEEK TESTS PASSED`.

The stub file defines `auth.uid()` to read a `test.uid` GUC so the harness can
impersonate players with `select set_config('test.uid', '<uuid>', false)`; on
real Supabase, `auth.uid()` comes from the signed-in session instead.

## Theme/locale preference verification (`03_theme_locale_verify.sql`)

`03_theme_locale_verify.sql` exercises migration `0006` after `0001`→`0006`:

- `roam_set_preferences` no-ops (does not error) when the caller has no
  profile row yet.
- New/legacy profile rows default both preference columns to `NULL`.
- Valid `theme`/`locale` values persist and round-trip through
  `roam_get_profile`; a partial update leaves the other field untouched.
- Invalid values (e.g. `'purple'`, `'fr'`) are rejected server-side — the
  client is never trusted.
- No preference state leaks across users.

```bash
# after the 0001→0006 apply loop:
psql -d roam_mp_test -f supabase/migrations/0006_theme_locale_preferences.sql
psql -d roam_mp_test -f supabase/tests/03_theme_locale_verify.sql
```

Ends with `ALL THEME/LOCALE PREFERENCE TESTS PASSED`.

## Exit flow verification (`04_exit_flow_verify.sql`)

`04_exit_flow_verify.sql` exercises migration `0008` and the existing
`mp_leave_room` guarantees after `0001`→`0008`:

- `roam_abandon_solo_run` marks the run abandoned, is idempotent on a second
  call, and leaves the player profile untouched.
- An abandoned run can never be finalized (`roam_finalize_solo_run` rejects
  it) and produces zero `game_results` rows — abandoning never scores.
- A host leaving an **active** (not just lobby) room transfers host
  ownership deterministically to the earliest-joined remaining player
  (lowest slot), and the room keeps running for the remaining players.
- Duplicate/concurrent `mp_leave_room` calls for the same player are
  idempotent.
- The last eligible player leaving abandons the room cleanly (no deadlock).

```bash
# after the 0001→0008 apply loop:
psql -d roam_mp_test -f supabase/migrations/0007_custom_round_config.sql
psql -d roam_mp_test -f supabase/migrations/0008_solo_run_abandon.sql
psql -d roam_mp_test -f supabase/tests/04_exit_flow_verify.sql
```

Ends with `ALL EXIT FLOW TESTS PASSED`.

## Resume verification (`05_resume_verify.sql`)

`05_resume_verify.sql` exercises migration `0009` after `0001`→`0009`:

- `roam_get_active_solo_run` now returns `server_now` and each round's
  `started_at`/`location_id` (needed to restore the timer/panorama on the
  client — see `src/solo/resume.ts`).
- The pre-existing hidden-answer guarantee is unchanged: an active/pending
  round still withholds `lat`/`lng`/`label`/`country` — only `pano_id` (and
  now `location_id`, already no more revealing than `pano_id`) are visible
  before it's guessed.
- Completing a round reveals its answer and starts the next round's own
  `started_at`, so a later resume computes remaining time from the server's
  clock, not the client's.

```bash
# after the 0001→0009 apply loop:
psql -d roam_mp_test -f supabase/migrations/0009_solo_run_resume.sql
psql -d roam_mp_test -f supabase/tests/05_resume_verify.sql
```

Ends with `ALL RESUME TESTS PASSED`.

## Durable location history (`07_location_history_verify.sql`)

Verifies migration `0011` after applying `0001`→`0011`:

- **Recording** — rounds are recorded and read back newest-first; replaying a
  place moves its timestamp and updates its difficulty/mode rather than
  duplicating the row; duplicate ids inside one call collapse to one row.
- **Privacy** — a player reads only their own history; nothing exposes another
  player's places, and no RPC returns a user id.
- **Bounded storage** — history is capped at `roam_location_history_limit()`
  (250) rows per player, trimmed oldest-first, and reads cannot exceed the cap
  even when a larger limit is requested.
- **Argument validation** — unknown difficulty/mode and oversized batches are
  rejected; empty/`NULL` ids are skipped without failing the whole call (a
  partially corrupt local cache must still sync its good part).
- **Signed-out behaviour** — reads return an empty history rather than an
  error (solo play must work with no account); writes are rejected.
- **Reset** — scoped to the caller; another player's history is untouched.
- **Rate limiting** — recording is limited with the stable `RATE_LIMITED:`
  prefix, reusing the 0010 counter.
- **Grants and RLS** — clients hold **no** direct privileges on
  `location_history`; RLS is enabled with an owner-only select policy; `anon`
  cannot execute any history RPC; `authenticated` can; every new function pins
  `search_path = public, pg_temp`; both supporting indexes exist.

```bash
# after the 0001→0010 apply loop above:
psql -d roam_mp_test -f supabase/migrations/0011_location_history.sql
psql -d roam_mp_test -f supabase/tests/07_location_history_verify.sql
```

Ends with `=== 07_location_history_verify.sql: ALL ASSERTIONS PASSED ===`.
