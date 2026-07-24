# Roam v2 — Difficulty, Party Rooms, Profiles & Weekly Leaderboard

This guide covers the v2 feature set layered on top of the working v1 app
(solo + private 1v1). It is written for someone deploying the upgrade to an
**existing production Supabase project** that already has migrations `0001` and
`0002` applied.

> **Golden rule:** never edit, rename, squash, or re-run `0001`/`0002`. All v2
> changes are additive migrations `0003`–`0005`. They are safe both on a
> production database upgraded from `0001`+`0002` and on a clean database that
> runs `0001`→`0005` in order.

---

## 1. Architecture overview

```
Difficulty (shared)                Profiles                     Leaderboard
  src/config/difficulty.ts           src/profile/                 src/leaderboard/
  src/utils/difficultyPool.ts          profileCache.ts (v1 cache)   weeks.ts (UTC weeks)
  (adjacent-pool fallback)             profileApi.ts (RPC, lazy)    types.ts
                                       useProfile.ts (hook)         leaderboardApi.ts (RPC, lazy)
                                                                    useLeaderboard.ts (hook)
Solo (server-authoritative)        Multiplayer (2–8 players)
  src/solo/soloRunApi.ts (lazy)      src/multiplayer/*  (machine, ranking, summary,
  src/solo/useSoloRun.ts             api, useMultiplayer, …)
```

Key principles carried over from v1 and preserved:

- **One Street View instance.** Unchanged. Party scoreboard/round events never
  remount the panorama (the game reads `submitted_count` + presence, not a
  re-render of the pano).
- **Database is authoritative.** All multiplayer + solo-run + profile +
  leaderboard writes go through `SECURITY DEFINER` RPCs. Clients hold only the
  publishable key; RLS + grants are the real protection.
- **Supabase is code-split.** The SDK loads in a separate chunk (`auth-*.js`)
  only when Supabase is configured (profile/leaderboard/multiplayer). With no
  Supabase config, solo play works fully offline with a local-only name.

---

## 2. Difficulty definitions

Internal values are stable and stored in the DB: `easy | normal | hard`.
User-facing copy lives only in `src/config/difficulty.ts`.

| Difficulty | Round timer | Pool                                         | For |
|-----------|-------------|----------------------------------------------|-----|
| Easy      | **180 s**   | Iconic cities/landmarks with strong clues    | New players |
| Normal    | **120 s**   | Balanced urban/suburban/rural (v1 default)   | The classic experience |
| Hard      | **75 s**    | Remote/rural/ambiguous spots                 | Experienced players |

- Movement is allowed in all three (unchanged Street View behaviour).
- Locations are tagged with a `difficulty` in `src/data/locations.ts`
  (Easy 15 / Normal 21 / Hard 14, ≥ 5 unique per tier with country diversity).
- The **shared** selector (`buildDifficultyPool`) is used by both solo and
  multiplayer so behaviour can't drift. If a tier can't supply enough unique
  locations for a game, it widens into adjacent tiers in a fixed order
  (`easy→normal→hard`, `hard→normal→easy`, …) and reports `usedFallback`; it
  never silently reuses one global pool. Validated by `difficultyPool.test.ts`.

---

## 3. Player capacity behaviour (2–8)

- Host picks capacity **2–8** at room creation; difficulty is chosen then too
  and **locked** for the match (and preserved in rematches).
- Start requires **≥ 2** players present — the room need not be full.
- **Dynamic round completion:** a round completes when *every eligible player*
  (connection ≠ `left`) has submitted, or the server timer expires. There is no
  hard-coded threshold of 2. Non-submitters score 0 for that round.
- **Leaving:**
  - Lobby: the slot is freed. If the host leaves, host transfers to the earliest
    remaining player; if nobody remains, the room is abandoned.
  - Active match: the player is marked `left` (kept for scoring/slots). The match
    continues for the rest; a departed player scores 0 for missed rounds. If the
    host leaves, host transfers. If nobody eligible remains, the match is
    abandoned. A departure that leaves all remaining players already submitted
    completes the round immediately (no stall).
  - Reconnect with the same anonymous identity restores the player (idempotent
    `mp_join_room`, offline→online).
- **Old rooms** created before v2 default to `difficulty = normal`,
  `max_players = 2`.

---

## 4. Profile persistence behaviour

- Anonymous Supabase auth only — no email/password/social/account UI.
- First visit: ensure an anonymous session → show the name screen → sanitize →
  persist via `roam_upsert_profile` → cache under `roam.playerProfile.v1`.
- Returning visit: restore the session, load the profile, **skip** the name
  screen. The cached name renders instantly (never flashes onboarding) while the
  server profile is confirmed in the background.
