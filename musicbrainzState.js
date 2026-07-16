'use strict';

// Shared, pure state transitions for the Settings review actions. Kept free
// of storage/UI concerns so the browser and focused tests use identical rules.
(function (root) {
  function retainedMetadata(previous) {
    return {
      source: previous.source || 'MusicBrainz',
      lastAttemptedAt: previous.lastAttemptedAt || null,
      rejectedCandidateMbids: [...new Set(previous.rejectedCandidateMbids || [])],
    };
  }

  function clearedIdentity(previous, changes) {
    return {
      mbid: null, artistName: null, area: null, country: null, artistType: null, disambiguation: null,
      confidence: null, matchMethod: null, matchedAt: null,
      ...retainedMetadata(previous),
      ...changes,
    };
  }

  function confirmedIdentity(candidate, previous, now = new Date().toISOString()) {
    return {
      ...retainedMetadata(previous),
      mbid: candidate.mbid,
      artistName: candidate.artistName,
      area: candidate.area || null,
      country: candidate.country || null,
      artistType: candidate.artistType || null,
      disambiguation: candidate.disambiguation || null,
      confidence: candidate.score,
      status: 'manual_confirmed',
      matchMethod: 'manual_review',
      source: 'MusicBrainz',
      matchedAt: now,
      reviewedAt: now,
      reviewCandidates: [],
    };
  }

  function rejectCandidates(previous, now = new Date().toISOString()) {
    const rejectedCandidateMbids = [...new Set([...(previous.rejectedCandidateMbids || []), ...(previous.reviewCandidates || []).map((c) => c.mbid).filter(Boolean)])];
    return clearedIdentity(previous, { status: 'manual_rejected', reviewedAt: now, rejectedCandidateMbids, reviewCandidates: [] });
  }

  function retryIdentity(previous, now = new Date().toISOString()) {
    return clearedIdentity(previous, { status: 'pending', reviewedAt: now, reviewCandidates: [] });
  }

  const api = { confirmedIdentity, rejectCandidates, retryIdentity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MusicbrainzState = api;
})(typeof window !== 'undefined' ? window : globalThis);
