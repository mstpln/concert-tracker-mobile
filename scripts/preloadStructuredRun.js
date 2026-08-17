'use strict';

// Loaded with Node's -r flag before scripts/research.js. The frequent
// structured run keeps Tavily disabled, gates MusicBrainz to the DAB5 fair
// queue, and shares Spotify rate/quota backoff through apiUsage.json.
// Release discovery remains retired at this scheduled-workflow boundary;
// historical release-shaped data and pure helpers stay readable for
// compatibility without generating or refreshing release alerts.
const config = require('./lib/config');
const musicbrainz = require('./lib/musicbrainz');
const spotify = require('./lib/spotify');
const worker = require('./lib/workerClient');
const releaseAlertPlan = require('./lib/releaseAlertPlan');
const { UsageTracker } = require('./lib/usageTracker');
const { installMusicbrainzScheduledGate } = require('./lib/musicbrainzScheduledGate');
const { installUsageTrackerSpotifyCircuit, installSpotifyModuleCircuit } = require('./lib/spotifyCircuitBreaker');
const nonPlaylist = require('./lib/nonPlaylistTrackLinks');
const mbTrackLinks = require('./lib/musicbrainzTrackLinksV137');
const { installSpotifyDiagnosticsV135 } = require('./lib/spotifyDiagnosticsV135');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled = false;
// Preserve the established DAB5 preload contract for historical helpers. This
// refresh value is dormant because scheduled release monitoring is disabled.
config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = 3;
releaseAlertPlan.planLifecycleAlerts = () => ({ alertsToCreate: [], alertsToEnrich: [], lifecycleUpdates: [], skipped: [] });

const originalReadJson = worker.readJson;
let safeBands = null;
let safeConcerts = null;

worker.readJson = async function v137ReadJsonWithTrustedTrackEvidence(path, fallback) {
  const value = await originalReadJson(path, fallback);
  if (path === 'bands.json' && Array.isArray(value)) safeBands = value;
  if (path === 'concerts.json' && Array.isArray(value)) safeConcerts = value;
  if (safeBands && safeConcerts) {
    nonPlaylist.seedEvidence(nonPlaylist.collectConcertEvidence(safeConcerts, safeBands));
  }
  return value;
};

nonPlaylist.setProviderNeutralLookup(async ({ artistName, recordingTitle, usage }) => {
  if (!safeBands) return { kind: 'no_match' };
  const target = nonPlaylist.normalize(artistName);
  const matches = safeBands.filter((band) => (
    nonPlaylist.normalize(band?.name) === target &&
    band?.musicbrainz?.mbid &&
    ['confirmed', 'manual_confirmed', 'auto_confirmed'].includes(band.musicbrainz.status)
  ));
  if (matches.length !== 1) return { kind: 'no_match' };
  return mbTrackLinks.resolveTrackUrl({
    artistMbid: matches[0].musicbrainz.mbid,
    recordingTitle,
    usage,
  });
});

installMusicbrainzScheduledGate({ musicbrainz, worker, config });
installUsageTrackerSpotifyCircuit(UsageTracker);
installSpotifyModuleCircuit(spotify);
nonPlaylist.installSpotifyNonPlaylistReuse(spotify);
installSpotifyDiagnosticsV135(spotify, UsageTracker);
