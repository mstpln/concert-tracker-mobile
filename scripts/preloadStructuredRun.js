'use strict';

// Loaded with Node's -r flag before scripts/research.js. It keeps the
// existing mature structured pipeline intact while disabling every Tavily
// route for this more frequent run, narrowing release alerts to actual
// Spotify catalogue releases, gating MusicBrainz to a small fair queue of
// due work, and sharing Spotify rate/quota backoff through apiUsage.json.
const config = require('./lib/config');
const releasePlan = require('./lib/releaseAlertPlan');
const { planSpotifyReleaseAlerts } = require('./lib/spotifyReleaseAlertPlan');
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

// The research entry point is loaded after this preload, so its destructured
// planner reference receives the Spotify-only lifecycle implementation while
// the planner itself remains pure and independently testable.
releasePlan.planLifecycleAlerts = planSpotifyReleaseAlerts;
