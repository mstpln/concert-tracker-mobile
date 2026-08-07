'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

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
  if (!response.ok) throw new Error(`Private listening read failed for ${pathname} (HTTP ${response.status}).`);
  return { missing: false, response, etag: response.headers.get('ETag') };
}

async function readJson({ endpoint, token, pathname, fetchImpl = fetch }) {
  const result = await authenticatedGet({ endpoint, token, pathname, fetchImpl });
  if (result.missing) return { ...result, value: null };
  let value;
  try { value = await result.response.json(); }
  catch (_) { throw new Error(`Private JSON is invalid for ${pathname}.`); }
  return { ...result, value };
}

function validateArchiveDescriptor(item, expectedSource) {
  if (!item || item.source !== expectedSource) throw new Error(`Listening ${expectedSource} archive descriptor is invalid.`);
  if (typeof item.path !== 'string' || !item.path.startsWith('listening/')) throw new Error(`Listening ${expectedSource} archive path is invalid.`);
  if (!/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))) throw new Error(`Listening ${expectedSource} archive checksum is invalid.`);
  if (item.contentEncoding !== 'gzip') throw new Error(`Listening ${expectedSource} archive encoding is invalid.`);
  if (!Number.isInteger(item.eventCount) || item.eventCount < 0) throw new Error(`Listening ${expectedSource} archive count is invalid.`);
  return item;
}

async function readGzipPayload({ endpoint, token, descriptor, expectedKind, expectedSource, fetchImpl = fetch }) {
  validateArchiveDescriptor(descriptor, expectedSource);
  const result = await authenticatedGet({ endpoint, token, pathname: descriptor.path, fetchImpl });
  if (result.missing) throw new Error(`Private listening object is missing: ${descriptor.path}`);
  const compressed = Buffer.from(await result.response.arrayBuffer());
  let text;
  try { text = zlib.gunzipSync(compressed).toString('utf8'); }
  catch (_) { throw new Error(`Private listening object could not be decompressed: ${descriptor.path}`); }
  if (sha256Hex(text) !== descriptor.sha256) throw new Error(`Private listening object failed its SHA-256 integrity check: ${descriptor.path}`);
  let payload;
  try { payload = JSON.parse(text); }
  catch (_) { throw new Error(`Private listening object contains invalid JSON: ${descriptor.path}`); }
  if (!payload || payload.kind !== expectedKind || Number(payload.schemaVersion) !== 1 || !Array.isArray(payload.events)) {
    throw new Error(`Private listening object has an unsupported payload: ${descriptor.path}`);
  }
  if (expectedSource === 'listenbrainz' && payload.source !== 'listenbrainz') {
    throw new Error(`Private ListenBrainz payload source is invalid: ${descriptor.path}`);
  }
  if (payload.events.length !== descriptor.eventCount) {
    throw new Error(`Private listening object count does not match its manifest: ${descriptor.path}`);
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
  sha256Hex,
  cleanEndpoint,
  authenticatedGet,
  readJson,
  validateArchiveDescriptor,
  readGzipPayload,
  readAllSourceEvents,
};
