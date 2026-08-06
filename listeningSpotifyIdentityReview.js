'use strict';

(function (root) {
  const PERIODS = Object.freeze({
    twoWeeks: 14 * 24 * 60 * 60 * 1000,
    threeMonths: 92 * 24 * 60 * 60 * 1000,
    oneYear: 365 * 24 * 60 * 60 * 1000,
  });

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function eventTimestamp(event) {
    const value = event?.playedAt ?? event?.timestamp ?? event?.ts ?? event?.endTime ?? null;
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  function eventArtistName(event) {
    return event?.artistName || event?.artist || event?.masterMetadataAlbumArtistName || event?.trackMetadata?.artist_name || '';
  }

  function isSpotifyEvent(event) {
    return event?.source === 'spotify' || Boolean(event?.spotifyTrackId || event?.spotify_track_uri || event?.spotifyTrackUri);
  }

  function spotifyTrackId(event) {
    if (event?.spotifyTrackId) return event.spotifyTrackId;
    const uri = event?.spotify_track_uri || event?.spotifyTrackUri || '';
    const match = String(uri).match(/(?:spotify:track:|open\.spotify\.com\/track\/)([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  function buildUniqueNameIndex(bands) {
    const grouped = new Map();
    for (const band of bands || []) {
      const key = normalizeName(band?.name);
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(band.id);
    }
    const unique = new Map();
    for (const [key, ids] of grouped) if (ids.length === 1) unique.set(key, ids[0]);
    return unique;
  }

  function resolveBandId(event, byId, uniqueNames) {
    const explicit = event?.bandId || event?.localBandId || null;
    if (explicit && byId.has(explicit)) return explicit;
    return uniqueNames.get(normalizeName(eventArtistName(event))) || null;
  }

  function storedCandidates(record) {
    const seen = new Set();
    return (Array.isArray(record?.reviewCandidates) ? record.reviewCandidates : [])
      .filter((candidate) => candidate && candidate.id && !seen.has(candidate.id) && seen.add(candidate.id))
      .map((candidate) => ({ ...candidate }));
  }

  function auditSpotifyArtistIdentities(bands, events, options = {}) {
    const identityState = options.identityState || root.ProviderIdentityState;
    if (!identityState) throw new Error('ProviderIdentityState is required');
    const nowMs = options.now instanceof Date ? options.now.getTime() : Date.parse(options.now || new Date().toISOString());
    const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
    const rows = Array.isArray(bands) ? bands : [];
    const byId = new Map(rows.map((band) => [band.id, band]));
    const uniqueNames = buildUniqueNameIndex(rows);
    const coverage = identityState.providerCoverage(rows, 'spotify', new Date(safeNow));
    const issues = new Map(coverage.issues.map((issue) => [issue.bandId, issue]));
    const impact = new Map();

    for (const event of events || []) {
      const bandId = resolveBandId(event, byId, uniqueNames);
      if (!bandId || !issues.has(bandId)) continue;
      if (!impact.has(bandId)) impact.set(bandId, { allTime: 0, twoWeeks: 0, threeMonths: 0, oneYear: 0, spotify: 0, trackIds: new Set(), firstAt: null, lastAt: null });
      const value = impact.get(bandId);
      value.allTime += 1;
      const timestamp = eventTimestamp(event);
      if (timestamp !== null) {
        const age = safeNow - timestamp;
        if (age >= 0 && age <= PERIODS.twoWeeks) value.twoWeeks += 1;
        if (age >= 0 && age <= PERIODS.threeMonths) value.threeMonths += 1;
        if (age >= 0 && age <= PERIODS.oneYear) value.oneYear += 1;
        value.firstAt = value.firstAt === null ? timestamp : Math.min(value.firstAt, timestamp);
        value.lastAt = value.lastAt === null ? timestamp : Math.max(value.lastAt, timestamp);
      }
      if (isSpotifyEvent(event)) value.spotify += 1;
      const trackId = spotifyTrackId(event);
      if (trackId) value.trackIds.add(trackId);
    }

    return coverage.issues.map((issue) => {
      const band = byId.get(issue.bandId);
      const record = identityState.providerRecord(band, 'spotify') || {};
      const counts = impact.get(issue.bandId) || { allTime: 0, twoWeeks: 0, threeMonths: 0, oneYear: 0, spotify: 0, trackIds: new Set(), firstAt: null, lastAt: null };
      const candidates = storedCandidates(record);
      return {
        bandId: issue.bandId,
        bandName: issue.bandName,
        status: issue.status,
        duplicateConflict: issue.status === 'duplicate_conflict',
        candidates,
        actionState: candidates.length ? 'candidate_available' : 'candidate_acquisition_required',
        affectedListens: {
          allTime: counts.allTime,
          twoWeeks: counts.twoWeeks,
          threeMonths: counts.threeMonths,
          oneYear: counts.oneYear,
          spotify: counts.spotify,
        },
        distinctSpotifyTrackIds: counts.trackIds.size,
        firstAffectedAt: counts.firstAt === null ? null : new Date(counts.firstAt).toISOString(),
        lastAffectedAt: counts.lastAt === null ? null : new Date(counts.lastAt).toISOString(),
      };
    }).sort((a, b) => b.affectedListens.allTime - a.affectedListens.allTime
      || normalizeName(a.bandName).localeCompare(normalizeName(b.bandName))
      || String(a.bandId).localeCompare(String(b.bandId)));
  }

  const api = { PERIODS, normalizeName, eventTimestamp, eventArtistName, spotifyTrackId, auditSpotifyArtistIdentities };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ListeningSpotifyIdentityReview = api;
})(typeof window !== 'undefined' ? window : globalThis);
