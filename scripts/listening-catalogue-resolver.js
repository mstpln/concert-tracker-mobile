'use strict';

const inventoryLib = require('./listening-inventory');

const CACHE_KIND = 'livevault-musicbrainz-catalogue-cache';
const CACHE_SCHEMA_VERSION = 1;
const CATALOGUE_PAGE_SCHEMA_VERSION = 1;
const MAX_BATCH_SIZE = 100;
const HELD_IDENTITY_STATUSES = new Set(['needs_review', 'retry', 'error', 'no_match']);
const HELD_PROVIDER_STATUSES = new Set(['needs_review', 'retry', 'error', 'no_match']);
const KNOWN_PROVIDERS = ['spotify', 'musicbrainz', 'listenbrainz'];
const LOCAL_RESULT_STATUSES = new Set(['complete', 'resolved', 'unresolved', 'ambiguous', 'exception']);
const EVIDENCE_TIERS = new Set(['A', 'B', 'C', 'D', 'E']);
const BRIDGE_UNRESOLVED_REASONS = new Set(['catalogue_no_match', 'catalogue_release_mismatch']);
const COMPLETE_INVENTORY_REASONS = new Set(['existing_track_identity', 'source_recording_mbid']);
const CATALOGUE_COVERAGE_SCOPES = Object.freeze(['release_artist', 'release_track_artist']);

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
  ].map(inventoryLib.validMbid).filter(Boolean))];
}

function sourceReleaseEvidenceMalformed(event) {
  return ['musicbrainzReleaseId', 'musicbrainzReleaseMbid'].some((field) => (
    event?.[field] != null && !inventoryLib.validMbid(event[field])
  ));
}

function spotifyTrackUrlFromId(value) {
  const id = clean(value);
  return id && /^[A-Za-z0-9]{1,64}$/.test(id) ? `https://open.spotify.com/track/${id}` : null;
}

function addUnique(list, values) {
  return [...new Set([...(list || []), ...(values || [])])].sort();
}

function normalizedMbidList(values) {
  if (!Array.isArray(values)) throw new Error('Invalid MusicBrainz identity list.');
  const normalized = values.map(inventoryLib.validMbid);
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) {
    throw new Error('Invalid MusicBrainz identity list.');
  }
  return normalized;
}

function normalizedCoverageScopes(values) {
  if (!Array.isArray(values)) throw new Error('Invalid catalogue coverage scopes.');
  if (values.some((value) => !CATALOGUE_COVERAGE_SCOPES.includes(value))
    || new Set(values).size !== values.length) {
    throw new Error('Invalid catalogue coverage scopes.');
  }
  return [...values].sort();
}

function hasAuthoritativeCoverage(artistCatalogue) {
  if (!artistCatalogue) return false;
  try {
    const scopes = normalizedCoverageScopes(artistCatalogue.coverageScopes);
    return CATALOGUE_COVERAGE_SCOPES.every((scope) => scopes.includes(scope));
  } catch {
    return false;
  }
}

