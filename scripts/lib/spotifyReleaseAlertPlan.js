'use strict';

const releaseLifecycle = require('./releaseLifecycle');
const releaseFeedPolicy = require('./releaseFeedPolicy');

const DAY = 86400000;
const RELEASE_REPAIR_CATCHUP_DAYS = 30;
const RELEASE_REPAIR_FIRST_SEEN_CUTOFF = Date.parse('2026-08-14T23:59:59.999Z');

function fullDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function spotifyReleaseReady(release, today) {
  if (!release?.spotifyReleaseId || !releaseFeedPolicy.trustedSpotifyReleaseUrl(release.spotifyUrl)) return false;
  if (!['Album', 'Single'].includes(release.type)) return false;
  if (!fullDate(release.releaseDate) || release.releaseDate > String(today || '').slice(0, 10)) return false;
  return true;
}

function releaseAgeDays(release, today) {
  if (!fullDate(release?.releaseDate)) return null;
  const releaseAt = Date.parse(`${release.releaseDate}T00:00:00Z`);
  const todayAt = Date.parse(`${String(today || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(releaseAt) || !Number.isFinite(todayAt)) return null;
  return Math.floor((todayAt - releaseAt) / DAY);
}

function recentSpotifyRelease(release, today) {
  if (!spotifyReleaseReady(release, today)) return false;
  const ageDays = releaseAgeDays(release, today);
  return Number.isInteger(ageDays) && ageDays >= 0 && ageDays <= RELEASE_REPAIR_CATCHUP_DAYS;
}

function spotifyLifecycleStage(release) {
  return release?.type === 'Single' ? 'spotify_single_release' : 'spotify_album_release';
}

function repairCatchupEligible(release, today) {
  if (!recentSpotifyRelease(release, today)) return false;
  const firstSeenAt = Date.parse(release.firstSeenAt || '');
  return Number.isFinite(firstSeenAt) && firstSeenAt <= RELEASE_REPAIR_FIRST_SEEN_CUTOFF;
}

function spotifyReleaseAlertId(bandId, release) {
  return `release-${String(bandId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-spotify-${release.spotifyReleaseId}`;
}

function planSpotifyReleaseAlerts({ band, releases = [], alerts = [], today }) {
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
    if (!spotifyReleaseReady(release, today)) {
      skipped.push({ release, reason: 'not_available_on_spotify' });
      continue;
    }

    const lifecycleStage = spotifyLifecycleStage(release);
    if (release.lifecycle?.[lifecycleStage]) {
      skipped.push({ release, reason: 'already_generated' });
      continue;
    }

    const recentRelease = recentSpotifyRelease(release, today);
    const normalLifecycleEligible = Boolean(release?.lifecycleEligible) && recentRelease;
    const catchupEligible = repairCatchupEligible(release, today);
    if (!normalLifecycleEligible && !catchupEligible) {
      skipped.push({ release, reason: recentRelease ? 'baseline' : 'outside_recency_window' });
      continue;
    }

    const generatedId = spotifyReleaseAlertId(band.id, release);
    const existing = knownById.get(generatedId) || knownBySpotifyRelease.get(release.spotifyReleaseId) || null;
    const alertId = existing?.id || generatedId;
    lifecycleUpdates.push({
      bandId: band.id,
      canonicalReleaseId: release.canonicalReleaseId || releaseLifecycle.canonicalReleaseId(release),
      stage: lifecycleStage,
      alertId,
    });

    if (existing) {
      enrich.push({ id: existing.id, lifecycleStage });
      continue;
    }

    const spotifyUrl = releaseFeedPolicy.trustedSpotifyReleaseUrl(release.spotifyUrl);
    creates.push({
      id: generatedId,
      bandId: band.id,
      bandName: band.name,
      category: 'album',
      headline: `${release.type === 'Single' ? 'New single' : 'New album'} · ${release.title}`,
      foundAt: today,
      structured: true,
      provider: 'spotify',
      lifecycleStage,
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
}

module.exports = {
  planSpotifyReleaseAlerts,
  spotifyReleaseReady,
  recentSpotifyRelease,
  repairCatchupEligible,
  spotifyLifecycleStage,
  spotifyReleaseAlertId,
};
