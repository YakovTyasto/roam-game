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
 * A saved `--report` file can be replayed later with `--from-report <path>` to
 * emit entries **offline**, without re-querying Google. That mode still cannot
 * invent anything: it only emits candidates the report records as verified,
 * using the panorama id the report holds, and it refuses any id the report does
 * not list.
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
 *   npm run catalog:verify -- data/candidates/batch-001.json --verify-panoramas --report out.json
 *   npm run catalog:verify -- data/candidates/recheck-original-50.json --recheck --verify-panoramas --report out.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

const shouldVerify = flags.has('--verify-panoramas');
const shouldEmit = flags.has('--emit');

/**
 * `--recheck` verifies locations that are ALREADY in the catalog, to confirm or
 * refresh their panorama coverage. Entries added before the verification
 * workflow existed have no `panoId`, and coverage is withdrawn over time, so the
 * catalog needs a way to be re-checked rather than only appended to.
 *
 * It changes exactly one thing: "this id/coordinate is already in the catalog"
 * stops being an error, because in this mode that is the entire point. Every
 * other validation rule still blocks, and no entry is modified — the run only
 * produces a report.
 */
const isRecheck = flags.has('--recheck');

/**
 * `--report <path>` writes the verification outcome to JSON. Verification is
 * the only step whose result cannot be recreated offline, so losing it means
 * re-running every request against Google. The report holds resolved panorama
 * ids and failure reasons — never the API key.
 */
const reportFlagIndex = argv.indexOf('--report');
const reportPath = reportFlagIndex >= 0 ? argv[reportFlagIndex + 1] : undefined;

/**
 * `--from-report <path>` emits catalog entries from a previously saved
 * verification report, with no network access at all. Verification results are
 * expensive to obtain and identical on replay, so turning one into catalog
 * entries should not require querying Google again.
 */
const fromReportIndex = argv.indexOf('--from-report');
const fromReportPath = fromReportIndex >= 0 ? argv[fromReportIndex + 1] : undefined;

// The value after --report is a path, not the batch file.
const files = argv.filter(
  (a, i) =>
    !a.startsWith('--') &&
    !(reportFlagIndex >= 0 && i === reportFlagIndex + 1) &&
    !(fromReportIndex >= 0 && i === fromReportIndex + 1),
);

