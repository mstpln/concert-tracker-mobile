'use strict';

const albumCore = require('./spotify-album-artwork-core');
const legacyCore = require('./spotify-artwork-backfill-core');
const legacyRunner = require('./spotify-artwork-backfill');
const sourceReader = require('./spotify-artwork-backfill-source');
const productionSafety = require('./spotify-artwork-backfill-production');
const { UsageTracker } = require('./lib/usageTracker');
const schedulerLease = require('./lib/schedulerLease');

const DEFAULT_CAP = 25;
const MAX_CAP = 100;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MARKET = 'SE';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    'Only that exact representative track receives a new persisted Spotify metadata record.',
    'Sibling listens reuse the album artwork in memory; source listening observations are never rewritten.',
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
  loadSource = () => sourceReader.readAllSourceEvents({ endpoint, token: workerToken, fetchImpl }),
  readBands = () => legacyRunner.workerGetJson({ endpoint, token: workerToken, pathname: 'bands.json', fetchImpl }),
  readMetadata = () => legacyRunner.readRemoteMetadata({ endpoint, token: workerToken, fetchImpl }),
  writeMetadata = ({ value, etag, missing }) => legacyRunner.workerPutJson({
    endpoint,
    token: workerToken,
    pathname: 'listening/spotify-metadata.json',
    value,
    etag,
    missing,
    fetchImpl,
  }),
  getToken = () => legacyRunner.getSpotifyToken({ clientId, clientSecret, fetchImpl }),
  fetchTrack = ({ id, token, market: trackMarket }) => legacyRunner.fetchSpotifyTrack({ id, token, market: trackMarket, fetchImpl }),
  trackProviderCall = productionSafety.trackedSpotifyCall,
} = {}) {
  if (![loadSource, readBands, readMetadata, writeMetadata, getToken, fetchTrack, usageFactory].every((fn) => typeof fn === 'function')) {
    throw new Error('Album artwork runner dependencies are incomplete.');
  }

  const source = await loadSource();
  if (!source || !Array.isArray(source.events)) throw new Error('Private listening source reader returned invalid data.');
  const [bandsState, metadataState] = await Promise.all([readBands(), readMetadata()]);
  const bands = validateBands(bandsState.value);
  let metadata = legacyRunner.validateMetadata(metadataState.metadata);
  let etag = metadataState.etag;
  let missing = metadataState.missing;
  const initialPlan = albumCore.planAlbumArtwork({ events: source.events, bands, metadata });
  const providerGroups = initialPlan.provider.slice(0, Math.max(1, Math.min(MAX_CAP, Number(cap) || DEFAULT_CAP)));

  let providerGroupsAttempted = 0;
  let providerGroupsResolved = 0;
  let providerGroupsNoArtwork = 0;
  let representativeRecordsAdded = 0;
  let token = null;
  const usage = await usageFactory();

  async function assertBandsCurrent() {
    const current = await readBands();
    if (!Array.isArray(current?.value) || !same(current.value, bands)) {
      throw new Error('Album artwork stopped safely because bands changed after planning. Reload before continuing.');
    }
  }

  async function persist() {
    metadata.updatedAt = now();
    await writeMetadata({ value: metadata, etag, missing });
    const refreshed = await readMetadata();
    metadata = legacyRunner.validateMetadata(refreshed.metadata);
    etag = refreshed.etag;
    missing = refreshed.missing;
    if (!etag && !missing) throw new Error('Album artwork could not confirm the metadata ETag after persistence.');
  }

  if (providerGroups.length) {
    await assertBandsCurrent();
    token = await trackProviderCall(usage, getToken);
  }

  for (let index = 0; index < providerGroups.length; index += 1) {
    if (index > 0) await sleepImpl(delayMs);
    await assertBandsCurrent();
    const group = providerGroups[index];
    const requestedId = group.representativeTrackId;
    const result = await trackProviderCall(usage, () => fetchTrack({ id: requestedId, token, market }));
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

    const next = albumCore.mergeRepresentativeRecord(metadata, group, record);
    if (!next) throw new Error('Album-oriented Spotify artwork refused an unsafe representative metadata update.');
    const existed = Boolean(metadata.records?.[requestedId]);
    metadata = next;
    providerGroupsResolved += 1;
    if (!existed) representativeRecordsAdded += 1;
    await assertBandsCurrent();
    await persist();
  }

  await usage.save();
  return {
    mode: 'spotify-album-artwork',
    sourceEvents: Number(source?.counts?.totalEvents) || source.events.length,
    safeAlbumGroups: initialPlan.summary.safeAlbumGroups,
    ambiguousAlbumGroups: initialPlan.summary.ambiguousAlbumGroups,
    unsafeEvents: initialPlan.summary.unsafeEvents,
    reusedAlbumGroups: initialPlan.summary.reusableAlbumGroups,
    providerAlbumGroupsPlanned: providerGroups.length,
    providerAlbumGroupsAttempted: providerGroupsAttempted,
    providerAlbumGroupsResolved: providerGroupsResolved,
    providerGroupsNoArtwork,
    representativeRecordsAdded,
    musicbrainzCalls: 0,
    listenbrainzCalls: 0,
  };
}

async function runProductionCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  runAlbumArtworkImpl = runAlbumArtwork,
  withLeaseImpl = schedulerLease.withSchedulerLease,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  productionSafety.assertProductionAuthorization(options, env);
  if (!options.write) throw new Error('Album-oriented artwork execution requires --write so each resolved representative record is durably checkpointed before continuing.');

  const endpoint = productionSafety.normalizeEndpoint(productionSafety.requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const workerToken = productionSafety.requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN');
  const clientId = productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_ID');
  const clientSecret = productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_SECRET');
  productionSafety.configureUsageEnvironment(env, { endpoint, workerToken });

  return withLeaseImpl({ owner: 'spotify-album-artwork-maintenance' }, async () => {
    const summary = await runAlbumArtworkImpl({
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
  });
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
  runAlbumArtwork,
  runProductionCli,
};
