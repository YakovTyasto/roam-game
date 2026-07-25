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
 * Country (as spelled in the catalog) → continent. Only countries that appear
 * in the catalog need an entry; `validateGeographyMetadata` reports any that
 * are missing, so adding a location in a new country fails the audit loudly
 * rather than defaulting to the wrong continent.
 *
 * Transcontinental countries are assigned the continent their *catalog*
 * locations sit in, which is documented per entry rather than left implicit.
 */
export const COUNTRY_CONTINENT: Readonly<Record<string, Continent>> = {
  // ── Europe ────────────────────────────────────────────
  Croatia: 'Europe',
  Czechia: 'Europe',
  France: 'Europe',
  Germany: 'Europe',
  Greece: 'Europe',
  Iceland: 'Europe',
  Italy: 'Europe',
  Netherlands: 'Europe',
  Portugal: 'Europe',
  Spain: 'Europe',
  Sweden: 'Europe',
  Switzerland: 'Europe',
  'United Kingdom': 'Europe',
  // Transcontinental: the catalog's Türkiye location (Sultanahmet) is in
  // Istanbul's European half, so it counts as Europe for diversity purposes.
  'Türkiye': 'Europe',

  // ── Asia ──────────────────────────────────────────────
  'Hong Kong': 'Asia',
  India: 'Asia',
  // Transcontinental region: Israel sits in Western Asia. Grouped with Asia so
  // "Africa & Middle East" copy in the dataset stays cosmetic, not structural.
  Israel: 'Asia',
  Japan: 'Asia',
  Singapore: 'Asia',
  'South Korea': 'Asia',
  Taiwan: 'Asia',
  Thailand: 'Asia',
  'United Arab Emirates': 'Asia',

  // ── Africa ────────────────────────────────────────────
  // Transcontinental: Egypt's catalog location (Giza) is west of Suez.
  Egypt: 'Africa',
  Kenya: 'Africa',
  Morocco: 'Africa',
  'South Africa': 'Africa',

  // ── North America ─────────────────────────────────────
  Canada: 'North America',
  Cuba: 'North America',
  Mexico: 'North America',
  'United States': 'North America',

  // ── South America ─────────────────────────────────────
  Argentina: 'South America',
  Brazil: 'South America',
  Chile: 'South America',
  Colombia: 'South America',
  Peru: 'South America',

  // ── Oceania ───────────────────────────────────────────
  Australia: 'Oceania',
  'New Zealand': 'Oceania',
};

/**
 * Countries/territories that drive on the left. Factual and verifiable, so the
 * "Left-Side Driving" collection is derived rather than hand-tagged per
 * location (one wrong tag would otherwise silently poison the collection).
 * Only countries present in the catalog are listed.
 */
export const LEFT_SIDE_DRIVING_COUNTRIES: ReadonlySet<string> = new Set([
  'Australia',
  'Hong Kong',
  'India',
  'Japan',
  'New Zealand',
  'Singapore',
  'South Africa',
  'Thailand',
  'United Kingdom',
]);

/**
 * Island countries/territories represented in the catalog — used to derive the
 * "Islands" collection. Deliberately conservative: a country only belongs here
 * when the country *itself* is an island or archipelago, not when it merely
 * owns islands.
 */
export const ISLAND_COUNTRIES: ReadonlySet<string> = new Set([
  'Cuba',
  'Hong Kong',
  'Iceland',
  'Japan',
  'New Zealand',
  'Singapore',
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
