# Catalog expansion workflow

The V4 release gates require a validated catalog of **80 Easy / 140 Normal /
80 Hard / 300 total** canonical location groups. The catalog currently holds
**50**. This document is the safe, reviewable process for closing that gap.

> **Shuffle-bag cycling guarantees full coverage of whatever exists. It cannot
> manufacture places.** No amount of algorithmic reshuffling substitutes for
> catalog expansion, and nothing in this repo should imply otherwise.

Check the current position at any time:

```bash
npm run audit:gates      # exits non-zero while any gate fails
npm run audit:dataset    # regenerates docs/DATASET_AUDIT.md + dataset-audit.json
```

---

## The rule

**A candidate is never promoted on the strength of plausibility.** It must
survive offline validation *and* have a real Street View panorama resolved and
recorded. Coordinates that "look like they should have coverage" are exactly the
failure mode this workflow exists to prevent.

Consequences, enforced in code rather than by convention:

- `panoId` and `panoVerifiedAt` are populated **only** by a real verification
  run. There is no code path that writes them from a guess.
- `toCatalogLocation()` requires a verified panorama id by type — an unverified
  candidate cannot even be expressed as a catalog entry.
- The `verification.streetView` gate fails while any location lacks one, so an
  unverified entry blocks release even if someone pastes one in by hand.

---

## Batch size

**25–50 candidates per batch.** The cap is enforced by the CLI.

This is a *review* constraint, not a technical one. A 300-location dump is not
reviewable by a human, and the whole point of the workflow is that a person
checks each location's difficulty, setting and country before it reaches
players. Expect **8–10 batches** to reach the gates from 50.

Suggested sequencing, worst shortfall first:

| Batch group | Focus | Why |
| --- | --- | --- |
| 1–4 | Normal tier, rural + suburban | Largest shortfall (119) and the tier every default game uses |
| 5–6 | Hard tier, rural + remote | Hard currently has **zero** rural or remote locations |
| 7–8 | Easy tier, landmarks outside Europe | Easy is landmark-heavy but Europe-concentrated |
| 9–10 | Continent depth: Africa, South America, Oceania | All three are below the 15-group floor |

---

## Step 1 — author a batch

Copy the template and fill it in:

```bash
cp data/candidates/batch-template.json data/candidates/batch-001.json
```

```json
{
  "batch": "001",
  "notes": "Normal-tier rural Europe",
  "candidates": [
    {
      "id": "cotswolds-lane",
      "lat": 51.8330,
      "lng": -1.8433,
      "label": "Country lane, Cotswolds",
      "country": "United Kingdom",
      "difficulty": "hard",
      "setting": "rural",
      "tags": [],
      "source": "public lane, checked on the map before submitting"
    }
  ]
}
```

Field notes:

- **`id`** — lowercase kebab-case, globally unique.
- **`country`** — must match a key in `src/config/geography.ts` *exactly*. A
  country that isn't mapped is rejected rather than guessed; add it to
  `COUNTRY_CONTINENT` first, as a deliberate reviewed change.
- **`continent`** — optional. It is derived from the country; supplying it only
  lets the validator cross-check you.
- **`setting`** — `urban`, `suburban`, `rural`, `landmark`, or `remote`. This
  drives the per-difficulty balance gates, so be honest: a village high street
  is `suburban`, not `rural`.
- **`tags`** — curated tags only (`capitals`, `famous`, `rural`). Continent,
  Islands and Left-Side Driving collections are **derived** from country
  metadata and must never be hand-tagged.
- **`source`** — where the coordinate came from. Not machine-checked, but a
  reviewer cannot do their job without it.
- **Never add `panoId`.** It comes from verification.

Aim for public roads and open outdoor spaces. Indoor photospheres often have no
navigable neighbours and make a poor round.

## Step 2 — validate offline

```bash
npm run catalog:verify -- data/candidates/batch-001.json
```

Fully offline. No network, no API key, no Google request — safe to run anywhere,
including CI. It checks:

