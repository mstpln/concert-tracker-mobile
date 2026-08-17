'use strict';

// Provider-neutral album-artwork evidence. This module performs no network or
// storage access. A MusicBrainz release identity is enough to address CAA, but
// it is NOT proof that a front image exists. Only explicit ListenBrainz CAA
// evidence may suppress Spotify fallback without a network verification step.
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAA_ID = /^[A-Za-z0-9_-]{1,128}$/;

function validMbid(value) {
  const text = String(value || '').trim().toLowerCase();
  return MBID.test(text) ? text : null;
}

function exactReleaseMbid(value = {}) {
  const candidates = [value.releaseMbid, value.musicbrainzReleaseId, value.musicbrainzReleaseMbid, value.listenbrainzCaaReleaseMbid]
    .map(validMbid).filter(Boolean);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

function coverArtArchiveUrl(value = {}, { size = 500 } = {}) {
  const releaseMbid = exactReleaseMbid(value);
  if (!releaseMbid) return null;
  const suffix = [250, 500, 1200].includes(Number(size)) ? `-${Number(size)}` : '';
  return `https://coverartarchive.org/release/${releaseMbid}/front${suffix}`;
}

function hasExplicitCaaEvidence(value = {}) {
  const caaReleaseMbid = validMbid(value.listenbrainzCaaReleaseMbid);
  const caaId = String(value.listenbrainzCaaId || '').trim();
  return !!(caaReleaseMbid && CAA_ID.test(caaId));
}

function artworkEvidence(value = {}) {
  if (!hasExplicitCaaEvidence(value)) return null;
  const releaseMbid = exactReleaseMbid(value);
  const artworkUrl = coverArtArchiveUrl(value);
  return releaseMbid && artworkUrl ? { provider: 'cover-art-archive', releaseMbid, artworkUrl, verifiedBy: 'listenbrainz-caa' } : null;
}

function groupArtworkEvidence(events = []) {
  const rows = (events || []).map(artworkEvidence).filter(Boolean);
  const releaseIds = [...new Set(rows.map((row) => row.releaseMbid))];
  if (releaseIds.length !== 1) return null;
  return rows.find((row) => row.releaseMbid === releaseIds[0]) || null;
}

module.exports = { validMbid, exactReleaseMbid, coverArtArchiveUrl, hasExplicitCaaEvidence, artworkEvidence, groupArtworkEvidence };
