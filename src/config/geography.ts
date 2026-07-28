/**
 * Geography vocabulary — the single source of truth for continents/regions and
 * a few *factual* country properties the catalog derives collections from.
 *
 * Why this exists: the Diversity Engine needs to reason about where a location
 * is beyond its country string (avoid two consecutive rounds on the same
 * continent, spread a five-round game across the world, build the "Europe" or
 * "Left-Side Driving" collections). Deriving those from a small, reviewable,
 * typed table keeps the dataset honest — no per-location guessing, and the
 * audit can flag any country that is missing here instead of silently
 * defaulting.
 */

/** Continent / macro-region used for diversity and collections. */
export type Continent =
  | 'Africa'
  | 'Asia'
  | 'Europe'
  | 'North America'
  | 'South America'
  | 'Oceania'
  | 'Antarctica';

/** All continents in a stable display order. */
export const CONTINENTS: readonly Continent[] = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
  'Antarctica',
] as const;

export function isContinent(value: unknown): value is Continent {
  return typeof value === 'string' && (CONTINENTS as readonly string[]).includes(value);
}

/**
 * Country/territory → continent.
 *
 * This is a **geography table, not a coverage claim.** Presence here says only
 * where a country is; whether Street View exists at a given coordinate is
 * decided by the verification step in `scripts/verify-candidates.ts` and
 * recorded per location as a resolved `panoId`. Never infer coverage from this
 * table.
 *
 * Candidate validation *requires* a country to appear here, so adding a
 * location in a new country is a deliberate two-step act: map the country
 * first, then submit the candidate. That is why the list is broad — the
 * expansion workflow is unusable if every batch is blocked on a config edit —
 * but it is still explicit rather than derived from a library, so a wrong
 * continent is a reviewable diff.
 *
 * Transcontinental countries are assigned the continent their *catalog*
 * locations sit in, documented per entry rather than left implicit.
 */
export const COUNTRY_CONTINENT: Readonly<Record<string, Continent>> = {
  // ── Europe ────────────────────────────────────────────
  Albania: 'Europe',
  Andorra: 'Europe',
  Austria: 'Europe',
  Belgium: 'Europe',
  Bulgaria: 'Europe',
  Croatia: 'Europe',
  Cyprus: 'Europe',
  Czechia: 'Europe',
  Denmark: 'Europe',
  Estonia: 'Europe',
  'Faroe Islands': 'Europe',
  Finland: 'Europe',
  France: 'Europe',
  Germany: 'Europe',
  Gibraltar: 'Europe',
  Greece: 'Europe',
  Hungary: 'Europe',
  Iceland: 'Europe',
  Ireland: 'Europe',
  'Isle of Man': 'Europe',
  Italy: 'Europe',
  Latvia: 'Europe',
  Lithuania: 'Europe',
  Luxembourg: 'Europe',
  Malta: 'Europe',
  Monaco: 'Europe',
  Montenegro: 'Europe',
  Netherlands: 'Europe',
  'North Macedonia': 'Europe',
  Norway: 'Europe',
  Poland: 'Europe',
  Portugal: 'Europe',
  Romania: 'Europe',
  'San Marino': 'Europe',
  Serbia: 'Europe',
  Slovakia: 'Europe',
  Slovenia: 'Europe',
  Spain: 'Europe',
  Sweden: 'Europe',
  Switzerland: 'Europe',
  Ukraine: 'Europe',
  'United Kingdom': 'Europe',
  // Transcontinental: the catalog's Türkiye location (Sultanahmet) is in
  // Istanbul's European half, so it counts as Europe for diversity purposes.
  'Türkiye': 'Europe',

  // ── Asia ──────────────────────────────────────────────
  Bangladesh: 'Asia',
  Bhutan: 'Asia',
  Cambodia: 'Asia',
  China: 'Asia',
  'Hong Kong': 'Asia',
  India: 'Asia',
  Indonesia: 'Asia',
  // Transcontinental region: Israel and Jordan sit in Western Asia.
  Israel: 'Asia',
  Japan: 'Asia',
  Jordan: 'Asia',
  Kazakhstan: 'Asia',
  Kyrgyzstan: 'Asia',
  Laos: 'Asia',
  Macau: 'Asia',
  Malaysia: 'Asia',
  Mongolia: 'Asia',
  Nepal: 'Asia',
  Philippines: 'Asia',
  Qatar: 'Asia',
  Singapore: 'Asia',
  'South Korea': 'Asia',
  'Sri Lanka': 'Asia',
  Taiwan: 'Asia',
  Thailand: 'Asia',
  'United Arab Emirates': 'Asia',
  Uzbekistan: 'Asia',
  Vietnam: 'Asia',

  // ── Africa ────────────────────────────────────────────
  Botswana: 'Africa',
  // Transcontinental: Egypt's catalog location (Giza) is west of Suez.
  Egypt: 'Africa',
  Eswatini: 'Africa',
  Ethiopia: 'Africa',
  Ghana: 'Africa',
  Kenya: 'Africa',
  Lesotho: 'Africa',
  Madagascar: 'Africa',
  Morocco: 'Africa',
  Namibia: 'Africa',
  Nigeria: 'Africa',
  Réunion: 'Africa',
  Rwanda: 'Africa',
  Senegal: 'Africa',
  'South Africa': 'Africa',
  Tanzania: 'Africa',
  Tunisia: 'Africa',
  Uganda: 'Africa',

  // ── North America ─────────────────────────────────────
  Belize: 'North America',
  Bermuda: 'North America',
  Canada: 'North America',
  'Costa Rica': 'North America',
  Cuba: 'North America',
  Curaçao: 'North America',
  'Dominican Republic': 'North America',
  Greenland: 'North America',
  Guatemala: 'North America',
  Jamaica: 'North America',
  Mexico: 'North America',
  Panama: 'North America',
  'Puerto Rico': 'North America',
  'United States': 'North America',

  // ── South America ─────────────────────────────────────
  Argentina: 'South America',
  Bolivia: 'South America',
  Brazil: 'South America',
  Chile: 'South America',
  Colombia: 'South America',
  Ecuador: 'South America',
  Guyana: 'South America',
  Paraguay: 'South America',
  Peru: 'South America',
  Uruguay: 'South America',
  Venezuela: 'South America',

  // ── Oceania ───────────────────────────────────────────
  'American Samoa': 'Oceania',
  Australia: 'Oceania',
  Fiji: 'Oceania',
  Guam: 'Oceania',
  'New Zealand': 'Oceania',
  'Northern Mariana Islands': 'Oceania',
  'Papua New Guinea': 'Oceania',
};

