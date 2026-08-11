'use strict';

const inventoryLib = require('../listening-inventory');
const acquisition = require('../listening-catalogue-acquisition');

const CATALOGUE_PATH = 'listening/musicbrainz-catalogue.json';
const MAX_CATALOGUE_BYTES = 25 * 1024 * 1024;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function validatePersistableCatalogue(value) {
  const normalized = acquisition.validateDurableCatalogue(value);
  if (byteLength(normalized) > MAX_CATALOGUE_BYTES) throw new Error('MusicBrainz catalogue exceeds 25 MiB persistence ceiling.');
  return normalized;
}

async function loadCatalogue(client) {
  if (!client || typeof client.readJson !== 'function' || typeof client.writeJsonStrict !== 'function') {
    throw new Error('Catalogue persistence requires a conditional Worker client.');
  }
  const value = await client.readJson(CATALOGUE_PATH, acquisition.emptyCatalogue());
  return { cache: validatePersistableCatalogue(value), base: clone(value) };
}

async function persistCatalogue(client, { base, next, artistMbid } = {}) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist) throw new Error('Catalogue persistence requires a trusted artist MBID.');
  const baseValidated = validatePersistableCatalogue(base);
  const intended = validatePersistableCatalogue(next);
  try {
    await client.writeJsonStrict(CATALOGUE_PATH, intended);
    return { cache: intended, conflicted: false };
  } catch (error) {
    if (error?.code !== 'ETAG_CONFLICT') throw error;
  }

  const latest = validatePersistableCatalogue(await client.readJson(CATALOGUE_PATH, acquisition.emptyCatalogue()));
  const baseArtist = baseValidated.artists[trustedArtist];
  const latestArtist = latest.artists[trustedArtist];
  if (!same(baseArtist, latestArtist)) {
    const conflict = new Error('MusicBrainz catalogue artist changed concurrently; reread before retrying.');
    conflict.code = 'CATALOGUE_ARTIST_CONFLICT';
    throw conflict;
  }
  const merged = clone(latest);
  if (intended.artists[trustedArtist] === undefined) delete merged.artists[trustedArtist];
  else merged.artists[trustedArtist] = clone(intended.artists[trustedArtist]);
  validatePersistableCatalogue(merged);
  await client.writeJsonStrict(CATALOGUE_PATH, merged);
  return { cache: merged, conflicted: true };
}

async function refreshArtistCatalogue({ client, artistMbid, provider, usage, now = () => Date.now(), maxPages = 1000 } = {}) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist) throw new Error('Catalogue refresh requires a trusted artist MBID.');
  const loaded = await loadCatalogue(client);
  if (!acquisition.artistNeedsRefresh(loaded.cache, trustedArtist, now())) {
    return { kind: 'fresh', cache: loaded.cache, calls: 0 };
  }
  let persistedBase = loaded.cache;
  return acquisition.acquireArtistCatalogue({
    cache: loaded.cache,
    artistMbid: trustedArtist,
    provider,
    usage,
    now,
    maxPages,
    persistCheckpoint: async (candidate) => {
      const persisted = await persistCatalogue(client, { base: persistedBase, next: candidate, artistMbid: trustedArtist });
      persistedBase = persisted.cache;
      return persisted;
    },
  });
}

module.exports = {
  CATALOGUE_PATH,
  MAX_CATALOGUE_BYTES,
  byteLength,
  validatePersistableCatalogue,
  loadCatalogue,
  persistCatalogue,
  refreshArtistCatalogue,
};