function durableRoutingState(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { held: false, reason: null, priorIdentityStatus: null };
  }
  const priorIdentityStatus = typeof record.status === 'string' ? record.status : null;
  if (HELD_IDENTITY_STATUSES.has(priorIdentityStatus)) {
    return { held: true, reason: `durable_identity_${priorIdentityStatus}`, priorIdentityStatus };
  }
  if (record.providers != null && (typeof record.providers !== 'object' || Array.isArray(record.providers))) {
    return { held: true, reason: 'durable_provider_state_malformed', priorIdentityStatus };
  }
  const providerNames = Object.keys(record.providers || {});
  if (providerNames.some((provider) => !KNOWN_PROVIDERS.includes(provider))) {
    return { held: true, reason: 'durable_provider_unknown_provider', priorIdentityStatus };
  }
  for (const provider of KNOWN_PROVIDERS) {
    if (!Object.prototype.hasOwnProperty.call(record.providers || {}, provider)) continue;
    const entry = record.providers[provider];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.status !== 'string') {
      return { held: true, reason: `durable_provider_${provider}_malformed`, priorIdentityStatus };
    }
    if (HELD_PROVIDER_STATUSES.has(entry.status)) {
      return { held: true, reason: `durable_provider_${provider}_${entry.status}`, priorIdentityStatus };
    }
    if (!['resolved', 'metadata'].includes(entry.status)) {
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
      spotifyTrackUrl: spotifyTrackUrlFromId(item.spotifyTrackId),
      releaseLookupName: null,
      normalizedReleaseTitle: null,
      releaseLookupConflict: false,
      releaseLookupNames: [],
      sourceMusicbrainzReleaseMbids: [],
      sourceMusicbrainzReleaseMbid: null,
      sourceReleaseIdentityConflict: false,
      sourceReleaseEvidenceMalformed: false,
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
    item.sourceReleaseEvidenceMalformed = item.sourceReleaseEvidenceMalformed || sourceReleaseEvidenceMalformed(event);
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
    if (item.sourceMusicbrainzReleaseMbids.length === 1) item.sourceMusicbrainzReleaseMbid = item.sourceMusicbrainzReleaseMbids[0];

    const trustedArtist = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
    const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
    const trustedReleaseContradiction = item.sourceReleaseEvidenceMalformed
      || item.sourceReleaseIdentityConflict
      || (item.sourceMusicbrainzReleaseMbid && item.releaseLookupConflict);
    const hasSingleReleaseEvidence = !trustedReleaseContradiction
      && (Boolean(item.sourceMusicbrainzReleaseMbid) || releases.size === 1);
    if (item.routingHoldReason) item.evidenceTier = 'E';
    else if (item.status === 'complete') item.evidenceTier = 'A';
    else if (item.status === 'blocked' || trustedReleaseContradiction
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

function normalizeCatalogueCheckpoint({ artistMbid, nextOffset, totalCount, complete } = {}) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist || !Number.isInteger(nextOffset) || nextOffset < 0
    || !Number.isInteger(totalCount) || totalCount < 0 || nextOffset > totalCount
    || typeof complete !== 'boolean' || complete !== (nextOffset === totalCount)) {
    throw new Error('Invalid catalogue checkpoint.');
  }
  return { schemaVersion: CATALOGUE_PAGE_SCHEMA_VERSION, artistMbid: trustedArtist, nextOffset, totalCount, complete };
}

function normalizeMusicBrainzRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) throw new Error('Invalid MusicBrainz release.');
  const releaseMbid = inventoryLib.validMbid(release.id);
  const title = clean(release.title);
  if (!releaseMbid || !title) throw new Error('Invalid MusicBrainz release.');
  const releaseGroupRaw = release['release-group'];
  let releaseGroupMbid = null;
  if (releaseGroupRaw != null) {
    if (!releaseGroupRaw || typeof releaseGroupRaw !== 'object' || Array.isArray(releaseGroupRaw)) throw new Error('Invalid MusicBrainz release group.');
    releaseGroupMbid = inventoryLib.validMbid(releaseGroupRaw.id);
    if (!releaseGroupMbid) throw new Error('Invalid MusicBrainz release group.');
  }
  return { releaseMbid, ...(releaseGroupMbid ? { releaseGroupMbid } : {}), title };
}

function normalizeMusicBrainzArtistCredits(credits) {
  if (!Array.isArray(credits) || !credits.length) throw new Error('Invalid MusicBrainz artist credit.');
  const artistMbids = [];
  for (const credit of credits) {
    if (!credit || typeof credit !== 'object' || Array.isArray(credit)
      || !credit.artist || typeof credit.artist !== 'object' || Array.isArray(credit.artist)) {
      throw new Error('Invalid MusicBrainz artist credit.');
    }
    const artistMbid = inventoryLib.validMbid(credit.artist.id);
    if (!artistMbid) throw new Error('Invalid MusicBrainz artist credit.');
    artistMbids.push(artistMbid);
  }
  return [...new Set(artistMbids)].sort();
}

function normalizeMusicBrainzRecording(recording, artistMbid) {
  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) throw new Error('Invalid MusicBrainz recording.');
  const recordingMbid = inventoryLib.validMbid(recording.id);
  const title = clean(recording.title);
  if (!recordingMbid || !title) throw new Error('Invalid MusicBrainz recording.');
  const artistMbids = normalizeMusicBrainzArtistCredits(recording['artist-credit']);
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist) throw new Error('Invalid trusted MusicBrainz artist.');
  if (!artistMbids.includes(trustedArtist)) return null;
  return { recordingMbid, title, artistMbids, releases: [] };
}

