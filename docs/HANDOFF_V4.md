# Handoff — Engagement, Diversity & Game Modes V4

**Status: partial. Section 2 (Diversity Engine V2) is complete. Sections 3–17
are not started.** Resume at **section 2.6 (dataset expansion tooling)**, then
section 3 (server location catalog).

Nothing in this branch is a placeholder. There are no fake buttons, no "coming
soon" controls, no mock production data, no unprotected RPCs, and no screens for
features that do not exist. What is here works end to end; what is not here is
listed explicitly below.

---

## 1. Architecture summary

The work replaces the location-selection system wholesale and adds durable,
cross-device novelty state.

```
src/config/
  geography.ts      Continent vocabulary + factual country tables
  collections.ts    Themed collections (derived where factual, curated where not)
  diversity.ts      Freshness targets and pool-size arithmetic
src/utils/
  canonicalGroup.ts Canonical "one place" grouping (explicit > pano > proximity)
src/diversity/
  shuffleBag.ts     Fisher-Yates, novelty ranking, cycle bookkeeping (pure)
  geoSpread.ts      Soft in-match geographic spread (pure)
  engine.ts         The one selection pipeline every mode calls (pure)
  bagStorage.ts     Bounded, malformed-safe local bag persistence
  store.ts          Sync read + commit-on-round-start
  historyApi.ts     Supabase RPC wrappers (dynamically imported)
  historySync.ts    Non-blocking background sync + bounded outbox
  simulate.ts       Deterministic simulation harness
src/audit/
  datasetAudit.ts   Pure, machine-readable catalog audit
  formatAudit.ts    Markdown rendering of the same report object
src/multiplayer/
  roomDiversity.ts  Anonymised room-wide novelty ranking
supabase/migrations/
  0011_location_history.sql   Durable per-player history
  0012_room_diversity.sql     Anonymised room aggregate RPC
```

Selection pipeline, in strict order: **collection filter → difficulty pool
(adjacent-tier fallback only when necessary) → canonical grouping → shuffle bag
→ novelty tie-break → soft geographic spread.** Solo, Endless and multiplayer
all call the same function, so they cannot drift.

Full design rationale, including the diagnosis that motivated the rewrite, is in
[`docs/DIVERSITY_V4.md`](DIVERSITY_V4.md).

---

## 2. Branch

`claude/engagement-diversity-v4-jeps8l`

> **Naming note.** The task text asked for `feature/engagement-diversity-v4`.
> The session's operating instructions mandate the branch above and forbid
> pushing anywhere else, so that is what was used. Only this branch was pushed.
> No PR was opened, nothing was merged, nothing was deployed, and no migration
> was applied to production.

Branched from `origin/main` at `cedade9` — the merge of PR #6, which is the
deployed, fixed V3 main.

---

## 3. Commits by feature

| Commit | Feature |
| --- | --- |
| `18f25f2` | 2.1 — Catalog audit + canonical location grouping |
| `213c737` | 2.2 — Shuffle-bag selection replacing random draws |
| `be377f8` | 2.5 — In-match geographic spread |
| `2d89f9c` | 2.3 — Durable per-player location history (migration 0011) |
| `423e4e6` | 2.4 — Room-wide multiplayer novelty (migration 0012) |
| `0926434` | 2.7 — Statistical verification over simulated games |

---

## 4. Completed sections

- **1 — Safety and Git workflow.** All prerequisites verified before any edit
  (see §16).
- **2.1 — Dataset audit.** Machine-readable + human-readable, with canonical
  deduplication.
- **2.2 — Shuffle-bag selection.**
- **2.3 — Persistent server-side history.**
- **2.4 — Multiplayer diversity.**
- **2.5 — Diversity inside a match.**
- **2.7 — Statistical tests.**

## 5. Incomplete sections

**Not started. No partial UI, scaffolding or stubs exist for any of these.**

- **2.6 — Dataset expansion tooling.** *(resume here)* The audit already
  reports exactly how much catalog growth is required; the safe
  validate/verify/import workflow is not built.
