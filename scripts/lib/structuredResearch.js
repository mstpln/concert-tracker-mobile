'use strict';

// Pure, compact state helpers for the optional structured-research router.
// They deliberately store observations and durable keys, never raw provider
// payloads.  Keeping this independent of the live clients makes the safety
// rules inexpensive to test with fixtures.
const config = require('./config');
const { normalize } = require('./musicbrainz');
const { daysAgo } = require('./util');

const EXCLUDED = /\b(compilation|live|remix|dj-mix|mixtape|audiobook|interview|spoken word|bootleg|promotion|promotional|reissue|remaster(?:ed)?|deluxe|expanded|anniversary|tribute|karaoke|appears on)\b/i;
const EDITION_SUFFIX = /\s*[\[(](?:deluxe|expanded|anniversary|remaster(?:ed)?|reissue|clean|explicit|\d{4}\s+edition)[^\])]*[\])]\s*$/i;
const DAY = 86400000;

function isoAfter(ms, now = Date.now()) { return new Date(now + ms).toISOString(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function fullDate(date, precision) { return precision === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')); }
function canonicalTitle(title) { return normalize(String(title || '').replace(EDITION_SUFFIX, '')); }
function allowedRelease(type, secondary = [], title = '') {
  const secondaryText = safeArray(secondary).join(' ');
  return ['Album', 'EP', 'Single'].includes(type) && !EXCLUDED.test(`${title} ${secondaryText}`);
}
function musicbrainzRelease(raw, artistMbid) {
  const type = raw?.['primary-type'] || null;
  const secondary = safeArray(raw?.['secondary-types']);
  const date = raw?.['first-release-date'] || null;
  const precision = date?.length === 10 ? 'day' : date?.length === 7 ? 'month' : date?.length === 4 ? 'year' : null;
  if (!raw?.id || !allowedRelease(type, secondary, raw.title)) return null;
  return { provider: 'musicbrainz', musicbrainzReleaseGroupMbid: raw.id, title: raw.title || null, type, secondaryTypes: secondary,
    releaseDate: date, releaseDatePrecision: precision, primaryArtistMbids: safeArray(raw['artist-credit']).map((credit) => credit?.artist?.id).filter(Boolean),
    followedArtistMbid: artistMbid, sources: ['MusicBrainz'] };
}
function spotifyRelease(raw, followedArtistId) {
  const artists = safeArray(raw?.artists);
  if (!raw?.id || !artists.some((artist) => artist?.id === followedArtistId) || EXCLUDED.test(raw?.name || '')) return null;
  const precision = raw.release_date_precision || (raw.release_date?.length === 10 ? 'day' : raw.release_date?.length === 7 ? 'month' : 'year');
  const type = raw.album_type === 'album' ? 'Album' : raw.album_type === 'single' ? 'Single' : null;
  if (!type) return null;
  return { provider: 'spotify', spotifyReleaseId: raw.id, spotifyUrl: raw.external_urls?.spotify || null, artworkUrl: raw.images?.[0]?.url || null,
    title: raw.name || null, type, releaseDate: raw.release_date || null, releaseDatePrecision: precision, followedSpotifyArtistId: followedArtistId,
    primaryArtistIds: artists.map((artist) => artist?.id).filter(Boolean), primaryArtistNames: artists.map((artist) => artist?.name).filter(Boolean),
    trackCount: raw.total_tracks ?? null, sources: ['Spotify'] };
}
function releaseKey(release) {
  if (release.musicbrainzReleaseGroupMbid) return `mbid:${release.musicbrainzReleaseGroupMbid}`;
  return `spotify:${release.followedSpotifyArtistId}|${canonicalTitle(release.title)}|${normalize(release.type)}|${release.releaseDate || ''}|${release.releaseDatePrecision || ''}|${safeArray(release.primaryArtistIds).sort().join(',')}`;
}
function alertDeduplicationKey(bandId, release) { return `${bandId}|${canonicalTitle(release.title)}|${normalize(release.type)}|${fullDate(release.releaseDate, release.releaseDatePrecision) ? release.releaseDate : ''}`; }
function mergeReleaseObservations(a, b) {
  if (!a) return b; if (!b) return a;
  const mb = a.musicbrainzReleaseGroupMbid || b.musicbrainzReleaseGroupMbid || null;
  return { ...a, ...b, musicbrainzReleaseGroupMbid: mb, firstSeenAt: a.firstSeenAt || b.firstSeenAt,
    sources: [...new Set([...safeArray(a.sources), ...safeArray(b.sources)])] };
}
function mergeReleaseList(releases) {
  const byKey = new Map();
  for (const release of releases.filter(Boolean)) {
    const key = releaseKey(release);
    // Same title/date/type across providers is a conservative temporary
    // bridge; retain both provenance without claiming they are identical
    // when complete dates or credited artists differ.
    const loose = [...byKey.keys()].find((known) => {
      const prior = byKey.get(known);
      return canonicalTitle(prior.title) === canonicalTitle(release.title) && prior.type === release.type && prior.releaseDate === release.releaseDate && prior.releaseDatePrecision === release.releaseDatePrecision;
    });
    byKey.set(loose || key, mergeReleaseObservations(byKey.get(loose || key), release));
  }
  return [...byKey.values()];
}
function blankProviderBaseline() { return { status: 'not_started', knownKeys: [], continuation: null, lastAttemptedAt: null, lastSuccessfulAt: null, nextEligibleCheckAt: null, errorCategory: null }; }
function releaseState(band) { return band.structuredResearch?.releases || { musicbrainz: blankProviderBaseline(), spotify: blankProviderBaseline(), knownAlerts: [] }; }
function providerBaseline(state, provider) { return { ...blankProviderBaseline(), ...(state?.[provider] || {}) }; }
function completeBaseline(existing, observations, { complete, now = new Date().toISOString(), errorCategory = null, continuation = null } = {}) {
  const prior = { ...blankProviderBaseline(), ...(existing || {}) };
  const known = [...new Set([...safeArray(prior.knownKeys), ...observations.map(releaseKey)])];
  return { ...prior, status: complete ? 'complete' : (errorCategory ? (errorCategory === 'unavailable' ? 'unsupported' : 'temporarily_unavailable') : 'in_progress'),
    knownKeys: known, continuation: complete ? null : continuation, lastAttemptedAt: now, lastSuccessfulAt: errorCategory ? prior.lastSuccessfulAt : now,
    nextEligibleCheckAt: errorCategory ? isoAfter(config.STRUCTURED_RESEARCH.temporaryErrorRetryHours * 3600000, Date.parse(now)) : isoAfter(config.STRUCTURED_RESEARCH.musicbrainzReleaseRefreshDays * DAY, Date.parse(now)), errorCategory };
}
function updateProviderBaseline(existing, observations, options) { return completeBaseline(existing, observations, options); }
function newReleasesAfterBaseline(baseline, observations) {
  if (baseline?.status !== 'complete') return [];
  const known = new Set(safeArray(baseline.knownKeys));
  return observations.filter((release) => !known.has(releaseKey(release)));
}
function structuredNewsItem(band, release, now = new Date().toISOString()) {
  if (!release || !allowedRelease(release.type, release.secondaryTypes, release.title)) return null;
  const partialFuture = release.releaseDate && !fullDate(release.releaseDate, release.releaseDatePrecision) && Date.parse(`${release.releaseDate}-01`) > Date.parse(now);
  if (partialFuture) return null;
  // A past item without a full date cannot be checked against the existing
  // news recency policy, so keep it in provider state but do not alert.
  if (release.releaseDate && !fullDate(release.releaseDate, release.releaseDatePrecision)) return null;
  if (fullDate(release.releaseDate, release.releaseDatePrecision) && daysAgo(release.releaseDate) > config.NEWS_RECENCY_DAYS) return null;
  const type = String(release.type || '').toLowerCase();
  return { id: `${band.id}-album-${releaseKey(release).replace(/[^a-z0-9]/gi, '-').slice(0, 70)}`, bandId: band.id, bandName: band.name, category: 'album',
    headline: `New ${type}: ${release.title}`, sourceUrl: release.spotifyUrl || null, sourceName: release.sources?.join(', ') || null, date: fullDate(release.releaseDate, release.releaseDatePrecision) ? release.releaseDate : null,
    foundAt: now, structured: true, releaseTitle: release.title, releaseType: release.type, releaseDate: release.releaseDate || null, releaseDatePrecision: release.releaseDatePrecision || null,
    musicbrainzReleaseGroupMbid: release.musicbrainzReleaseGroupMbid || null, spotifyReleaseId: release.spotifyReleaseId || null, spotifyUrl: release.spotifyUrl || null,
    artworkUrl: release.artworkUrl || null, trackCount: release.trackCount ?? null, tracks: release.tracks || null, sources: release.sources || [],
    releaseDeduplicationKey: alertDeduplicationKey(band.id, release), firstSeenAt: release.firstSeenAt || now, lastCheckedAt: now };
}
function newsHasRelease(news, bandId, release) {
  const key = alertDeduplicationKey(bandId, release);
  return safeArray(news).some((item) => item?.releaseDeduplicationKey === key || (release.musicbrainzReleaseGroupMbid && item?.musicbrainzReleaseGroupMbid === release.musicbrainzReleaseGroupMbid));
}
function due(value, days, now = Date.now()) { return !value || Number.isNaN(Date.parse(value)) || Date.parse(value) + days * DAY <= now; }
function tavilyEligibility(band, category, { ticketmasterFound = false, now = Date.now() } = {}) {
  const state = band.structuredResearch?.routing || {};
  if (category === 'tour') return due(state.lastTavilyTourAt, ticketmasterFound ? config.STRUCTURED_RESEARCH.tavilySupplementalTourDays : config.STRUCTURED_RESEARCH.tavilyNoEventsDays, now) ? (ticketmasterFound ? 'periodic_non_ticketmaster_tour_check' : 'no_ticketmaster_events') : null;
  if (category === 'release') return due(state.lastTavilyReleaseAt, config.STRUCTURED_RESEARCH.tavilyReleaseDays, now) ? 'future_release_announcement_check' : null;
  if (category === 'status') return due(state.lastTavilyStatusAt, config.STRUCTURED_RESEARCH.tavilyStatusDays, now) ? 'status_news_due' : null;
  return null;
}
function resultFingerprint(result, category) { return `${category}|${normalize(result?.url)}|${normalize(result?.content || result?.title).slice(0, 500)}`; }
function mergeStructuredBandUpdates(latestBands, updates) {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return safeArray(latestBands).map((band) => {
    const update = byId.get(band.id); if (!update) return band;
    const currentMb = band.musicbrainz || {};
    const incomingMb = update.musicbrainz || {};
    // A newer human MB choice is authoritative. Provider identities and
    // feature state are still additive, but automation may never replace it.
    const musicbrainz = ['manual_confirmed', 'manual_rejected'].includes(currentMb.status) ? { ...incomingMb, ...currentMb } : { ...currentMb, ...incomingMb };
    return { ...band, musicbrainz, structuredResearch: { ...(band.structuredResearch || {}), ...(update.structuredResearch || {}) } };
  });
}

module.exports = { allowedRelease, musicbrainzRelease, spotifyRelease, releaseKey, alertDeduplicationKey, mergeReleaseObservations, mergeReleaseList,
  blankProviderBaseline, releaseState, providerBaseline, updateProviderBaseline, newReleasesAfterBaseline, structuredNewsItem, newsHasRelease,
  tavilyEligibility, resultFingerprint, mergeStructuredBandUpdates, fullDate, canonicalTitle };