function releaseRowKey(release) {
  return inventoryLib.validMbid(release?.releaseMbid);
}

function mergeRecordingRows(existing, incoming) {
  if (!existing) return clone(incoming);
  if (!incoming || existing.recordingMbid !== incoming.recordingMbid
    || inventoryLib.normalizeText(existing.title) !== inventoryLib.normalizeText(incoming.title)) {
    throw new Error('Conflicting catalogue recording identity.');
  }
  const existingArtists = normalizedMbidList(existing.artistMbids).sort();
  const incomingArtists = normalizedMbidList(incoming.artistMbids).sort();
  if (!existingArtists.length || !incomingArtists.length
    || existingArtists.join('\n') !== incomingArtists.join('\n')) {
    throw new Error('Conflicting catalogue recording artist identity.');
  }
  const byRelease = new Map((existing.releases || []).map((release) => [releaseRowKey(release), clone(release)]));
  for (const release of incoming.releases || []) {
    const key = releaseRowKey(release);
    if (!key) throw new Error('Invalid catalogue release identity.');
    const prior = byRelease.get(key);
    const priorGroup = inventoryLib.validMbid(prior?.releaseGroupMbid);
    const incomingGroup = inventoryLib.validMbid(release.releaseGroupMbid);
    if (prior && inventoryLib.normalizeText(prior.title) !== inventoryLib.normalizeText(release.title)) throw new Error('Conflicting catalogue release identity.');
    if (priorGroup && incomingGroup && priorGroup !== incomingGroup) throw new Error('Conflicting catalogue release identity.');
    if (prior) {
      byRelease.set(key, {
        ...clone(release),
        ...clone(prior),
        releaseMbid: key,
        title: prior.title,
        ...((priorGroup || incomingGroup) ? { releaseGroupMbid: priorGroup || incomingGroup } : {}),
      });
    } else byRelease.set(key, clone(release));
  }
  return {
    ...clone(incoming),
    ...clone(existing),
    recordingMbid: existing.recordingMbid,
    title: existing.title,
    artistMbids: addUnique(existing.artistMbids, incoming.artistMbids),
    releases: [...byRelease.values()].sort((a, b) => a.releaseMbid.localeCompare(b.releaseMbid)),
  };
}

function recordingsFromMusicBrainzRelease(release, artistMbid) {
  const releaseRelation = normalizeMusicBrainzRelease(release);
  if (!Array.isArray(release.media)) throw new Error('Invalid MusicBrainz release media.');
  const byRecording = new Map();
  for (const medium of release.media) {
    if (!medium || typeof medium !== 'object' || Array.isArray(medium) || !Array.isArray(medium.tracks)) throw new Error('Invalid MusicBrainz release media.');
    for (const track of medium.tracks) {
      if (!track || typeof track !== 'object' || Array.isArray(track)) throw new Error('Invalid MusicBrainz track.');
      const normalized = normalizeMusicBrainzRecording(track.recording, artistMbid);
      if (!normalized) continue;
      normalized.releases = [releaseRelation];
      byRecording.set(normalized.recordingMbid, mergeRecordingRows(byRecording.get(normalized.recordingMbid), normalized));
    }
  }
  return [...byRecording.values()].sort((a, b) => a.recordingMbid.localeCompare(b.recordingMbid));
}