- Offline/misconfigured: falls back to a **local-only** name so solo still
  works; leaderboard/multiplayer surfaces clearly report online services are
  unavailable.
- Change name any time in **Settings → Display name** (updates future
  leaderboard display via the same RPC).
- The anonymous **user id is the authoritative identity**; local storage is only
  a cache. Clearing site data or switching browser/device yields a new anonymous
  identity + name (documented, expected).

---

## 5. Weekly leaderboard rules

- A week is **Monday 00:00:00 UTC → the following Monday 00:00:00 UTC**,
  computed from the DB/server clock (`roam_week_start`/`roam_week_end`). No
  destructive weekly reset — historical rows are kept; the active week is
  queried by `week_start`.
- **Primary ranking:** the player's **best eligible 5-round score** that week
  (max 25,000), descending. Tie-breakers, in order: more multiplayer wins (for
  the MP filter), fewer games needed to reach that best score, earliest
  achievement timestamp.
- **Filters:** Mode (Solo / Multiplayer) × Difficulty (Easy / Normal / Hard).
  Difficulties are never mixed in one ranking.
- Shows the current week range, a reset countdown, top 50, and the current
  player's own position even when outside the top 50; loading/empty/offline/
  error states are all handled.
- **Eligibility:** only completed, valid **5-round** games count. Abandoned,
  incomplete, or non-5-round games are excluded (`eligible = false`).
- **Privacy:** the read RPC (`roam_leaderboard`) returns only rank, sanitized
  display name, and stats — never UUIDs/emails/tokens.

---

## 6. Exact new migration order

```
supabase/migrations/
  0001_multiplayer_schema.sql          # v1 — DO NOT TOUCH
  0002_multiplayer_functions.sql       # v1 — DO NOT TOUCH
  0003_difficulty_and_party_rooms.sql  # v2 — difficulty + 2–8 players + dynamic completion + host transfer
  0004_player_profiles_and_leaderboard.sql  # v2 — profiles, solo runs, game_results, week helpers
  0005_v2_rpc_functions.sql            # v2 — profile/solo/leaderboard RPCs + MP result recording
```

Run strictly in numerical order.

---

## 7. Applying only `0003+` to an existing production database

Your production DB already has `0001`+`0002`. Apply **only** the three new files,
in order, via the Supabase SQL editor (or CLI):

```bash
# CLI example (psql against your project)
psql "$SUPABASE_DB_URL" -f supabase/migrations/0003_difficulty_and_party_rooms.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0004_player_profiles_and_leaderboard.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0005_v2_rpc_functions.sql
```

Each file is idempotent (`add column if not exists`, `create or replace`,
`drop … if exists`) so a re-run is safe. `0003` **drops** the old
`mp_create_room(text,int,int)` signature and replaces it with the
difficulty/capacity-aware one, so no obsolete overload can bypass the new rules.

---

## 8. Validating a successful migration

Run the SQL verification scripts against a **throwaway local Postgres** (never
production — see the warning in `supabase/tests/00_local_stubs.sql`):

```bash
createdb roam_v2_test
psql -d roam_v2_test -f supabase/tests/00_local_stubs.sql
for f in 0001_multiplayer_schema 0002_multiplayer_functions \
         0003_difficulty_and_party_rooms 0004_player_profiles_and_leaderboard \
         0005_v2_rpc_functions; do
  psql -d roam_v2_test -f supabase/migrations/$f.sql
done
psql -d roam_v2_test -f supabase/tests/01_multiplayer_verify.sql   # v1 regression
psql -d roam_v2_test -f supabase/tests/02_v2_verify.sql            # v2 features
```

`02_v2_verify.sql` asserts (prints `OK: …` per check): profile sanitization,
create-room difficulty/capacity + derived timer, join up to capacity, 9th-player
rejection, non-host start rejection, start with 2+ (not full), **dynamic** round
completion (not fixed 2), duplicate-submit idempotency, one-player-leave keeps
the party alive, host transfer, empty-room abandonment, per-participant result
recording + idempotency, server-authoritative solo scoring + finalize
idempotency, sanitized leaderboard (no UUIDs), and UTC Monday week boundaries.

**On production**, after applying, spot-check with read-only queries:

```sql
-- Columns backfilled on old rooms:
select difficulty, max_players from public.multiplayer_rooms limit 5;   -- normal / 2
-- New functions exist and are granted only to authenticated:
select proname from pg_proc where proname in
 ('mp_create_room','roam_upsert_profile','roam_leaderboard','roam_finalize_solo_run');
-- RLS enabled on the new tables:
select relname, relrowsecurity from pg_class
 where relname in ('player_profiles','solo_runs','solo_run_rounds','solo_run_guesses','game_results');
```

