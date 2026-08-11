'use strict';

const resolver = require('./listening-catalogue-resolver');
const inventoryLib = require('./listening-inventory');
const { SUPPORTED_SCOPES } = require('./lib/listeningCatalogueProviders');

const CATALOGUE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CATALOGUE_ARTISTS = 5000;
const MAX_SCOPE_RELEASES = 100000;
const MAX_RECORDINGS_PER_ARTIST = 50000;
const MAX_RELEASES_PER_RECORDING = 1000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function emptyCatalogue() {
  return { kind: resolver.CACHE_KIND, schemaVersion: resolver.CACHE_SCHEMA_VERSION, artists: {} };
}

function normalizeScopeCheckpoint(scope, artistMbid) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Invalid catalogue scope checkpoint.');
  const normalized = resolver.validateCatalogueCache({
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: { [artistMbid]: scope },
  }).artists[artistMbid];
  if (normalized.releaseMbids.length > MAX_SCOPE_RELEASES) throw new Error('Catalogue scope release limit exceeded.');
  if (normalized.recordings.length > MAX_RECORDINGS_PER_ARTIST) throw new Error('Catalogue recording limit exceeded.');
  for (const recording of normalized.recordings) {
    if ((recording.releases || []).length > MAX_RELEASES_PER_RECORDING) throw new Error('Catalogue recording release limit exceeded.');
  }
  return normalized;
}

function mergeOwnedRecordingShape(rows) {
  const byMbid = new Map();
  for (const row of rows) {
    byMbid.set(row.recordingMbid, resolver.mergeRecordingRows(byMbid.get(row.recordingMbid), row));
  }
  return [...byMbid.values()].sort((a, b) => a.recordingMbid.localeCompare(b.recordingMbid));
}

function rebuildArtistAssembly(artist, nowMs) {
  const next = clone(artist);
  const checkpoints = next.scopeCheckpoints || {};
  const scopeRows = [];
  const releaseMbids = new Set();
  const completed = [];
  for (const scopeName of SUPPORTED_SCOPES) {
    const scope = checkpoints[scopeName];
    if (!scope) continue;
    for (const id of scope.releaseMbids) releaseMbids.add(id);
    scopeRows.push(...scope.recordings);
    if (scope.complete) completed.push(scopeName);
  }
  next.recordings = mergeOwnedRecordingShape(scopeRows);
  next.releaseMbids = [...releaseMbids].sort();
  next.coverageScopes = completed.sort();
  next.sourceEntity = 'release';
  if (SUPPORTED_SCOPES.every((scope) => completed.includes(scope))) {
    next.nextOffset = next.releaseMbids.length;
    next.totalCount = next.releaseMbids.length;
    next.complete = true;
    next.refreshedAt = new Date(nowMs).toISOString();
    next.freshUntil = new Date(nowMs + CATALOGUE_FRESHNESS_MS).toISOString();
    delete next.refreshStartedAt;
  } else {
    delete next.nextOffset;
    delete next.totalCount;
    delete next.complete;
    delete next.refreshedAt;
    delete next.freshUntil;
  }
  return next;
}