| Check | Blocks? |
| --- | --- |
| Id format, uniqueness vs catalog and vs batch | error |
| Coordinate range, and (0, 0) | error |
| Missing label | error |
| Invalid difficulty / setting / tag | error |
| Country not in `COUNTRY_CONTINENT` | error |
| Continent disagrees with the country table | error |
| Within 1 km of a catalog location or another candidate | error |
| Would exceed 3 locations in one 25 km cluster | error |
| Missing `source` note | warning |
| Declares an explicit `locationGroupId` | warning |

Fix every error and re-run until the batch is clean.

## Step 3 — verify panoramas (network, opt-in)

This is the only step that touches Google.

```bash
read -rs -p "Street View verify key: " ROAM_STREETVIEW_VERIFY_KEY
export ROAM_STREETVIEW_VERIFY_KEY
npm run catalog:verify -- data/candidates/batch-001.json \
  --verify-panoramas --report data/candidates/batch-001.verified.json
```

`read -rs` keeps the key off the screen and, because it never appears as a
command argument, out of shell history. Always pass `--report`: verification is
the only step whose result cannot be recreated offline, so a run without it
throws away the resolved panorama ids and forces a second full pass.

### The key

Use a **separate, IP-restricted** key with the **Street View Static API**
enabled. Two reasons it must not be the browser key:

1. Anything named `VITE_*` is **bundled into the client** by Vite. Reusing that
   name for a CLI key risks shipping it to every player.
2. The browser key is HTTP-referrer restricted and would be rejected from a CLI
   anyway.

The tool reads the key from the environment and **never prints it** — not in
logs, not in errors, not in the report. Error output carries the candidate id
and the API status only, never the request URL.

### What it does

For each accepted candidate it calls the Street View **metadata** endpoint with
`source=outdoor` and a 50 m radius, then:

- `status != OK` → rejected, reason recorded;
- resolves to a panorama already used by another location → rejected as a
  duplicate place, however different the coordinates looked;
- otherwise → records the real `pano_id`, today's date, and how far the
  panorama sits from the requested point.

The resolved panorama id is printed on each `ok` line and written to the
`--report` file. It is never inferred, defaulted or generated.

Requests are paced at roughly 5/second.

### Google usage

This uses the Street View Static API **metadata** endpoint, which Google
documents as returning no-charge responses — it exists precisely so you can
check coverage before requesting a billable image. It does **not** fetch
panorama imagery, and it does **not** touch the Maps JavaScript API the game
uses at runtime, so it does not consume the game's panorama-load budget.

Confirm this against current Google pricing before a large run. Verifying 250
locations is 250 metadata requests plus re-checks — small, but not something to
assume is free forever.

### Choosing coordinates that actually verify

Batch 001 returned `ZERO_RESULTS` for 26 of 40 candidates — a 65% miss. Batch
002, placed on road corridors instead, missed 18 of 40. Two things the results
make clear:

**Verification is effectively binary.** Every candidate that verified did so
within 3–75 m of the requested point. None resolved to something 40 m away that
"nearly" matched. Either the coordinate is on a covered road or nothing is
there, so precision matters far more than luck.

**A single failure does not condemn a country.** Australia verified on the
Landsborough Highway but failed on the Nullarbor and in Tasmania; New Zealand
verified in Central Otago but failed on the Coromandel. Iceland, Norway, Chile
and Uruguay all failed despite extensive national coverage. Those are coordinate
misses, not coverage gaps — which is why a replacement should move *within* the
country to a better-evidenced road before abandoning it.

The cause was method, not bad luck: a 50 m radius around a point picked *near a
place name* usually lands beside the road rather than on it, and rural coverage
follows roads exactly.

Place candidates **on a named, long-distance road corridor** — a numbered
national route, trunk road or European route — in a country with dense official
coverage. A point anywhere along the Stuart Highway, Ruta 5, the N7, E6 or a
Ring Road is almost certainly on tarmac Google has driven. A point "near a
scenic village" often is not.

The 50 m radius is deliberately not loosened: widening it would accept a
panorama that is not the place under review, quietly detaching the catalog's
coordinates from what players actually see.

