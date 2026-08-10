'use strict';

const inventoryLib = require('./listening-inventory');

const CACHE_KIND = 'livevault-musicbrainz-catalogue-cache';
const CACHE_SCHEMA_VERSION = 1;
const MAX_BATCH_SIZE = 100;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function releaseText(event) {
  return clean(event?.releaseTitle || event?.albumName || event?.albumTitle);
}

function buildCatalogueEvidence({ bands = [], events = [], spotifyMetadata = null, trackIdentities = null } = {}) {
  const inventory = inventoryLib.buildListeningInventory({ bands, events, spotifyMetadata, trackIdentities });
  const index = inventoryLib.bandIndex(bands);
  const byKey = new Map(inventory.items.map((item) => [item.trackKey, {
    ...clone(item),
    releaseLookupName: null,
    normalizedReleaseTitle: null,
    releaseLookupConflict: false,
    releaseLookupNames: [],
    evidenceTier: null,
  }]));
  const releaseSets = new Map();

  for (const event of events || []) {
    const bandId = inventoryLib.mappedBandId(event, index);
    if (!bandId) continue;
    const trackKey = inventoryLib.workKey(event, bandId);
    if (!trackKey || !byKey.has(trackKey)) continue;
    const release = releaseText(event);
    if (!release) continue;
    const normalized = inventoryLib.normalizeText(release);
    if (!normalized) continue;
    if (!releaseSets.has(trackKey)) releaseSets.set(trackKey, new Map());
    const values = releaseSets.get(trackKey);
    if (!values.has(normalized)) values.set(normalized, release);
  }

  const tierCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const item of byKey.values()) {
    const releases = releaseSets.get(item.trackKey) || new Map();
    item.releaseLookupNames = [...releases.values()].sort((a, b) => a.localeCompare(b));
    item.releaseLookupConflict = releases.size > 1;
    if (releases.size === 1) {
      item.releaseLookupName = item.releaseLookupNames[0];
      item.normalizedReleaseTitle = inventoryLib.normalizeText(item.releaseLookupName) || null;
    }

    const trustedArtist = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
    const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
    if (item.status === 'complete') item.evidenceTier = 'A';
    else if (item.status === 'blocked' || !trustedArtist || !normalizedTrack || item.lookupTextConflict) item.evidenceTier = 'E';
    else if (releases.size === 1) item.evidenceTier = 'B';
    else item.evidenceTier = 'C';
    tierCounts[item.evidenceTier] += 1;
  }

  return {
    schemaVersion: 1,
    inventoryCounts: clone(inventory.counts),
    tierCounts,
    items: [...byKey.values()].sort((a, b) => a.trackKey.localeCompare(b.trackKey)),
  };
}

