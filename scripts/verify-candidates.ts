/**
 * Candidate verification CLI — `npm run catalog:verify -- <batch-file>`.
 *
 * Three phases, in order, each gated on the previous:
 *
 *   1. **Validate (always, offline).** Schema, metadata, coordinate sanity,
 *      duplicate/near-duplicate detection against the catalog and within the
 *      batch, and concentration limits. No network.
 *   2. **Verify (opt-in, network).** Only with `--verify-panoramas` AND an
 *      explicit API key in the environment. Asks the Street View metadata
 *      endpoint whether a panorama actually exists, and records the real
 *      panorama id it returns.
 *   3. **Emit (opt-in).** Only with `--emit`, and only for candidates that
 *      passed BOTH previous phases. Prints ready-to-paste catalog entries.
 *
 * SAFETY PROPERTIES — these are the point of the tool:
 *   • The API key is read from the environment and **never printed**, never
 *     logged, and never written to the report. Failures print the candidate id
 *     and the API status, never the request URL.
 *   • Network access requires an explicit flag *and* an explicit key. Running
 *     the tool without both is a pure offline validation pass, so it can never
 *     fire during a build, a test, or CI.
 *   • Nothing is ever emitted for an unverified candidate. `--emit` without
 *     verification refuses to run.
 *   • The tool only ever prints to stdout. It does not modify
 *     `src/data/locations.ts` — a human pastes the reviewed block in.
 *
 * ENVIRONMENT
 *   ROAM_STREETVIEW_VERIFY_KEY   Google Maps API key with the *Street View
 *                                Static API* enabled.
 *
 *   This is deliberately NOT the `VITE_`-prefixed browser key:
 *     - anything named `VITE_*` is bundled into the client by Vite, so reusing
 *       that name for a server-side key risks shipping it to users;
 *     - the browser key is HTTP-referrer restricted and will be rejected from a
 *       CLI anyway. Use a separate, IP-restricted key for this tool.
 *
 * GOOGLE USAGE
 *   This uses the Street View Static API *metadata* endpoint, which Google
 *   documents as returning no-charge responses (it exists precisely so you can
 *   check coverage before requesting a billable image). It does NOT request
 *   panorama imagery, and it does not touch the Maps JavaScript API the game
 *   uses at runtime, so it does not consume the game's panorama-load budget.
 *   Confirm against current Google pricing before a large run, and keep the
 *   request rate modest — the tool paces itself at ~5 requests/second.
 *
 * USAGE
 *   npm run catalog:verify -- data/candidates/batch-001.json
 *   npm run catalog:verify -- data/candidates/batch-001.json --verify-panoramas
 *   npm run catalog:verify -- data/candidates/batch-001.json --verify-panoramas --emit
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCATIONS } from '../src/data/locations';
import {
  type Candidate,
  type VerifiedCandidate,
  renderCatalogEntries,
  toCatalogLocation,
  validateCandidateBatch,
} from '../src/catalog/candidates';

const MIN_BATCH = 1;
const MAX_BATCH = 50;
const RECOMMENDED_MIN_BATCH = 25;

/** Metres to search around the requested coordinate for a panorama. */
const SEARCH_RADIUS_M = 50;

/** Pace requests so a large batch stays polite. */
const REQUEST_INTERVAL_MS = 200;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const files = argv.filter((a) => !a.startsWith('--'));

const shouldVerify = flags.has('--verify-panoramas');
const shouldEmit = flags.has('--emit');

if (files.length !== 1) {
  console.error(
    'Usage: npm run catalog:verify -- <batch-file.json> [--verify-panoramas] [--emit]',
  );
  process.exit(2);
}

const batchPath = resolve(process.cwd(), files[0]);

interface BatchFile {
  batch?: string;
  notes?: string;
  candidates?: Candidate[];
}

