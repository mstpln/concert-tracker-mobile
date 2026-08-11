'use strict';

const albumCore = require('./spotify-album-artwork-core');
const legacyCore = require('./spotify-artwork-backfill-core');
const legacyRunner = require('./spotify-artwork-backfill');
const sourceReader = require('./spotify-artwork-backfill-source');
const productionSafety = require('./spotify-artwork-backfill-production');
const { UsageTracker } = require('./lib/usageTracker');

const DEFAULT_CAP = 25;
const MAX_CAP = 100;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MARKET = 'SE';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv = []) {
  const options = { execute: false, write: false, cap: DEFAULT_CAP, delayMs: DEFAULT_DELAY_MS, market: DEFAULT_MARKET, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--cap') { options.cap = Number(next); index += 1; }
    else if (arg === '--delay-ms') { options.delayMs = Number(next); index += 1; }
    else if (arg === '--market') { options.market = String(next || '').toUpperCase(); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.cap = Math.max(1, Math.min(MAX_CAP, Math.floor(Number(options.cap) || DEFAULT_CAP)));
  options.delayMs = Math.max(DEFAULT_DELAY_MS, Math.floor(Number(options.delayMs) || DEFAULT_DELAY_MS));
  if (!/^[A-Z]{2}$/.test(options.market)) throw new Error('Spotify market must be a two-letter country code.');
  return options;
}

function usageText() {
  return [
    'Album-oriented Spotify listening artwork maintenance',
    '',
    'Historical artwork is grouped conservatively by trusted local band identity + normalized release title.',
    'Only one exact trusted Spotify track ID is used as the provider seed for each unresolved safe album group.',
    'MusicBrainz and ListenBrainz are never used by this artwork runner.',
    '',
    'Real execution remains separately authorized:',
    '  node scripts/spotify-album-artwork-production.js --execute --write --cap 25',
    `Minimum pacing: ${DEFAULT_DELAY_MS} ms. Hard album-group ceiling: ${MAX_CAP} per invocation.`,
  ].join('\n');
}

function validateBands(value) {
  if (!Array.isArray(value)) throw new Error('Production bands document is invalid.');
  return value;
}

function exactAlbumRecord(requestedTrackId, track, now) {
  const record = legacyCore.recordFromSpotifyTrack(requestedTrackId, track, now);
  if (!record?.spotifyAlbumId || !record?.artworkUrl) return null;
  return record;
}

function applyReusableGroups(metadata, reusable = []) {
  let next = metadata;
  let groupsApplied = 0;
  let tracksMaterialized = 0;
  for (const item of reusable) {
    const before = Object.keys(next?.records || {}).length;
    next = albumCore.materializeGroupRecords({ metadata: next, group: item.group, albumRecord: item.albumRecord });
    const after = Object.keys(next?.records || {}).length;
    groupsApplied += 1;
    tracksMaterialized += Math.max(0, after - before);
  }
  return { metadata: next, groupsApplied, tracksMaterialized };
}

async function runAlbumArtwork({
  endpoint,
  workerToken,
  clientId,
  clientSecret,
  cap = DEFAULT_CAP,
  delayMs = DEFAULT_DELAY_MS,
  market = DEFAULT_MARKET,
  fetchImpl = fetch,
  usageFactory = () => UsageTracker.load(),
  now = () => new Date().toISOString(),
  sleepImpl = sleep,
} = {}) {
  const source = await sourceReader.readAllSourceEvents({ endpoint, token: workerToken, fetchImpl });
  const [bandsState, metadataState] = await Promise.all([
    legacyRunner.workerGetJson({ endpoint, token: workerToken, pathname: 'bands.json', fetchImpl }),
    legacyRunner.readRemoteMetadata({ endpoint, token: workerToken, fetchImpl }),
  ]);
  const bands = validateBands(bandsState.value);
  let metadata = legacyRunner.validateMetadata(metadataState.metadata);
  let etag = metadataState.etag;
  let missing = metadataState.missing;
  const initialPlan = albumCore.planAlbumArtwork({ events: source.events, bands, metadata });

  const reused = applyReusableGroups(metadata, initialPlan.reusable);
  metadata = reused.metadata;
  let providerGroupsAttempted = 0;
  let providerGroupsResolved = 0;
  let providerGroupsNoArtwork = 0;
  let tracksMaterialized = reused.tracksMaterialized;
  let token = null;
  const usage = await usageFactory();

  async function persist() {
    metadata.updatedAt = now();
    const result = await legacyRunner.workerPutJson({
      endpoint,
      token: workerToken,
      pathname: 'listening/spotify-metadata.json',
      value: metadata,
      etag,
      missing,
      fetchImpl,
    });
    etag = result.etag;
    missing = false;
  }

  if (reused.groupsApplied > 0) await persist();

  const providerGroups = initialPlan.provider.slice(0, Math.max(1, Math.min(MAX_CAP, Number(cap) || DEFAULT_CAP)));
  if (providerGroups.length) {
    token = await productionSafety.trackedSpotifyCall(usage, () => legacyRunner.getSpotifyToken({ clientId, clientSecret, fetchImpl }));
  }

  for (let index = 0; index < providerGroups.length; index += 1) {
    if (index > 0) await sleepImpl(delayMs);
    const group = providerGroups[index];
    const requestedId = group.representativeTrackId;
    const result = await productionSafety.trackedSpotifyCall(usage, () => legacyRunner.fetchSpotifyTrack({ id: requestedId, token, market, fetchImpl }));
    providerGroupsAttempted += 1;

    if (result.kind === 'not_found') continue;
    if (result.kind !== 'ok') {
      throw new Error(`Album-oriented Spotify artwork stopped safely: ${legacyRunner.stopReasonForResult(result)}.`);
    }

    const record = exactAlbumRecord(requestedId, result.track, now());
    if (!record) {
      providerGroupsNoArtwork += 1;
      continue;
    }
    if (group.knownAlbumId && group.knownAlbumId !== record.spotifyAlbumId) {
      throw new Error('Album-oriented Spotify artwork stopped safely because a provider album ID conflicts with already-known album identity.');
    }

    metadata = {
      ...metadata,
      records: {
        ...(metadata.records || {}),
        [requestedId]: { ...(metadata.records?.[requestedId] || {}), ...record },
      },
    };
    const before = Object.keys(metadata.records || {}).length;
    metadata = albumCore.materializeGroupRecords({ metadata, group, albumRecord: record, fetchedAt: now() });
    const after = Object.keys(metadata.records || {}).length;
    tracksMaterialized += Math.max(0, after - before) + 1;
    providerGroupsResolved += 1;
    await persist();
  }

  await usage.save();
  return {
    mode: 'spotify-album-artwork',
    sourceEvents: Number(source?.counts?.totalEvents) || source.events.length,
    safeAlbumGroups: initialPlan.summary.safeAlbumGroups,
    ambiguousAlbumGroups: initialPlan.summary.ambiguousAlbumGroups,
    unsafeEvents: initialPlan.summary.unsafeEvents,
    reusedAlbumGroups: reused.groupsApplied,
    providerAlbumGroupsPlanned: providerGroups.length,
    providerAlbumGroupsAttempted,
    providerAlbumGroupsResolved,
    providerGroupsNoArtwork,
    tracksMaterialized,
    musicbrainzCalls: 0,
    listenbrainzCalls: 0,
  };
}

async function runProductionCli({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  productionSafety.assertProductionAuthorization(options, env);
  if (!options.write) throw new Error('Album-oriented artwork execution requires --write so each resolved album group is durably checkpointed before continuing.');

  const endpoint = productionSafety.normalizeEndpoint(productionSafety.requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const workerToken = productionSafety.requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN');
  const clientId = productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_ID');
  const clientSecret = productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_SECRET');
  productionSafety.configureUsageEnvironment(env, { endpoint, workerToken });

  const summary = await runAlbumArtwork({
    endpoint,
    workerToken,
    clientId,
    clientSecret,
    cap: options.cap,
    delayMs: options.delayMs,
    market: options.market,
    fetchImpl,
  });
  log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  runProductionCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CAP,
  MAX_CAP,
  DEFAULT_DELAY_MS,
  DEFAULT_MARKET,
  parseArgs,
  usageText,
  validateBands,
  exactAlbumRecord,
  applyReusableGroups,
  runAlbumArtwork,
  runProductionCli,
};
