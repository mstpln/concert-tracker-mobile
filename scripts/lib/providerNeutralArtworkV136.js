'use strict';

// Provider-neutral album-artwork evidence. This module performs no network or
// storage access. Exact MusicBrainz release identity can deterministically
// address Cover Art Archive; callers may use this before considering Spotify.
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validMbid(value) {
  const text = String(value || '').trim().toLowerCase();
  return MBID.test(text) ? text : null;
}

function exactReleaseMbid(value = {}) {
  const candidates = [value.releaseMbid, value.musicbrainzReleaseId, value.musicbrainzReleaseMbid]
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

function artworkEvidence(value = {}) {
  const releaseMbid = exactReleaseMbid(value);
  const artworkUrl = coverArtArchiveUrl(value);
  return releaseMbid && artworkUrl ? { provider: 'cover-art-archive', releaseMbid, artworkUrl } : null;
}

function groupArtworkEvidence(events = []) {
  const rows = (events || []).map(artworkEvidence).filter(Boolean);
  const releaseIds = [...new Set(rows.map((row) => row.releaseMbid))];
  if (releaseIds.length !== 1) return null;
  return rows.find((row) => row.releaseMbid === releaseIds[0]) || null;
}

module.exports = { validMbid, exactReleaseMbid, coverArtArchiveUrl, artworkEvidence, groupArtworkEvidence };
