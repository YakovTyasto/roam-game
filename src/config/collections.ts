/**
 * Themed collections — the tag vocabulary the catalog and the Diversity Engine
 * share.
 *
 * Two kinds of collection exist, and the difference matters:
 *
 *   • **Derived** collections are computed from *factual* metadata already on
 *     the location (continent, country). "Europe" and "Left-Side Driving" can
 *     never drift out of sync with the data, and nobody has to remember to tag
 *     a new location.
 *   • **Curated** collections come from an explicit `tags` array on the
 *     catalog entry, because no rule can decide them ("is this a famous
 *     place?"). Those are reviewed by a human when the entry is added.
 *
 * A collection is only *shippable* when it holds enough distinct canonical
 * groups to fill a game without immediately repeating (see
 * `collectionAvailability`). Under-filled collections stay defined here but are
 * reported as unavailable rather than shown to players as if they worked —
 * a tiny "Rural" collection that serves the same four places every time is
 * worse than no Rural collection.
 */

import type { GameLocation } from '../types';
import type { Continent } from './geography';
import { continentForCountry, drivesOnLeft, isIslandCountry } from './geography';

/** Stable internal collection id. Persisted verbatim (DB, URLs, storage). */
export type CollectionId =
  | 'world'
  | 'europe'
  | 'asia'
  | 'africa'
  | 'north-america'
  | 'south-america'
  | 'oceania'
  | 'capitals'
  | 'famous'
  | 'rural'
  | 'islands'
  | 'left-driving';

/**
 * Curated tags a catalog entry may carry. Derived collections are deliberately
 * absent — tagging a location `europe` by hand would be a second, conflicting
 * source of truth.
 */
export type CuratedTag = Extract<CollectionId, 'capitals' | 'famous' | 'rural'>;

export const CURATED_TAGS: readonly CuratedTag[] = ['capitals', 'famous', 'rural'] as const;

export function isCuratedTag(value: unknown): value is CuratedTag {
  return typeof value === 'string' && (CURATED_TAGS as readonly string[]).includes(value);
}

type CollectionKind =
  | { kind: 'all' }
  | { kind: 'continent'; continent: Continent }
  | { kind: 'curated'; tag: CuratedTag }
  | { kind: 'derived'; predicate: (location: GameLocation) => boolean };

export interface CollectionDefinition {
  id: CollectionId;
  /** i18n message key suffix; user-facing copy lives in `src/i18n/messages`. */
  labelKey: string;
  /** How membership is decided. */
  membership: CollectionKind;
}

export const COLLECTION_DEFINITIONS: Readonly<Record<CollectionId, CollectionDefinition>> = {
  world: { id: 'world', labelKey: 'collection.world', membership: { kind: 'all' } },
  europe: {
    id: 'europe',
    labelKey: 'collection.europe',
    membership: { kind: 'continent', continent: 'Europe' },
  },
  asia: {
    id: 'asia',
    labelKey: 'collection.asia',
    membership: { kind: 'continent', continent: 'Asia' },
  },
  africa: {
    id: 'africa',
    labelKey: 'collection.africa',
    membership: { kind: 'continent', continent: 'Africa' },
  },
  'north-america': {
    id: 'north-america',
    labelKey: 'collection.northAmerica',
    membership: { kind: 'continent', continent: 'North America' },
  },
  'south-america': {
    id: 'south-america',
    labelKey: 'collection.southAmerica',
    membership: { kind: 'continent', continent: 'South America' },
  },
  oceania: {
    id: 'oceania',
    labelKey: 'collection.oceania',
    membership: { kind: 'continent', continent: 'Oceania' },
  },
  capitals: {
    id: 'capitals',
    labelKey: 'collection.capitals',
    membership: { kind: 'curated', tag: 'capitals' },
  },
  famous: {
    id: 'famous',
    labelKey: 'collection.famous',
    membership: { kind: 'curated', tag: 'famous' },
  },
  rural: {
    id: 'rural',
    labelKey: 'collection.rural',
    membership: { kind: 'curated', tag: 'rural' },
  },
  islands: {
    id: 'islands',
    labelKey: 'collection.islands',
    membership: { kind: 'derived', predicate: (l) => isIslandCountry(l.country) },
  },
  'left-driving': {
    id: 'left-driving',
    labelKey: 'collection.leftDriving',
    membership: { kind: 'derived', predicate: (l) => drivesOnLeft(l.country) },
  },
};

/** Every collection id in display order. */
export const COLLECTION_IDS: readonly CollectionId[] = [
  'world',
  'europe',
  'asia',
  'africa',
  'north-america',
  'south-america',
  'oceania',
  'capitals',
  'famous',
  'rural',
  'islands',
  'left-driving',
] as const;

/** The default collection — the whole catalog. */
export const DEFAULT_COLLECTION: CollectionId = 'world';

export function isCollectionId(value: unknown): value is CollectionId {
  return typeof value === 'string' && (COLLECTION_IDS as readonly string[]).includes(value);
}

/** Coerce unknown input (URL param, DB column) to a valid collection id. */
export function toCollectionId(value: unknown): CollectionId {
  return isCollectionId(value) ? value : DEFAULT_COLLECTION;
}

/** True when `location` belongs to `collection`. */
export function isInCollection(location: GameLocation, collection: CollectionId): boolean {
  const def = COLLECTION_DEFINITIONS[collection];
  switch (def.membership.kind) {
    case 'all':
      return true;
    case 'continent': {
      const continent = location.continent ?? continentForCountry(location.country);
      return continent === def.membership.continent;
    }
    case 'curated':
      return (location.tags ?? []).includes(def.membership.tag);
    case 'derived':
      return def.membership.predicate(location);
  }
}

/** All catalog locations belonging to `collection`. Input order preserved. */
export function locationsInCollection(
  all: readonly GameLocation[],
  collection: CollectionId,
): GameLocation[] {
  if (collection === 'world') return [...all];
  return all.filter((l) => isInCollection(l, collection));
}
