'use strict';

// Loaded with Node's -r flag before scripts/research.js. It keeps the
// existing mature structured pipeline intact while disabling every Tavily
// route for this more frequent run and narrowing release alerts to actual
// Spotify catalogue releases.
const config = require('./lib/config');
const releasePlan = require('./lib/releaseAlertPlan');
const releaseLifecycle = require('./lib/releaseLifecycle');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
config.STRUCTURED_RESEARCH.musicbrainzReleaseRefreshDays = 3;
config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = 3;

function fullDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function spotifyReleaseReady(release, today) {
  if (!release?.spotifyReleaseId || !release.spotifyUrl) return false;
  if (!['Album', 'Single'].includes(release.type)) return false;
  if (!fullDate(release.releaseDate) || release.releaseDate > today.slice(0, 10)) return false;
  return true;
}

function spotifyReleaseAlertId(bandId, release) {
  return `release-${String(bandId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-spotify-${release.spotifyReleaseId}`;
}

releasePlan.planLifecycleAlerts = function planSpotifyReleaseAlerts({ band, releases = [], alerts = [], today }) {
  const creates = [];
  const lifecycleUpdates = [];
  const skipped = [];
  const known = new Set((alerts || []).map((alert) => alert.id));
  for (const release of releases) {
    if (!release?.lifecycleEligible || release.historical || release.baselineIncomplete) {
      skipped.push({ release, reason: 'baseline' });
      continue;
    }
    if (!spotifyReleaseReady(release, today)) {
      skipped.push({ release, reason: 'not_available_on_spotify' });
      continue;
    }
    const id = spotifyReleaseAlertId(band.id, release);
    lifecycleUpdates.push({ bandId: band.id, canonicalReleaseId: release.canonicalReleaseId || releaseLifecycle.canonicalReleaseId(release), stage: 'spotify_release', alertId: id });
    if (known.has(id)) continue;
    creates.push({
      id,
      bandId: band.id,
      bandName: band.name,
      category: 'album',
      headline: `${release.type === 'Single' ? 'New single' : 'New album'} · ${release.title}`,
      foundAt: today,
      structured: true,
      provider: 'spotify',
      lifecycleStage: 'spotify_release',
      canonicalReleaseId: release.canonicalReleaseId || releaseLifecycle.canonicalReleaseId(release),
      releaseTitle: release.title,
      releaseType: release.type,
      releaseDate: release.releaseDate,
      spotifyReleaseId: release.spotifyReleaseId,
      spotifyUrl: release.spotifyUrl,
      artworkUrl: release.artworkUrl || null,
      sourceName: 'Spotify',
      sourceUrl: release.spotifyUrl,
    });
  }
  return { alertsToCreate: creates, alertsToEnrich: [], lifecycleUpdates, skipped };
};
