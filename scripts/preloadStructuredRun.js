'use strict';

// Loaded with Node's -r flag before scripts/research.js. It keeps the
// existing mature structured pipeline intact while disabling every Tavily
// route for this more frequent run, narrowing release alerts to actual
// Spotify catalogue releases, gating MusicBrainz to a small fair queue of
// due work, and sharing Spotify rate/quota backoff through apiUsage.json.
const config = require('./lib/config');
const releasePlan = require('./lib/releaseAlertPlan');
const releaseLifecycle = require('./lib/releaseLifecycle');
const { trustedSpotifyReleaseUrl } = require('./lib/releaseFeedPolicy');
const musicbrainz = require('./lib/musicbrainz');
const spotify = require('./lib/spotify');
const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const { installMusicbrainzScheduledGate } = require('./lib/musicbrainzScheduledGate');
const { installUsageTrackerSpotifyCircuit, installSpotifyModuleCircuit } = require('./lib/spotifyCircuitBreaker');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
// Spotify remains the frequent catalogue source. MusicBrainz retains the
// base configured refresh interval and is additionally bounded by DAB5's
// demand/fair scheduler below.
config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = 3;

installMusicbrainzScheduledGate({ musicbrainz, worker, config });
installUsageTrackerSpotifyCircuit(UsageTracker);
installSpotifyModuleCircuit(spotify);

const DAY = 86400000;

function fullDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function spotifyReleaseReady(release, today) {
  if (!release?.spotifyReleaseId || !trustedSpotifyReleaseUrl(release.spotifyUrl)) return false;
  if (!['Album', 'Single'].includes(release.type)) return false;
  if (!fullDate(release.releaseDate) || release.releaseDate > today.slice(0, 10)) return false;
  return true;
}

// Baseline creation is still silent for old catalogue history, but a real
// Spotify release from the normal recency window must not disappear merely
// because it was first observed while a provider baseline was being built.
// This bounded catch-up is what repairs missed recent albums/singles without
// turning the first baseline into a historical flood.
function recentSpotifyCatchupEligible(release, today) {
  if (!spotifyReleaseReady(release, today)) return false;
  const releaseAt = Date.parse(`${release.releaseDate}T00:00:00Z`);
  const todayAt = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(releaseAt) || !Number.isFinite(todayAt)) return false;
  const ageDays = Math.floor((todayAt - releaseAt) / DAY);
  return ageDays >= 0 && ageDays <= config.NEWS_RECENCY_DAYS;
}

function spotifyReleaseAlertId(bandId, release) {
  return `release-${String(bandId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-spotify-${release.spotifyReleaseId}`;
}

releasePlan.planLifecycleAlerts = function planSpotifyReleaseAlerts({ band, releases = [], alerts = [], today }) {
  const creates = [];
  const enrich = [];
  const lifecycleUpdates = [];
  const skipped = [];
  const knownById = new Map((alerts || []).map((alert) => [alert.id, alert]));
  const knownBySpotifyRelease = new Map((alerts || []).filter((alert) => alert.spotifyReleaseId).map((alert) => [alert.spotifyReleaseId, alert]));
  for (const release of releases) {
    if (release?.historical || release?.baselineIncomplete) {
      skipped.push({ release, reason: 'baseline' });
      continue;
    }
    const normalLifecycleEligible = Boolean(release?.lifecycleEligible);
    const catchupEligible = recentSpotifyCatchupEligible(release, today);
    if (!normalLifecycleEligible && !catchupEligible) {
      skipped.push({ release, reason: 'baseline' });
      continue;
    }
    if (!spotifyReleaseReady(release, today)) {
      skipped.push({ release, reason: 'not_available_on_spotify' });
      continue;
    }
    const generatedId = spotifyReleaseAlertId(band.id, release);
    const existing = knownById.get(generatedId) || knownBySpotifyRelease.get(release.spotifyReleaseId) || null;
    const alertId = existing?.id || generatedId;
    lifecycleUpdates.push({ bandId: band.id, canonicalReleaseId: release.canonicalReleaseId || releaseLifecycle.canonicalReleaseId(release), stage: 'spotify_release', alertId });
    if (existing) {
      enrich.push({ id: existing.id, lifecycleStage: 'spotify_release' });
      continue;
    }
    const spotifyUrl = trustedSpotifyReleaseUrl(release.spotifyUrl);
    creates.push({
      id: generatedId,
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
      spotifyUrl,
      artworkUrl: release.artworkUrl || null,
      sourceName: 'Spotify',
      sourceUrl: spotifyUrl,
    });
  }
  return { alertsToCreate: creates, alertsToEnrich: enrich, lifecycleUpdates, skipped };
};