function validateDurableCatalogue(cache) {
  const normalized = resolver.validateCatalogueCache(cache == null ? emptyCatalogue() : cache);
  const entries = Object.entries(normalized.artists);
  if (entries.length > MAX_CATALOGUE_ARTISTS) throw new Error('Catalogue artist limit exceeded.');
  for (const [artistMbid, artist] of entries) {
    if (artist.refreshStartedAt != null && !validDate(artist.refreshStartedAt)) throw new Error('Invalid catalogue refresh timestamp.');
    if (artist.scopeCheckpoints != null) {
      if (!artist.scopeCheckpoints || typeof artist.scopeCheckpoints !== 'object' || Array.isArray(artist.scopeCheckpoints)) {
        throw new Error('Invalid catalogue scope checkpoints.');
      }
      const keys = Object.keys(artist.scopeCheckpoints);
      if (keys.some((scope) => !SUPPORTED_SCOPES.includes(scope))) throw new Error('Invalid catalogue coverage scope.');
      const checkpoints = {};
      for (const scope of keys) checkpoints[scope] = normalizeScopeCheckpoint(artist.scopeCheckpoints[scope], artistMbid);
      const rebuilt = rebuildArtistAssembly({ ...clone(artist), scopeCheckpoints: checkpoints }, validDate(artist.refreshedAt) ? Date.parse(artist.refreshedAt) : 0);
      const expectedCoverage = rebuilt.coverageScopes;
      if (JSON.stringify(artist.coverageScopes || []) !== JSON.stringify(expectedCoverage)) throw new Error('Catalogue coverage markers do not match scope checkpoints.');
      if (JSON.stringify(artist.releaseMbids || []) !== JSON.stringify(rebuilt.releaseMbids)) throw new Error('Catalogue release assembly does not match scope checkpoints.');
      const actualOwned = mergeOwnedRecordingShape(artist.recordings || []).map((recording) => ({
        recordingMbid: recording.recordingMbid,
        title: recording.title,
        artistMbids: [...recording.artistMbids].sort(),
        releases: (recording.releases || []).map((release) => ({
          releaseMbid: release.releaseMbid,
          releaseGroupMbid: release.releaseGroupMbid || null,
          title: release.title,
        })).sort((a, b) => a.releaseMbid.localeCompare(b.releaseMbid)),
      }));
      const rebuiltOwned = rebuilt.recordings.map((recording) => ({
        recordingMbid: recording.recordingMbid,
        title: recording.title,
        artistMbids: [...recording.artistMbids].sort(),
        releases: (recording.releases || []).map((release) => ({
          releaseMbid: release.releaseMbid,
          releaseGroupMbid: release.releaseGroupMbid || null,
          title: release.title,
        })).sort((a, b) => a.releaseMbid.localeCompare(b.releaseMbid)),
      }));
      if (JSON.stringify(actualOwned) !== JSON.stringify(rebuiltOwned)) throw new Error('Catalogue recording assembly does not match scope checkpoints.');
      const fullyComplete = SUPPORTED_SCOPES.every((scope) => checkpoints[scope]?.complete === true);
      if (fullyComplete) {
        if (artist.complete !== true || artist.nextOffset !== artist.releaseMbids.length || artist.totalCount !== artist.releaseMbids.length
          || !validDate(artist.refreshedAt) || !validDate(artist.freshUntil)
          || Date.parse(artist.freshUntil) - Date.parse(artist.refreshedAt) !== CATALOGUE_FRESHNESS_MS
          || artist.refreshStartedAt != null) {
          throw new Error('Invalid complete catalogue freshness state.');
        }
      } else if (!validDate(artist.refreshStartedAt) || artist.complete != null || artist.nextOffset != null || artist.totalCount != null || artist.refreshedAt != null || artist.freshUntil != null) {
        throw new Error('Partial catalogue must retain only its valid refresh checkpoint state.');
      }
    }
  }
  return normalized;
}

function artistNeedsRefresh(cache, artistMbid, nowMs = Date.now()) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist) throw new Error('Invalid trusted MusicBrainz artist.');
  const normalized = validateDurableCatalogue(cache);
  const artist = normalized.artists[trustedArtist];
  if (!artist) return true;
  if (!artist.scopeCheckpoints || !SUPPORTED_SCOPES.every((scope) => artist.scopeCheckpoints[scope]?.complete === true)) return true;
  return !validDate(artist.freshUntil) || Date.parse(artist.freshUntil) <= nowMs;
}

function startArtistRefresh(cache, artistMbid, nowMs = Date.now()) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist) throw new Error('Invalid trusted MusicBrainz artist.');
  const base = clone(validateDurableCatalogue(cache));
  const existing = base.artists[trustedArtist] || {};
  base.artists[trustedArtist] = {
    ...existing,
    artistMbid: trustedArtist,
    sourceEntity: 'release',
    recordings: [],
    releaseMbids: [],
    coverageScopes: [],
    scopeCheckpoints: {},
    refreshStartedAt: new Date(nowMs).toISOString(),
  };
  delete base.artists[trustedArtist].nextOffset;
  delete base.artists[trustedArtist].totalCount;
  delete base.artists[trustedArtist].complete;
  delete base.artists[trustedArtist].refreshedAt;
  delete base.artists[trustedArtist].freshUntil;
  validateDurableCatalogue(base);
  return base;
}

