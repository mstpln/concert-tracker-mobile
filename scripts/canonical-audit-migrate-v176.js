'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Migration = require('./lib/canonicalMigrationV176Final');

function usage() {
  return [
    'Usage:',
    '  node scripts/canonical-audit-migrate-v176.js audit --venues <local venues.json> --concerts <local concerts.json> [--decisions <local decisions.json>] --out <local report.json>',
    '  node scripts/canonical-audit-migrate-v176.js plan --venues <local venues.json> --concerts <local concerts.json> [--decisions <local decisions.json> --expected-decisions-sha256 <sha256>] --expected-venues-sha256 <sha256> --expected-concerts-sha256 <sha256> --out-dir <local directory>',
    '',
    'Safety: this command reads explicit local files only. It has no network or production write path.',
    'Plan mode is dry-run only and refuses to run unless exact source-file SHA-256 guards match.',
    'When a research decision registry is supplied in plan mode, its exact byte-level SHA-256 is mandatory too.',
    'Output paths may not overwrite or contain any supplied source input file.',
    'Plan output directories must be absent or empty so stale artifacts cannot survive a later run.',
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
  const raw = fs.readFileSync(resolved);
  const parsed = JSON.parse(raw.toString('utf8'));
  return { path: resolved, raw, value: parsed, sha256: Migration.sha256Bytes(raw) };
}

function validateSha256(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`Missing or invalid --${label}; expected a 64-character SHA-256.`);
  return normalized;
}

function assertHash(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}. Refusing dry-run plan.`);
}

function inputPaths(venues, concerts, decisionsFile) {
  return [venues.path, concerts.path, decisionsFile?.path].filter(Boolean);
}

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertAuditOutputSafe(outPath, inputs) {
  const resolved = path.resolve(outPath);
  if (inputs.includes(resolved)) throw new Error('Audit output path must not overwrite a source input file.');
  return resolved;
}

function assertPlanOutputSafe(outDir, inputs) {
  const resolved = path.resolve(outDir);
  const contained = inputs.find((input) => pathInside(resolved, input));
  if (contained) throw new Error(`Plan output directory must not contain a source input file: ${contained}`);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error('Plan output path must be a directory.');
    if (fs.readdirSync(resolved).length > 0) throw new Error('Plan output directory must be absent or empty.');
  }
  return resolved;
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

function writeBytes(filePath, raw) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, raw);
  return resolved;
}

function main() {
  const args = argsFrom(process.argv);
  if (!['audit', 'plan'].includes(args.command)) throw new Error(usage());
  const venues = readJson(args.venues, 'venues');
  const concerts = readJson(args.concerts, 'concerts');
  if (!Array.isArray(venues.value) || !Array.isArray(concerts.value)) throw new Error('Venue and concert inputs must both be JSON arrays.');
  const decisionsFile = args.decisions ? readJson(args.decisions, 'decisions') : null;
  const decisions = decisionsFile?.value || {};
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) throw new Error('Research decisions input must be a JSON object.');
  const inputs = inputPaths(venues, concerts, decisionsFile);

  if (args.command === 'audit') {
    if (!args.out) throw new Error('Missing --out');
    const safeOut = assertAuditOutputSafe(args.out, inputs);
    const report = Migration.audit(venues.value, concerts.value, decisions);
    report.sourceFileHashes = {
      venues: venues.sha256,
      concerts: concerts.sha256,
      decisions: decisionsFile?.sha256 || null,
    };
    const out = writeJson(safeOut, report);
    process.stdout.write(`Audit written: ${out}\n`);
    process.stdout.write(`Source file hashes: venues=${venues.sha256} concerts=${concerts.sha256}${decisionsFile ? ` decisions=${decisionsFile.sha256}` : ''}\n`);
    process.stdout.write(`Candidates: venues=${report.venueCandidates.length} concerts=${report.concertCandidates.length} unresolved=${report.unresolvedConcerts.length}\n`);
    return;
  }

  if (!args['out-dir']) throw new Error('Missing --out-dir');
  const expectedVenuesHash = validateSha256(args['expected-venues-sha256'], 'expected-venues-sha256');
  const expectedConcertsHash = validateSha256(args['expected-concerts-sha256'], 'expected-concerts-sha256');
  assertHash(venues.sha256, expectedVenuesHash, 'venues');
  assertHash(concerts.sha256, expectedConcertsHash, 'concerts');
  if (decisionsFile) {
    const expectedDecisionsHash = validateSha256(args['expected-decisions-sha256'], 'expected-decisions-sha256');
    assertHash(decisionsFile.sha256, expectedDecisionsHash, 'decisions');
  } else if (args['expected-decisions-sha256']) {
    throw new Error('--expected-decisions-sha256 requires --decisions.');
  }

  const outDir = assertPlanOutputSafe(args['out-dir'], inputs);
  const plan = Migration.planMigration(venues.value, concerts.value, decisions);
  const validation = Migration.validatePlan(plan);

  writeBytes(path.join(outDir, 'source', 'venues.original.json'), venues.raw);
  writeBytes(path.join(outDir, 'source', 'concerts.original.json'), concerts.raw);
  if (decisionsFile) writeBytes(path.join(outDir, 'source', 'decisions.original.json'), decisionsFile.raw);
  writeJson(path.join(outDir, 'venues.migrated.json'), plan.venues);
  writeJson(path.join(outDir, 'concerts.migrated.json'), plan.concerts);
  writeJson(path.join(outDir, 'legacy-venue-map.json'), plan.legacyVenueMap);
  writeJson(path.join(outDir, 'legacy-concert-map.json'), plan.legacyConcertMap);
  writeJson(path.join(outDir, 'reverse-venue-map.json'), plan.reverseVenueMap);
  writeJson(path.join(outDir, 'reverse-concert-map.json'), plan.reverseConcertMap);
  writeJson(path.join(outDir, 'merge-manifest.json'), plan.mergeManifest);
  writeJson(path.join(outDir, 'migration-report.json'), {
    schemaVersion: plan.schemaVersion,
    sourceFileHashes: {
      venues: venues.sha256,
      concerts: concerts.sha256,
      decisions: decisionsFile?.sha256 || null,
    },
    sourceHashes: plan.sourceHashes,
    outputHashes: plan.outputHashes,
    before: plan.before,
    after: plan.after,
    blocked: plan.blocked,
    unresolved: plan.unresolved,
    unresolvedIdentity: plan.unresolvedIdentity,
    invariants: plan.invariants,
    validation,
  });
  writeJson(path.join(outDir, 'rollback-manifest.json'), {
    schemaVersion: 1,
    sourceFileHashes: {
      venues: venues.sha256,
      concerts: concerts.sha256,
      decisions: decisionsFile?.sha256 || null,
    },
    outputHashes: plan.outputHashes,
    reverseVenueMap: plan.reverseVenueMap,
    reverseConcertMap: plan.reverseConcertMap,
    untouchedBackups: {
      venues: 'source/venues.original.json',
      concerts: 'source/concerts.original.json',
      decisions: decisionsFile ? 'source/decisions.original.json' : null,
    },
    note: 'Rollback uses the untouched source files. This dry-run tool never writes production data.',
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
