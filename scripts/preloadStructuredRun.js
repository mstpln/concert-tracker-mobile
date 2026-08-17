'use strict';

// Loaded with Node's -r flag before scripts/research.js. The frequent
// structured run keeps Tavily disabled, gates MusicBrainz to the DAB5 fair
// queue, and shares Spotify rate/quota backoff through apiUsage.json.
// v135 retires release discovery at this scheduled-workflow boundary.
const config = require('./lib/config');
const musicbrainz = require('./lib/musicbrainz');
const spotify = require('./lib/spotify');
const worker = require('./lib/workerClient');
const releaseAlertPlan = require('./lib/releaseAlertPlan');
const { UsageTracker } = require('./lib/usageTracker');
const { installMusicbrainzScheduledGate } = require('./lib/musicbrainzScheduledGate');
const { installUsageTrackerSpotifyCircuit, installSpotifyModuleCircuit } = require('./lib/spotifyCircuitBreaker');
const nonPlaylist = require('./lib/nonPlaylistTrackLinks');
const { installSpotifyDiagnosticsV135 } = require('./lib/spotifyDiagnosticsV135');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled = false;
config.STRUCTURED_RESEARCH.spotifyReleaseRefreshDays = 3;
releaseAlertPlan.planLifecycleAlerts = () => ({ alertsToCreate: [], alertsToEnrich: [], lifecycleUpdates: [], skipped: [] });

// Capture only the ordinary automation documents it already reads. Once both
// are present, seed the pure resolver with existing setlist and predicted-link
// evidence. This does not widen the automation credential to private listening.
const originalReadJson = worker.readJson;
let safeBands = null;
let safeConcerts = null;
worker.readJson = async function readJsonWithTrackEvidence(path, fallback) {
  const value = await originalReadJson(path, fallback);
  if (path === 'bands.json' && Array.isArray(value)) safeBands = value;
  if (path === 'concerts.json' && Array.isArray(value)) safeConcerts = value;
  if (safeBands && safeConcerts) nonPlaylist.seedEvidence(nonPlaylist.collectConcertEvidence(safeConcerts, safeBands));
  return value;
};

installMusicbrainzScheduledGate({ musicbrainz, worker, config });
installUsageTrackerSpotifyCircuit(UsageTracker);
installSpotifyModuleCircuit(spotify);
nonPlaylist.installSpotifyNonPlaylistReuse(spotify);
installSpotifyDiagnosticsV135(spotify, UsageTracker);
