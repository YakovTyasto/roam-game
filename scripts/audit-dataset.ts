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

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..', 'docs');
const jsonPath = resolve(docsDir, 'dataset-audit.json');
const mdPath = resolve(docsDir, 'DATASET_AUDIT.md');

const checkOnly = process.argv.includes('--check');

const report = auditDataset(LOCATIONS);
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = formatAuditMarkdown(report);

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

if (checkOnly) {
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