function validateCatalogueCache(cache) {
  if (cache == null) return { kind: CACHE_KIND, schemaVersion: CACHE_SCHEMA_VERSION, artists: {} };
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) throw new Error('Invalid catalogue cache.');
  if (cache.kind !== CACHE_KIND || cache.schemaVersion !== CACHE_SCHEMA_VERSION) throw new Error('Invalid catalogue cache.');
  if (!cache.artists || typeof cache.artists !== 'object' || Array.isArray(cache.artists)) throw new Error('Invalid catalogue cache.');

  for (const [artistKey, artist] of Object.entries(cache.artists)) {
    const key = inventoryLib.validMbid(artistKey);
    if (!key || key !== artistKey.toLowerCase()) throw new Error('Invalid catalogue artist key.');
    if (!artist || typeof artist !== 'object' || Array.isArray(artist)) throw new Error('Invalid catalogue artist.');
    const artistMbid = inventoryLib.validMbid(artist.artistMbid);
    if (!artistMbid || artistMbid !== key) throw new Error('Invalid catalogue artist identity.');
    if (!Array.isArray(artist.recordings)) throw new Error('Invalid catalogue recordings.');
    const seenRecordings = new Set();
    for (const recording of artist.recordings) {
      if (!recording || typeof recording !== 'object' || Array.isArray(recording)) throw new Error('Invalid catalogue recording.');
      const recordingMbid = inventoryLib.validMbid(recording.recordingMbid);
      if (!recordingMbid || !clean(recording.title)) throw new Error('Invalid catalogue recording identity.');
      if (seenRecordings.has(recordingMbid)) throw new Error('Duplicate catalogue recording identity.');
      seenRecordings.add(recordingMbid);
      if (!Array.isArray(recording.artistMbids) || !recording.artistMbids.length
        || !recording.artistMbids.every((value) => Boolean(inventoryLib.validMbid(value)))) {
        throw new Error('Invalid catalogue recording artists.');
      }
      if (recording.releases != null && !Array.isArray(recording.releases)) throw new Error('Invalid catalogue releases.');
      for (const release of recording.releases || []) {
        if (!release || typeof release !== 'object' || Array.isArray(release) || !clean(release.title)) throw new Error('Invalid catalogue release.');
        if (release.releaseMbid != null && !inventoryLib.validMbid(release.releaseMbid)) throw new Error('Invalid catalogue release identity.');
        if (release.releaseGroupMbid != null && !inventoryLib.validMbid(release.releaseGroupMbid)) throw new Error('Invalid catalogue release-group identity.');
      }
    }
  }
  return cache;
}

function recordingMatchesArtist(recording, trustedArtistMbid) {
  const trusted = inventoryLib.validMbid(trustedArtistMbid);
  return Boolean(trusted && Array.isArray(recording?.artistMbids)
    && recording.artistMbids.map(inventoryLib.validMbid).filter(Boolean).includes(trusted));
}

function candidateRecordings(item, artistCatalogue) {
  const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
  if (!normalizedTrack) return [];
  return (artistCatalogue?.recordings || []).filter((recording) => (
    recordingMatchesArtist(recording, item.trustedMusicbrainzArtistMbid)
    && inventoryLib.normalizeText(recording.title) === normalizedTrack
  ));
}

function uniqueRecording(candidates) {
  const byMbid = new Map();
  for (const candidate of candidates) byMbid.set(inventoryLib.validMbid(candidate.recordingMbid), candidate);
  byMbid.delete(null);
  return byMbid.size === 1 ? [...byMbid.values()][0] : null;
}

function resolveFromCatalogue(item, cache) {
  validateCatalogueCache(cache);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { status: 'exception', reason: 'invalid_evidence_item' };
  if (item.evidenceTier === 'A') return { status: 'complete', reason: 'already_complete' };
  if (!['B', 'C'].includes(item.evidenceTier)) return { status: 'exception', reason: 'not_catalogue_eligible' };
  const artistMbid = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
  const artistCatalogue = artistMbid ? cache.artists[artistMbid] : null;
  if (!artistCatalogue) return { status: 'unresolved', reason: 'catalogue_missing' };

  const titleCandidates = candidateRecordings(item, artistCatalogue);
  if (!titleCandidates.length) return { status: 'unresolved', reason: 'catalogue_no_match' };

  let candidates = titleCandidates;
  let evidence = 'catalogue_unique_recording_title';
  if (item.evidenceTier === 'B' && item.normalizedReleaseTitle) {
    candidates = titleCandidates.filter((recording) => (recording.releases || []).some((release) => (
      inventoryLib.normalizeText(release.title) === item.normalizedReleaseTitle
    )));
    evidence = 'catalogue_exact_recording_release';
    if (!candidates.length) return { status: 'unresolved', reason: 'catalogue_release_mismatch' };
  }

  const matched = uniqueRecording(candidates);
  if (!matched) return { status: 'ambiguous', reason: 'multiple_compatible_recordings' };
  return {
    status: 'resolved',
    reason: evidence,
    musicbrainzRecordingMbid: inventoryLib.validMbid(matched.recordingMbid),
    musicbrainzArtistMbid: artistMbid,
    evidenceClass: 'deterministic_local_match',
    evidenceSource: 'musicbrainz_catalogue_cache',
  };
}

