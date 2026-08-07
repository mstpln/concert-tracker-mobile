'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./spotify-artwork-backfill-core');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    args[key] = value;
  }
  return args;
}

function readJson(filename, fallback = null) {
  if (!filename) return fallback;
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function eventsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events)) return value.events;
  throw new Error('Synthetic events input must be an array or an object with an events array.');
}

function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (!args.events || !args.metadata) {
    throw new Error('Usage: node scripts/spotify-artwork-backfill-dry-run.js --events <synthetic-events.json> --metadata <synthetic-metadata.json> [--checkpoint <path>] [--cap <1-100>]');
  }
  const checkpointPath = String(args.checkpoint || '.livevault-maintenance/spotify-artwork-backfill-checkpoint.json');
  const events = eventsFrom(readJson(String(args.events)));
  const metadata = readJson(String(args.metadata), {});
  const checkpoint = fs.existsSync(checkpointPath) ? readJson(checkpointPath) : null;
  const cap = Number(args.cap || core.DEFAULT_IDS_PER_INVOCATION);
  const plan = core.createOrResumePlan({ events, metadata, checkpoint, cap });
  if (plan) writeJson(checkpointPath, plan);
  const uniqueTrusted = core.trustedTrackIds(events).length;
  const existing = Object.keys(metadata?.records || {}).length;
  const summary = {
    mode: 'spotify-artwork-backfill-dry-run',
    networkCalls: 0,
    productionWrites: 0,
    uniqueTrustedTrackIds: uniqueTrusted,
    metadataRecordsPresent: existing,
    plannedThisLogicalRun: plan?.plannedIds?.length || 0,
    remainingThisLogicalRun: plan?.remainingIds?.length || 0,
    terminalNotFound: plan?.terminalNotFoundIds?.length || 0,
    stagedUnsynced: Object.keys(plan?.stagedRecords || {}).length,
    checkpointWritten: Boolean(plan),
  };
  log(JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, readJson, writeJson, eventsFrom, main };