---

## 9. Vercel deployment order

**Apply the DB migrations BEFORE deploying the new frontend.** The v2 client
calls the new RPCs; deploying it against a database that lacks them would break
profiles/leaderboard/party features.

1. Review `0003`–`0005`.
2. Apply `0003`→`0005` to Supabase (numerical order).
3. Verify tables/functions/policies (section 8).
4. Confirm env vars in Vercel (section 13; **no new variables**).
5. Deploy the feature branch as a Vercel **preview** and test it.
6. Merge to `main`.
7. Verify the production Vercel deployment.

---

## 10. Multi-browser test plan

Use several isolated sessions (separate browsers / private windows / profiles —
each gets its own anonymous identity):

1. First-visit name onboarding; reload → name restored, no onboarding flash.
2. Solo Easy / Normal / Hard — confirm 180 / 120 / 75-second timers and the
   difficulty label in the HUD + results.
3. Create a **2-player** room (host + 1 join) → play → final ranking.
4. Create an **8-capacity** room; join with up to 7 more sessions; start with
   just 2 present to confirm "start when ≥ 2".
5. Submit guesses out of order; confirm the round only completes when everyone
   eligible has submitted.
6. Let a round time out with a missing guess → that player gets 0.
7. Have a guest leave mid-match → match continues; departed player scores 0.
8. Have the host leave the lobby → host badge transfers to another player.
9. Reconnect a player (reload) → restored under the same identity.
10. Finish a match → per-round ranking, final 1..N standings with ties, rematch.
11. Open the leaderboard → correct week range/countdown, filters by mode +
    difficulty, own row highlighted, own position shown when outside top 50.
12. Finish a 5-round solo/MP game → confirm it appears on the leaderboard after
    a refresh.

To avoid burning Google quota, prefer the SQL verify scripts (which exercise the
state machine without any Street View loads) for the party/scoring logic.

---

## 11. Rollback / recovery notes

- The v2 migrations are **additive**. To roll back the *frontend*, redeploy the
  previous build — the new tables/functions simply go unused.
- The new tables (`player_profiles`, `solo_runs`, `solo_run_rounds`,
  `solo_run_guesses`, `game_results`) can be dropped if you must fully revert,
  but this deletes leaderboard/profile data. `0003`'s room-column additions are
  backward-compatible with the v1 client (it ignores `difficulty`/`max_players`).
- `0003` replaces several RPCs via `create or replace`; to fully restore the v1
  signatures you would re-run `0002` (it does not drop the v2-only functions).
  In practice, prefer rolling forward.

---

## 12. Known MVP anti-cheat limitations

- The curated dataset is still bundled with the client; a determined user can
  read coordinates from the app bundle (documented v1 trade-off).
- A round's panorama id must be rendered on the client, so a sophisticated user
  could resolve it back to coordinates. **However**, they cannot write a
  fabricated leaderboard score: solo scores are computed server-side per guess
  (`roam_submit_solo_guess`) and finalized once (`roam_finalize_solo_run`); the
  client never passes a total. Multiplayer scores are server-computed as before.
- Solo-run resume-after-refresh RPC exists (`roam_get_active_solo_run`) but the
  UI does not yet reattach to an in-progress run; a mid-solo refresh starts a
  fresh game, and the stale run is auto-abandoned on the next start (one active
  run per user).

---

## 13. Google Maps usage for up to 8 players

Every client in a room renders the **same** single panorama per round, so an
8-player room means the same billable panorama is loaded once per client (8×),
not 8 different panoramas. The single-instance rule still holds *per client*:
scoreboard/presence changes never reload the pano. The server-tracked solo run
adds cheap Street View **metadata** resolves (to build the manifest) on top of
the one billable panorama load per round; the billable load count per solo game
is unchanged.

---

## 14. Future CAPTCHA / rate-limit recommendations

Before a large public launch, consider:

- CAPTCHA / attestation on anonymous sign-in and profile creation to slow
  automated identity churn.
- Server-side rate limits on room creation and solo-run creation per user/IP
  (an MVP guard already limits each user to one active solo run and frees lobby
  slots on leave).
- Monitoring on `game_results` insert rates for anomaly detection.
- These are hardening steps; the current build already blocks direct score
  writes, duplicate results, over-capacity joins, and cross-user profile edits.

---

## Environment variables (unchanged)

No new variables. Continue using:

```
VITE_GOOGLE_MAPS_API_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Use only the **publishable** Supabase key in the browser — never a
secret/service_role key.
