'use strict';

(function attachListeningIdentityContracts(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityContracts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CONTRACT_VERSION = 1;
  const TIMESTAMP_TOLERANCE_MS = 1000;
  const DURATION_TOLERANCE_MS = 2000;

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

  function identityEnvelope(event = {}) {
    return {
      version: CONTRACT_VERSION,
      bandId: clean(event.localBandId || event.bandId),
      artistMbid: clean(event.artistMbid || event.musicbrainzArtistId),
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

    const trustedRelease = clean(left.releaseMbid || left.musicbrainzReleaseId)
      && clean(left.releaseMbid || left.musicbrainzReleaseId) === clean(right.releaseMbid || right.musicbrainzReleaseId);
    if (trustedRelease && durationsCompatible(left, right)) {
      return { tier: 4, outcome: 'probable_duplicate', method: 'trusted_release_duration', automatic: false };
    }

    return { tier: 5, outcome: 'ambiguous', method: 'normalized_signature', automatic: false };
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
      artistMbidEventCount: 0,
      firstDateCategory: null,
      lastDateCategory: null,
    };
    let first = Infinity;
    let last = -Infinity;
    for (const event of events) {
      result.eventCount += 1;
      const source = clean(event?.source) || 'unknown';
      result.sourceCounts[source] = (result.sourceCounts[source] || 0) + 1;
      if (clean(event?.stableListenId)) result.stableIdCount += 1;
      if (clean(event?.spotifyTrackId)) result.spotifyTrackIdCount += 1;
      if (clean(event?.recordingMbid || event?.musicbrainzRecordingId)) result.recordingMbidCount += 1;
      if (clean(event?.releaseMbid || event?.musicbrainzReleaseId)) result.releaseMbidCount += 1;
      if (Array.isArray(event?.musicbrainzArtistIds) && event.musicbrainzArtistIds.length) result.artistMbidEventCount += 1;
      const timestamp = Date.parse(event?.listenedAt || '');
      if (Number.isFinite(timestamp)) { first = Math.min(first, timestamp); last = Math.max(last, timestamp); }
    }
    const category = (value) => Number.isFinite(value) ? new Date(value).toISOString().slice(0, 7) : null;
    result.firstDateCategory = category(first);
    result.lastDateCategory = category(last);
    return result;
  }

  return {
    CONTRACT_VERSION,
    TIMESTAMP_TOLERANCE_MS,
    DURATION_TOLERANCE_MS,
    IDENTITY_STATUSES,
    DEDUPE_STATUSES,
    identityEnvelope,
    canonicalEnvelope,
    timestampDistanceMs,
    durationsCompatible,
    matchingEvidence,
    safeAuditSummary,
  };
});
