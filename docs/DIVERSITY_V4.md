# Diversity Engine V2 — diagnosis and design

> Companion to the generated [`DATASET_AUDIT.md`](DATASET_AUDIT.md). Regenerate
> the audit with `npm run audit:dataset`; `npm run audit:dataset:check` fails if
> the committed artifacts are stale or the catalog has metadata problems.

## The complaint

> "The recent-location cooldown does not provide enough visible variety.
> Players still encounter the same or effectively identical locations too
> often."

That symptom has several plausible causes, and they call for opposite fixes.
Replacing the selector without knowing which one is real would have been a
guess, so the catalog was audited first.

## Diagnosis

The audit rules out the explanation that would have justified a
deduplication-first fix, and points squarely at two others.

### It is NOT duplicate or near-identical data

| Check | Result |
| --- | --- |
| Duplicate `location_id` | 0 |
| Duplicate `pano_id` | 0 |
| Identical coordinate pairs | 0 |
| Near-duplicate pairs (≤ 1 km) | 0 |
| Locations sharing a small geographic cluster (≤ 25 km) | 0 |
| Catalog rows that collapse into another row | 0 |

All 50 catalog rows are 50 genuinely distinct places, in 38 countries across 6
continents. No amount of deduplication will improve variety here. (The
canonical-group machinery is still built and enforced — it is what keeps this
true as the catalog grows, and it is the unit the history layer stores.)

### Cause 1 — the pools are far too small

Variety is bounded by the pool a *single configuration* can draw from, not by
the catalog total. A game never mixes difficulties unless the fallback fires:

| Difficulty | Distinct places | 5-round games before the tier is exhausted |
| --- | --- | --- |
| Easy | 15 | 3 |
| Normal | 21 | 4 |
| Hard | 14 | 2 |

A default (Normal, 5-round) game therefore has **21** places to choose from. By
the fifth game the player has necessarily seen every Normal location in the
product. The cooldown was not failing — it had nothing left to offer.

To support the stated goal of **10 consecutive repeat-free standard games**, the
Normal tier alone needs **50** distinct places: a shortfall of **29**. Exact
per-tier and per-round-count targets are in the audit's *Required catalog
growth* table.

### Cause 2 — the selector degenerated once history saturated

`selectUniqueLocationsAvoidingHistory` shuffled the *unseen* locations and, when
those ran out, appended the least-recently-played ones **sorted deterministically
and never shuffled**. With a 100-entry history and a 50-entry catalog, every
location is "seen" after roughly ten games — from then on the fallback branch
did all the work and the game served a fixed, cyclic order. That is exactly the
"same locations, same order" feeling players reported, and it got *worse* the
more they played.

Three smaller defects compounded it:

- **History was keyed on `location.id`**, which assumes different ids mean
  different places. Today they do; the moment two entries share a panorama or
  sit on the same square, the cooldown would silently under-count.
- **History was recorded at selection time**, so an abandoned game, a failed
  panorama resolution, or a network error still burned freshness.
- **History was local-only**, so a reinstall, a second device, or cleared site
  data reset variety to zero.

### Conclusion

Both a selector rewrite *and* catalog growth are required, and neither
substitutes for the other. The engine is built to make the most of whatever
catalog exists — full-cycle coverage before any repeat, canonical grouping,
durable cross-device history, room-wide multiplayer novelty, and in-match
geographic spread — but the audit is explicit that **the current catalog cannot
meet the freshness target by algorithm alone**. Section 2.6's tooling exists to
close that gap safely, with verification, rather than by inventing entries.

## Canonical groups

The unit of "have I seen this place?" is a **canonical group**, not a location
id. Groups are derived deterministically in strict precedence order
(`src/utils/canonicalGroup.ts`):

1. **`locationGroupId`** — an explicit, human-reviewed statement that two
   entries are the same place (two viewpoints of one landmark).
