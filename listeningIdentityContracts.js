'use strict';

(function attachListeningIdentityContracts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CONTRACT_VERSION = 1;
  const TIMESTAMP_TOLERANCE_MS = 1000;
  const DURATION_TOLERANCE_MS = 2000;
  const DEFAULT_CHUNK_SIZE = 1000;
  const AUDIT_SOURCE_BUCKETS = Object.freeze(['spotify_import', 'listenbrainz']);

  const IDENTITY_STATUSES = Object.freeze([
    'unresolved', 'resolved', 'ambiguous', 'unmatched', 'user_reviewed',
  ]);
  const DEDUPE_STATUSES = Object.freeze([
    'unique', 'exact_duplicate', 'probable_duplicate', 'ambiguous', 'user_reviewed',
  ]);

  function clean(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function cleanList(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function nonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
  }

  function optionalNonNegativeInteger(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function identityEnvelope(event = {}) {
    const artistMbids = cleanList(event.artistMbids || event.musicbrainzArtistIds);
    const artistMbid = clean(event.artistMbid || event.musicbrainzArtistId) || artistMbids[0] || null;
    return {
      version: CONTRACT_VERSION,
      bandId: clean(event.bandId || event.localBandId),
      artistMbid,
      artistMbids,
      recordingMbid: clean(event.recordingMbid || event.musicbrainzRecordingId),
      releaseMbid: clean(event.releaseMbid || event.musicbrainzReleaseId),
      releaseGroupMbid: clean(event.releaseGroupMbid || event.musicbrainzReleaseGroupId),
      spotifyTrackId: clean(event.spotifyTrackId),
      spotifyAlbumId: clean(event.spotifyAlbumId),
      source: clean(event.source),
      sourceEventId: clean(event.sourceEventId || event.stableListenId),
      status: IDENTITY_STATUSES.includes(event.identityStatus) ? event.identityStatus : 'unresolved',
      evidence: Array.isArray(event.identityEvidence) ? [...event.identityEvidence] : [],
      reviewedDecision: event.reviewedDecision || null,
      reviewedAt: clean(event.reviewedAt),
    };
  }

  function canonicalEnvelope(event = {}) {
    return {
      version: CONTRACT_VERSION,
      canonicalListenId: clean(event.canonicalListenId || event.stableListenId),
      duplicateOf: clean(event.duplicateOf),
      status: DEDUPE_STATUSES.includes(event.dedupeStatus) ? event.dedupeStatus : 'unique',
      method: clean(event.dedupeMethod),
      evidenceTier: Number.isInteger(event.dedupeEvidenceTier) ? event.dedupeEvidenceTier : null,
      reviewedDecision: event.reviewedDecision || null,
      reviewedAt: clean(event.reviewedAt),
      source: clean(event.source),
      sourceEventId: clean(event.sourceEventId || event.stableListenId),
    };
  }

  function timestampDistanceMs(left, right) {
    const a = Date.parse(left?.listenedAt || '');
    const b = Date.parse(right?.listenedAt || '');
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) : Infinity;
  }

  function durationsCompatible(left, right) {
    const a = Number(left?.listenedDurationMs);
    const b = Number(right?.listenedDurationMs);
    if (!(a > 0) || !(b > 0)) return true;
    return Math.abs(a - b) <= DURATION_TOLERANCE_MS;
  }

  function knownDurationsCompatible(left, right) {
    const a = Number(left?.listenedDurationMs);
    const b = Number(right?.listenedDurationMs);
    return a > 0 && b > 0 && Math.abs(a - b) <= DURATION_TOLERANCE_MS;
  }

  function normalizedSignatureMatches(left, right) {
    const leftArtist = normalizeText(left?.artistCreditName);
    const rightArtist = normalizeText(right?.artistCreditName);
    const leftTrack = normalizeText(left?.recordingTitle);
    const rightTrack = normalizeText(right?.recordingTitle);
    return Boolean(leftArtist && rightArtist && leftTrack && rightTrack
      && leftArtist === rightArtist && leftTrack === rightTrack);
  }

  function matchingEvidence(left = {}, right = {}) {
    if (left.reviewedDecision || right.reviewedDecision) {
      return { tier: null, outcome: 'user_reviewed', method: 'manual', automatic: false };
    }
    const sameSource = clean(left.source) && clean(left.source) === clean(right.source);
    const leftSourceId = clean(left.sourceEventId || left.stableListenId);
    const rightSourceId = clean(right.sourceEventId || right.stableListenId);
    if (sameSource && leftSourceId && leftSourceId === rightSourceId) {
      return { tier: 1, outcome: 'exact_duplicate', method: 'provider_id', automatic: true };
    }

    const timeCompatible = timestampDistanceMs(left, right) <= TIMESTAMP_TOLERANCE_MS;
    if (!timeCompatible) return { tier: null, outcome: 'unique', method: null, automatic: false };

    const recordingA = clean(left.recordingMbid || left.musicbrainzRecordingId);
    const recordingB = clean(right.recordingMbid || right.musicbrainzRecordingId);
    if (recordingA && recordingA === recordingB) {
      return { tier: 2, outcome: 'exact_duplicate', method: 'recording_id', automatic: true };
    }

    const spotifyA = clean(left.spotifyTrackId);
    const spotifyB = clean(right.spotifyTrackId);
    if (spotifyA && spotifyA === spotifyB) {
      return { tier: 3, outcome: 'exact_duplicate', method: 'spotify_id', automatic: true };
    }

    const releaseA = clean(left.releaseMbid || left.musicbrainzReleaseId);
    const releaseB = clean(right.releaseMbid || right.musicbrainzReleaseId);
    if (releaseA && releaseA === releaseB && knownDurationsCompatible(left, right)) {
      return { tier: 4, outcome: 'probable_duplicate', method: 'trusted_release_duration', automatic: false };
    }

    if (normalizedSignatureMatches(left, right)) {
      return { tier: 5, outcome: 'ambiguous', method: 'normalized_signature', automatic: false };
    }
    return { tier: null, outcome: 'unique', method: null, automatic: false };
  }

  function safeAuditSource(value) {
    const source = clean(value);
    return AUDIT_SOURCE_BUCKETS.includes(source) ? source : 'other';
  }

  function safeAuditSummary(events = []) {
    const result = {
      schemaVersion: CONTRACT_VERSION,
      eventCount: 0,
      sourceCounts: {},
      stableIdCount: 0,
      spotifyTrackIdCount: 0,
      recordingMbidCount: 0,
      releaseMbidCount: 0,
      releaseGroupMbidCount: 0,
      artistMbidEventCount: 0,
      reviewedDecisionCount: 0,
      firstDateCategory: null,
      lastDateCategory: null,
    };
    let first = Infinity;
    let last = -Infinity;
    for (const event of events) {
      result.eventCount += 1;
      const source = safeAuditSource(event?.source);
      result.sourceCounts[source] = (result.sourceCounts[source] || 0) + 1;
      if (clean(event?.stableListenId)) result.stableIdCount += 1;
      if (clean(event?.spotifyTrackId)) result.spotifyTrackIdCount += 1;
      if (clean(event?.recordingMbid || event?.musicbrainzRecordingId)) result.recordingMbidCount += 1;
      if (clean(event?.releaseMbid || event?.musicbrainzReleaseId)) result.releaseMbidCount += 1;
      if (clean(event?.releaseGroupMbid || event?.musicbrainzReleaseGroupId)) result.releaseGroupMbidCount += 1;
      if (cleanList(event?.artistMbids || event?.musicbrainzArtistIds).length || clean(event?.artistMbid || event?.musicbrainzArtistId)) {
        result.artistMbidEventCount += 1;
      }
      if (event?.reviewedDecision) result.reviewedDecisionCount += 1;
      const timestamp = Date.parse(event?.listenedAt || '');
      if (Number.isFinite(timestamp)) { first = Math.min(first, timestamp); last = Math.max(last, timestamp); }
    }
    const category = (value) => Number.isFinite(value) ? new Date(value).toISOString().slice(0, 7) : null;
    result.firstDateCategory = category(first);
    result.lastDateCategory = category(last);
    return result;
  }

  function safeCandidateSummary(pairs = []) {
    const result = {
      schemaVersion: CONTRACT_VERSION,
      pairCount: 0,
      byTier: { level1: 0, level2: 0, level3: 0, level4: 0, level5: 0, level6: 0, none: 0 },
      automaticCount: 0,
      ambiguousCount: 0,
      probableCount: 0,
      reviewedCount: 0,
    };
    for (const pair of pairs) {
      const evidence = matchingEvidence(pair?.left, pair?.right);
      result.pairCount += 1;
      const key = Number.isInteger(evidence.tier) && evidence.tier >= 1 && evidence.tier <= 6
        ? `level${evidence.tier}` : 'none';
      result.byTier[key] += 1;
      if (evidence.automatic) result.automaticCount += 1;
      if (evidence.outcome === 'ambiguous') result.ambiguousCount += 1;
      if (evidence.outcome === 'probable_duplicate') result.probableCount += 1;
      if (evidence.outcome === 'user_reviewed') result.reviewedCount += 1;
    }
    return result;
  }

  function createMigrationCheckpoint(options = {}) {
    const totalEvents = nonNegativeInteger(options.totalEvents);
    const requestedChunkSize = nonNegativeInteger(options.chunkSize, DEFAULT_CHUNK_SIZE);
    const chunkSize = Math.max(1, requestedChunkSize || DEFAULT_CHUNK_SIZE);
    const cursor = Math.min(totalEvents, nonNegativeInteger(options.cursor));
    return {
      schemaVersion: CONTRACT_VERSION,
      migrationVersion: CONTRACT_VERSION,
      status: cursor >= totalEvents ? 'complete' : 'pending',
      cursor,
      totalEvents,
      chunkSize,
      processedEvents: cursor,
      sourceEventCountBefore: optionalNonNegativeInteger(options.sourceEventCountBefore),
      sourceEventCountAfter: optionalNonNegativeInteger(options.sourceEventCountAfter),
      reviewedDecisionCount: nonNegativeInteger(options.reviewedDecisionCount),
      integrityStatus: clean(options.integrityStatus) || 'not_checked',
    };
  }

  function nextMigrationChunk(checkpoint = {}) {
    const normalized = createMigrationCheckpoint(checkpoint);
    const start = normalized.cursor;
    const end = Math.min(normalized.totalEvents, start + normalized.chunkSize);
    return {
      start,
      end,
      count: Math.max(0, end - start),
      done: start >= normalized.totalEvents,
      checkpoint: {
        ...normalized,
        cursor: end,
        processedEvents: end,
        status: end >= normalized.totalEvents ? 'complete' : 'pending',
      },
    };
  }

  function verifyMigrationIntegrity(checkpoint = {}) {
    const normalized = createMigrationCheckpoint(checkpoint);
    const sourceCountsPresent = normalized.sourceEventCountBefore !== null
      && normalized.sourceEventCountAfter !== null;
    const sourceCountsMatch = sourceCountsPresent
      && normalized.sourceEventCountBefore === normalized.sourceEventCountAfter;
    const cursorValid = normalized.cursor >= 0 && normalized.cursor <= normalized.totalEvents;
    const complete = normalized.status === 'complete' && normalized.cursor === normalized.totalEvents;
    return {
      ok: sourceCountsPresent && sourceCountsMatch && cursorValid,
      complete,
      sourceCountsPresent,
      sourceCountsMatch,
      cursorValid,
      rollbackSafe: sourceCountsPresent && sourceCountsMatch,
    };
  }

  return {
    CONTRACT_VERSION,
    TIMESTAMP_TOLERANCE_MS,
    DURATION_TOLERANCE_MS,
    DEFAULT_CHUNK_SIZE,
    AUDIT_SOURCE_BUCKETS,
    IDENTITY_STATUSES,
    DEDUPE_STATUSES,
    identityEnvelope,
    canonicalEnvelope,
    timestampDistanceMs,
    durationsCompatible,
    knownDurationsCompatible,
    normalizedSignatureMatches,
    matchingEvidence,
    safeAuditSource,
    safeAuditSummary,
    safeCandidateSummary,
    createMigrationCheckpoint,
    nextMigrationChunk,
    verifyMigrationIntegrity,
  };
});