function parseMusicBrainzCataloguePage({ artistMbid, payload, expectedOffset = 0 } = {}) {
  const trustedArtist = inventoryLib.validMbid(artistMbid);
  if (!trustedArtist || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Number.isInteger(expectedOffset) || expectedOffset < 0) throw new Error('Invalid MusicBrainz catalogue page.');
  const totalCount = payload['release-count'];
  const offset = payload['release-offset'];
  const releases = payload.releases;
  if (!Number.isInteger(totalCount) || totalCount < 0 || !Number.isInteger(offset) || offset < 0
    || offset !== expectedOffset || offset > totalCount || !Array.isArray(releases)
    || offset + releases.length > totalCount || (releases.length === 0 && offset < totalCount)) {
    throw new Error('Invalid MusicBrainz catalogue pagination.');
  }

  const seenReleases = new Set();
  const byRecording = new Map();
  for (const release of releases) {
    const relation = normalizeMusicBrainzRelease(release);
    if (seenReleases.has(relation.releaseMbid)) throw new Error('Duplicate MusicBrainz release identity.');
    seenReleases.add(relation.releaseMbid);
    for (const recording of recordingsFromMusicBrainzRelease(release, trustedArtist)) {
      byRecording.set(recording.recordingMbid, mergeRecordingRows(byRecording.get(recording.recordingMbid), recording));
    }
  }

  const nextOffset = offset + releases.length;
  const complete = nextOffset === totalCount;
  const checkpoint = normalizeCatalogueCheckpoint({ artistMbid: trustedArtist, nextOffset, totalCount, complete });
  return {
    schemaVersion: CATALOGUE_PAGE_SCHEMA_VERSION,
    sourceEntity: 'release',
    artistMbid: trustedArtist,
    offset,
    releaseCount: releases.length,
    releaseMbids: [...seenReleases],
    recordings: [...byRecording.values()].sort((a, b) => a.recordingMbid.localeCompare(b.recordingMbid)),
    ...checkpoint,
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
    if (artist.sourceEntity != null && artist.sourceEntity !== 'release') throw new Error('Invalid catalogue source entity.');
    if (artist.coverageScopes != null) normalizedCoverageScopes(artist.coverageScopes);

    const paginationFields = ['nextOffset', 'totalCount', 'complete'].filter((field) => Object.prototype.hasOwnProperty.call(artist, field));
    if (paginationFields.length && paginationFields.length !== 3) throw new Error('Invalid catalogue artist checkpoint.');
    let coveredReleaseSet = null;
    if (paginationFields.length === 3) {
      normalizeCatalogueCheckpoint({ artistMbid, nextOffset: artist.nextOffset, totalCount: artist.totalCount, complete: artist.complete });
      if (artist.sourceEntity !== 'release') throw new Error('Invalid catalogue source entity.');
      const releaseMbids = normalizedMbidList(artist.releaseMbids);
      if (releaseMbids.length !== artist.nextOffset) throw new Error('Invalid catalogue release coverage.');
      coveredReleaseSet = new Set(releaseMbids);
    } else if (artist.releaseMbids != null) coveredReleaseSet = new Set(normalizedMbidList(artist.releaseMbids));

    if (!Array.isArray(artist.recordings)) throw new Error('Invalid catalogue recordings.');
    const seenRecordings = new Set();
    for (const recording of artist.recordings) {
      if (!recording || typeof recording !== 'object' || Array.isArray(recording)) throw new Error('Invalid catalogue recording.');
      const recordingMbid = inventoryLib.validMbid(recording.recordingMbid);
      if (!recordingMbid || !clean(recording.title)) throw new Error('Invalid catalogue recording identity.');
      if (seenRecordings.has(recordingMbid)) throw new Error('Duplicate catalogue recording identity.');
      seenRecordings.add(recordingMbid);
      if (!Array.isArray(recording.artistMbids) || !recording.artistMbids.length
        || !recording.artistMbids.every((value) => Boolean(inventoryLib.validMbid(value)))) throw new Error('Invalid catalogue recording artists.');
      if (!recording.artistMbids.map(inventoryLib.validMbid).includes(artistMbid)) throw new Error('Catalogue recording is outside artist boundary.');
      if (coveredReleaseSet && (!Array.isArray(recording.releases) || !recording.releases.length)) throw new Error('Catalogue recording is missing release provenance.');
      if (recording.releases != null && !Array.isArray(recording.releases)) throw new Error('Invalid catalogue releases.');
      const seenReleases = new Set();
      for (const release of recording.releases || []) {
        if (!release || typeof release !== 'object' || Array.isArray(release) || !clean(release.title)) throw new Error('Invalid catalogue release.');
        const releaseMbid = inventoryLib.validMbid(release.releaseMbid);
        if (!releaseMbid) throw new Error('Invalid catalogue release identity.');
        if (seenReleases.has(releaseMbid)) throw new Error('Duplicate catalogue release identity.');
        seenReleases.add(releaseMbid);
        if (coveredReleaseSet && !coveredReleaseSet.has(releaseMbid)) throw new Error('Catalogue recording references an uncounted release.');
        if (release.releaseGroupMbid != null && !inventoryLib.validMbid(release.releaseGroupMbid)) throw new Error('Invalid catalogue release-group identity.');
      }
    }
  }
  return cache;
}