2. **`panoId`** — the same Street View panorama is by definition the same place.
3. **Proximity** — entries within `nearDuplicateKm` (1 km), linked transitively.

City and country are deliberately *not* grouping keys: two districts of one city
are different places to guess, and merging them would shrink the pool far more
than it would improve variety.

A separate, coarser threshold — `clusterKm` (25 km) — describes "the same metro
area". It is used **only** by the soft in-match diversity rules and never merges
groups or affects uniqueness.

| Threshold | Value | Purpose |
| --- | --- | --- |
| `identicalCoordinateDegrees` | 1e-5° (≈1.1 m) | Audit reporting of identical coordinates |
| `nearDuplicateKm` | 1 km | Canonical group merging |
| `clusterKm` | 25 km | Soft in-match spread only |

## The selector: shuffle-bag cycling

`src/diversity/` replaces "draw randomly, then suppress repeats" with "deal
every place once, then reshuffle".

```
catalog
  → collection filter        (hard constraint)
  → difficulty pool          (adjacent-tier fallback only when necessary)
  → canonical grouping       (one slot per place)
  → shuffle bag              (every group dealt once per cycle)
  → novelty tie-break        (history, bucketed by recency)
  → soft arrangement         (in-match geographic spread)
```

| Module | Responsibility |
| --- | --- |
| `shuffleBag.ts` | Pure bag mechanics: Fisher–Yates, novelty ranking, cycle bookkeeping |
| `bagStorage.ts` | Bounded, malformed-safe local persistence |
| `engine.ts` | The pipeline above, as one pure function every mode calls |
| `store.ts` | Reads state synchronously; commits it when a round starts |

### Guarantees

1. **No duplicate place within a match** — the bag deals one item per canonical
   group, so two catalog rows for one place can never both appear.
2. **Full coverage before repetition** — every eligible group is dealt before
   any group is dealt twice, whenever the pool can supply the round count.
3. **Reshuffled cycles** — a new cycle is a fresh shuffle, not a continuation.
4. **Unpredictable order** — every ordering comes from Fisher–Yates over an
   injectable RNG. Nothing sorts by id, so selection cannot be predicted from
   public sequential identifiers. `sort(() => Math.random() - 0.5)` is banned
   and unused.
5. **Bounded state** — a bag stores only the current cycle's dealt ids, clears
   itself on completion, and is capped per bag and per install.

### Two decisions worth recording

**Recency is bucketed, not total-ordered.** Ordering seen places by their exact
history position is a total order — and a total order is deterministic. On a
small catalog that reproduces the original bug *inside* the new engine: once
history covers the pool, every "reshuffled" cycle deals the same sequence. The
`RECENCY_BUCKET_SIZE` blocks (one game's worth of history) keep the meaningful
preference — a place from ten games ago beats one from last game — while
leaving order inside a bucket genuinely random. A regression test asserts two
consecutive full cycles differ.

**Recording happens when a round starts, not when it is selected.** V3 recorded
at selection time, so a five-round game charged the player for five places even
if they quit after two, and a manifest rejected by the start RPC still burned
freshness. `commitRoundStarted` is now called per round: from `exploring` in
solo, and from the round's reveal in multiplayer (which is also the first
moment RLS lets a client see the location at all). Selection itself has no
side effects.

## Freshness targets

Defined once in `src/config/diversity.ts`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `TARGET_FRESH_GAMES` | 10 | Consecutive standard games that should be repeat-free |
| `MIN_POOL_MULTIPLIER` | 2 | A pool must fill a game twice over to be offered at all |
| `HISTORY_LIMIT_GROUPS` | 250 | Bounded per-player history (50 standard games) |

A pool is **comfortable** at `roundCount × TARGET_FRESH_GAMES` groups and merely
**playable** at `roundCount × MIN_POOL_MULTIPLIER`. Collections below the
playable floor are reported unavailable rather than shipped half-empty — which
is why the `rural` collection (0 qualifying locations) is defined in code but
never offered.
