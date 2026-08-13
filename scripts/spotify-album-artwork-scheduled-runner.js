'use strict';

const albumCore = require('./spotify-album-artwork-core');
const albumRunner = require('./spotify-album-artwork-production');
const legacyRunner = require('./spotify-artwork-backfill');
const sourceReader = require('./spotify-artwork-backfill-source');
const productionSafety = require('./spotify-artwork-backfill-production');

function parseScheduledArgs(argv = []) {
  const options = albumRunner.parseArgs(argv);
  if (!options.execute || !options.write) throw new Error('Scheduled album artwork wrapper requires the existing execute and write gates.');
  return options;
}

function manifestFingerprint(source) {
  if (!source?.manifest || typeof source.manifest !== 'object') return null;
  return `sha256:${sourceReader.sha256Hex(JSON.stringify(source.manifest))}`;
}

function suppressionFor(group, checkedAt) {
  return {
    albumGroupKey: group.key,
    representativeTrackId: group.representativeTrackId,
    reason: 'exact_track_terminal_no_artwork',
    checkedAt,
  };
}

async function runScheduledAlbumArtworkCli({
  argv = [],
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  now = () => new Date().toISOString(),
  runProductionCliImpl = albumRunner.runProductionCli,
  loadSourceImpl,
  readBandsImpl,
  readMetadataImpl,
  writeMetadataImpl,
  withLeaseImpl,
} = {}) {
  const options = parseScheduledArgs(argv);
  productionSafety.assertProductionAuthorization(options, env);
  const endpoint = productionSafety.normalizeEndpoint(productionSafety.requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const workerToken = productionSafety.requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN');
  const loadSource = loadSourceImpl || (() => sourceReader.readAllSourceEvents({ endpoint, token: workerToken, fetchImpl }));
  const readBands = readBandsImpl || (() => legacyRunner.workerGetJson({ endpoint, token: workerToken, pathname: 'bands.json', fetchImpl }));
  const readMetadata = readMetadataImpl || (() => legacyRunner.readRemoteMetadata({ endpoint, token: workerToken, fetchImpl }));
  const writeMetadata = writeMetadataImpl || (({ value, etag, missing }) => legacyRunner.workerPutJson({
    endpoint, token: workerToken, pathname: 'listening/spotify-metadata.json', value, etag, missing, fetchImpl,
  }));

  const source = await loadSource();
  if (!source || !Array.isArray(source.events)) throw new Error('Private listening source reader returned invalid data.');
  const [bandsState, beforeState] = await Promise.all([readBands(), readMetadata()]);
  if (!Array.isArray(bandsState?.value)) throw new Error('Production bands document is invalid.');
  const before = legacyRunner.validateMetadata(beforeState.metadata);
  const initialPlan = albumCore.planAlbumArtwork({ events: source.events, bands: bandsState.value, metadata: before });
  const plannedGroups = initialPlan.provider.slice(0, options.cap);

  const result = await runProductionCliImpl({ argv, env, fetchImpl, log, withLeaseImpl });
  const attemptedCount = Math.max(0, Math.min(plannedGroups.length, Number(result?.providerAlbumGroupsAttempted) || 0));
  const attemptedGroups = plannedGroups.slice(0, attemptedCount);
  let latestState = await readMetadata();
  let latest = legacyRunner.validateMetadata(latestState.metadata);
  let latestPlan = albumCore.planAlbumArtwork({ events: source.events, bands: bandsState.value, metadata: latest });
  const stillProvider = new Set(latestPlan.provider.map((group) => group.key));
  const terminalGroups = attemptedGroups.filter((group) => stillProvider.has(group.key));

  if (terminalGroups.length) {
    const currentBands = await readBands();
    if (!Array.isArray(currentBands?.value) || JSON.stringify(currentBands.value) !== JSON.stringify(bandsState.value)) {
      throw new Error('Scheduled album artwork stopped safely because bands changed before terminal checkpoint persistence.');
    }
    const suppressions = { ...(latest.albumArtworkSuppressions || {}) };
    for (const group of terminalGroups) suppressions[group.key] = suppressionFor(group, now());
    latest = { ...latest, albumArtworkSuppressions: suppressions, updatedAt: now() };
    await writeMetadata({ value: latest, etag: latestState.etag, missing: latestState.missing });
    latestState = await readMetadata();
    latest = legacyRunner.validateMetadata(latestState.metadata);
    latestPlan = albumCore.planAlbumArtwork({ events: source.events, bands: bandsState.value, metadata: latest });
  }

  return {
    ...result,
    sourceManifestFingerprint: manifestFingerprint(source),
    suppressedAlbumGroups: latestPlan.summary.suppressedAlbumGroups,
    providerAlbumGroupsRemaining: latestPlan.summary.providerAlbumGroups,
    providerGroupsSuppressed: terminalGroups.length,
  };
}

module.exports = {
  parseScheduledArgs,
  manifestFingerprint,
  suppressionFor,
  runScheduledAlbumArtworkCli,
};
