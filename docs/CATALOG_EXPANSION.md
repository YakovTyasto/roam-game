# Catalog expansion workflow

The V4 release gates require a validated catalog of **80 Easy / 140 Normal /
80 Hard / 300 total** canonical location groups. The catalog started at **50**
and now holds **325** — 90 Easy, 147 Normal, 88 Hard, across 79 countries, all
Street View verified. This document is the safe, reviewable process that got it
there, and the process any further expansion must follow.

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
players. It took **eleven batches** to reach the gates from 50 — ten expansion
batches plus one repair batch — for 612 candidates and 325 verified locations.

**All ten expansion batches are done. The catalog stands at 325 canonical
groups across 79 countries, 100% Street View verified, and passes 25 of 25
release gates.** What follows is the record of how it got there, kept because
the failure modes are the reusable part.

| Batch | Focus | Result |
| --- | --- | --- |
| 001–003 | Normal rural, road corridors, city-edge suburban | 50 verified of 120 — the method was wrong, not the countries |
| 004 | Easy landmarks and named city-centre streets | 34 of 40 |
| 005 | Normal suburban + rural, named villages | 35 of 40 |
| 006 | Normal urban, named central streets | 37 of 40 |
| repair | The six uncovered pre-V4 entries | 7 of 12; catalog reached 100% verified |
| 007 | Hard, named settlements and passes | 33 of 50 |
| 008 | Hard + Normal | 36 of 50 |
| 009 | Easy + Normal | 38 of 50 |
| 010 | Easy top-up, 12 candidates for a 2-group gap | **12 of 12** — the only clean sweep |

### The 007–009 strategy

Batches 007–009 are sized together rather than one at a time, because the
remaining shortfall (+31 Easy, +20 Normal, +43 Hard) is small enough to plan
in one pass and large enough that verification losses matter.

| Batch | Composition | Serves |
| --- | --- | --- |
| 007 | 50 Hard (24 remote / 26 rural) | Hard is the worst shortfall and the tier the named-street method serves least well |
| 008 | 30 Hard + 20 Normal (6 rural / 8 suburban / 6 urban) | Buffers Hard; the Normal split protects the rural+remote floor, the tightest Normal gate |
| 009 | 40 Easy (16 landmark / 24 urban) + 10 Normal | Easy needs +31, so 40 gives room to lose nine; the urban majority keeps it from being a list of monuments |

**150 candidates for a 94-group shortfall is a 60% buffer, and it is deliberate.**
Hard is where the buffer sits: 80 Hard candidates against a 43-group need, because
hard coordinates are remote and remote coordinates are where verification fails.
Easy and Normal are buffered more thinly (40 for 31, 30 for 20) since both tiers
have verified at 85–92.5% in every batch that used the named-place method.

The projection bears that out. Under the expected rates every gate passes with
margin. Under a flat 60% — well below anything Easy or Normal has produced —
Hard still passes on its buffer while Easy falls 7 short and Normal 2, needing
a top-up batch of roughly 16 candidates. That is the trade the shape encodes:
protect the tier that actually fails, accept a small top-up risk on the tiers
that do not.

**Outcome: 107 of 150 verified (71.3%), and the shape was right.** Hard came in
at 66–72%, far below the 85–92.5% the method gets in towns, and the buffer
absorbed 29 misses to clear the floor with 8 to spare. Normal and Easy cleared
comfortably and two groups short respectively — the conservative scenario's
warning, landing better than modelled because Easy verified at 72.5% rather
than 60%. Batch 010 tops up the two.

### What the hard tier actually taught

Naming the place is necessary but not sufficient out here. The hard misses
cluster by *kind of place*, not by country:

- **Mountain passes and high plateau roads failed almost completely.** All
  three Norwegian candidates (Sognefjellet, Dyranut, Ifjord), all three New
  Zealand ones (Lindis Pass, Arthur's Pass, Wairau Valley) and both Kyrgyz ones
  returned ZERO_RESULTS — in four countries with dense proven coverage. A pass
  has a name but often no settlement, so the coordinate is still a guess about
  where the road runs.
- **Named towns on long-distance routes worked.** Camooweal, Coober Pedy,
  Norseman, Hughenden, Ranfurly, Matehuala, Wawa, Malta and Van Horn all
  verified. The rule that survives: the name has to belong to a *place people
  live in*, not to a stretch of road or a summit.
- **Some countries have no usable coverage at all.** Namibia, Botswana (three
  misses now), Kazakhstan, Morocco (four misses across four batches), Cuba (two)
  and Uzbekistan should be treated as closed until there is new evidence.

Easy's misses tell the same story from the other side: Curaçao, Belize, Guyana,
Venezuela, Ethiopia and Fiji are small-country coverage gaps, while Rovinj,
Essaouira, Bhaktapur and Eger are pedestrian precincts — the same failure mode
that defeated the repair batch.

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
That was convenient while `normal`/`suburban` was the worst-failing balance
gate. Batch 005 cleared the suburban and rural floors and broke
`balance.normal.urban.min` instead (18.1% against a 25% floor); batch 006's 37
urban entries cleared that in turn. **Every balance gate now passes**, so
setting mix is no longer what to optimise for. What remains is raw size, and
`hard` is the tier furthest from its floor — which is also the tier the
named-street method serves worst, because hard wants sparse clues and named
streets supply clues. Expect hit rates to fall back toward the batch-002 range
when hard candidates resume.

### Coverage evidence

Recorded from real verification runs, not assumed. "Proven" means at least one
candidate in that country actually resolved a panorama.

Hit rate by batch: **001 = 35%** (near place names), **002 = 55%** (named road
corridors), **003 = 39%** (city-edge suburban), **004 = 85%** (pedestrian
squares, promenades and named city-centre streets), **005 = 87.5%** (the same
method applied to deliberately unrecognisable places), **006 = 92.5%** (named
central streets in mid-sized cities), **007 = 66%** (hard: remote named
settlements and passes), **008 = 72%**, **009 = 76%** (easy, reaching into
small countries with thin coverage).

The three-way split in 007–009 is the clearest signal in the data: the method's
hit rate tracks **how built-up the named place is**, not the tier label. Town
and city streets verify at 85–92.5%; remote settlements at 66–72%; passes,
plateaus and small-country capitals below that.

Batch 004 settles what the earlier three only hinted at. The variable that
matters is not the country and not the setting label — it is whether the
coordinate sits somewhere Google's car or trekker actually stopped. A named
square, a promenade, a bridge approach or a main shopping street is such a
place; "the edge of town" and "a road near X" usually are not. Prefer a
specific, nameable pedestrian location over a plausible-sounding stretch of
road, and the hit rate roughly doubles.

**Nameability is not recognizability.** They are separate axes and conflating
them mis-tiers locations. Nameability is a *coverage* heuristic — does Google's
car stop at a place you can name precisely. Recognizability is what sets
*difficulty* — how much the player can read off the view. A named village square
in Aragón is highly nameable and barely recognisable: perfect Normal. The
Brandenburg Gate is both: Easy. An unnamed stretch of the Nullarbor is neither:
it fails verification *and* would have been Hard.

So pick the coordinate for coverage, then tier it on clues:

| Tier | Choose | Avoid |
| --- | --- | --- |
| Easy | Landmarks, major squares, central promenades, distinctive city centres | — |
| Normal suburban | Named residential streets, local junctions, small-town centres, transport areas | Globally recognisable landmarks |
| Normal rural | Named villages, bridges, regional routes, country-road junctions with moderate signage | Iconic scenery |
| Hard | Precisely located remote named roads and routes, sparse clues, weak signage | Anything nameable on sight |

When a famous feature sits near an otherwise-good Normal candidate, place the
coordinate on the ordinary streets instead — Antigua's side streets rather than
its arch, Ollantaytambo's village rather than its ruins. The round is then solved
from signage, architecture and vegetation, which is what Normal should test.

The recheck of the 50 pre-V4 entries verified 44 (88%), which is consistent:
those were also authored as specific named places.

Batch 006 ran the sharpest test of the method available. Three of its
candidates sat within 5 km of an earlier `ZERO_RESULTS` — same city, different
kind of coordinate. Bloemfontein (2.6 km from a failed N1 point) and Kigali
(3.1 km from a failed "outskirts" point) both verified; Cape Coast (4.1 km from
a failed outskirts point) did not. Two out of three recovered a city the older
method had written off, which is strong evidence that a miss condemns the
coordinate rather than the city — and a reminder that it is not a guarantee.

Batch 005 confirms the two axes are independent. It used the batch-004 coverage
method on 40 candidates chosen to be *un*recognisable, and verified 35 of 40 —
slightly better than batch 004, not worse. Coverage did not care that the places
were obscure, because the coordinates still named streets and squares Google had
driven. All five misses were the same failure mode as before: villages named as
a whole (Viscri, Real de Catorce, Cafayate, Boquete) rather than a street within
them, plus one African city-centre avenue.

| Status | Countries |
| --- | --- |
| **Proven** | 79 countries are now represented in the catalog, including every country that has ever verified. Batches 007–009 added Mongolia, Nepal, Paraguay, Bulgaria, Slovakia, Slovenia, Latvia, Lithuania, Belgium, Switzerland, Netherlands, Austria, Finland, Sweden, Denmark, Ireland, Greece, Tanzania, Kenya and Vietnam, several of them after an earlier miss — Sweden, Ireland, Romania, Jamaica, Tunisia and Kenya all recovered once the coordinate named a town street. |
| **Closed** — repeated misses across different coordinate types, treat as uncovered until there is new evidence | Iceland, Botswana (3), Morocco (4), Cuba (2), Eswatini, Namibia, Kazakhstan, Uzbekistan, Ethiopia, Guyana, Belize, Curaçao, Venezuela, Fiji (3), mainland China (no car coverage at all) |
| **Failed once** — one more attempt on a named town street is reasonable | Panama, Puerto Rico |

**The hard tier gets the same treatment, with the tiers read off the view.**
Hard wants sparse clues, and the instinct is to author a sparse *coordinate* —
a point on an empty highway. Batches 001–003 show where that leads: the
Nullarbor, the Stuart Highway, the Kalahari and the Icelandic highland all
returned ZERO_RESULTS. Batches 007 and 008 instead name the settlement, pass or
junction — Camooweal, Lindis Pass, Dyranut, Baquedano, Jeffrey City — and let
the *view* be empty. A one-street outback township is a precise nameable place
and still gives the player almost nothing.

**Two candidates in 007–009 had to move because they sat on top of old
failures.** The per-batch validator only compares against the catalog, so it
cannot see that a coordinate matches a candidate that failed two batches ago.
The cross-batch check does: it caught a Botswana candidate 230 m from a
batch-001 ZERO_RESULTS and a Bolivian one 370 m from another. Run it over every
new batch together with all previous candidate files, failures included, before
spending any requests.

**Do not author candidates in countries with no Street View at all.** A Lijiang
candidate was dropped from batch 009 for this reason: mainland China has no
Google car coverage, so it was a guaranteed miss. This is different from a
country that has missed before — Costa Rica missed twice and then verified.

**Moving a coordinate onto the adjacent road is not a reliable repair.** The
repair-006 batch tested it on the six uncovered pre-V4 entries: five of them
were pedestrian precincts, and the fix was to move 200–550 m onto the named
public road beside them. Only Cape Town's Dock Road verified. Al Haram Street,
Na Phra Lan Road, the India Gate hexagon and the Marrakech ramparts avenue all
returned ZERO_RESULTS — and Thailand and India are both proven countries, so
the likely cause is that a road named from memory is not precise to 50 m, not
that coverage is absent. Author a replacement candidate the same way as any
other; do not assume a nearby street will rescue a known-bad coordinate.

Coverage is not uniform below the country level. Batch 006's three misses were
all in proven countries — Chuncheon, Viljandi and Cape Coast — and all three
are small cities. South Korea, Estonia and Ghana each verified elsewhere in the
same batch. Town size, not the country, is the better predictor of the
remaining gaps.
| **Sparse coverage** — prefer a same-continent proven country | Fiji, American Samoa, Guam, Northern Mariana Islands, Greenland, Bhutan, Mongolia, Madagascar, Tanzania, Uganda, Bolivia, Jordan |

Two results worth keeping in mind, because they complicate the simple story:

- **A proven country still misses.** Australia verified on the Landsborough
  Highway in batch 001, then failed on all three batch-002 candidates including
  the Stuart Highway. Mexico and Argentina, both long proven, each lost a
  batch-005 candidate. Country-level evidence raises the odds; it does not settle
  an individual coordinate.
- **A twice-failed country can still come good with a better coordinate.** Costa
  Rica missed twice on approximate countryside points, then verified on Sarchí's
  central street. "Failed twice" means stop guessing, not that the country is
  uncovered.
- **Suburban is not reliably easier.** City-edge candidates verified in Ghana,
  Argentina, Mexico and Indonesia but failed in Australia, Canada, the
  Philippines and South Korea. Prefer them for balance reasons, not because they
  are a safe bet.

## Rechecking existing catalog entries

Entries added before this workflow existed carry no `panoId`, so
`verification.streetView` cannot pass while they remain. Regenerate the input
and verify it with `--recheck`:

```bash
npm run catalog:recheck-file      # offline; writes data/candidates/recheck-original-50.json
npm run catalog:verify -- data/candidates/recheck-original-50.json \
  --recheck --verify-panoramas --report data/candidates/recheck-original-50.verified.json
```

`--recheck` changes exactly one thing: "this id/coordinate is already in the
catalog" stops being an error, because in this mode that is the point. Every
other validation rule still blocks, no entry is modified, and no `panoId` is
written — the run only produces a report.

Expect some to fail. A pre-V4 entry that returns `ZERO_RESULTS` is a location
players may already be seeing without confirmed coverage; those need a nudged
coordinate or removal, decided per case rather than in bulk.

The first recheck run verified 44 of 50. The six that failed — Havana Malecón,
Giza, Cape Town V&A Waterfront, Marrakech Jemaa el-Fnaa, Bangkok Grand Palace
and Delhi India Gate — are all long-standing catalog entries, several of them
famous. They are deliberately left unmodified and unverified: each needs a
decision about whether to move the coordinate or retire the location, and
`verification.streetView` keeps failing until they are resolved.

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
