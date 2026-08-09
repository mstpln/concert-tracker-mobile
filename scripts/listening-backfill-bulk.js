'use strict';

const inventoryLib = require('./listening-inventory');
const enrichment = require('./listening-enrichment-engine');
const sourceReader = require('./spotify-artwork-backfill-source');
const spotifyBackfill = require('./spotify-artwork-backfill');
const runner = require('./listening-maintenance-runner');
const production = require('./listening-backfill-production');
const { createListeningMaintenanceClient } = require('./lib/listeningMaintenanceClient');
const { loadListeningMaintenanceContext } = require('./lib/listeningMaintenancePersistence');
const {
  createListeningMaintenanceProviders,
  MUSICBRAINZ_TRANSIENT_RETRY_MS,
} = require('./lib/listeningMaintenanceProviders');

const BULK_CONFIRM_ENV = 'LIVEVAULT_LISTENING_BULK_CONFIRM';
const BULK_CONFIRMATION = 'I_AUTHORIZE_FULL_LISTENING_BACKFILL';
const CHUNK_STEPS = runner.HARD_MAX_STEPS;
const MAX_TOTAL_STEPS = 50000;
const SPOTIFY_TOKEN_REUSE_MS = 45 * 60 * 1000;
const LEGACY_MUSICBRAINZ_TRANSIENT_REASONS = new Set([
  'http_429',
  'http_503',
  'musicbrainz_network_error',
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseArgs(argv = []) {
  const options = { execute: false, write: false, maxTotalSteps: MAX_TOTAL_STEPS, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--max-total-steps') {
      options.maxTotalSteps = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown listening bulk-backfill option: ${arg}`);
  }
  if (!Number.isInteger(options.maxTotalSteps) || options.maxTotalSteps < 1 || options.maxTotalSteps > MAX_TOTAL_STEPS) {
    throw new Error(`--max-total-steps must be an integer from 1 to ${MAX_TOTAL_STEPS}.`);
  }
  return options;
}

function usageText() {
  return [
    'Usage: node scripts/listening-backfill-bulk.js --execute --write',
    '',
    `Bulk Build D ceiling: ${MAX_TOTAL_STEPS} provider steps per invocation, executed in durable chunks of at most ${CHUNK_STEPS}.`,
    'The existing provider/write authorizations and the separate full-backfill authorization are all required.',
  ].join('\n');
}

function assertBulkAuthorization(options, env) {
  production.assertBackfillAuthorization(options, env);
  if (String(env?.[BULK_CONFIRM_ENV] || '') !== BULK_CONFIRMATION) {
    throw new Error(`Refusing full backfill: ${BULK_CONFIRM_ENV} does not contain the required authorization value.`);
  }
}

function safeProgressSummary({ chunk, attempted, persisted, result }) {
  return {
    mode: 'bulk-production-enrichment-progress',
    chunk,
    attempted,
    persisted,
    haltReason: result?.summary?.haltReason || null,
    plan: result?.plan && typeof result.plan === 'object' ? { ...result.plan } : {},
  };
}

function legacyMusicbrainzTransientRetryAt(record) {
  if (!record || record.status !== 'error') return null;
  const state = record?.providers?.musicbrainz;
  if (!state || state.status !== 'error' || !LEGACY_MUSICBRAINZ_TRANSIENT_REASONS.has(state.reason)) return null;
  const checkedAt = Date.parse(state.checkedAt);
  if (!Number.isFinite(checkedAt)) return null;
  return new Date(checkedAt + MUSICBRAINZ_TRANSIENT_RETRY_MS).toISOString();
}

function recoverableLegacyMusicbrainzItem(item, record) {
  if (!item || item.status === 'blocked' || item.status === 'complete') return false;
  if (!enrichment.identityCompatible(item, record)) return false;
  const storedIsrc = enrichment.validIsrc(record?.isrc);
  const metadataIsrc = enrichment.validIsrc(item.spotifyMetadataIsrc);
  if (storedIsrc && metadataIsrc && storedIsrc !== metadataIsrc) return false;
  return Boolean((storedIsrc || metadataIsrc) && item.trustedMusicbrainzArtistMbid);
}

function reviveLegacyMusicbrainzTransientErrors(document, recoveredAt = new Date().toISOString(), inventory = null) {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !document.records || typeof document.records !== 'object' || Array.isArray(document.records)) return document;
  if (!Number.isFinite(Date.parse(recoveredAt))) throw new Error('Legacy MusicBrainz recovery requires a valid timestamp.');
  const itemsByKey = new Map((Array.isArray(inventory?.items) ? inventory.items : []).map((item) => [item.trackKey, item]));
  let changed = false;
  const records = {};
  for (const [trackKey, record] of Object.entries(document.records)) {
    const retryAt = legacyMusicbrainzTransientRetryAt(record);
    const item = itemsByKey.get(trackKey);
    if (!retryAt || !recoverableLegacyMusicbrainzItem(item, record)) {
      records[trackKey] = record;
      continue;
    }
    const recovered = clone(record);
    recovered.status = 'retry';
    recovered.updatedAt = recoveredAt;
    recovered.nextEligibleCheckAt = retryAt;
    recovered.providers.musicbrainz.status = 'retry';
    records[trackKey] = recovered;
    changed = true;
  }
  return changed ? { ...document, updatedAt: recoveredAt, records } : document;
}

async function runBulkBackfill({
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
  now = () => new Date().toISOString(),
  clock = () => Date.now(),
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  assertBulkAuthorization(options, env);

  const endpoint = production.normalizeEndpoint(production.requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const maintenanceToken = production.requiredEnv(env, 'DATA_MAINTENANCE_TOKEN');
  const client = clientFactory({ env, fetchImpl });

  const [bands, source, context] = await Promise.all([
    client.readJson('bands.json', []),
    readAllSourceEvents({ endpoint, token: maintenanceToken, fetchImpl }),
    contextLoader(client, { bulk: true }),
  ]);
  if (!Array.isArray(bands)) throw new Error('Production bands document is invalid.');
  if (!source || !Array.isArray(source.events)) throw new Error('Private listening source reader returned invalid data.');
  const loadedBands = clone(bands);

  const inventory = inventoryLib.buildListeningInventory({
    bands,
    events: source.events,
    spotifyMetadata: context.spotifyMetadata,
    trackIdentities: context.trackIdentities,
  });
  const recoveryNow = now();
  const recoveredTrackIdentities = reviveLegacyMusicbrainzTransientErrors(context.trackIdentities, recoveryNow, inventory);

  async function assertBandsCurrent() {
    const currentBands = await client.readJson('bands.json', []);
    if (!Array.isArray(currentBands)) throw new Error('Production bands document is invalid during backfill preflight.');
    if (!production.same(currentBands, loadedBands)) {
      throw new Error('Listening backfill bands changed after inventory load; reload before provider execution.');
    }
    return true;
  }

  if (recoveredTrackIdentities !== context.trackIdentities) {
    if (typeof context.persistTrackIdentitiesOnly !== 'function') {
      throw new Error('Listening maintenance identity-correction persistence is unavailable.');
    }
    await assertBandsCurrent();
    const correctionPersisted = await context.persistTrackIdentitiesOnly(recoveredTrackIdentities);
    if (correctionPersisted !== true) throw new Error('Listening maintenance identity correction was not confirmed.');
  }

  let cachedSpotifyToken = null;
  let cachedSpotifyTokenAt = 0;
  async function spotifyTokenProvider() {
    const current = clock();
    if (cachedSpotifyToken && current - cachedSpotifyTokenAt < SPOTIFY_TOKEN_REUSE_MS) return cachedSpotifyToken;
    cachedSpotifyToken = await spotifyTokenFactory({
      clientId: production.requiredEnv(env, 'SPOTIFY_CLIENT_ID'),
      clientSecret: production.requiredEnv(env, 'SPOTIFY_CLIENT_SECRET'),
      fetchImpl,
    });
    cachedSpotifyTokenAt = current;
    return cachedSpotifyToken;
  }

  async function listenbrainzTokenProvider() {
    return production.requiredEnv(env, 'LISTENBRAINZ_USER_TOKEN');
  }

  const providers = providerFactory({ fetchImpl, spotifyTokenProvider, listenbrainzTokenProvider });
  let lastPreflightSnapshot = null;
  const guardedPreflight = async (snapshot) => {
    production.assertProviderConfiguration(snapshot?.nextStep, env);
    await assertBandsCurrent();
    const approved = await context.preflight(snapshot);
    if (approved === true) lastPreflightSnapshot = clone(snapshot);
    return approved;
  };
  const guardedUsage = {
    reserve: async (provider) => {
      if (!lastPreflightSnapshot) throw new Error('Listening backfill usage reservation requires a successful preflight snapshot.');
      const allowed = await context.usage.reserve(provider);
      if (allowed !== true) return false;
      await assertBandsCurrent();
      const stillApproved = await context.preflight(lastPreflightSnapshot);
      if (stillApproved !== true) throw new Error('Listening maintenance post-reservation preflight was not approved.');
      return true;
    },
  };
  const guardedPersist = async (snapshot) => {
    // Long provider calls increase the chance that band ownership or a
    // confirmed provider identity changes after the pre-request checks.
    // Revalidate immediately before any derived/checkpoint persistence.
    await assertBandsCurrent();
    return context.persist(snapshot);
  };

  let trackIdentities = recoveredTrackIdentities;
  let spotifyMetadata = context.spotifyMetadata;
  let checkpoint = context.checkpoint;
  let attempted = 0;
  let persisted = 0;
  let chunk = 0;
  let finalResult = null;

  while (attempted < options.maxTotalSteps) {
    const remaining = options.maxTotalSteps - attempted;
    const chunkLimit = Math.min(CHUNK_STEPS, remaining);
    chunk += 1;
    const result = await maintenanceRunner({
      inventory,
      trackIdentities,
      spotifyMetadata,
      checkpoint,
      providers,
      usage: guardedUsage,
      preflight: guardedPreflight,
      persist: guardedPersist,
      maxSteps: chunkLimit,
      haltOnNeedsReview: false,
      now: now(),
    });
    finalResult = result;
    attempted += Number(result?.summary?.attempted) || 0;
    persisted += Number(result?.summary?.persisted) || 0;
    trackIdentities = result.trackIdentities;
    spotifyMetadata = result.spotifyMetadata;
    checkpoint = result.checkpoint;

    log(JSON.stringify(safeProgressSummary({ chunk, attempted, persisted, result })));

    const haltReason = result?.summary?.haltReason || null;
    if (!result?.plan?.planned) break;
    if (haltReason && haltReason !== 'batch_limit') break;
    if ((Number(result?.summary?.attempted) || 0) === 0) break;
  }

  const finalPlan = finalResult?.plan && typeof finalResult.plan === 'object' ? { ...finalResult.plan } : {};
  const safetyHalt = Boolean(finalResult?.summary?.halted && finalResult?.summary?.haltReason !== 'batch_limit');
  const hitBulkLimit = !safetyHalt && attempted >= options.maxTotalSteps && Number(finalPlan.planned) > 0;
  const safe = {
    mode: 'bulk-production-enrichment',
    maxTotalSteps: options.maxTotalSteps,
    chunkSteps: CHUNK_STEPS,
    source: production.safeSourceSummary(source.counts),
    inventory: inventoryLib.safeInventorySummary(inventory),
    run: {
      attempted,
      persisted,
      halted: safetyHalt || hitBulkLimit,
      haltReason: safetyHalt
        ? finalResult.summary.haltReason
        : (hitBulkLimit ? 'bulk_limit' : (finalResult?.summary?.haltReason === 'batch_limit' ? null : finalResult?.summary?.haltReason || null)),
      plan: finalPlan,
    },
  };
  log(JSON.stringify(safe));
  return safe;
}

if (require.main === module) {
  runBulkBackfill().catch((error) => {
    console.error(`Listening bulk backfill stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BULK_CONFIRM_ENV,
  BULK_CONFIRMATION,
  CHUNK_STEPS,
  MAX_TOTAL_STEPS,
  SPOTIFY_TOKEN_REUSE_MS,
  LEGACY_MUSICBRAINZ_TRANSIENT_REASONS,
  parseArgs,
  usageText,
  assertBulkAuthorization,
  safeProgressSummary,
  legacyMusicbrainzTransientRetryAt,
  recoverableLegacyMusicbrainzItem,
  reviveLegacyMusicbrainzTransientErrors,
  runBulkBackfill,
};