- **3 — Server location catalog.**
- **4 — Daily Challenge.**
- **5 — Challenge Links.**
- **6 — Country Streak.**
- **7 — Player statistics.**
- **8 — Achievements.**
- **9 — Shareable result cards.**
- **10 — Multiplayer room modifiers.**
- **11 — Themed collections (UI).** The tag/collection *model* is built,
  validated and audited (section 2 needs it), and collection selection works in
  the engine. No collection picker is exposed to players, which is deliberate:
  the audit shows several collections are too small to ship.
- **12 — Navigation and home-screen UX.**
- **13 — Localization/themes/accessibility/PWA for new features.** No new
  user-facing surface was added, so nothing new needed translating. Existing
  behaviour is unchanged.
- **14 — Performance and Google usage.** Verified for this change (§18), not
  re-audited for unbuilt features.
- **15 — Security and database.** Done for 0011/0012 only.
- **16 — Testing.** Unit/SQL done. **Browser interaction tests were not
  written** — see §18 for what this means for confidence.
- **17 — Final handoff.** This document.

---

## 6. Changed files by subsystem

**Config / model**
`src/config/geography.ts` (new), `src/config/collections.ts` (new),
`src/config/diversity.ts` (new), `src/types/index.ts`, `src/data/locations.ts`

**Diversity engine**
`src/diversity/{shuffleBag,geoSpread,engine,bagStorage,store,historyApi,historySync,simulate}.ts`
(all new), `src/utils/canonicalGroup.ts` (new), `src/utils/selectRounds.ts`,
`src/utils/endlessSelection.ts`, `src/utils/locationHistory.ts`

**Audit**
`src/audit/{datasetAudit,formatAudit}.ts` (new), `scripts/audit-dataset.ts` (new),
`docs/DATASET_AUDIT.md`, `docs/dataset-audit.json` (generated)

**Providers / game wiring**
`src/providers/LocationProvider.ts`, `src/App.tsx`, `src/solo/useSoloRun.ts`

**Multiplayer**
`src/multiplayer/{roomDiversity.ts (new),manifest.ts,useMultiplayer.ts,api.ts,database.types.ts}`

**Database**
`supabase/migrations/{0011_location_history,0012_room_diversity}.sql` (new),
`supabase/tests/{07_location_history_verify,08_room_diversity_verify}.sql` (new),
`supabase/tests/README.md`

**Docs / tooling**
`docs/DIVERSITY_V4.md` (new), `docs/HANDOFF_V4.md` (new), `package.json`

---

## 7. Catalog audit — exact counts

Generated by `npm run audit:dataset`; full report in
[`docs/DATASET_AUDIT.md`](DATASET_AUDIT.md).

| Metric | Value |
| --- | --- |
| Locations (rows) | 50 |
| **Canonical groups (distinct places)** | **50** |
| Redundant rows | 0 |
| Countries | 38 |
| Continents | 6 |

**By difficulty:** Easy 15, Normal 21, Hard 14 — all with zero redundancy.

**By continent:** Europe 16, Asia 10, North America 9, South America 6,
Oceania 5, Africa 4.

**By collection (shippable = can fill a standard game twice over):**

| Collection | Groups | Shippable |
| --- | --- | --- |
| world | 50 | yes |
| famous | 23 | yes |
| capitals | 22 | yes |
| europe | 16 | yes |
| left-driving | 14 | yes |
| islands | 12 | yes |
| asia | 10 | yes |
| north-america | 9 | **no** |
| south-america | 6 | **no** |
| oceania | 5 | **no** |
| africa | 4 | **no** |
| rural | 0 | **no** |

**Verdict: the catalog is too small.** A default game (Normal, 5 rounds) draws
from **21** places. Ten repeat-free consecutive games need **50** — a shortfall
of **29**. It supports **4** repeat-free standard games today.

Required growth to make every offered length comfortable (own-tier groups,
ignoring adjacent-difficulty fallback):

| Difficulty | Rounds | Now | Target | Must add |
| --- | --- | --- | --- | --- |
| easy | 3 / 5 / 10 / 20 | 15 | 30 / 50 / 100 / 200 | 15 / 35 / 85 / 185 |
| normal | 3 / 5 / 10 / 20 | 21 | 30 / 50 / 100 / 200 | 9 / 29 / 79 / 179 |
| hard | 3 / 5 / 10 / 20 | 14 | 30 / 50 / 100 / 200 | 16 / 36 / 86 / 186 |