function mergeCataloguePage(cache, page) {
  const base = clone(validateCatalogueCache(cache));
  if (!page || typeof page !== 'object' || Array.isArray(page)
    || page.schemaVersion !== CATALOGUE_PAGE_SCHEMA_VERSION || page.sourceEntity !== 'release'
    || !Array.isArray(page.recordings) || !Number.isInteger(page.releaseCount) || page.releaseCount < 0) throw new Error('Invalid catalogue page.');
  const checkpoint = normalizeCatalogueCheckpoint(page);
  const pageReleaseMbids = normalizedMbidList(page.releaseMbids);
  if (!Number.isInteger(page.offset) || page.offset < 0
    || page.offset + page.releaseCount !== checkpoint.nextOffset
    || pageReleaseMbids.length !== page.releaseCount) throw new Error('Invalid catalogue page offset.');
  const pageReleaseSet = new Set(pageReleaseMbids);
  for (const recording of page.recordings) {
    for (const release of recording?.releases || []) {
      if (!pageReleaseSet.has(inventoryLib.validMbid(release?.releaseMbid))) throw new Error('Catalogue page recording references an uncounted release.');
    }
  }

  const existing = base.artists[checkpoint.artistMbid];
  if (existing && !['nextOffset', 'totalCount', 'complete'].every((field) => Object.prototype.hasOwnProperty.call(existing, field))) {
    throw new Error('Cannot paginate a checkpoint-less catalogue snapshot.');
  }
  const expectedOffset = existing?.nextOffset ?? 0;
  if (page.offset !== expectedOffset) throw new Error('Catalogue page is not sequential.');
  if (existing?.totalCount != null && existing.totalCount !== checkpoint.totalCount) throw new Error('Catalogue total count changed during pagination.');
  const existingReleaseMbids = existing ? normalizedMbidList(existing.releaseMbids) : [];
  const existingReleaseSet = new Set(existingReleaseMbids);
  if (pageReleaseMbids.some((mbid) => existingReleaseSet.has(mbid))) throw new Error('Catalogue release repeated across pages.');
  const combinedReleaseMbids = [...existingReleaseMbids, ...pageReleaseMbids];
  if (combinedReleaseMbids.length !== checkpoint.nextOffset) throw new Error('Invalid catalogue release coverage.');

  const byRecording = new Map((existing?.recordings || []).map((recording) => [recording.recordingMbid, clone(recording)]));
  for (const recording of page.recordings) {
    byRecording.set(recording.recordingMbid, mergeRecordingRows(byRecording.get(recording.recordingMbid), recording));
  }
  base.artists[checkpoint.artistMbid] = {
    ...(existing || {}),
    artistMbid: checkpoint.artistMbid,
    sourceEntity: 'release',
    releaseMbids: combinedReleaseMbids,
    recordings: [...byRecording.values()].sort((a, b) => a.recordingMbid.localeCompare(b.recordingMbid)),
    nextOffset: checkpoint.nextOffset,
    totalCount: checkpoint.totalCount,
    complete: checkpoint.complete,
  };
  validateCatalogueCache(base);
  return base;
}

function validateEvidenceDocument(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || evidence.schemaVersion !== 1 || !Array.isArray(evidence.items)) throw new Error('Invalid catalogue evidence.');
  const seen = new Set();
  for (const item of evidence.items) {
    const trackKey = typeof item?.trackKey === 'string' ? clean(item.trackKey) : null;
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !trackKey || item.trackKey !== trackKey || !EVIDENCE_TIERS.has(item.evidenceTier)) {
      throw new Error('Invalid catalogue evidence item.');
    }
    if (seen.has(trackKey)) throw new Error('Duplicate catalogue evidence item.');
    seen.add(trackKey);
  }
  return evidence;
}

