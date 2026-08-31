'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Migration = require('./lib/canonicalMigrationV176');

function usage() {
  return [
    'Usage:',
    '  node scripts/canonical-audit-migrate-v176.js audit --venues <local venues.json> --concerts <local concerts.json> [--decisions <local decisions.json>] --out <local report.json>',
    '  node scripts/canonical-audit-migrate-v176.js plan --venues <local venues.json> --concerts <local concerts.json> [--decisions <local decisions.json>] --out-dir <local directory>',
    '',
    'Safety: this command reads explicit local files only. It has no network or production write path.',
  ].join('\n');
}

function argsFrom(argv) {
  const result = { command: argv[2] || '' };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    i += 1;
  }
  return result;
}

function readJson(filePath, label) {
  if (!filePath) throw new Error(`Missing --${label}`);
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { path: resolved, value: parsed };
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

function main() {
  const args = argsFrom(process.argv);
  if (!['audit', 'plan'].includes(args.command)) throw new Error(usage());
  const venues = readJson(args.venues, 'venues');
  const concerts = readJson(args.concerts, 'concerts');
  if (!Array.isArray(venues.value) || !Array.isArray(concerts.value)) throw new Error('Venue and concert inputs must both be JSON arrays.');
  const decisions = args.decisions ? readJson(args.decisions, 'decisions').value : {};

  if (args.command === 'audit') {
    if (!args.out) throw new Error('Missing --out');
    const report = Migration.audit(venues.value, concerts.value, decisions);
    const out = writeJson(args.out, report);
    process.stdout.write(`Audit written: ${out}\n`);
    process.stdout.write(`Source hashes: venues=${report.sourceHashes.venues} concerts=${report.sourceHashes.concerts}\n`);
    process.stdout.write(`Candidates: venues=${report.venueCandidates.length} concerts=${report.concertCandidates.length} unresolved=${report.unresolvedConcerts.length}\n`);
    return;
  }

  if (!args['out-dir']) throw new Error('Missing --out-dir');
  const outDir = path.resolve(args['out-dir']);
  const plan = Migration.planMigration(venues.value, concerts.value, decisions);
  const validation = Migration.validatePlan(plan);
  writeJson(path.join(outDir, 'venues.migrated.json'), plan.venues);
  writeJson(path.join(outDir, 'concerts.migrated.json'), plan.concerts);
  writeJson(path.join(outDir, 'legacy-venue-map.json'), plan.legacyVenueMap);
  writeJson(path.join(outDir, 'legacy-concert-map.json'), plan.legacyConcertMap);
  writeJson(path.join(outDir, 'merge-manifest.json'), plan.mergeManifest);
  writeJson(path.join(outDir, 'migration-report.json'), {
    schemaVersion: plan.schemaVersion,
    sourceHashes: plan.sourceHashes,
    outputHashes: plan.outputHashes,
    before: plan.before,
    after: plan.after,
    blocked: plan.blocked,
    unresolved: plan.unresolved,
    validation,
  });
  writeJson(path.join(outDir, 'rollback-manifest.json'), {
    schemaVersion: 1,
    sourceHashes: plan.sourceHashes,
    outputHashes: plan.outputHashes,
    reverseVenueMap: Object.fromEntries(Object.entries(plan.legacyVenueMap).map(([oldId, canonicalId]) => [oldId, canonicalId])),
    reverseConcertMap: Object.fromEntries(Object.entries(plan.legacyConcertMap).map(([oldId, canonicalId]) => [oldId, canonicalId])),
    note: 'Keep untouched source files alongside this manifest. This tool never writes production data.',
  });
  process.stdout.write(`Dry-run plan written: ${outDir}\n`);
  process.stdout.write(`Validation: ${validation.valid ? 'PASS' : 'BLOCKED'}${validation.errors.length ? ` (${validation.errors.join(', ')})` : ''}\n`);
  if (!validation.valid) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