**No selection algorithm can close this gap** — it can only make the most of
what exists. Section 2.6 is the mechanism for closing it safely, and it is not
built.

## 8. Duplicate / near-duplicate findings

**None.** This is the headline diagnostic result: the variety problem was never
duplication.

| Check | Result |
| --- | --- |
| Duplicate `location_id` | 0 |
| Duplicate `pano_id` | 0 |
| Identical coordinate pairs | 0 |
| Near-duplicate pairs (≤ 1 km) | 0 |
| Locations sharing a ≤ 25 km cluster | 0 |
| Explicit location groups | 0 |
| Metadata issues | 0 |

The canonical-grouping machinery is still built and enforced — it is what keeps
this true as the catalog grows, and it is the unit history and the bag store.

## 9. Diversity simulation results

100 games per row, Normal tier, shipped catalog (21-place pool), seeded RNG:

| Rounds | Fresh rounds before first repeat | Cycles | Served | Per-place min/max | CoV | Countries/game | Continents/game | Duplicate matches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 21 / 21 | 14 | 21/21 | 14 / 15 | 0.032 | 3.00 | 2.51 | 0 |
| 5 | 21 / 21 | 23 | 21/21 | 23 / 24 | 0.016 | 4.99 | 3.40 | 0 |
| 10 | 21 / 21 | 47 | 21/21 | 47 / 48 | 0.010 | 9.84 | 4.84 | 0 |
| 20 | 21 / 21 | 95 | 21/21 | 95 / 96 | 0.004 | 19.09 | 5.95 | 0 |

On a 60-place synthetic pool over 240 games (20 whole cycles): every place
served exactly 20 times, coefficient of variation **0**, top-ten share 16.7%.
Evenness is structural, not luck.

---

## 10. New migrations, in exact order

1. `supabase/migrations/0011_location_history.sql`
2. `supabase/migrations/0012_room_diversity.sql`

Both are strictly additive. `0011` adds one table, two indexes, four functions
and one RLS policy. `0012` adds a single read-only RPC. **Neither modifies any
existing table, function, policy or grant**, so applying them cannot disturb an
active room, run, profile or leaderboard.

## 11. SQL upgrade verification

Run against a real local PostgreSQL 16 instance (throwaway, using the existing
`00_local_stubs.sql` harness):

| Path | Result |
| --- | --- |
| Fresh `0001`→`0012` | All 8 suites pass — 151 assertions |
| `0010` → `0011`/`0012` with seeded V3-shaped data (profile + rate-limit rows) | All 8 suites pass; pre-existing rows intact |

Per-suite on both paths: multiplayer 53, v2 26, theme/locale 7, exit flow 8,
resume 3, rate limit 9, location history 16, room diversity 15 (was 14 before
the added start-idempotency assertion).

> The verify scripts are **not idempotent across repeated runs on the same
> database** (`03_theme_locale_verify.sql` asserts a profile starts with `NULL`
> preferences). Run each once per freshly-migrated database. This is
> pre-existing, now documented in `supabase/tests/README.md`.

## 12. Security / RLS / grants summary

- **RLS enabled** on `location_history`, with an owner-only (`user_id =
  auth.uid()`) select policy, and **zero direct table privileges** granted to
  `anon` or `authenticated`. The RPCs are the only access path. No
  insert/update/delete policy exists at all.
- **Identity is always `auth.uid()`.** No RPC accepts a caller-supplied user id.
- **All five new functions** are `SECURITY DEFINER` with
  `set search_path = public, pg_temp`, revoked from `public`, `anon` and
  `authenticated`, then granted only to `authenticated`. `anon` can execute
  none of them (asserted in SQL).
- **No auth UUID is ever returned** by any new RPC.
- **No future target, coordinate or label** is exposed. Group ids are opaque
  catalog identifiers for places already played.
- **Rate limiting** extends the existing 0010 counter to every new sensitive
  RPC, with the stable `RATE_LIMITED:` prefix.
- **Bounded cleanup**: per-player trim to 250 rows on write, plus an
  opportunistic `LIMIT 500` purge of year-old rows — no `pg_cron` dependency.