function validateLocalResults(localResults) {
  if (!localResults || typeof localResults !== 'object' || Array.isArray(localResults)
    || localResults.schemaVersion !== 1 || !Array.isArray(localResults.results)) throw new Error('Invalid catalogue resolution results.');
  const seen = new Set();
  for (const result of localResults.results) {
    const trackKey = typeof result?.trackKey === 'string' ? clean(result.trackKey) : null;
    if (!result || typeof result !== 'object' || Array.isArray(result) || !trackKey || result.trackKey !== trackKey
      || !EVIDENCE_TIERS.has(result.evidenceTier) || !LOCAL_RESULT_STATUSES.has(result.status)) {
      throw new Error('Invalid catalogue resolution result.');
    }
    if (seen.has(trackKey)) throw new Error('Duplicate catalogue resolution result.');
    seen.add(trackKey);
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
  if (expectedMbid) return inventoryLib.validMbid(release?.releaseMbid) === expectedMbid;
  return item.normalizedReleaseTitle
    ? inventoryLib.normalizeText(release?.title) === item.normalizedReleaseTitle
    : false;
}

function uniqueRecording(candidates) {
  const byMbid = new Map();
  for (const candidate of candidates) byMbid.set(inventoryLib.validMbid(candidate.recordingMbid), candidate);
  byMbid.delete(null);
  return byMbid.size === 1 ? [...byMbid.values()][0] : null;
}

function catalogueSnapshotComplete(artistCatalogue) {
  if (!artistCatalogue || !hasAuthoritativeCoverage(artistCatalogue)
    || artistCatalogue.sourceEntity !== 'release' || artistCatalogue.complete !== true
    || !Number.isInteger(artistCatalogue.nextOffset) || !Number.isInteger(artistCatalogue.totalCount)
    || artistCatalogue.nextOffset !== artistCatalogue.totalCount || !Array.isArray(artistCatalogue.releaseMbids)) return false;
  try {
    return normalizedMbidList(artistCatalogue.releaseMbids).length === artistCatalogue.totalCount;
  } catch {
    return false;
  }
}

function resolveFromValidatedCatalogue(item, cache) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { status: 'exception', reason: 'invalid_evidence_item' };
  if (item.routingHoldReason) return { status: 'exception', reason: item.routingHoldReason };
  if (item.evidenceTier === 'A') {
    return item.status === 'complete' && COMPLETE_INVENTORY_REASONS.has(item.reason)
      ? { status: 'complete', reason: 'already_complete' }
      : { status: 'exception', reason: 'invalid_tier_a_evidence' };
  }
  if (!['B', 'C'].includes(item.evidenceTier)) return { status: 'exception', reason: 'not_catalogue_eligible' };
  const artistMbid = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
  const normalizedTrack = inventoryLib.normalizeText(item.recordingLookupName || item.normalizedRecordingTitle);
  if (!artistMbid || !normalizedTrack) return { status: 'exception', reason: 'invalid_catalogue_evidence' };
  if (item.evidenceTier === 'B' && !item.normalizedReleaseTitle
    && !inventoryLib.validMbid(item.sourceMusicbrainzReleaseMbid)) return { status: 'exception', reason: 'invalid_tier_b_release_evidence' };

  const artistCatalogue = cache.artists[artistMbid];
  if (!artistCatalogue) return { status: 'unresolved', reason: 'catalogue_missing' };
  if (!catalogueSnapshotComplete(artistCatalogue)) return { status: 'unresolved', reason: 'catalogue_incomplete' };
  const titleCandidates = candidateRecordings(item, artistCatalogue);
  if (!titleCandidates.length) return { status: 'unresolved', reason: 'catalogue_no_match' };

  let candidates = titleCandidates;
  let evidence = 'catalogue_unique_recording_title';
  if (item.evidenceTier === 'B') {
    candidates = titleCandidates.filter((recording) => (recording.releases || []).some((release) => releaseMatchesEvidence(release, item)));
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

function resolveFromCatalogue(item, cache) {
  return resolveFromValidatedCatalogue(item, validateCatalogueCache(cache));
}

function resolveCatalogueEvidence({ evidence, catalogueCache } = {}) {
  validateEvidenceDocument(evidence);
  const cache = validateCatalogueCache(catalogueCache);
  const results = [];
  const counts = { alreadyComplete: 0, resolved: 0, unresolved: 0, ambiguous: 0, exceptions: 0 };
  for (const item of evidence.items) {
    const outcome = resolveFromValidatedCatalogue(item, cache);
    results.push({ trackKey: item.trackKey, evidenceTier: item.evidenceTier, ...outcome });
    if (outcome.status === 'complete') counts.alreadyComplete += 1;
    else if (outcome.status === 'resolved') counts.resolved += 1;
    else if (outcome.status === 'ambiguous') counts.ambiguous += 1;
    else if (outcome.status === 'exception') counts.exceptions += 1;
    else counts.unresolved += 1;
  }
  return { schemaVersion: 1, counts, results };
}

function localResultsMatchCurrent(supplied, current) {
  if (supplied.results.length !== current.results.length) return false;
  const currentByKey = new Map(current.results.map((result) => [result.trackKey, result]));
  for (const result of supplied.results) {
    const expected = currentByKey.get(result.trackKey);
    if (!expected || result.evidenceTier !== expected.evidenceTier
      || result.status !== expected.status || result.reason !== expected.reason
      || clean(result.musicbrainzRecordingMbid) !== clean(expected.musicbrainzRecordingMbid)
      || clean(result.musicbrainzArtistMbid) !== clean(expected.musicbrainzArtistMbid)) return false;
  }
  return true;
}

function planListenBrainzBatchBridge({ evidence, catalogueCache, localResults, maxItems = 25 } = {}) {
  validateEvidenceDocument(evidence);
  const currentLocalResults = resolveCatalogueEvidence({ evidence, catalogueCache });
  if (localResults != null) {
    validateLocalResults(localResults);
    if (!localResultsMatchCurrent(localResults, currentLocalResults)) throw new Error('Stale catalogue resolution results.');
  }
  const authoritativeResults = localResults || currentLocalResults;
  if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error('Invalid batch size.');
  const limit = Math.min(MAX_BATCH_SIZE, maxItems);
  const resultByKey = new Map(authoritativeResults.results.map((result) => [result.trackKey, result]));
  const items = [];
  const skipped = { complete: 0, resolvedLocally: 0, ambiguous: 0, notUnresolvedLocally: 0, ineligible: 0, overflow: 0 };

  for (const item of evidence.items) {
    const local = resultByKey.get(item.trackKey);
    if (item.evidenceTier === 'A') { skipped.complete += 1; continue; }
    if (!local || local.evidenceTier !== item.evidenceTier) { skipped.notUnresolvedLocally += 1; continue; }
    if (local.status === 'resolved') { skipped.resolvedLocally += 1; continue; }
    if (local.status === 'ambiguous') { skipped.ambiguous += 1; continue; }
    if (local.status !== 'unresolved' || !BRIDGE_UNRESOLVED_REASONS.has(local.reason)) { skipped.notUnresolvedLocally += 1; continue; }
    if (!['B', 'C'].includes(item.evidenceTier)
      || item.routingHoldReason
      || !inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid)
      || !clean(item.artistLookupName)
      || !clean(item.recordingLookupName)) { skipped.ineligible += 1; continue; }
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
  CATALOGUE_PAGE_SCHEMA_VERSION,
  MAX_BATCH_SIZE,
  HELD_IDENTITY_STATUSES,
  HELD_PROVIDER_STATUSES,
  KNOWN_PROVIDERS,
  LOCAL_RESULT_STATUSES,
  EVIDENCE_TIERS,
  BRIDGE_UNRESOLVED_REASONS,
  COMPLETE_INVENTORY_REASONS,
  CATALOGUE_COVERAGE_SCOPES,
  releaseText,
  sourceReleaseMbids,
  sourceReleaseEvidenceMalformed,
  spotifyTrackUrlFromId,
  normalizedCoverageScopes,
  hasAuthoritativeCoverage,
  durableRoutingState,
  buildCatalogueEvidence,
  normalizeCatalogueCheckpoint,
  normalizeMusicBrainzRelease,
  normalizeMusicBrainzArtistCredits,
  normalizeMusicBrainzRecording,
  recordingsFromMusicBrainzRelease,
  parseMusicBrainzCataloguePage,
  validateCatalogueCache,
  mergeRecordingRows,
  mergeCataloguePage,
  validateEvidenceDocument,
  validateLocalResults,
  candidateRecordings,
  releaseMatchesEvidence,
  catalogueSnapshotComplete,
  resolveFromCatalogue,
  resolveCatalogueEvidence,
  localResultsMatchCurrent,
  planListenBrainzBatchBridge,
  safeResolverDiagnostics,
};
