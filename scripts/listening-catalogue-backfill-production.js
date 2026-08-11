'use strict';

const sourceReader = require('./spotify-artwork-backfill-source');
const c4 = require('./listening-catalogue-backfill-c4');
const cataloguePersistence = require('./lib/listeningCataloguePersistence');
const { createListeningMaintenanceClient } = require('./lib/listeningMaintenanceClient');
const { loadListeningMaintenanceContext } = require('./lib/listeningMaintenancePersistence');
const {
  createMusicBrainzCatalogueAdapter,
  createListenBrainzBatchAdapter,
} = require('./lib/listeningCatalogueProviders');

const PRIVATE_READ_CONFIRM_ENV = 'LIVEVAULT_LISTENING_MAINTENANCE_CONFIRM';
const PRIVATE_READ_CONFIRMATION = 'I_AUTHORIZE_PRIVATE_LISTENING_READS_FOR_AGGREGATE_INVENTORY';
const PROVIDER_CONFIRM_ENV = 'LIVEVAULT_LISTENING_C4_PROVIDER_CONFIRM';
const PROVIDER_CONFIRMATION = 'I_AUTHORIZE_C4_PROVIDER_EXECUTION';
const WRITE_CONFIRM_ENV = 'LIVEVAULT_LISTENING_C4_WRITE_CONFIRM';
const WRITE_CONFIRMATION = 'I_AUTHORIZE_C4_DERIVED_WRITES';
const PROOF_CONFIRM_ENV = 'LIVEVAULT_LISTENING_C4_PROOF_CONFIRM';
const PROOF_CONFIRMATION = 'I_AUTHORIZE_C4_SMALL_LIVE_PROOF';
const FULL_CONFIRM_ENV = 'LIVEVAULT_LISTENING_C4_FULL_CONFIRM';
const FULL_CONFIRMATION = 'I_AUTHORIZE_C4_FULL_RESUMABLE_BACKFILL';
const PROOF_MUSICBRAINZ_PAGE_CALLS = 2;

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

