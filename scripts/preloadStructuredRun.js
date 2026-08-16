'use strict';

// Loaded with Node's -r flag before scripts/research.js. The frequent
// structured run keeps Tavily disabled, gates MusicBrainz to the DAB5 fair
// queue, and shares Spotify rate/quota backoff through apiUsage.json.
// v135 deliberately does not install any release planner or release refresh
// override: album/EP/single discovery is no longer a BANDMARKR product lane.
const config = require('./lib/config');
const musicbrainz = require('./lib/musicbrainz');
const spotify = require('./lib/spotify');
const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const { installMusicbrainzScheduledGate } = require('./lib/musicbrainzScheduledGate');
const { installUsageTrackerSpotifyCircuit, installSpotifyModuleCircuit } = require('./lib/spotifyCircuitBreaker');
const { installSpotifyNonPlaylistReuse } = require('./lib/nonPlaylistTrackLinks');
const { installSpotifyDiagnosticsV135 } = require('./lib/spotifyDiagnosticsV135');

config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled = false;
config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled = false;

installMusicbrainzScheduledGate({ musicbrainz, worker, config });
installUsageTrackerSpotifyCircuit(UsageTracker);
installSpotifyModuleCircuit(spotify);
installSpotifyNonPlaylistReuse(spotify);
installSpotifyDiagnosticsV135(spotify);
