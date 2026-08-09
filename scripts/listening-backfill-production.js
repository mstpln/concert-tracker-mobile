'use strict';

const inventoryLib = require('./listening-inventory');
const sourceReader = require('./spotify-artwork-backfill-source');
const spotifyBackfill = require('./spotify-artwork-backfill');
const runner = require('./listening-maintenance-runner');
const { createListeningMaintenanceClient } = require('./lib/listeningMaintenanceClient');
const { loadListeningMaintenanceContext } = require('./lib/listeningMaintenancePersistence');
const { createListeningMaintenanceProviders } = require('./lib/listeningMaintenanceProviders');

const MAX_FIRST_ROLLOUT_STEPS = 5;
const BACKFILL_CONFIRM_ENV = 'LIVEVAULT_LISTENING_BACKFILL_CONFIRM';
const BACKFILL_CONFIRMATION = 'I_AUTHORIZE_BOUNDED_LISTENING_PROVIDER_ENRICHMENT';
const WRITE_CONFIRM_ENV = 'LIVEVAULT_LISTENING_WRITE_CONFIRM';
const WRITE_CONFIRMATION = 'I_AUTHORIZE_DERIVED_LISTENING_WRITES';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  const options = { execute: false, write: false, maxSteps: 1, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--max-steps') {
      options.maxSteps = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown listening backfill option: ${arg}`);
  }
  if (!Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > MAX_FIRST_ROLLOUT_STEPS) {
    throw new Error(`--max-steps must be an integer from 1 to ${MAX_FIRST_ROLLOUT_STEPS} for the initial Build D rollout.`);
  }
  return options;
}

function usageText() {
  return [
    'Usage: node scripts/listening-backfill-production.js --execute --write --max-steps 1',
    '',
    `Initial Build D hard ceiling: ${MAX_FIRST_ROLLOUT_STEPS} provider steps per invocation.`,
    'Provider execution and derived production writes require separate exact authorization values.',
  ].join('\n');
}

function assertBackfillAuthorization(options, env) {
  if (!options.execute) throw new Error('Refusing listening backfill: --execute is required after provider execution is explicitly authorized.');
  if (!options.write) throw new Error('Refusing listening backfill: --write is required after derived production writes are explicitly authorized.');
  if (String(env?.[BACKFILL_CONFIRM_ENV] || '') !== BACKFILL_CONFIRMATION) {
    throw new Error(`Refusing provider execution: ${BACKFILL_CONFIRM_ENV} does not contain the required authorization value.`);
  }
  if (String(env?.[WRITE_CONFIRM_ENV] || '') !== WRITE_CONFIRMATION) {
    throw new Error(`Refusing production writes: ${WRITE_CONFIRM_ENV} does not contain the required authorization value.`);
  }
}

function safeSourceSummary(counts = {}) {
  const allowed = ['spotifyArchiveEvents', 'incrementalObjects', 'incrementalEvents', 'totalEvents'];
  return Object.fromEntries(allowed.map((key) => [key, Number(counts[key]) || 0]));
}

function safeRunSummary(result) {
  return {
    attempted: Number(result?.summary?.attempted) || 0,
    persisted: Number(result?.summary?.persisted) || 0,
    halted: Boolean(result?.summary?.halted),
    haltReason: typeof result?.summary?.haltReason === 'string' ? result.summary.haltReason : null,
    plan: result?.plan && typeof result.plan === 'object' ? { ...result.plan } : {},
  };
}

async function runProductionBackfill({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  clientFactory = createListeningMaintenanceClient,
  contextLoader = loadListeningMaintenanceContext,
  providerFactory = createListeningMaintenanceProviders,
  readAllSourceEvents = sourceReader.readAllSourceEvents,
  spotifyTokenFactory = spotifyBackfill.getSpotifyToken,
  maintenanceRunner = runner.runMaintenanceBatch,
  now = new Date().toISOString(),
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  assertBackfillAuthorization(options, env);

  const endpoint = normalizeEndpoint(requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const maintenanceToken = requiredEnv(env, 'DATA_MAINTENANCE_TOKEN');
  const client = clientFactory({ env, fetchImpl });

  const [bands, source, context] = await Promise.all([
    client.readJson('bands.json', []),
    readAllSourceEvents({ endpoint, token: maintenanceToken, fetchImpl }),
    contextLoader(client),
  ]);
  if (!Array.isArray(bands)) throw new Error('Production bands document is invalid.');
  if (!source || !Array.isArray(source.events)) throw new Error('Private listening source reader returned invalid data.');
  const loadedBands = clone(bands);

  async function assertBandsCurrent() {
    const currentBands = await client.readJson('bands.json', []);
    if (!Array.isArray(currentBands)) throw new Error('Production bands document is invalid during backfill preflight.');
    if (!same(currentBands, loadedBands)) {
      throw new Error('Listening backfill bands changed after inventory load; reload before provider execution.');
    }
    return true;
  }

  const inventory = inventoryLib.buildListeningInventory({
    bands,
    events: source.events,
    spotifyMetadata: context.spotifyMetadata,
    trackIdentities: context.trackIdentities,
  });

  let cachedSpotifyToken = null;
  async function spotifyTokenProvider() {
    if (cachedSpotifyToken) return cachedSpotifyToken;
    cachedSpotifyToken = await spotifyTokenFactory({
      clientId: requiredEnv(env, 'SPOTIFY_CLIENT_ID'),
      clientSecret: requiredEnv(env, 'SPOTIFY_CLIENT_SECRET'),
      fetchImpl,
    });
    return cachedSpotifyToken;
  }

  async function listenbrainzTokenProvider() {
    return requiredEnv(env, 'LISTENBRAINZ_USER_TOKEN');
  }

  const providers = providerFactory({ fetchImpl, spotifyTokenProvider, listenbrainzTokenProvider });
  const guardedPreflight = async (snapshot) => {
    await assertBandsCurrent();
    return context.preflight(snapshot);
  };
  const guardedUsage = {
    reserve: async (provider) => {
      const allowed = await context.usage.reserve(provider);
      if (allowed !== true) return false;
      // Recheck after quota persistence as well, so a band change between
      // preflight and reservation still stops before the provider request.
      await assertBandsCurrent();
      return true;
    },
  };
  const result = await maintenanceRunner({
    inventory,
    trackIdentities: context.trackIdentities,
    spotifyMetadata: context.spotifyMetadata,
    checkpoint: context.checkpoint,
    providers,
    usage: guardedUsage,
    preflight: guardedPreflight,
    persist: context.persist,
    maxSteps: options.maxSteps,
    now,
  });

  const safe = {
    mode: 'bounded-production-enrichment',
    maxSteps: options.maxSteps,
    source: safeSourceSummary(source.counts),
    inventory: inventoryLib.safeInventorySummary(inventory),
    run: safeRunSummary(result),
  };
  log(JSON.stringify(safe));
  return safe;
}

if (require.main === module) {
  runProductionBackfill().catch((error) => {
    console.error(`Listening backfill stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_FIRST_ROLLOUT_STEPS,
  BACKFILL_CONFIRM_ENV,
  BACKFILL_CONFIRMATION,
  WRITE_CONFIRM_ENV,
  WRITE_CONFIRMATION,
  clone,
  same,
  requiredEnv,
  normalizeEndpoint,
  parseArgs,
  usageText,
  assertBackfillAuthorization,
  safeSourceSummary,
  safeRunSummary,
  runProductionBackfill,
};