function mergeScopePage(cache, scopeName, page, nowMs = Date.now()) {
  if (!SUPPORTED_SCOPES.includes(scopeName)) throw new Error('Invalid catalogue scope.');
  const base = clone(validateDurableCatalogue(cache));
  const artistMbid = inventoryLib.validMbid(page?.artistMbid);
  if (!artistMbid) throw new Error('Invalid catalogue page artist.');
  const artist = base.artists[artistMbid];
  if (!artist || !artist.scopeCheckpoints) throw new Error('Catalogue refresh has not been started.');
  const priorScope = artist.scopeCheckpoints[scopeName];
  const temp = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: priorScope ? { [artistMbid]: clone(priorScope) } : {},
  };
  const merged = resolver.mergeCataloguePage(temp, page).artists[artistMbid];
  artist.scopeCheckpoints[scopeName] = merged;
  base.artists[artistMbid] = rebuildArtistAssembly(artist, nowMs);
  validateDurableCatalogue(base);
  return base;
}

async function persistAndCarry(working, persistCheckpoint) {
  const persisted = await persistCheckpoint(working);
  if (persisted?.cache) return validateDurableCatalogue(persisted.cache);
  if (persisted?.kind === resolver.CACHE_KIND) return validateDurableCatalogue(persisted);
  return working;
}

async function acquireArtistCatalogue({
  cache,
  artistMbid,
  provider,
  usage,
  persistCheckpoint,
  now = () => Date.now(),
  maxPages = 1000,
} = {}) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist || !provider || typeof provider.releaseBrowse !== 'function'
    || !usage || typeof usage.reserve !== 'function' || typeof persistCheckpoint !== 'function'
    || !Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid catalogue acquisition context.');
  let working = validateDurableCatalogue(cache);
  if (!working.artists[trustedArtist]?.scopeCheckpoints || !working.artists[trustedArtist]?.refreshStartedAt) {
    working = startArtistRefresh(working, trustedArtist, now());
    working = await persistAndCarry(working, persistCheckpoint);
  }
  let calls = 0;
  for (const scope of SUPPORTED_SCOPES) {
    while (!working.artists[trustedArtist].scopeCheckpoints?.[scope]?.complete) {
      if (calls >= maxPages) return { kind: 'paused', reason: 'page_cap', cache: working, calls };
      const checkpoint = working.artists[trustedArtist].scopeCheckpoints?.[scope];
      const offset = checkpoint?.nextOffset || 0;
      const allowed = await usage.reserve('musicbrainz');
      if (!allowed) return { kind: 'paused', reason: usage.blockReason?.('musicbrainz') || 'usage_denied', cache: working, calls };
      const outcome = await provider.releaseBrowse({ artistMbid: trustedArtist, scope, offset });
      calls += 1;
      if (outcome.kind !== 'ok') return { ...outcome, cache: working, calls, scope, offset };
      let page;
      try { page = resolver.parseMusicBrainzCataloguePage({ artistMbid: trustedArtist, payload: outcome.data, expectedOffset: offset }); }
      catch { return { kind: 'error', reason: 'musicbrainz_invalid_catalogue_page', cache: working, calls, scope, offset }; }
      try { working = mergeScopePage(working, scope, page, now()); }
      catch (error) {
        if (/total count changed/.test(error.message)) {
          working = startArtistRefresh(working, trustedArtist, now());
          working = await persistAndCarry(working, persistCheckpoint);
          return { kind: 'restart', reason: 'catalogue_total_changed', cache: working, calls, scope };
        }
        return { kind: 'error', reason: 'catalogue_merge_conflict', cache: working, calls, scope };
      }
      working = await persistAndCarry(working, persistCheckpoint);
    }
  }
  return { kind: 'ok', cache: working, calls };
}

function safeCatalogueDiagnostics(cache) {
  const normalized = validateDurableCatalogue(cache);
  let completeArtists = 0;
  let partialArtists = 0;
  let recordings = 0;
  let releases = 0;
  for (const artist of Object.values(normalized.artists)) {
    if (artist.complete === true) completeArtists += 1;
    else partialArtists += 1;
    recordings += artist.recordings.length;
    releases += artist.releaseMbids?.length || 0;
  }
  return { artists: Object.keys(normalized.artists).length, completeArtists, partialArtists, recordings, releases };
}

module.exports = {
  CATALOGUE_FRESHNESS_MS,
  MAX_CATALOGUE_ARTISTS,
  MAX_SCOPE_RELEASES,
  MAX_RECORDINGS_PER_ARTIST,
  MAX_RELEASES_PER_RECORDING,
  emptyCatalogue,
  validateDurableCatalogue,
  rebuildArtistAssembly,
  artistNeedsRefresh,
  startArtistRefresh,
  mergeScopePage,
  persistAndCarry,
  acquireArtistCatalogue,
  safeCatalogueDiagnostics,
};
