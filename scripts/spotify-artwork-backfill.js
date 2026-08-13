'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('./spotify-artwork-backfill-core');

const DEFAULT_MARKET = 'SE';
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_CHECKPOINT = path.join('.livevault-maintenance', 'spotify-artwork-backfill.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv = []) {
  const options = {
    execute: false,
    write: false,
    cap: core.DEFAULT_IDS_PER_INVOCATION,
    delayMs: DEFAULT_DELAY_MS,
    checkpointPath: DEFAULT_CHECKPOINT,
    market: DEFAULT_MARKET,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--cap') { options.cap = Number(next); index += 1; }
    else if (arg === '--delay-ms') { options.delayMs = Number(next); index += 1; }
    else if (arg === '--checkpoint') { options.checkpointPath = String(next || ''); index += 1; }
    else if (arg === '--market') { options.market = String(next || '').toUpperCase(); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.cap = Math.max(1, Math.min(core.MAX_IDS_PER_INVOCATION, Math.floor(Number(options.cap) || core.DEFAULT_IDS_PER_INVOCATION)));
  options.delayMs = Math.max(DEFAULT_DELAY_MS, Math.floor(Number(options.delayMs) || DEFAULT_DELAY_MS));
  if (!/^[A-Z]{2}$/.test(options.market)) throw new Error('Spotify market must be a two-letter country code.');
  if (!options.checkpointPath) throw new Error('Checkpoint path is required.');
  return options;
}

function usageText() {
  return [
    'Spotify listening artwork maintenance backfill',
    '',
    'This module contains the tested backfill engine and is not a production CLI.',
    'For any explicitly authorized real execution use:',
    '  node scripts/spotify-artwork-backfill-production.js --execute --cap 25',
    'A production metadata write additionally requires --write and its separate write authorization.',
    '',
    `Default checkpoint: ${DEFAULT_CHECKPOINT}`,
    `Minimum pacing: ${DEFAULT_DELAY_MS} ms between Spotify track requests.`,
    `Hard request-plan ceiling: ${core.MAX_IDS_PER_INVOCATION} tracks per logical batch.`,
  ].join('\n');
}

async function readCheckpoint(checkpointPath) {
  try {
    return JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Could not read private backfill checkpoint: ${error.message}`);
  }
}

async function writeCheckpoint(checkpointPath, checkpoint) {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const tempPath = `${checkpointPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, checkpointPath);
  try { await fs.chmod(checkpointPath, 0o600); } catch (_) { /* best effort on non-POSIX filesystems */ }
}

async function workerGet({ endpoint, token, pathname, fetchImpl = fetch }) {
  const response = await fetchImpl(`${endpoint}/${pathname.replace(/^\//, '')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return { missing: true, value: null, etag: null };
  if (!response.ok) throw new Error(`Private data read failed for ${pathname} (HTTP ${response.status}).`);
  return { missing: false, response, etag: response.headers.get('ETag') };
}

async function workerGetJson(args) {
  const result = await workerGet(args);
  if (result.missing) return result;
  let value;
  try { value = await result.response.json(); }
  catch (_) { throw new Error(`Private JSON is invalid for ${args.pathname}.`); }
  return { ...result, value };
}

async function workerPutJson({ endpoint, token, pathname, value, etag, missing = false, fetchImpl = fetch }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (missing) headers['If-None-Match'] = '*';
  else if (etag) headers['If-Match'] = etag;
  else throw new Error('Refusing private metadata write without an ETag or create-only condition.');
  const response = await fetchImpl(`${endpoint}/${pathname.replace(/^\//, '')}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(value, null, 2),
  });
  if (response.status === 412) {
    const error = new Error('Private listening metadata changed during the backfill. No overwrite was attempted; rerun to rebase the staged records.');
    error.code = 'ETAG_CONFLICT';
    throw error;
  }
  if (!response.ok) throw new Error(`Private metadata write failed (HTTP ${response.status}).`);
  return { etag: response.headers.get('ETag') };
}

function validateMetadata(value) {
  if (value == null) return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
  if (!value || value.kind !== 'livevault-spotify-listening-metadata' || Number(value.schemaVersion) !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('Private Spotify listening metadata has an unsupported shape.');
  }
  return value;
}

async function readRemoteMetadata({ endpoint, token, fetchImpl = fetch }) {
  const result = await workerGetJson({ endpoint, token, pathname: 'listening/spotify-metadata.json', fetchImpl });
  return {
    metadata: validateMetadata(result.missing ? null : result.value),
    etag: result.etag,
    missing: result.missing,
  };
}

function spotifyBasicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function getSpotifyToken({ clientId, clientSecret, fetchImpl = fetch }) {
  const response = await fetchImpl('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: spotifyBasicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Spotify application authorization failed (HTTP ${response.status}).`);
  let payload;
  try { payload = await response.json(); }
  catch (_) { throw new Error('Spotify application authorization returned an invalid response.'); }
  const accessToken = String(payload?.access_token || '');
  if (!accessToken) throw new Error('Spotify application authorization returned no access token.');
  return accessToken;
}

async function readSpotifyError(response) {
  try {
    const payload = await response.clone().json();
    return payload?.error && typeof payload.error === 'object' ? payload.error : {};
  } catch (_) {
    return {};
  }
}

function spotifyRetryAfter(response) {
  const value = response?.headers?.get?.('Retry-After') ?? response?.headers?.get?.('retry-after') ?? null;
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim();
}

function spotifyRetryAfterSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.ceil(numeric);
}

async function fetchSpotifyTrack({ id, token, market = DEFAULT_MARKET, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}?market=${market}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return { kind: 'not_found', status: 404 };
  if (response.status === 429) {
    const spotifyError = await readSpotifyError(response);
    const retryAfter = spotifyRetryAfter(response);
    return {
      kind: spotifyError.reason === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'rate_limited',
      status: 429,
      retryAfter,
      retryAfterSeconds: spotifyRetryAfterSeconds(retryAfter),
    };
  }
  if (response.status === 401) return { kind: 'auth_error', status: 401 };
  if (response.status === 403) return { kind: 'forbidden', status: 403 };
  if (!response.ok) return { kind: 'provider_error', status: response.status };
  let track;
  try { track = await response.json(); }
  catch (_) { return { kind: 'malformed', status: 200 }; }
  if (!track || !core.validSpotifyId(track.id)) return { kind: 'malformed', status: 200 };
  return { kind: 'ok', track, status: 200 };
}

function stopReasonForResult(result) {
  if (result.kind === 'quota_exceeded') return 'spotify_development_quota_exceeded';
  if (result.kind === 'rate_limited') return result.retryAfterSeconds
    ? `spotify_rate_limited_retry_after_${result.retryAfterSeconds}s`
    : 'spotify_rate_limited';
  if (result.kind === 'auth_error') return 'spotify_application_authorization_failed';
  if (result.kind === 'forbidden') return 'spotify_track_request_forbidden';
  if (result.kind === 'malformed') return 'spotify_malformed_track_response';
  return `spotify_http_${result.status || 'error'}`;
}

function aggregateSummary({ checkpoint, totalTrusted, existingBefore, existingAfter, synced, stopped }) {
  return {
    trustedTrackIds: totalTrusted,
    metadataRecordsBefore: existingBefore,
    metadataRecordsAfter: existingAfter,
    planned: checkpoint?.plannedIds?.length || 0,
    remaining: checkpoint?.remainingIds?.length || 0,
    terminalNotFound: checkpoint?.terminalNotFoundIds?.length || 0,
    staged: Object.keys(checkpoint?.stagedRecords || {}).length,
    providerRequestsThisInvocation: checkpoint?._invocationRequests || 0,
    synced: Boolean(synced),
    stopped: stopped || null,
  };
}

async function synchronizeStages({ checkpoint, remote, writeEnabled, writeRemote, saveCheckpoint }) {
  if (!checkpoint || !Object.keys(checkpoint.stagedRecords || {}).length) return { checkpoint, remote, synced: false };
  if (!writeEnabled) return { checkpoint, remote, synced: false };
  const merged = core.mergeStagedRecords(remote.metadata, checkpoint);
  merged.updatedAt = new Date().toISOString();
  await writeRemote({ value: merged, etag: remote.etag, missing: remote.missing });
  const refreshed = { metadata: merged, etag: null, missing: false };
  const cleared = core.clearSynchronizedStages(checkpoint, merged);
  await saveCheckpoint(cleared);
  return { checkpoint: cleared, remote: refreshed, synced: true };
}

async function runBackfill({
  cap = core.DEFAULT_IDS_PER_INVOCATION,
  delayMs = DEFAULT_DELAY_MS,
  market = DEFAULT_MARKET,
  writeEnabled = false,
  loadEvents,
  readMetadata,
  writeMetadata,
  loadCheckpoint,
  saveCheckpoint,
  getToken,
  fetchTrack,
  sleepImpl = sleep,
  now = () => new Date().toISOString(),
} = {}) {
  if (![loadEvents, readMetadata, loadCheckpoint, saveCheckpoint, getToken, fetchTrack].every((fn) => typeof fn === 'function')) {
    throw new Error('Backfill runner dependencies are incomplete.');
  }
  if (writeEnabled && typeof writeMetadata !== 'function') throw new Error('Backfill write dependency is unavailable.');

  const events = await loadEvents();
  let remote = await readMetadata();
  remote.metadata = validateMetadata(remote.metadata);
  let checkpoint = core.normalizeCheckpoint(await loadCheckpoint());

  if (checkpoint?.stagedRecords && Object.keys(checkpoint.stagedRecords).length) {
    const syncResult = await synchronizeStages({
      checkpoint,
      remote,
      writeEnabled,
      writeRemote: writeMetadata,
      saveCheckpoint,
    });
    checkpoint = syncResult.checkpoint;
    remote = syncResult.remote;
    if (writeEnabled && syncResult.synced) {
      remote = await readMetadata();
      remote.metadata = validateMetadata(remote.metadata);
    }
  }

  const trustedIds = core.trustedTrackIds(events);
  const existingBefore = Object.keys(remote.metadata.records || {}).length;
  checkpoint = core.createOrResumePlan({ events, metadata: remote.metadata, checkpoint, cap });
  if (!checkpoint) {
    return aggregateSummary({ checkpoint: null, totalTrusted: trustedIds.length, existingBefore, existingAfter: existingBefore, synced: false, stopped: null });
  }
  await saveCheckpoint(checkpoint);

  let invocationRequests = 0;
  let stopped = null;
  let token = null;
  if (checkpoint.remainingIds.length) token = await getToken();

  for (const id of [...checkpoint.remainingIds]) {
    if (invocationRequests >= cap) break;
    if (invocationRequests > 0) await sleepImpl(delayMs);
    const result = await fetchTrack({ id, token, market });
    invocationRequests += 1;
    if (result.kind === 'ok') checkpoint = core.completeSuccess(checkpoint, id, result.track, now());
    else if (result.kind === 'not_found') checkpoint = core.completeNotFound(checkpoint, id);
    else {
      stopped = stopReasonForResult(result);
      checkpoint = core.stopWithoutConsuming(checkpoint, stopped);
      await saveCheckpoint(checkpoint);
      break;
    }
    await saveCheckpoint(checkpoint);
  }

  let synced = false;
  if (Object.keys(checkpoint.stagedRecords || {}).length && writeEnabled) {
    const latest = await readMetadata();
    latest.metadata = validateMetadata(latest.metadata);
    const merged = core.mergeStagedRecords(latest.metadata, checkpoint);
    merged.updatedAt = now();
    await writeMetadata({ value: merged, etag: latest.etag, missing: latest.missing });
    checkpoint = core.clearSynchronizedStages(checkpoint, merged);
    await saveCheckpoint(checkpoint);
    remote = { ...latest, metadata: merged };
    synced = true;
  } else {
    remote.metadata = core.mergeStagedRecords(remote.metadata, checkpoint);
  }

  checkpoint._invocationRequests = invocationRequests;
  const summary = aggregateSummary({
    checkpoint,
    totalTrusted: trustedIds.length,
    existingBefore,
    existingAfter: Object.keys(remote.metadata.records || {}).length,
    synced,
    stopped,
  });
  delete checkpoint._invocationRequests;
  return summary;
}

async function runCli({ argv = process.argv.slice(2), log = console.log } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  throw new Error('This engine is not a production entrypoint. Use scripts/spotify-artwork-backfill-production.js after the required production authorization.');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Spotify artwork backfill stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MARKET,
  DEFAULT_DELAY_MS,
  DEFAULT_CHECKPOINT,
  parseArgs,
  usageText,
  readCheckpoint,
  writeCheckpoint,
  workerGet,
  workerGetJson,
  validateMetadata,
  readRemoteMetadata,
  workerPutJson,
  getSpotifyToken,
  fetchSpotifyTrack,
  stopReasonForResult,
  aggregateSummary,
  synchronizeStages,
  runBackfill,
  runCli,
};