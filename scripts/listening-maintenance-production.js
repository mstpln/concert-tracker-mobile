'use strict';

const inventoryLib = require('./listening-inventory');
const sourceReader = require('./spotify-artwork-backfill-source');
const { createListeningMaintenanceClient } = require('./lib/listeningMaintenanceClient');

const PRIVATE_READ_CONFIRMATION = 'I_AUTHORIZE_PRIVATE_LISTENING_READS_FOR_AGGREGATE_INVENTORY';
const CONFIRM_ENV = 'LIVEVAULT_LISTENING_MAINTENANCE_CONFIRM';

function requiredEnv(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(endpoint)) throw new Error('CF_WORKER_ENDPOINT must be an HTTPS URL.');
  return endpoint;
}

function parseArgs(argv = []) {
  const options = { execute: false, inventoryOnly: false, help: false };
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg === '--inventory-only') options.inventoryOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown listening maintenance option: ${arg}`);
  }
  return options;
}

function usageText() {
  return [
    'Usage: node scripts/listening-maintenance-production.js --inventory-only --execute',
    '',
    'This v109 entrypoint can only produce aggregate inventory diagnostics.',
    'It has no provider-call mode and no production-write mode.',
  ].join('\n');
}

function assertInventoryAuthorization(options, env) {
  if (!options.inventoryOnly) throw new Error('Refusing listening maintenance: only --inventory-only is supported in this Build C slice.');
  if (!options.execute) throw new Error('Refusing private listening reads: add --execute only after aggregate inventory access is explicitly authorized.');
  if (String(env?.[CONFIRM_ENV] || '') !== PRIVATE_READ_CONFIRMATION) {
    throw new Error(`Refusing private listening reads: ${CONFIRM_ENV} does not contain the required aggregate-inventory authorization value.`);
  }
}

function safeSourceSummary(counts = {}) {
  const allowed = ['spotifyArchiveEvents', 'incrementalObjects', 'incrementalEvents', 'totalEvents'];
  return Object.fromEntries(allowed.map((key) => [key, Number(counts[key]) || 0]));
}

async function runProductionInventory({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  clientFactory = createListeningMaintenanceClient,
  readAllSourceEvents = sourceReader.readAllSourceEvents,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  assertInventoryAuthorization(options, env);

  const endpoint = normalizeEndpoint(requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const token = requiredEnv(env, 'DATA_MAINTENANCE_TOKEN');
  const client = clientFactory({ env, fetchImpl });

  const [bands, spotifyMetadata, trackIdentities, source] = await Promise.all([
    client.readJson('bands.json', []),
    client.readJson('listening/spotify-metadata.json', null),
    client.readJson('listening/track-identities.json', null),
    readAllSourceEvents({ endpoint, token, fetchImpl }),
  ]);

  if (!Array.isArray(bands)) throw new Error('Production bands document is invalid.');
  if (!source || !Array.isArray(source.events)) throw new Error('Private listening source reader returned invalid data.');

  const inventory = inventoryLib.buildListeningInventory({
    bands,
    events: source.events,
    spotifyMetadata,
    trackIdentities,
  });
  const safe = {
    mode: 'inventory-only',
    source: safeSourceSummary(source.counts),
    inventory: inventoryLib.safeInventorySummary(inventory),
    providerCalls: 0,
    productionWrites: 0,
  };
  log(JSON.stringify(safe));
  return safe;
}

if (require.main === module) {
  runProductionInventory().catch((error) => {
    console.error(`Listening maintenance inventory stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRIVATE_READ_CONFIRMATION,
  CONFIRM_ENV,
  requiredEnv,
  normalizeEndpoint,
  parseArgs,
  usageText,
  assertInventoryAuthorization,
  safeSourceSummary,
  runProductionInventory,
};
