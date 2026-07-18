'use strict';

// Shared, dependency-free provider identity helpers.  The browser uses the
// global and Node tests/backfill scripts use module.exports, so coverage and
// conflict rules cannot drift apart.
(function (root) {
  const TRUSTED_MUSICBRAINZ_STATUSES = new Set(['confirmed', 'manual_confirmed', 'auto_confirmed']);
  const TRUSTED_PROVIDER_STATUSES = new Set(['confirmed', 'manual_confirmed']);
  const PROVIDERS = ['musicbrainz', 'ticketmaster', 'spotify'];

  function providerRecord(band, provider) {
    return provider === 'musicbrainz' ? band?.musicbrainz : band?.musicbrainz?.[provider];
  }

  function isConfirmed(record, provider = 'ticketmaster') {
    if (!record?.id && !(provider === 'musicbrainz' && record?.mbid)) return false;
    const id = provider === 'musicbrainz' ? record.mbid : record.id;
    const allowed = provider === 'musicbrainz' ? TRUSTED_MUSICBRAINZ_STATUSES : TRUSTED_PROVIDER_STATUSES;
    return Boolean(id && allowed.has(record.status));
  }

  function providerId(record, provider) {
    return provider === 'musicbrainz' ? record?.mbid || null : record?.id || null;
  }

  function duplicateAssignments(bands, provider) {
    const byId = new Map();
    for (const band of bands || []) {
      const record = providerRecord(band, provider);
      if (!isConfirmed(record, provider)) continue;
      const id = providerId(record, provider);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(band.id);
    }
    return [...byId.entries()].filter(([, bandIds]) => bandIds.length > 1)
      .map(([id, bandIds]) => ({ provider, id, bandIds: [...bandIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function duplicateBandIds(bands, provider) {
    return new Set(duplicateAssignments(bands, provider).flatMap((conflict) => conflict.bandIds));
  }

  function retryInfo(record, now = new Date()) {
    const value = record?.nextEligibleCheckAt || null;
    const timestamp = value ? Date.parse(value) : NaN;
    return {
      nextEligibleCheckAt: Number.isFinite(timestamp) ? value : null,
      retryScheduled: Number.isFinite(timestamp) && timestamp > now.getTime(),
      retryEligibleNow: !Number.isFinite(timestamp) || timestamp <= now.getTime(),
    };
  }

  function providerRetrySummary(records, now = new Date()) {
    const futureRetries = [];
    let eligibleNow = false;
    for (const { provider, record } of records || []) {
      if (!record || isConfirmed(record, provider) || ['confirmed', 'manual_confirmed', 'manual_rejected'].includes(record.status)) continue;
      const retry = retryInfo(record, now);
      if (retry.retryScheduled) futureRetries.push(retry.nextEligibleCheckAt);
      else if (retry.nextEligibleCheckAt && ['unresolved', 'needs_review', 'no_match', 'error', 'unavailable'].includes(record.status)) eligibleNow = true;
    }
    futureRetries.sort();
    return { nextRetryAt: futureRetries[0] || null, eligibleNow };
  }

  function statusForRecord(record, provider, isDuplicate, now = new Date()) {
    if (isDuplicate) return 'duplicate_conflict';
    if (isConfirmed(record, provider)) return 'confirmed';
    if (!record?.status) return 'unchecked';
    if (record.status === 'unresolved') return 'needs_review';
    return record.status;
  }

  function providerCoverage(bands, provider, now = new Date()) {
    const rows = bands || [];
    const duplicateIds = duplicateBandIds(rows, provider);
    const counts = { confirmed: 0, needs_review: 0, no_match: 0, error: 0, unavailable: 0, manual_rejected: 0, unchecked: 0, duplicate_conflict: 0 };
    const issues = [];
    let retryScheduledCount = 0;
    for (const band of rows) {
      const record = providerRecord(band, provider);
      const status = statusForRecord(record, provider, duplicateIds.has(band.id), now);
      const retry = retryInfo(record, now);
      if (!(status in counts)) counts[status] = 0;
      counts[status] += 1;
      if (retry.retryScheduled) retryScheduledCount += 1;
      if (status !== 'confirmed') issues.push({
        bandId: band.id,
        bandName: band.name || band.id,
        provider,
        status,
        candidateName: record?.artistName || record?.attractionName || null,
        errorCategory: record?.errorCategory || null,
        nextEligibleCheckAt: retry.nextEligibleCheckAt,
        retryScheduled: retry.retryScheduled,
        retryEligibleNow: retry.retryEligibleNow,
        reviewCandidates: Array.isArray(record?.reviewCandidates) ? record.reviewCandidates.slice(0, 5) : [],
      });
    }
    return {
      provider,
      total: rows.length,
      confirmed: counts.confirmed,
      healthyConfirmed: counts.confirmed,
      coveragePercent: rows.length ? Math.round((counts.confirmed / rows.length) * 100) : 0,
      issueCount: rows.length - counts.confirmed,
      counts,
      retryScheduledCount,
      duplicateConflicts: duplicateAssignments(rows, provider),
      issues,
    };
  }

  function identityCoverage(bands, now = new Date()) {
    const musicbrainz = providerCoverage(bands, 'musicbrainz', now);
    const ticketmaster = providerCoverage(bands, 'ticketmaster', now);
    const spotify = providerCoverage(bands, 'spotify', now);
    return { total: (bands || []).length, musicbrainz, setlistfm: { ...musicbrainz, provider: 'setlistfm', linkedThroughMusicbrainz: true }, ticketmaster, spotify };
  }

  function trustedMusicbrainzBand(band) { return isConfirmed(providerRecord(band, 'musicbrainz'), 'musicbrainz'); }
  function providerBackfillEligible(band, provider, now = new Date()) {
    if (!trustedMusicbrainzBand(band)) return false;
    const record = providerRecord(band, provider);
    if (isConfirmed(record, provider) || record?.status === 'manual_rejected') return false;
    return retryInfo(record, now).retryEligibleNow;
  }

  const api = { PROVIDERS, TRUSTED_MUSICBRAINZ_STATUSES, TRUSTED_PROVIDER_STATUSES, providerRecord, providerId, isConfirmed, trustedMusicbrainzBand, providerBackfillEligible, duplicateAssignments, duplicateBandIds, retryInfo, providerRetrySummary, statusForRecord, providerCoverage, identityCoverage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProviderIdentityState = api;
})(typeof window !== 'undefined' ? window : globalThis);