function safeReason(value, fallback = 'unknown') {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(value) ? value : fallback;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function usageHaltReason(provider, reason) {
  return `usage_blocked:${provider}:${safeReason(reason, 'usage_denied')}`;
}

function parseArgs(argv = []) {
  const options = { mode: null, execute: false, write: false, help: false };
  for (const arg of argv) {
    if (arg === '--plan-only') options.mode = options.mode ? 'invalid' : 'plan';
    else if (arg === '--proof') options.mode = options.mode ? 'invalid' : 'proof';
    else if (arg === '--full') options.mode = options.mode ? 'invalid' : 'full';
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown C4 production option: ${arg}`);
  }
  if (!options.help && !['plan', 'proof', 'full'].includes(options.mode)) {
    throw new Error('Choose exactly one C4 mode: --plan-only, --proof, or --full.');
  }
  return options;
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/listening-catalogue-backfill-production.js --plan-only --execute',
    '  node scripts/listening-catalogue-backfill-production.js --proof --execute --write',
    '  node scripts/listening-catalogue-backfill-production.js --full --execute --write',
    '',
    'C4 is catalogue-first. Spotify is never called for core recording identity.',
    `Full mode has a ${c4.MAX_PROVIDER_OPERATIONS}-provider-operation emergency ceiling, not a manual batch size.`,
  ].join('\n');
}

function assertPrivateReadAuthorization(env) {
  if (String(env?.[PRIVATE_READ_CONFIRM_ENV] || '') !== PRIVATE_READ_CONFIRMATION) {
    throw new Error(`Refusing C4 private reads: ${PRIVATE_READ_CONFIRM_ENV} does not contain the required authorization value.`);
  }
}

function assertPlanAuthorization(options, env) {
  if (!options.execute) throw new Error('Refusing C4 private reads: --execute is required after read-only authorization.');
  if (options.write) throw new Error('C4 --plan-only refuses --write.');
  assertPrivateReadAuthorization(env);
}

function assertLiveAuthorization(options, env) {
  if (!options.execute || !options.write) throw new Error('C4 live modes require both --execute and --write after separate authorization.');
  assertPrivateReadAuthorization(env);
  if (String(env?.[PROVIDER_CONFIRM_ENV] || '') !== PROVIDER_CONFIRMATION) {
    throw new Error(`Refusing C4 providers: ${PROVIDER_CONFIRM_ENV} does not contain the required authorization value.`);
  }
  if (String(env?.[WRITE_CONFIRM_ENV] || '') !== WRITE_CONFIRMATION) {
    throw new Error(`Refusing C4 writes: ${WRITE_CONFIRM_ENV} does not contain the required authorization value.`);
  }
  if (options.mode === 'proof' && String(env?.[PROOF_CONFIRM_ENV] || '') !== PROOF_CONFIRMATION) {
    throw new Error(`Refusing C4 proof: ${PROOF_CONFIRM_ENV} does not contain the required authorization value.`);
  }
  if (options.mode === 'full' && String(env?.[FULL_CONFIRM_ENV] || '') !== FULL_CONFIRMATION) {
    throw new Error(`Refusing C4 full backfill: ${FULL_CONFIRM_ENV} does not contain the required authorization value.`);
  }
}

function safeSourceSummary(counts = {}) {
  const allowed = ['spotifyArchiveEvents', 'incrementalObjects', 'incrementalEvents', 'totalEvents'];
  return Object.fromEntries(allowed.map((key) => [key, Number(counts[key]) || 0]));
}

async function loadBaseContext({ client, endpoint, token, fetchImpl, readAllSourceEvents = sourceReader.readAllSourceEvents } = {}) {
  const [bands, spotifyMetadata, trackIdentities, source] = await Promise.all([
    client.readJson('bands.json', []),
    client.readJson('listening/spotify-metadata.json', null),
    client.readJson('listening/track-identities.json', null),
    readAllSourceEvents({ endpoint, token, fetchImpl }),
  ]);
  if (!Array.isArray(bands)) throw new Error('Production bands document is invalid.');
  if (!source || !Array.isArray(source.events) || !source.manifest) throw new Error('Private listening source reader returned invalid data.');
  return { bands, spotifyMetadata, trackIdentities, source };
}

async function runPlanOnly({ client, endpoint, token, fetchImpl, readAllSourceEvents } = {}) {
  const base = await loadBaseContext({ client, endpoint, token, fetchImpl, readAllSourceEvents });
  const plan = c4.buildC4Plan({
    bands: base.bands,
    events: base.source.events,
    spotifyMetadata: base.spotifyMetadata,
    trackIdentities: base.trackIdentities,
  });
  return {
    mode: 'c4-plan-only',
    source: safeSourceSummary(base.source.counts),
    plan: c4.safePlanSummary(plan),
    providerCalls: 0,
    productionWrites: 0,
  };
}

function makeSafetyGuards({ client, endpoint, token, fetchImpl, base, context, getTrackIdentities, readManifest = sourceReader.readJson } = {}) {
  const loadedBands = clone(base.bands);
  const loadedManifest = clone(base.source.manifest);
  return {
    async assertBandsCurrent() {
      const current = await client.readJson('bands.json', []);
      if (!Array.isArray(current) || !same(current, loadedBands)) throw new Error('C4 bands changed after inventory load; reload before continuing.');
      return true;
    },
    async assertSourceCurrent() {
      const current = await readManifest({ endpoint, token, pathname: 'listening/manifest.json', fetchImpl });
      if (!current?.value || !same(current.value, loadedManifest)) throw new Error('C4 immutable listening manifest changed after source load; reload before continuing.');
      return true;
    },
    async preflight() {
      await this.assertBandsCurrent();
      await this.assertSourceCurrent();
      const approved = await context.preflight({
        trackIdentities: clone(getTrackIdentities()),
        spotifyMetadata: clone(base.spotifyMetadata),
        checkpoint: clone(context.checkpoint),
      });
      if (approved !== true) throw new Error('C4 maintenance preflight was not approved.');
      return true;
    },
  };
}

function deferredReason(deferred) {
  const values = [...deferred].sort();
  return values.length ? `provider_deferred:${values.join(',')}` : null;
}

async function runProof({ client, context, base, guards, musicbrainzProvider, now = () => Date.now() } = {}) {
  const plan = c4.buildC4Plan({
    bands: base.bands,
    events: base.source.events,
    spotifyMetadata: base.spotifyMetadata,
    trackIdentities: base.trackIdentities,
  });
  let loaded = await cataloguePersistence.loadCatalogue(client);
  const artistMbid = c4.nextCatalogueArtist({ plan, catalogueCache: loaded.cache, nowMs: now() });
  if (!artistMbid) throw new Error('C4 proof requires one eligible artist whose catalogue is missing, partial, or stale.');
  let providerCalls = 0;
  const provider = {
    releaseBrowse: async (input) => {
      providerCalls += 1;
      if (providerCalls > PROOF_MUSICBRAINZ_PAGE_CALLS) throw new Error('C4 proof exceeded its MusicBrainz page-call ceiling.');
      return musicbrainzProvider.releaseBrowse(input);
    },
  };
  const usage = {
    reserve: async () => {
      await guards.preflight();
      const allowed = await context.usage.reserve('musicbrainz');
      if (allowed !== true) return false;
      await guards.preflight();
      return true;
    },
    blockReason: () => context.usage.blockReason?.('musicbrainz') || 'usage_denied',
  };

  const first = await cataloguePersistence.refreshArtistCatalogue({ client, artistMbid, provider, usage, now, maxPages: 1 });
  if (first.kind === 'paused' && first.reason !== 'page_cap') throw new Error(usageHaltReason('musicbrainz', first.reason));
  if (first.kind === 'error') throw new Error(`C4 proof MusicBrainz failed: ${safeReason(first.reason, 'provider_error')}`);
  if (first.kind === 'retry') {
    return {
      mode: 'c4-small-live-proof',
      artistCount: 1,
      musicbrainzPageCalls: providerCalls,
      persistedCatalogueRereads: 0,
      haltReason: 'provider_deferred:musicbrainz',
      providerDeferral: {
        provider: 'musicbrainz',
        reason: safeReason(first.reason, 'provider_retry'),
        ...(validDate(first.nextEligibleCheckAt) ? { nextEligibleCheckAt: first.nextEligibleCheckAt } : {}),
      },
      trackIdentityWrites: 0,
      listenbrainzCalls: 0,
      spotifyCalls: 0,
    };
  }

  loaded = await cataloguePersistence.loadCatalogue(client);
  const second = providerCalls < PROOF_MUSICBRAINZ_PAGE_CALLS
    ? await cataloguePersistence.refreshArtistCatalogue({ client, artistMbid, provider, usage, now, maxPages: 1 })
    : first;
  if (second.kind === 'paused' && second.reason !== 'page_cap') throw new Error(usageHaltReason('musicbrainz', second.reason));
  if (second.kind === 'error') throw new Error(`C4 proof MusicBrainz failed: ${safeReason(second.reason, 'provider_error')}`);
  if (second.kind === 'retry') {
    return {
      mode: 'c4-small-live-proof',
      artistCount: 1,
      musicbrainzPageCalls: providerCalls,
      persistedCatalogueRereads: 1,
      haltReason: 'provider_deferred:musicbrainz',
      providerDeferral: {
        provider: 'musicbrainz',
        reason: safeReason(second.reason, 'provider_retry'),
        ...(validDate(second.nextEligibleCheckAt) ? { nextEligibleCheckAt: second.nextEligibleCheckAt } : {}),
      },
      trackIdentityWrites: 0,
      listenbrainzCalls: 0,
      spotifyCalls: 0,
    };
  }

  loaded = await cataloguePersistence.loadCatalogue(client);
  const local = c4.currentLocalResults(plan, loaded.cache);
  return {
    mode: 'c4-small-live-proof',
    artistCount: 1,
    musicbrainzPageCalls: providerCalls,
    persistedCatalogueRereads: 2,
    haltReason: null,
    local: {
      resolved: Number(local.counts.resolved) || 0,
      unresolved: Number(local.counts.unresolved) || 0,
      ambiguous: Number(local.counts.ambiguous) || 0,
      exceptions: Number(local.counts.exceptions) || 0,
    },
    trackIdentityWrites: 0,
    listenbrainzCalls: 0,
    spotifyCalls: 0,
  };
}

async function runFull({
  client,
  context,
  base,
  guards,
  musicbrainzProvider,
  listenbrainzProvider,
  assertProviderConfiguration = async () => true,
  now = () => Date.now(),
} = {}) {
  let trackIdentities = c4.identityDocument(base.trackIdentities);
  let catalogue = (await cataloguePersistence.loadCatalogue(client)).cache;
  let providerOperations = 0;
  let localResolved = 0;
  const listenbrainzCounts = { resolved: 0, noMatch: 0, needsReview: 0, error: 0 };
  const providerCalls = { musicbrainz: 0, listenbrainz: 0 };
  const providerDeferrals = {};
  const deferred = new Set();
  let haltReason = null;

  const guardedUsage = (provider) => ({
    reserve: async () => {
      await guards.preflight();
      const allowed = await context.usage.reserve(provider);
      if (allowed !== true) return false;
      await guards.preflight();
      return true;
    },
    blockReason: () => context.usage.blockReason?.(provider) || 'usage_denied',
  });

  async function persistIdentities(next) {
    await guards.assertBandsCurrent();
    await guards.assertSourceCurrent();
    const persisted = await context.persistTrackIdentitiesOnly(next);
    if (persisted !== true) throw new Error('C4 track-identity persistence was not confirmed.');
    trackIdentities = next;
  }

  while (providerOperations < c4.MAX_PROVIDER_OPERATIONS) {
    const plan = c4.buildC4Plan({
      bands: base.bands,
      events: base.source.events,
      spotifyMetadata: base.spotifyMetadata,
      trackIdentities,
    });
    const local = c4.currentLocalResults(plan, catalogue);
    const applied = c4.applyLocalResolutions({
      plan,
      localResults: local,
      trackIdentities,
      now: new Date(now()).toISOString(),
    });
    if (applied.resolved > 0) {
      await persistIdentities(applied.trackIdentities);
      localResolved += applied.resolved;
      continue;
    }

    const artistMbid = c4.nextCatalogueArtist({
      plan,
      catalogueCache: catalogue,
      nowMs: now(),
      deferredProviders: [...deferred],
    });
    if (artistMbid) {
      const remaining = c4.MAX_PROVIDER_OPERATIONS - providerOperations;
      const provider = {
        releaseBrowse: async (input) => {
          providerOperations += 1;
          providerCalls.musicbrainz += 1;
          return musicbrainzProvider.releaseBrowse(input);
        },
      };
      const result = await cataloguePersistence.refreshArtistCatalogue({
        client,
        artistMbid,
        provider,
        usage: guardedUsage('musicbrainz'),
        now,
        maxPages: Math.min(1000, remaining),
      });
      catalogue = result.cache || (await cataloguePersistence.loadCatalogue(client)).cache;
      if (result.kind === 'retry') {
        deferred.add('musicbrainz');
        providerDeferrals.musicbrainz = {
          reason: safeReason(result.reason, 'provider_retry'),
          ...(validDate(result.nextEligibleCheckAt) ? { nextEligibleCheckAt: result.nextEligibleCheckAt } : {}),
        };
      } else if (result.kind === 'paused' && result.reason !== 'page_cap') {
        haltReason = usageHaltReason('musicbrainz', result.reason);
        break;
      } else if (result.kind === 'error') {
        haltReason = `musicbrainz:${safeReason(result.reason, 'provider_error')}`;
        break;
      }
      continue;
    }

    const currentLocal = c4.currentLocalResults(plan, catalogue);
    const batch = c4.buildListenBrainzBatch({
      plan,
      catalogueCache: catalogue,
      localResults: currentLocal,
      maxItems: c4.MAX_LISTENBRAINZ_BATCH,
    });
    if (batch.count > 0 && !deferred.has('listenbrainz')) {
      await assertProviderConfiguration('listenbrainz');
      const usage = guardedUsage('listenbrainz');
      if (!(await usage.reserve())) {
        haltReason = usageHaltReason('listenbrainz', usage.blockReason());
        break;
      }
      providerOperations += 1;
      providerCalls.listenbrainz += 1;
      const result = await listenbrainzProvider.lookupBatch({ items: batch.items });
      if (result.kind === 'retry') {
        deferred.add('listenbrainz');
        providerDeferrals.listenbrainz = {
          reason: safeReason(result.reason, 'provider_retry'),
          ...(validDate(result.nextEligibleCheckAt) ? { nextEligibleCheckAt: result.nextEligibleCheckAt } : {}),
        };
        continue;
      }
      if (result.kind !== 'ok') {
        haltReason = `listenbrainz:${safeReason(result.reason, 'provider_error')}`;
        break;
      }
      const appliedBatch = c4.applyListenBrainzBatch({
        plan,
        batchPlan: batch,
        data: result.data,
        trackIdentities,
        now: new Date(now()).toISOString(),
      });
      await persistIdentities(appliedBatch.trackIdentities);
      for (const key of Object.keys(listenbrainzCounts)) {
        listenbrainzCounts[key] += Number(appliedBatch.counts[key]) || 0;
      }
      continue;
    }

    const pendingMusicbrainz = c4.nextCatalogueArtist({
      plan,
      catalogueCache: catalogue,
      nowMs: now(),
      deferredProviders: [],
    });
    if ((pendingMusicbrainz && deferred.has('musicbrainz')) || (batch.count > 0 && deferred.has('listenbrainz'))) {
      haltReason = deferredReason(deferred);
    }
    break;
  }

  if (!haltReason && providerOperations >= c4.MAX_PROVIDER_OPERATIONS) haltReason = 'provider_operation_ceiling';
  return {
    mode: 'c4-full-resumable-backfill',
    providerOperations,
    providerDeferrals,
    ...c4.aggregateRunDiagnostics({
      providerCalls,
      localResolved,
      listenbrainz: listenbrainzCounts,
      deferredProviders: [...deferred],
      haltReason,
    }),
  };
}

async function runProductionC4({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  clientFactory = createListeningMaintenanceClient,
  contextLoader = loadListeningMaintenanceContext,
  readAllSourceEvents = sourceReader.readAllSourceEvents,
  readManifest = sourceReader.readJson,
  musicbrainzProviderFactory = createMusicBrainzCatalogueAdapter,
  listenbrainzProviderFactory = createListenBrainzBatchAdapter,
  now = () => Date.now(),
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  if (options.mode === 'plan') assertPlanAuthorization(options, env);
  else assertLiveAuthorization(options, env);

  const endpoint = normalizeEndpoint(requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const token = requiredEnv(env, 'DATA_MAINTENANCE_TOKEN');
  const client = clientFactory({ env, fetchImpl });

  if (options.mode === 'plan') {
    const safe = await runPlanOnly({ client, endpoint, token, fetchImpl, readAllSourceEvents });
    log(JSON.stringify(safe));
    return safe;
  }

  const base = await loadBaseContext({ client, endpoint, token, fetchImpl, readAllSourceEvents });
  const context = await contextLoader(client, { bulk: true });
  const baseIdentities = c4.identityDocument(base.trackIdentities);
  const contextIdentities = c4.identityDocument(context.trackIdentities);
  if (!same(contextIdentities, baseIdentities)) throw new Error('C4 identity state changed during initial load.');
  base.trackIdentities = baseIdentities;
  let currentTrackIdentities = contextIdentities;
  const guards = makeSafetyGuards({
    client,
    endpoint,
    token,
    fetchImpl,
    base,
    context,
    getTrackIdentities: () => currentTrackIdentities,
    readManifest,
  });
  const musicbrainzProvider = musicbrainzProviderFactory({ fetchImpl, now });

  let safe;
  if (options.mode === 'proof') {
    safe = await runProof({ client, context, base, guards, musicbrainzProvider, now });
  } else {
    const listenbrainzProvider = listenbrainzProviderFactory({
      fetchImpl,
      now,
      tokenProvider: async () => requiredEnv(env, 'LISTENBRAINZ_USER_TOKEN'),
    });
    const originalPersist = context.persistTrackIdentitiesOnly;
    context.persistTrackIdentitiesOnly = async (next) => {
      const result = await originalPersist(next);
      if (result === true) currentTrackIdentities = clone(next);
      return result;
    };
    safe = await runFull({
      client,
      context,
      base,
      guards,
      musicbrainzProvider,
      listenbrainzProvider,
      assertProviderConfiguration: async (provider) => {
        if (provider === 'listenbrainz') requiredEnv(env, 'LISTENBRAINZ_USER_TOKEN');
        return true;
      },
      now,
    });
  }
  log(JSON.stringify(safe));
  return safe;
}

if (require.main === module) {
  runProductionC4().catch((error) => {
    console.error(`C4 listening catalogue backfill stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PRIVATE_READ_CONFIRM_ENV,
  PRIVATE_READ_CONFIRMATION,
  PROVIDER_CONFIRM_ENV,
  PROVIDER_CONFIRMATION,
  WRITE_CONFIRM_ENV,
  WRITE_CONFIRMATION,
  PROOF_CONFIRM_ENV,
  PROOF_CONFIRMATION,
  FULL_CONFIRM_ENV,
  FULL_CONFIRMATION,
  PROOF_MUSICBRAINZ_PAGE_CALLS,
  clone,
  same,
  requiredEnv,
  normalizeEndpoint,
  safeReason,
  validDate,
  usageHaltReason,
  parseArgs,
  usageText,
  assertPrivateReadAuthorization,
  assertPlanAuthorization,
  assertLiveAuthorization,
  safeSourceSummary,
  loadBaseContext,
  runPlanOnly,
  makeSafetyGuards,
  deferredReason,
  runProof,
  runFull,
  runProductionC4,
};
