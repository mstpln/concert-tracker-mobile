'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SPOTIFY_ARCHIVE_PATTERN = /^listening\/spotify-history\/([a-f0-9]{64})\.json\.gz$/;
const LISTENBRAINZ_ARCHIVE_PATTERN = /^listening\/listenbrainz\/(\d{4}-(?:0[1-9]|1[0-2]))\/([a-f0-9]{64})\.json\.gz$/;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(endpoint)) throw new Error('Worker endpoint must be an HTTPS URL.');
  return endpoint;
}

async function authenticatedGet({ endpoint, token, pathname, fetchImpl = fetch }) {
  const response = await fetchImpl(`${cleanEndpoint(endpoint)}/${String(pathname || '').replace(/^\//, '')}`, {
    headers: { Authorization: `Bearer ${String(token || '')}` },
  });
  if (response.status === 404) return { missing: true, response: null, etag: null };
  if (!response.ok) throw new Error(`Private listening read failed for the requested object (HTTP ${response.status}).`);
  return { missing: false, response, etag: response.headers.get('ETag') };
}

async function readJson({ endpoint, token, pathname, fetchImpl = fetch }) {
  const result = await authenticatedGet({ endpoint, token, pathname, fetchImpl });
  if (result.missing) return { ...result, value: null };
  let value;
  try { value = await result.response.json(); }
  catch (_) { throw new Error('Private listening JSON is invalid.'); }
  return { ...result, value };
}

function validateArchiveDescriptor(item, expectedSource) {
  if (!item || item.source !== expectedSource) throw new Error(`Listening ${expectedSource} archive descriptor is invalid.`);
  const sha256 = String(item.sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Listening ${expectedSource} archive checksum is invalid.`);
  const pathname = String(item.path || '');
  const match = expectedSource === 'spotify_import'
    ? pathname.match(SPOTIFY_ARCHIVE_PATTERN)
    : expectedSource === 'listenbrainz'
      ? pathname.match(LISTENBRAINZ_ARCHIVE_PATTERN)
      : null;
  if (!match) throw new Error(`Listening ${expectedSource} archive path is invalid.`);
  const pathHash = expectedSource === 'spotify_import' ? match[1] : match[2];
  if (pathHash !== sha256) throw new Error(`Listening ${expectedSource} archive path does not match its checksum.`);
  if (item.contentEncoding !== 'gzip') throw new Error(`Listening ${expectedSource} archive encoding is invalid.`);
  if (!Number.isInteger(item.eventCount) || item.eventCount < 0) throw new Error(`Listening ${expectedSource} archive count is invalid.`);
  return item;
}

async function readGzipPayload({ endpoint, token, descriptor, expectedKind, expectedSource, fetchImpl = fetch }) {
  validateArchiveDescriptor(descriptor, expectedSource);
  const result = await authenticatedGet({ endpoint, token, pathname: descriptor.path, fetchImpl });
  if (result.missing) throw new Error('A private listening object referenced by the manifest is missing.');
  const compressed = Buffer.from(await result.response.arrayBuffer());
  let text;
  try { text = zlib.gunzipSync(compressed).toString('utf8'); }
  catch (_) { throw new Error('A private listening object could not be decompressed.'); }
  if (sha256Hex(text) !== descriptor.sha256) throw new Error('A private listening object failed its SHA-256 integrity check.');
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { throw new Error('A private listening object contains invalid JSON.'); }
  if (!payload || payload.kind !== expectedKind || Number(payload.schemaVersion) !== 1 || !Array.isArray(payload.events)) {
    throw new Error('A private listening object has an unsupported payload.');
  }
  if (expectedSource === 'listenbrainz' && payload.source !== 'listenbrainz') {
    throw new Error('A private ListenBrainz payload has an invalid source.');
  }
  if (payload.events.length !== descriptor.eventCount) {
    throw new Error('A private listening object count does not match its manifest.');
  }
  return payload.events;
}

async function readAllSourceEvents({ endpoint, token, fetchImpl = fetch }) {
  const manifestResult = await readJson({ endpoint, token, pathname: 'listening/manifest.json', fetchImpl });
  const manifest = manifestResult.value;
  if (!manifest || manifest.kind !== 'livevault-listening-vault' || Number(manifest.schemaVersion) !== 1) {
    throw new Error('Private listening manifest is missing or unsupported.');
  }

  const baseEvents = await readGzipPayload({
    endpoint,
    token,
    descriptor: manifest.archive,
    expectedKind: 'livevault-listening-history',
    expectedSource: 'spotify_import',
    fetchImpl,
  });

  const incrementals = Array.isArray(manifest.incrementals) ? manifest.incrementals : [];
  const incrementalEvents = [];
  for (const descriptor of incrementals) {
    const events = await readGzipPayload({
      endpoint,
      token,
      descriptor,
      expectedKind: 'livevault-listening-incremental',
      expectedSource: 'listenbrainz',
      fetchImpl,
    });
    incrementalEvents.push(...events);
  }

  return {
    events: [...baseEvents, ...incrementalEvents],
    manifest,
    counts: {
      spotifyArchiveEvents: baseEvents.length,
      incrementalObjects: incrementals.length,
      incrementalEvents: incrementalEvents.length,
      totalEvents: baseEvents.length + incrementalEvents.length,
    },
  };
}

module.exports = {
  SPOTIFY_ARCHIVE_PATTERN,
  LISTENBRAINZ_ARCHIVE_PATTERN,
  sha256Hex,
  cleanEndpoint,
  authenticatedGet,
  readJson,
  validateArchiveDescriptor,
  readGzipPayload,
  readAllSourceEvents,
};