- **Concurrency**: `mp_start_match` already takes `for update` on the room and
  rejects a non-`lobby` status; an explicit assertion now proves a second start
  cannot create a second manifest.
- **Room aggregate privacy** (`0012`): caller's own rows excluded, no-op below
  three participants, counts only over *other* participants, no identities. The
  reasoning — and the deliberate 2-player limitation — is documented in the
  migration header and in `docs/DIVERSITY_V4.md`.
- **No secrets** were read, printed, staged or committed. `.env.local` was never
  opened. No service-role key exists anywhere in the client.

## 13. New environment variables

**None.** No public variable, no secret. The work uses the existing
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` /
`VITE_GOOGLE_MAPS_API_KEY` configuration unchanged.

## 14. Manual Supabase steps

Apply `0011` then `0012` via the SQL Editor or `supabase db push`. Nothing else
— no dashboard configuration, no policy edit, no role change, no scheduled job.

## 15. Optional scheduled jobs

**None required, and none added.** Cleanup for both new features is
opportunistic and bounded inside the RPCs, matching the pattern 0010
established. A future `pg_cron` job could purge stale history more eagerly, but
the feature is fully functional without one.

## 16. Vercel routing / deep links

**No change.** This work adds no route, no deep link and no client-side routing.
The existing SPA configuration is untouched.

---

## 17. Prerequisite verification (section 1)

| Check | Result |
| --- | --- |
| Latest remote fetched | ✓ |
| Starting point is deployed/fixed V3 main | ✓ `origin/main` = `cedade9` (PR #6 merge) |
| Unresponsive-entry-button timeout fix present | ✓ commit `3ecde4b` + `src/utils/withTimeout.ts` |
| Migrations 0001–0010 present | ✓ |
| Working tree clean before edits | ✓ |
| Migrations 0001–0010 unmodified | ✓ |
| No destructive Git commands used | ✓ |

## 18. Test / lint / typecheck / build results

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm run test` | **527 passed / 527** (51 files; baseline was 316) |
| `npm run build` | pass |
| `npm run audit:dataset:check` | pass — artifacts current, catalog clean |
| SQL suites | 151 assertions pass on both migration paths |

Formatting: no formatter is configured in this repo, so none was run.

### Browser / device test results

**Not performed.** No Playwright/browser harness exists in this repo, and
building one is section 16's work, which was not reached. This is the main gap
in confidence for this branch, and it should not be glossed over:

- The **diversity engine, storage, sync, audit and both migrations** are
  covered by unit and SQL tests to a high standard, including adversarial cases
  (malformed storage, hostile payloads, unavailable storage, tiny pools).
- The **wiring into `App.tsx` and `useMultiplayer.ts`** — the round-start
  commit effect, the startup sync effect, and the host's room-aggregate lookup
  — is exercised only indirectly. It is deliberately built so that every new
  path is non-blocking and failure-swallowing (see below), but that reasoning
  has not been confirmed in a real browser at iPhone/iPad/desktop viewports.

Given the V3 production incident, the specific loading-gate risk was designed
against directly:

- `readDiversityState()` is synchronous, network-free and cannot throw.
- `syncLocationHistory()` is awaited by nobody, bounded at 8 s, and returns a
  result object on every failure path rather than rejecting.
- The room aggregate is bounded at 2.5 s and falls back to host-only history.
- No new code gates first paint, a screen transition, or a button.

Recommended before any production deploy: manual smoke test of home → solo
start → five rounds → final, plus a multiplayer room, on one mobile and one
desktop browser.

## 19. Bundle comparison

Built from `origin/main` and from this branch with the same toolchain:

| Chunk | main | this branch | Δ |
| --- | --- | --- | --- |
| `index-*.js` (main) | 403.91 kB (125.82 kB gz) | 417.73 kB (129.89 kB gz) | **+13.8 kB (+4.1 kB gz)** |
| `auth-*.js` (Supabase, lazy) | 216.68 kB | 216.68 kB | unchanged |
| `MultiplayerApp-*.js` (lazy) | 36.84 kB | 36.84 kB | unchanged |
| PWA precache | 762.13 KiB | 772.27 KiB | +10.1 KiB |

