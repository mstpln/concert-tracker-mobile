'use strict';

const inventoryLib = require('./listening-inventory');

const CACHE_KIND = 'livevault-musicbrainz-catalogue-cache';
const CACHE_SCHEMA_VERSION = 1;
const MAX_BATCH_SIZE = 100;
const HELD_IDENTITY_STATUSES = new Set(['needs_review', 'retry', 'error', 'no_match']);
const HELD_PROVIDER_STATUSES = new Set(['needs_review', 'retry', 'error', 'no_match']);
const KNOWN_PROVIDERS = ['spotify', 'musicbrainz', 'listenbrainz'];

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

function sourceReleaseMbids(event) {
  return [...new Set([
    event?.musicbrainzReleaseId,
    event?.musicbrainzReleaseMbid,
    event?.releaseMbid,
  ].map(inventoryLib.validMbid).filter(Boolean))];
}

function addUnique(list, values) {
  return [...new Set([...(list || []), ...(values || [])])].sort();
}

function durableRoutingState(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { held: false, reason: null, priorIdentityStatus: null };
  }
  const priorIdentityStatus = typeof record.status === 'string' ? record.status : null;
  if (HELD_IDENTITY_STATUSES.has(priorIdentityStatus)) {
    return { held: true, reason: `durable_identity_${priorIdentityStatus}`, priorIdentityStatus };
  }
  for (const provider of KNOWN_PROVIDERS) {
    if (!Object.prototype.hasOwnProperty.call(record?.providers || {}, provider)) continue;
    const entry = record.providers[provider];
    const status = entry?.status;
    if (HELD_PROVIDER_STATUSES.has(status)) {
      return { held: true, reason: `durable_provider_${provider}_${status}`, priorIdentityStatus };
    }
    if (status != null && !['resolved', 'metadata'].includes(status)) {
      return { held: true, reason: `durable_provider_${provider}_unknown_status`, priorIdentityStatus };
    }
  }
  return { held: false, reason: null, priorIdentityStatus };
}