function resolveCatalogueEvidence({ evidence, catalogueCache } = {}) {
  const cache = validateCatalogueCache(catalogueCache);
  const results = [];
  const counts = {
    alreadyComplete: 0,
    resolved: 0,
    unresolved: 0,
    ambiguous: 0,
    exceptions: 0,
  };
  for (const item of evidence?.items || []) {
    const outcome = resolveFromCatalogue(item, cache);
    results.push({ trackKey: item.trackKey, evidenceTier: item.evidenceTier, ...outcome });
    if (outcome.status === 'complete') counts.alreadyComplete += 1;
    else if (outcome.status === 'resolved') counts.resolved += 1;
    else if (outcome.status === 'ambiguous') counts.ambiguous += 1;
    else if (outcome.status === 'exception') counts.exceptions += 1;
    else counts.unresolved += 1;
  }
  return { schemaVersion: 1, counts, results };
}

function planListenBrainzBatchBridge({ evidence, localResults, maxItems = 25 } = {}) {
  const limit = Number.isInteger(maxItems) ? Math.max(1, Math.min(MAX_BATCH_SIZE, maxItems)) : 25;
  const resultByKey = new Map((localResults?.results || []).map((result) => [result.trackKey, result]));
  const items = [];
  const skipped = { complete: 0, resolvedLocally: 0, ambiguous: 0, ineligible: 0, overflow: 0 };

  for (const item of evidence?.items || []) {
    const local = resultByKey.get(item.trackKey);
    if (item.evidenceTier === 'A') { skipped.complete += 1; continue; }
    if (local?.status === 'resolved') { skipped.resolvedLocally += 1; continue; }
    if (local?.status === 'ambiguous') { skipped.ambiguous += 1; continue; }
    if (!['B', 'C'].includes(item.evidenceTier)
      || !inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid)
      || !clean(item.artistLookupName)
      || !clean(item.recordingLookupName)) {
      skipped.ineligible += 1;
      continue;
    }
    if (items.length >= limit) { skipped.overflow += 1; continue; }
    items.push({
      trackKey: item.trackKey,
      artistName: item.artistLookupName,
      recordingName: item.recordingLookupName,
      releaseName: item.evidenceTier === 'B' ? item.releaseLookupName : null,
      trustedMusicbrainzArtistMbid: inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid),
      evidenceTier: 'D',
    });
  }

  return { schemaVersion: 1, maxItems: limit, count: items.length, skipped, items };
}

function safeResolverDiagnostics({ evidence, localResults, batchPlan } = {}) {
  return {
    tiers: {
      A: Number(evidence?.tierCounts?.A) || 0,
      B: Number(evidence?.tierCounts?.B) || 0,
      C: Number(evidence?.tierCounts?.C) || 0,
      D: Number(batchPlan?.count) || 0,
      E: Number(evidence?.tierCounts?.E) || 0,
    },
    catalogue: {
      resolved: Number(localResults?.counts?.resolved) || 0,
      unresolved: Number(localResults?.counts?.unresolved) || 0,
      ambiguous: Number(localResults?.counts?.ambiguous) || 0,
      exceptions: Number(localResults?.counts?.exceptions) || 0,
    },
    batchBridgeEligible: Number(batchPlan?.count) || 0,
  };
}

module.exports = {
  CACHE_KIND,
  CACHE_SCHEMA_VERSION,
  MAX_BATCH_SIZE,
  releaseText,
  buildCatalogueEvidence,
  validateCatalogueCache,
  candidateRecordings,
  resolveFromCatalogue,
  resolveCatalogueEvidence,
  planListenBrainzBatchBridge,
  safeResolverDiagnostics,
};
