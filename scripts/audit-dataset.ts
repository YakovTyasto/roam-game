/**
 * Dataset audit CLI — `npm run audit:dataset`.
 *
 * Writes two views of the SAME report object:
 *   • docs/dataset-audit.json  — machine-readable, diffable, CI-checkable
 *   • docs/DATASET_AUDIT.md    — human-readable
 *
 * Fully offline: it imports the bundled catalog and runs pure functions. No
 * network, no API key, no Google request. (Panorama *verification* is a
 * separate, explicitly opt-in tool — see scripts/verify-candidates.ts.)
 *
 * Run with `--check` to fail (exit 1) when the committed artifacts are stale
 * or the audit reports metadata problems; that is the mode CI would use.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCATIONS } from '../src/data/locations';
import { auditDataset } from '../src/audit/datasetAudit';
import { formatAuditMarkdown } from '../src/audit/formatAudit';
import { evaluateReleaseGates } from '../src/audit/releaseGates';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', 'docs');
const jsonPath = resolve(docsDir, 'dataset-audit.json');
const mdPath = resolve(docsDir, 'DATASET_AUDIT.md');

const checkOnly = process.argv.includes('--check');
/**
 * `--gates` exits non-zero while any V4 release gate fails. This is the
 * blocking check: the catalog must not reach production below it.
 */
const gatesOnly = process.argv.includes('--gates');

const report = auditDataset(LOCATIONS);
const gateReport = evaluateReleaseGates(report);
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = formatAuditMarkdown(report);

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

if (gatesOnly) {
  const { summary, groupsStillNeeded: need } = gateReport;
  for (const gate of gateReport.gates) {
    console.log(`${gate.passed ? 'PASS' : 'FAIL'}  ${gate.id.padEnd(38)} ${gate.requirement}`);
    if (!gate.passed) console.log(`      actual: ${gate.actual}`);
  }
  console.log(`\n${summary.passed}/${summary.total} release gates pass.`);

  if (!gateReport.passed) {
    console.error(
      `\nRELEASE BLOCKED. Still required: +${need.easy} Easy, +${need.normal} Normal, ` +
        `+${need.hard} Hard (+${need.total} total canonical groups).\n` +
        'Shuffle-bag cycling guarantees coverage of whatever exists; it is not a\n' +
        'substitute for catalog expansion. See docs/CATALOG_EXPANSION.md for the\n' +
        'batch validation workflow.',
    );
    process.exit(1);
  }
  console.log('Catalog meets every V4 release gate.');
} else if (checkOnly) {
  const staleFiles = [
    [jsonPath, json],
    [mdPath, markdown],
  ].filter(([path, expected]) => readOrNull(path) !== expected);

  if (staleFiles.length > 0) {
    console.error(
      `Dataset audit artifacts are stale:\n${staleFiles
        .map(([p]) => `  - ${p}`)
        .join('\n')}\nRun \`npm run audit:dataset\` and commit the result.`,
    );
    process.exit(1);
  }
  if (!report.ok) {
    console.error('Dataset audit reported metadata issues:');
    for (const issue of report.metadataIssues) {
      console.error(`  - ${issue.locationId} [${issue.field}] ${issue.message}`);
    }
    process.exit(1);
  }
  console.log('Dataset audit artifacts are up to date and clean.');
} else {
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(jsonPath, json, 'utf8');
  writeFileSync(mdPath, markdown, 'utf8');
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

// Headline numbers on stdout so the CLI is useful without opening the files.
if (!gatesOnly) {
console.log(
  `\n${report.totals.locations} locations → ${report.totals.canonicalGroups} canonical groups ` +
    `(${report.totals.redundantLocations} redundant), ${report.totals.countries} countries, ` +
    `${report.totals.continents} continents.`,
);
console.log(
  `A default ${report.verdict.defaultDifficulty} game draws from ` +
    `${report.verdict.defaultPoolGroups} of them.`,
);
console.log(
  `Repeat-free standard games supported: ${report.verdict.freshGamesSupported} ` +
    `(target ${report.verdict.targetFreshGames}) — ` +
    `${
      report.verdict.sufficient
        ? 'sufficient'
        : `short by ${report.verdict.groupsRequired - report.verdict.defaultPoolGroups} groups`
    }.`,
);
}