The +13.8 kB is the diversity engine, canonical grouping, geography/collection
tables and the audit types. **Supabase remains fully lazy** — `historyApi.ts` is
only ever reached through a dynamic `import()`, and the `auth` chunk is
byte-identical, confirming nothing leaked into the solo path.

The audit module is imported by the CLI and tests; it is tree-shaken from the
app bundle (`App.tsx` never references it).

## 20. Google Maps usage implications

**No increase in billable panorama loads.** Specifically:

- The single `StreetViewPanorama` instance and its ref/singleton guards are
  untouched.
- No panorama is preloaded, and no hidden panorama is instantiated. Selection is
  pure computation over bundled data.
- `buildManifest` resolves panoramas exactly as before — one lookup per
  candidate until `count` playable rounds are found. It now receives a
  *better-ordered* candidate list, which if anything reduces retries.
- The new history/sync/room-aggregate calls are Supabase only. They touch no
  Google API.
- Recording moved from selection time to round start, which does not change how
  many panoramas load.

## 21. Known limitations

1. **The catalog is too small** (§7). This is the binding constraint on
   perceived variety, and the engine cannot fix it. 29 more Normal-tier places
   are needed for the stated freshness target.
2. **Two-player rooms get no room-wide novelty.** With one other participant,
   any aggregate entry would be attributable to that person, so the RPC returns
   nothing and the host falls back to their own history. Deliberate, documented,
   and asserted in SQL.
3. **~0.7% of five-round games** on the real catalog contain two consecutive
   rounds from the same country — forced by a 21-place tier in which Canada is
   the only twice-represented country. The rule is soft so the game still
   starts.
4. **No browser interaction tests** (§18).
5. **Client-rendered Street View remains inspectable.** The active round's pano
   id is necessarily on the client. Nothing here changes that, and no claim of
   anti-cheat concealment is made — the existing honest note in
   `docs/MULTIPLAYER_SETUP.md` still stands.
6. **The `rural` collection has zero qualifying locations** and several
   continent collections are below the shippable floor. They are defined in code
   and reported unavailable by the audit rather than offered to players.
7. **Endless sessions can eventually repeat** once every place in the pool has
   been served. Uniqueness within a *fixed* match is a hard guarantee; an
   unbounded session cannot honour it forever, and the code says so.

## 22. Safe deployment order

1. Review this branch and both migrations.
2. Apply `0011` then `0012` to a **non-production/test** database.
3. Run `supabase/tests/07_*.sql` and `08_*.sql` plus the existing suites; confirm
   permissions and RLS.
4. No environment variables to configure (§13).
5. Apply `0011` then `0012` to production, in that order.
6. Deploy the branch as a **Vercel Preview**.
7. Smoke-test solo and multiplayer on at least one mobile and one desktop
   browser (§18) — this substitutes for the missing automated coverage.
8. Open a PR **only after explicit approval**.
9. Merge **only after explicit approval**.
10. Verify production.
11. Monitor Supabase (new table growth, RPC error rates), Vercel, and Google
    usage — the last should be flat.

## 23. Rollback considerations

- **App rollback is clean.** Redeploying the previous build is safe with the
  migrations still applied: `0011`/`0012` add only new objects that old code
  never calls.
- **Migration rollback is not required** for an app rollback, and is not
  recommended. If it is genuinely wanted, dropping the five new functions and
  the `location_history` table reverses everything; no existing object was
  altered, so nothing else needs restoring. Dropping the table permanently
  destroys durable history — players fall back to their local caches, which
  costs novelty, not correctness.
- **Local client state is forward- and backward-compatible.** The history key
  and format are unchanged (group ids default to location ids), so V3 code
  reading V4-written history behaves correctly. The new bag key is simply
  ignored by V3.
- **No data migration or backfill** was performed, so there is nothing to undo.

## 24. Secrets

**No secret was read, printed, staged, or committed.** `.env.local` was never
opened. No API key, token, database URL or Supabase secret appears in any
migration, test, script or source file. No service-role key exists in the
client. The new tooling (`npm run audit:dataset`) is fully offline and makes no
network request of any kind.