/**
 * Countries/territories that drive on the left. Factual and verifiable, so the
 * "Left-Side Driving" collection is derived rather than hand-tagged per
 * location (one wrong tag would otherwise silently poison the collection).
 * Only countries present in the catalog are listed.
 */
export const LEFT_SIDE_DRIVING_COUNTRIES: ReadonlySet<string> = new Set([
  'Australia',
  'Bangladesh',
  'Bhutan',
  'Botswana',
  'Cyprus',
  'Eswatini',
  'Fiji',
  'Hong Kong',
  'India',
  'Guyana',
  'Indonesia',
  'Ireland',
  'Isle of Man',
  'Jamaica',
  'Japan',
  'Kenya',
  'Lesotho',
  'Macau',
  'Malaysia',
  'Malta',
  'Namibia',
  'Nepal',
  'New Zealand',
  'Papua New Guinea',
  'Singapore',
  'South Africa',
  'Sri Lanka',
  'Tanzania',
  'Thailand',
  'Uganda',
  'United Kingdom',
]);

/**
 * Island countries/territories represented in the catalog — used to derive the
 * "Islands" collection. Deliberately conservative: a country only belongs here
 * when the country *itself* is an island or archipelago, not when it merely
 * owns islands.
 */
export const ISLAND_COUNTRIES: ReadonlySet<string> = new Set([
  'American Samoa',
  'Bermuda',
  'Cuba',
  'Curaçao',
  'Cyprus',
  'Dominican Republic',
  'Faroe Islands',
  'Fiji',
  'Greenland',
  'Guam',
  'Hong Kong',
  'Iceland',
  'Indonesia',
  'Ireland',
  'Isle of Man',
  'Jamaica',
  'Japan',
  'Madagascar',
  'Malta',
  'New Zealand',
  'Northern Mariana Islands',
  'Philippines',
  'Puerto Rico',
  'Réunion',
  'Singapore',
  'Sri Lanka',
  'Taiwan',
  'United Kingdom',
]);

/** Continent for a catalog country, or `null` when the country is unknown. */
export function continentForCountry(country: string): Continent | null {
  return COUNTRY_CONTINENT[country] ?? null;
}

/** True when the country drives on the left. Unknown countries are `false`. */
export function drivesOnLeft(country: string): boolean {
  return LEFT_SIDE_DRIVING_COUNTRIES.has(country);
}

/** True when the country is itself an island/archipelago. */
export function isIslandCountry(country: string): boolean {
  return ISLAND_COUNTRIES.has(country);
}