let batch: BatchFile;
try {
  batch = JSON.parse(readFileSync(batchPath, 'utf8')) as BatchFile;
} catch (err) {
  console.error(`Could not read batch file: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const candidates = Array.isArray(batch.candidates) ? batch.candidates : [];
if (candidates.length < MIN_BATCH) {
  console.error('Batch file contains no candidates.');
  process.exit(2);
}
if (candidates.length > MAX_BATCH) {
  console.error(
    `Batch contains ${candidates.length} candidates; the maximum is ${MAX_BATCH}.\n` +
      'Batches are capped so a human can actually review one. Split the file.',
  );
  process.exit(2);
}

console.log(`Batch: ${batch.batch ?? files[0]} (${candidates.length} candidates)`);
if (candidates.length < RECOMMENDED_MIN_BATCH) {
  console.log(
    `Note: batches of ${RECOMMENDED_MIN_BATCH}–${MAX_BATCH} are the intended review size.`,
  );
}

// ── Phase 1: offline validation ─────────────────────────────────────────────

const report = validateCandidateBatch(candidates, LOCATIONS);

console.log('\n── Validation ──');
for (const result of report.results) {
  const id = result.candidate.id || '(no id)';
  if (result.issues.length === 0) {
    console.log(`  ok    ${id}`);
    continue;
  }
  console.log(`  ${result.accepted ? 'warn' : 'FAIL'}  ${id}`);
  for (const issue of result.issues) {
    console.log(`          [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
}

console.log(
  `\n${report.accepted.length} accepted, ${report.rejected.length} rejected ` +
    `of ${report.batchSize}.`,
);

if (report.accepted.length === 0) {
  console.error('\nNothing passed validation. Fix the batch and re-run.');
  process.exit(1);
}

// ── Phase 2: panorama verification (opt-in, network) ────────────────────────

interface MetadataResponse {
  status?: string;
  pano_id?: string;
  location?: { lat?: number; lng?: number };
}

const apiKey = process.env.ROAM_STREETVIEW_VERIFY_KEY;

if (!shouldVerify) {
  console.log(
    '\n── Verification ──\n' +
      '  Skipped: --verify-panoramas was not passed. This run was fully offline.\n' +
      '  No candidate may be promoted to the catalog without verification.',
  );
  process.exit(0);
}

if (!apiKey) {
  console.error(
    '\n── Verification ──\n' +
      '  ROAM_STREETVIEW_VERIFY_KEY is not set.\n' +
      '  Set an IP-restricted Google Maps key with the Street View Static API\n' +
      '  enabled. Do NOT reuse the VITE_-prefixed browser key: Vite bundles\n' +
      '  VITE_* variables into the client, and the browser key is referrer-\n' +
      '  restricted so it would be rejected here anyway.',
  );
  process.exit(2);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Ask Google whether a panorama exists near a coordinate.
 *
 * Errors are reported with the candidate id and the API status only. The URL
 * is never logged, because it contains the key.
 */
async function verifyPanorama(
  candidate: Candidate,
): Promise<{ ok: true; panoId: string; lat: number; lng: number } | { ok: false; reason: string }> {
  const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  url.searchParams.set('location', `${candidate.lat},${candidate.lng}`);
  url.searchParams.set('radius', String(SEARCH_RADIUS_M));
  // Official outdoor coverage only — user photospheres are often indoors and
  // have no navigable neighbours, which makes for a poor round.
  url.searchParams.set('source', 'outdoor');
  url.searchParams.set('key', apiKey!);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as MetadataResponse;
    if (data.status !== 'OK') {
      return { ok: false, reason: data.status ?? 'UNKNOWN_STATUS' };
    }
    if (!data.pano_id || typeof data.location?.lat !== 'number' || typeof data.location?.lng !== 'number') {
      return { ok: false, reason: 'MALFORMED_RESPONSE' };
    }
    return { ok: true, panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng };
  } catch (err) {
    // Deliberately not interpolating the error object, which some runtimes
    // decorate with the request URL — and therefore the key.
    return { ok: false, reason: err instanceof Error ? err.name : 'NETWORK_ERROR' };
  }
}

console.log('\n── Verification ──');

const today = new Date().toISOString().slice(0, 10);
const verified: VerifiedCandidate[] = [];
const unverified: { id: string; reason: string }[] = [];
const seenPanoIds = new Map<string, string>();
for (const existing of LOCATIONS) {
  if (existing.panoId) seenPanoIds.set(existing.panoId, existing.id);
}

for (const result of report.accepted) {
  const candidate = result.candidate;
  const outcome = await verifyPanorama(candidate);
  await sleep(REQUEST_INTERVAL_MS);

  if (!outcome.ok) {
    unverified.push({ id: candidate.id, reason: outcome.reason });
    console.log(`  FAIL  ${candidate.id}  (${outcome.reason})`);
    continue;
  }

  // A panorama id already in use means this is the same place as an existing
  // entry, however different the coordinates looked.
  const clash = seenPanoIds.get(outcome.panoId);
  if (clash) {
    unverified.push({ id: candidate.id, reason: `duplicate panorama of "${clash}"` });
    console.log(`  FAIL  ${candidate.id}  (resolves to the same panorama as "${clash}")`);
    continue;
  }
  seenPanoIds.set(outcome.panoId, candidate.id);

  const offsetKm = Math.round(
    Math.hypot(
      (outcome.lat - candidate.lat) * 111,
      (outcome.lng - candidate.lng) * 111 * Math.cos((candidate.lat * Math.PI) / 180),
    ) * 1000,
  ) / 1000;

  verified.push({ candidate, panoId: outcome.panoId, verifiedAt: today, offsetKm });
  console.log(`  ok    ${candidate.id}  (panorama ${offsetKm.toFixed(3)} km from the target)`);
}

console.log(
  `\n${verified.length} verified, ${unverified.length} could not be verified ` +
    `of ${report.accepted.length} accepted.`,
);

if (unverified.length > 0) {
  console.log('\nNot verified (excluded from any emitted entries):');
  for (const item of unverified) console.log(`  - ${item.id}: ${item.reason}`);
}

// ── Phase 3: emit (opt-in) ──────────────────────────────────────────────────

if (!shouldEmit) {
  console.log('\nRe-run with --emit to print catalog entries for the verified candidates.');
  process.exit(verified.length === report.accepted.length ? 0 : 1);
}

if (verified.length === 0) {
  console.error('\nNothing was verified; there is nothing to emit.');
  process.exit(1);
}

console.log('\n── Catalog entries ──');
console.log('Paste into src/data/locations.ts, then run `npm run audit:dataset`.\n');
console.log(renderCatalogEntries(verified.map(toCatalogLocation)));

process.exit(verified.length === report.accepted.length ? 0 : 1);