**City-edge suburban locations verify far more reliably than remote roads.**
That is convenient rather than a compromise — `normal`/`suburban` is currently
the worst-failing balance gate, so the greatest need and the highest-probability
candidates coincide. Lead with them.

### Coverage evidence

Recorded from real verification runs, not assumed. "Proven" means at least one
candidate in that country actually resolved a panorama.

Hit rate by batch: **001 = 35%** (14/40, coordinates picked near place names),
**002 = 55%** (22/40, coordinates placed on named road corridors). The corridor
method works, but it is not a guarantee.

| Status | Countries |
| --- | --- |
| **Proven** | South Africa, Réunion, Rwanda, Australia, New Zealand, Argentina, Peru, Ecuador, Colombia, Brazil, Kyrgyzstan, Sri Lanka, Malaysia, Guatemala, Lesotho, Ghana, Chile, Uruguay, Canada, Mexico, Japan, Thailand, Indonesia, Norway, Spain, Portugal |
| **Failed twice** — stop spending requests here without new evidence | Iceland, Botswana, Eswatini, Costa Rica |
| **Failed once** — one more attempt on a trunk road is reasonable | Kenya, Sweden, Ireland, Taiwan, South Korea, Philippines, Puerto Rico, Jamaica, Tunisia |
| **Sparse coverage** — prefer a same-continent proven country | Fiji, American Samoa, Guam, Northern Mariana Islands, Greenland, Bhutan, Mongolia, Madagascar, Tanzania, Uganda, Bolivia, Jordan |

Two results worth keeping in mind, because they complicate the simple story:

- **A proven country still misses.** Australia verified on the Landsborough
  Highway in batch 001, then failed on all three batch-002 candidates including
  the Stuart Highway. Country-level evidence raises the odds; it does not settle
  an individual coordinate.
- **Suburban is not reliably easier.** City-edge candidates verified in Ghana,
  Argentina, Mexico and Indonesia but failed in Australia, Canada, the
  Philippines and South Korea. Prefer them for balance reasons, not because they
  are a safe bet.

## Step 4 — emit and review

```bash
npm run catalog:verify -- data/candidates/batch-001.json --verify-panoramas --emit
```

Prints catalog entries for the **verified** candidates only. `--emit` refuses to
run if nothing was verified.

The tool deliberately **does not modify `src/data/locations.ts`.** A human
pastes the block in, which keeps the diff reviewable and makes it impossible for
a tool run to silently change the catalog.

## Step 5 — re-audit

```bash
npm run audit:dataset    # regenerate the committed artifacts
npm run audit:gates      # how much is still missing
npm run test             # catalog invariants
```

Commit the batch file, the catalog change, and the regenerated audit artifacts
together, so the reasoning behind each addition stays in history.

---

## Definition of done

`npm run audit:gates` exits 0. That means all of:

- 80 Easy, 140 Normal, 80 Hard, 300 total canonical groups — counted on each
  tier's **own** locations, since adjacent-difficulty fallback is borrowing,
  not growth;
- ≥60 countries, 6 continents, ≥15 groups per represented continent;
- no country above 10% of the catalog; no more than 3 groups in one 25 km
  cluster;
- no duplicate panorama ids, no identical or near-duplicate coordinates, no
  redundant canonical groups;
- 100% of locations carrying a verified, dated panorama id;
- per-difficulty setting balance — in particular Hard being ≥45% rural/remote
  with ≥15% genuinely remote, which the pre-V4 catalog missed entirely (it was
  100% urban and landmark).

**Do not deploy to production while `npm run audit:gates` fails.** The command
prints the exact remaining shortfall per tier.

---

## Re-verification

Street View coverage is withdrawn and re-shot over time, so verifications age.
The audit reports entries older than 365 days as **stale**. Stale is a re-check
signal, not a release blocker — but a large stale fraction means the catalog
needs a sweep. Re-run the verification step against a batch file rebuilt from
the existing entries to refresh them.