if (files.length !== 1) {
  console.error(
    'Usage: npm run catalog:verify -- <batch-file.json> ' +
      '[--verify-panoramas] [--emit] [--report <path.json>]',
  );
  process.exit(2);
}
if (reportFlagIndex >= 0 && !reportPath) {
  console.error('--report requires a file path.');
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

// When replaying a saved report, a candidate that is ALREADY in the catalog is
// the expected case, not an error: replay exists to regenerate entries that were
// integrated earlier. Those two codes are therefore downgraded in that mode
// only. Every other error still blocks, so a genuinely malformed candidate
// cannot slip through on the replay path.
const REPLAY_EXPECTED_CODES = new Set(['id.duplicateCatalog', 'novelty.catalogDuplicate']);
const replayAccepted = fromReportPath || isRecheck
  ? report.results.filter((r) =>
      r.issues.every((i) => i.severity !== 'error' || REPLAY_EXPECTED_CODES.has(i.code)),
    )
  : report.accepted;

console.log(
  `\n${report.accepted.length} accepted, ${report.rejected.length} rejected ` +
    `of ${report.batchSize}.`,
);
if ((fromReportPath || isRecheck) && replayAccepted.length !== report.accepted.length) {
  console.log(
    `  (${isRecheck ? 'recheck' : 'replay'}: ${replayAccepted.length} usable — ` +
      `${replayAccepted.length - report.accepted.length} already in the catalog, which is expected here)`,
  );
}

if (replayAccepted.length === 0) {
  console.error('\nNothing passed validation. Fix the batch and re-run.');
  process.exit(1);
}

// ── Replay: emit from a saved report, offline ───────────────────────────────

interface SavedReport {
  verified?: { id?: unknown; panoId?: unknown; verifiedAt?: unknown }[];
}

if (fromReportPath) {
  let saved: SavedReport;
  try {
    saved = JSON.parse(readFileSync(resolve(process.cwd(), fromReportPath), 'utf8')) as SavedReport;
  } catch (err) {
    console.error(
      `Could not read report: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  const rows = Array.isArray(saved.verified) ? saved.verified : [];
  const byId = new Map<string, { panoId: string; verifiedAt: string }>();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || typeof row?.panoId !== 'string') continue;
    if (row.panoId.trim().length === 0) continue;
    byId.set(row.id, {
      panoId: row.panoId,
      verifiedAt: typeof row.verifiedAt === 'string' ? row.verifiedAt : '',
    });
  }

  console.log(`\n── Replay from ${fromReportPath} ──`);
  console.log(`  ${byId.size} verified entr${byId.size === 1 ? 'y' : 'ies'} in the report.`);

  // Only candidates the report vouches for are emitted. A candidate absent from
  // the report has no panorama id, and one is never synthesised for it.
  const replayed: VerifiedCandidate[] = [];
  for (const result of replayAccepted) {
    const record = byId.get(result.candidate.id);
    if (!record) continue;
    if (!record.verifiedAt) {
      console.error(`  FAIL  ${result.candidate.id}: report has no verification date.`);
      process.exit(1);
    }
    replayed.push({
      candidate: result.candidate,
      panoId: record.panoId,
      verifiedAt: record.verifiedAt,
      offsetKm: 0,
    });
  }

  const missing = [...byId.keys()].filter(
    (id) => !replayAccepted.some((r) => r.candidate.id === id),
  );
  if (missing.length > 0) {
    console.error(
      `  Report references ids that are not accepted candidates in this batch: ${missing.join(', ')}`,
    );
    process.exit(1);
  }

  console.log(`  ${replayed.length} matched this batch.\n`);
  console.log('── Catalog entries ──');
  console.log('Paste into src/data/locations.ts, then run `npm run audit:dataset`.\n');
  console.log(renderCatalogEntries(replayed.map(toCatalogLocation)));
  process.exit(0);
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

for (const result of replayAccepted) {
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
  // Print the resolved panorama id, not just "ok". It is the one piece of
  // information a verification run produces that cannot be recreated offline,
  // and a run that only says "ok" forces a second billable pass to recover it.
  console.log(`  ok    ${candidate.id}  ${outcome.panoId}  (${offsetKm.toFixed(3)} km off target)`);
}

console.log(
  `\n${verified.length} verified, ${unverified.length} could not be verified ` +
    `of ${report.accepted.length} accepted.`,
);

if (unverified.length > 0) {
  console.log('\nNot verified (excluded from any emitted entries):');
  for (const item of unverified) console.log(`  - ${item.id}: ${item.reason}`);
}

if (reportPath) {
  const artifact = {
    batch: batch.batch ?? files[0],
    verifiedAt: today,
    counts: {
      candidates: report.batchSize,
      accepted: report.accepted.length,
      verified: verified.length,
      unverified: unverified.length,
    },
    verified: verified.map((v) => ({
      id: v.candidate.id,
      panoId: v.panoId,
      verifiedAt: v.verifiedAt,
      offsetKm: v.offsetKm,
    })),
    unverified,
  };
  writeFileSync(resolve(process.cwd(), reportPath), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`\nWrote verification report to ${reportPath}`);
}

// ── Phase 3: emit (opt-in) ──────────────────────────────────────────────────

if (!shouldEmit) {
  console.log('\nRe-run with --emit to print catalog entries for the verified candidates.');
  process.exit(verified.length === replayAccepted.length ? 0 : 1);
}

if (verified.length === 0) {
  console.error('\nNothing was verified; there is nothing to emit.');
  process.exit(1);
}

console.log('\n── Catalog entries ──');
console.log('Paste into src/data/locations.ts, then run `npm run audit:dataset`.\n');
console.log(renderCatalogEntries(verified.map(toCatalogLocation)));

process.exit(verified.length === replayAccepted.length ? 0 : 1);