function buildCatalogueEvidence({ bands = [], events = [], spotifyMetadata = null, trackIdentities = null } = {}) {
  const inventory = inventoryLib.buildListeningInventory({ bands, events, spotifyMetadata, trackIdentities });
  const identityRecords = inventoryLib.normalizeIdentityDocument(trackIdentities);
  const index = inventoryLib.bandIndex(bands);
  const byKey = new Map(inventory.items.map((item) => {
    const routing = durableRoutingState(identityRecords[item.trackKey]);
    return [item.trackKey, {
      ...clone(item),
      releaseLookupName: null,
      normalizedReleaseTitle: null,
      releaseLookupConflict: false,
      releaseLookupNames: [],
      sourceMusicbrainzReleaseMbids: [],
      sourceMusicbrainzReleaseMbid: null,
      sourceReleaseIdentityConflict: false,
      evidenceTier: null,
      durableIdentityStatus: routing.priorIdentityStatus,
      routingHoldReason: routing.reason,
    }];
  }));
  const releaseSets = new Map();

  for (const event of events || []) {
    const bandId = inventoryLib.mappedBandId(event, index);
    if (!bandId) continue;
    const trackKey = inventoryLib.workKey(event, bandId);
    if (!trackKey || !byKey.has(trackKey)) continue;
    const item = byKey.get(trackKey);
    item.sourceMusicbrainzReleaseMbids = addUnique(item.sourceMusicbrainzReleaseMbids, sourceReleaseMbids(event));
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
    item.sourceReleaseIdentityConflict = item.sourceMusicbrainzReleaseMbids.length > 1;
    if (item.sourceMusicbrainzReleaseMbids.length === 1) {
      item.sourceMusicbrainzReleaseMbid = item.sourceMusicbrainzReleaseMbids[0];
    }

    const trustedArtist = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
    const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
    const trustedReleaseContradiction = item.sourceReleaseIdentityConflict
      || (item.sourceMusicbrainzReleaseMbid && item.releaseLookupConflict);
    const hasSingleReleaseEvidence = !trustedReleaseContradiction
      && (Boolean(item.sourceMusicbrainzReleaseMbid) || releases.size === 1);
    if (item.status === 'complete') item.evidenceTier = 'A';
    else if (item.status === 'blocked' || item.routingHoldReason || trustedReleaseContradiction
      || !trustedArtist || !normalizedTrack || item.lookupTextConflict) item.evidenceTier = 'E';
    else if (hasSingleReleaseEvidence) item.evidenceTier = 'B';
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

function validateEvidenceDocument(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || evidence.schemaVersion !== 1 || !Array.isArray(evidence.items)) {
    throw new Error('Invalid catalogue evidence.');
  }
  return evidence;
}

function validateLocalResults(localResults) {
  if (!localResults || typeof localResults !== 'object' || Array.isArray(localResults)
    || localResults.schemaVersion !== 1 || !Array.isArray(localResults.results)) {
    throw new Error('Invalid catalogue resolution results.');
  }
  const seen = new Set();
  for (const result of localResults.results) {
    if (!result || typeof result !== 'object' || Array.isArray(result) || !clean(result.trackKey)) {
      throw new Error('Invalid catalogue resolution result.');
    }
    if (seen.has(result.trackKey)) throw new Error('Duplicate catalogue resolution result.');
    seen.add(result.trackKey);
  }
  return localResults;
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

function releaseMatchesEvidence(release, item) {
  const expectedMbid = inventoryLib.validMbid(item.sourceMusicbrainzReleaseMbid);
  if (expectedMbid && inventoryLib.validMbid(release?.releaseMbid) !== expectedMbid) return false;
  if (item.normalizedReleaseTitle
    && inventoryLib.normalizeText(release?.title) !== item.normalizedReleaseTitle) return false;
  return Boolean(expectedMbid || item.normalizedReleaseTitle);
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
  if (item.routingHoldReason) return { status: 'exception', reason: item.routingHoldReason };
  if (!['B', 'C'].includes(item.evidenceTier)) return { status: 'exception', reason: 'not_catalogue_eligible' };
  const artistMbid = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
  const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
  if (!artistMbid || !normalizedTrack) return { status: 'exception', reason: 'invalid_catalogue_evidence' };
  if (item.evidenceTier === 'B' && !item.normalizedReleaseTitle
    && !inventoryLib.validMbid(item.sourceMusicbrainzReleaseMbid)) {
    return { status: 'exception', reason: 'invalid_tier_b_release_evidence' };
  }
  const artistCatalogue = cache.artists[artistMbid];
  if (!artistCatalogue) return { status: 'unresolved', reason: 'catalogue_missing' };

  const titleCandidates = candidateRecordings(item, artistCatalogue);
  if (!titleCandidates.length) return { status: 'unresolved', reason: 'catalogue_no_match' };

  let candidates = titleCandidates;
  let evidence = 'catalogue_unique_recording_title';
  if (item.evidenceTier === 'B') {
    candidates = titleCandidates.filter((recording) => (recording.releases || []).some((release) => (
      releaseMatchesEvidence(release, item)
    )));
    evidence = inventoryLib.validMbid(item.sourceMusicbrainzReleaseMbid)
      ? 'catalogue_exact_recording_release_identity'
      : 'catalogue_exact_recording_release';
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
  validateEvidenceDocument(evidence);
  const cache = validateCatalogueCache(catalogueCache);
  const results = [];
  const counts = {
    alreadyComplete: 0,
    resolved: 0,
    unresolved: 0,
    ambiguous: 0,
    exceptions: 0,
  };
  for (const item of evidence.items) {
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
  validateEvidenceDocument(evidence);
  validateLocalResults(localResults);
  const limit = Number.isInteger(maxItems) ? Math.max(1, Math.min(MAX_BATCH_SIZE, maxItems)) : 25;
  const resultByKey = new Map(localResults.results.map((result) => [result.trackKey, result]));
  const items = [];
  const skipped = {
    complete: 0,
    resolvedLocally: 0,
    ambiguous: 0,
    notUnresolvedLocally: 0,
    ineligible: 0,
    overflow: 0,
  };

  for (const item of evidence.items) {
    const local = resultByKey.get(item.trackKey);
    if (item.evidenceTier === 'A') { skipped.complete += 1; continue; }
    if (local?.status === 'resolved') { skipped.resolvedLocally += 1; continue; }
    if (local?.status === 'ambiguous') { skipped.ambiguous += 1; continue; }
    if (!local || local.status !== 'unresolved') { skipped.notUnresolvedLocally += 1; continue; }
    if (!['B', 'C'].includes(item.evidenceTier)
      || item.routingHoldReason
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
  HELD_IDENTITY_STATUSES,
  HELD_PROVIDER_STATUSES,
  KNOWN_PROVIDERS,
  releaseText,
  sourceReleaseMbids,
  durableRoutingState,
  buildCatalogueEvidence,
  validateCatalogueCache,
  validateEvidenceDocument,
  validateLocalResults,
  candidateRecordings,
  releaseMatchesEvidence,
  resolveFromCatalogue,
  resolveCatalogueEvidence,
  planListenBrainzBatchBridge,
  safeResolverDiagnostics,
};
