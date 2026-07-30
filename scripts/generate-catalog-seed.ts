/**
 * Generate the SQL seed for `public.game_catalog` from the verified TypeScript
 * catalog.
 *
 *   npx vite-node scripts/generate-catalog-seed.ts -- --out supabase/migrations/0014_catalog_seed.sql
 *   npx vite-node scripts/generate-catalog-seed.ts -- --check
 *
 * Why a generator rather than a hand-written migration: the catalog is 325
 * reviewed rows with pano ids that were individually verified against the Street
 * View metadata endpoint (see docs/CATALOG_EXPANSION.md). Re-typing those into
 * SQL by hand would be both unreviewable and a chance to invent a pano id, which
 * the V5 brief explicitly forbids. Generating keeps one source of truth and
 * makes the diff auditable: run `--check` in CI and the migration cannot drift
 * from src/data/locations.ts.
 *
 * The emitted SQL is:
 *   • deterministic — rows sorted by location_id, fixed numeric formatting, so
 *     regenerating produces a byte-identical file;
 *   • idempotent — `on conflict (location_id) do update`, and the update is
 *     skipped when nothing actually changed, so re-running the migration is a
 *     no-op that does not even bump `updated_at`;
 *   • additive — it never deletes. A row removed from the TS catalog is reported
 *     by `--check` and must be retired deliberately (`active = false`) rather
 *     than silently dropped, because historical results reference it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCATIONS } from '../src/data/locations';
import { buildGroupIndex } from '../src/utils/canonicalGroup';
import type { CatalogLocation } from '../src/types';

const DEFAULT_OUT = 'supabase/migrations/0014_catalog_seed.sql';

interface SeedRow {
  locationId: string;
  groupId: string;
  panoId: string;
  lat: number;
  lng: number;
  label: string;
  country: string;
  continent: string;
  difficulty: string;
  setting: string;
  panoVerifiedAt: string | null;
}

function buildRows(locations: readonly CatalogLocation[]): SeedRow[] {
  const groups = buildGroupIndex(locations);
  const rows = locations.map((l) => {
    if (!l.panoId) {
      throw new Error(
        `${l.id} has no verified panoId. The server catalog stores only verified ` +
          `panoramas — run the catalog verification workflow first (docs/CATALOG_EXPANSION.md).`,
      );
    }
    const groupId = groups.get(l.id);
    if (!groupId) throw new Error(`${l.id} has no canonical group.`);
    return {
      locationId: l.id,
      groupId,
      panoId: l.panoId,
      lat: l.lat,
      lng: l.lng,
      label: l.label,
      country: l.country,
      continent: l.continent,
      difficulty: l.difficulty,
      setting: l.setting,
      panoVerifiedAt: l.panoVerifiedAt ?? null,
    };
  });
  rows.sort((a, b) => (a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0));
  return rows;
}

/** Single-quote a SQL string literal (doubling embedded quotes). */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Fixed 6-decimal formatting: stable output, ~11 cm precision — far finer than
 *  any guess needs, and identical across regenerations. */
function num(value: number): string {
  return value.toFixed(6);
}

function render(rows: SeedRow[]): string {
  const values = rows
    .map(
      (r) =>
        `  (${q(r.locationId)}, ${q(r.groupId)}, ${q(r.panoId)}, ` +
        `${num(r.lat)}, ${num(r.lng)}, ${q(r.label)}, ${q(r.country)}, ` +
        `${q(r.continent)}, ${q(r.difficulty)}, ${q(r.setting)}, ` +
        `${r.panoVerifiedAt ? q(r.panoVerifiedAt) : 'null'})`,
    )
    .join(',\n');

  const byDifficulty = new Map<string, number>();
  for (const r of rows) byDifficulty.set(r.difficulty, (byDifficulty.get(r.difficulty) ?? 0) + 1);
  const countries = new Set(rows.map((r) => r.country)).size;
  const continents = new Set(rows.map((r) => r.continent)).size;

  return `-- ============================================================================
-- Roam Engagement Core V5 — deterministic seed for public.game_catalog.
--
-- GENERATED FILE — do not edit by hand.
--   npx vite-node scripts/generate-catalog-seed.ts -- --out ${DEFAULT_OUT}
--   npx vite-node scripts/generate-catalog-seed.ts -- --check    (CI drift gate)
--
-- Source: src/data/locations.ts (the verified catalog) + the canonical grouping
-- from src/utils/canonicalGroup.ts. Every pano id here was individually verified
-- against the Street View metadata endpoint by the catalog workflow — none is
-- invented, and no location is added that is not already in the TS catalog.
--
-- Contents: ${rows.length} locations · ${byDifficulty.get('easy') ?? 0} easy · ${byDifficulty.get('normal') ?? 0} normal · ${byDifficulty.get('hard') ?? 0} hard
--           ${countries} countries · ${continents} continents · ${new Set(rows.map((r) => r.groupId)).size} canonical groups
--
-- IDEMPOTENT: re-running is a no-op. \`on conflict do update\` is guarded by a
-- WHERE clause that compares every column, so an unchanged row is not rewritten
-- and \`updated_at\` does not move.
--
-- NON-DESTRUCTIVE: this seed never deletes. A location retired from the TS
-- catalog must be deactivated by a deliberate follow-up migration
-- (\`update public.game_catalog set active = false where location_id = …\`),
-- because completed runs, leaderboard rows and per-player location history all
-- reference these ids.
-- ============================================================================

insert into public.game_catalog as t
  (location_id, group_id, pano_id, lat, lng, label, country, continent,
   difficulty, setting, pano_verified_at)
values
${values}
on conflict (location_id) do update
  set group_id = excluded.group_id,
      pano_id = excluded.pano_id,
      lat = excluded.lat,
      lng = excluded.lng,
      label = excluded.label,
      country = excluded.country,
      continent = excluded.continent,
      difficulty = excluded.difficulty,
      setting = excluded.setting,
      pano_verified_at = excluded.pano_verified_at,
      updated_at = now()
  where (t.group_id, t.pano_id, t.lat, t.lng, t.label, t.country, t.continent,
         t.difficulty, t.setting, t.pano_verified_at)
     is distinct from
        (excluded.group_id, excluded.pano_id, excluded.lat, excluded.lng,
         excluded.label, excluded.country, excluded.continent,
         excluded.difficulty, excluded.setting, excluded.pano_verified_at);
`;
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;
  const target = resolve(process.cwd(), out);

  const sql = render(buildRows(LOCATIONS));

  if (check) {
    let existing = '';
    try {
      existing = readFileSync(target, 'utf8');
    } catch {
      console.error(`✗ ${out} does not exist. Generate it first.`);
      process.exit(1);
    }
    if (existing !== sql) {
      console.error(
        `✗ ${out} is out of date with src/data/locations.ts.\n` +
          `  Regenerate it: npx vite-node scripts/generate-catalog-seed.ts`,
      );
      process.exit(1);
    }
    console.log(`✓ ${out} matches src/data/locations.ts (${LOCATIONS.length} locations).`);
    return;
  }

  writeFileSync(target, sql, 'utf8');
  console.log(`✓ wrote ${out} (${LOCATIONS.length} locations).`);
}

main();
