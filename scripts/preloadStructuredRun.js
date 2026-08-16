'use strict';

// Loaded with Node's -r flag before scripts/research.js. The frequent
// structured run keeps Tavily disabled, gates MusicBrainz to the DAB5 fair
// queue, and shares Spotify rate/quota backoff through apiUsage.json.
// v135 retires release discovery at this scheduled-workflow boundary while
// leaving the old pure helpers readable for historical-data compatibility.
// Historical v122 wiring (retired, intentionally not executable):
// planSpotifyReleaseAlerts
// releasePlan.planLifecycleAlerts = planSpotifyReleaseAlerts
const config = require('./lib/config');
const musicbrainz = require('./lib/musicbrainz');
const spotify = require('./lib/spotify');
const worker = require('./lib/workerClient');
const releaseAlertPlan = require('./lib/releaseAlertPlan');
const { UsageTracker } = require('./lib/usageTracker');
const { installMusicbrainzScheduledGate } = require('./lib/musicbrainzScheduledGate');
const { installUsageTrackerSpotifyCircuit, installSpotifyModuleCircuit } = require('./lib/spotifyCircuitBreaker');
const { installSpotifyNonPlaylistReuse } = require('./lib/nonPlaylistTrackLinks');
const { installSpotifyDiagnosticsV135 } = require('./lib/spotifyDiagnosticsV135');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled = false;
releaseAlertPlan.planLifecycleAlerts = () => ({ alertsToCreate: [], alertsToEnrich: [], lifecycleUpdates: [], skipped: [] });

installMusicbrainzScheduledGate({ musicbrainz, worker, config });
installUsageTrackerSpotifyCircuit(UsageTracker);
installSpotifyModuleCircuit(spotify);
installSpotifyNonPlaylistReuse(spotify);
installSpotifyDiagnosticsV135(spotify, UsageTracker);
