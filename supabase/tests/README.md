# Multiplayer SQL verification

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

The stub file defines `auth.uid()` to read a `test.uid` GUC so the harness can
impersonate players with `select set_config('test.uid', '<uuid>', false)`; on
real Supabase, `auth.uid()` comes from the signed-in session instead.
