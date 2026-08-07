'use strict';

const path = require('node:path');
const core = require('./spotify-artwork-backfill-core');
const runner = require('./spotify-artwork-backfill');
const source = require('./spotify-artwork-backfill-source');
const { UsageTracker } = require('./lib/usageTracker');

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

function assertPrivateCheckpointPath(value) {
  const maintenanceRoot = path.resolve('.livevault-maintenance');
  const checkpoint = path.resolve(String(value || ''));
  if (checkpoint === maintenanceRoot || !checkpoint.startsWith(`${maintenanceRoot}${path.sep}`)) {
    throw new Error('Production backfill checkpoints must stay inside the ignored .livevault-maintenance directory.');
  }
  return checkpoint;
}

async function loadValidatedCheckpoint(checkpointPath, readCheckpoint = runner.readCheckpoint) {
  const raw = await readCheckpoint(checkpointPath);
  if (!raw) return null;
  const normalized = core.normalizeCheckpoint(raw);
  if (!normalized) {
    throw new Error('The private Spotify artwork backfill checkpoint is invalid. No provider request was started.');
  }
  return normalized;
}

function configureUsageEnvironment(env, { endpoint, workerToken }) {
  process.env.CF_WORKER_ENDPOINT = endpoint;
  process.env.CF_WORKER_TOKEN = workerToken;
  if (env !== process.env) {
    env.CF_WORKER_ENDPOINT = endpoint;
    env.CF_WORKER_TOKEN = workerToken;
  }
}

async function trackedSpotifyCall(usage, operation) {
  if (!usage?.canCallSpotify?.()) {
    const error = new Error('BANDMARKR provider-usage safety stopped this Spotify maintenance run before another request.');
    error.code = 'SPOTIFY_USAGE_GUARD';
    throw error;
  }
  await usage.recordSpotifyCall();
  return operation();
}

async function runProductionCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  usageFactory = () => UsageTracker.load(),
  runBackfillImpl = runner.runBackfill,
} = {}) {
  const options = runner.parseArgs(argv);
  if (options.help) {
    log(runner.usageText());
    return { help: true };
  }
  if (!options.execute) throw new Error('Refusing production maintenance: add --execute only after the reviewed production authorization is in place.');
  if (env.LIVEVAULT_BACKFILL_CONFIRM !== runner.EXECUTION_CONFIRMATION) {
    throw new Error('Refusing production maintenance: LIVEVAULT_BACKFILL_CONFIRM does not contain the required confirmation value.');
  }

  const endpoint = normalizeEndpoint(requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const workerToken = requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN');
  const clientId = requiredEnv(env, 'SPOTIFY_CLIENT_ID');
  const clientSecret = requiredEnv(env, 'SPOTIFY_CLIENT_SECRET');
  const checkpointPath = assertPrivateCheckpointPath(options.checkpointPath);
  configureUsageEnvironment(env, { endpoint, workerToken });

  const usage = await usageFactory();
  let summary = null;
  let runError = null;
  try {
    summary = await runBackfillImpl({
      cap: options.cap,
      delayMs: options.delayMs,
      market: options.market,
      writeEnabled: options.write,
      loadEvents: async () => {
        const result = await source.readAllSourceEvents({ endpoint, token: workerToken, fetchImpl });
        return result.events;
      },
      readMetadata: () => runner.readRemoteMetadata({ endpoint, token: workerToken, fetchImpl }),
      writeMetadata: ({ value, etag, missing }) => runner.workerPutJson({
        endpoint,
        token: workerToken,
        pathname: 'listening/spotify-metadata.json',
        value,
        etag,
        missing,
        fetchImpl,
      }),
      loadCheckpoint: () => loadValidatedCheckpoint(checkpointPath),
      saveCheckpoint: (checkpoint) => runner.writeCheckpoint(checkpointPath, checkpoint),
      getToken: () => trackedSpotifyCall(usage, () => runner.getSpotifyToken({ clientId, clientSecret, fetchImpl })),
      fetchTrack: ({ id, token, market }) => trackedSpotifyCall(usage, () => runner.fetchSpotifyTrack({ id, token, market, fetchImpl })),
    });
    return summary;
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      await usage.save();
    } catch (saveError) {
      if (!runError) throw new Error(`Backfill finished but provider-usage accounting could not be saved: ${saveError.message}`);
      log('Provider-usage accounting also failed to save; no credential values were logged.');
    }
    if (summary) {
      log(JSON.stringify(summary, null, 2));
      if (!options.write && summary.staged > 0) {
        log('Spotify metadata is staged only in the ignored private checkpoint. Production listening metadata was not written.');
      }
    }
  }
}

if (require.main === module) {
  runProductionCli().catch((error) => {
    console.error(`Spotify artwork production backfill stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  requiredEnv,
  normalizeEndpoint,
  assertPrivateCheckpointPath,
  loadValidatedCheckpoint,
  configureUsageEnvironment,
  trackedSpotifyCall,
  runProductionCli,
  MAX_IDS_PER_INVOCATION: core.MAX_IDS_PER_INVOCATION,
};
