'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const circuit = require('../scripts/lib/spotifyCircuitBreaker');
const { trackedSpotifyCall } = require('../scripts/spotify-artwork-backfill-production');

const START = Date.parse('2026-08-12T20:00:00.000Z');

function spotifyState() {
  return { callsThisRun: 0, callsToday: 0, perRunCap: 4000, dailyCap: 6000 };
}

function fakeUsage(state = spotifyState()) {
  return {
    state: { spotify: state },
    canCallSpotify() { return true; },
    async recordSpotifyCall() {
      this.state.spotify.callsThisRun += 1;
      this.state.spotify.callsToday += 1;
    },
    async save() {},
  };
}

test('DAB6 persists Retry-After as a shared Spotify circuit and fails closed on malformed state', () => {
  const usage = fakeUsage();
  const opened = circuit.reportSpotifyCircuitSignal(usage, { type: 'rate_limit', retryAfterSeconds: 12 }, { nowMs: START });
  assert.equal(opened.changed, true);
  assert.equal(usage.state.spotify.circuit.status, 'open');
  assert.equal(usage.state.spotify.circuit.reason, 'rate_limited');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-12T20:00:13.000Z');
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + 5000), 'rate_limit_circuit_open');
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + 14000), null);

  assert.equal(circuit.spotifyCircuitBlockReason({ circuit: { status: 'open', reason: 'rate_limited' } }, START), 'circuit_state_invalid');
});

test('DAB6 quota exhaustion opens a conservative 24-hour circuit and only a later successful probe closes it', () => {
  const usage = fakeUsage();
  circuit.reportSpotifyCircuitSignal(usage, { type: 'quota' }, { nowMs: START });
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-13T20:00:00.000Z');
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + circuit.QUOTA_COOLDOWN_MS - 1), 'quota_circuit_open');

  const earlySuccess = circuit.reportSpotifyCircuitSignal(usage, { type: 'success' }, { nowMs: START + 1000 });
  assert.equal(earlySuccess.changed, false);
  assert.equal(usage.state.spotify.circuit.status, 'open');

  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + circuit.QUOTA_COOLDOWN_MS + 1), null);
  const probeSuccess = circuit.reportSpotifyCircuitSignal(usage, { type: 'success' }, { nowMs: START + circuit.QUOTA_COOLDOWN_MS + 1 });
  assert.equal(probeSuccess.changed, true);
  assert.equal(usage.state.spotify.circuit.status, 'closed');
  assert.equal(usage.state.spotify.circuit.reason, null);
});

test('DAB6 patches UsageTracker so an open persisted circuit blocks all later Spotify reservations', () => {
  let nowMs = START;
  class FakeUsageTracker {
    constructor() { this.state = { spotify: spotifyState() }; }
    canCallSpotify() { return this.state.spotify.callsThisRun < this.state.spotify.perRunCap; }
  }
  assert.equal(circuit.installUsageTrackerSpotifyCircuit(FakeUsageTracker, { now: () => nowMs }), true);
  assert.equal(circuit.installUsageTrackerSpotifyCircuit(FakeUsageTracker, { now: () => nowMs }), false);

  const usage = new FakeUsageTracker();
  assert.equal(usage.canCallSpotify(), true);
  usage.reportSpotifyCircuitSignal({ type: 'quota' });
  assert.equal(usage.canCallSpotify(), false);
  assert.equal(usage.spotifyCircuitBlockReason(), 'quota_circuit_open');

  nowMs += circuit.QUOTA_COOLDOWN_MS + 1;
  assert.equal(usage.canCallSpotify(), true);
  usage.reportSpotifyCircuitSignal({ type: 'success' });
  assert.equal(usage.state.spotify.circuit.status, 'closed');
});

test('DAB6 scheduled Spotify wrappers arm the same usage circuit from provider 429 outcomes', async () => {
  let nowMs = START;
  class FakeUsageTracker {
    constructor() { this.state = { spotify: spotifyState() }; }
    canCallSpotify() { return true; }
  }
  circuit.installUsageTrackerSpotifyCircuit(FakeUsageTracker, { now: () => nowMs });
  const usage = new FakeUsageTracker();
  const spotify = {
    searchTrackOutcome: async () => ({ kind: 'error', status: 429, retryAfter: '9' }),
    resolveSongLinks: async (songs, bandName, passedUsage, options) => options.search(songs[0].name, bandName, passedUsage),
    resolveArtistIdentity: async () => ({ kind: 'error', identity: { errorCategory: 'http_429', nextEligibleCheckAt: '2026-08-13T20:00:00.000Z' } }),
    listArtistReleases: async () => ({ kind: 'error', status: 429, retryAfter: '15' }),
    getReleaseTracks: async () => ({ kind: 'ok', data: { items: [] } }),
    matchPredictedSong: async () => ({ kind: 'no_match' }),
  };
  circuit.installSpotifyModuleCircuit(spotify);

  const result = await spotify.listArtistReleases('artist', usage);
  assert.equal(result.status, 429);
  assert.equal(usage.state.spotify.circuit.reason, 'rate_limited');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-12T20:00:16.000Z');
  assert.equal(usage.canCallSpotify(), false);

  nowMs += 17000;
  assert.equal(usage.canCallSpotify(), true);
  await spotify.getReleaseTracks('album', usage);
  assert.equal(usage.state.spotify.circuit.status, 'closed');
});

test('DAB6 trusted artwork maintenance persists quota circuit state and refuses a second provider call', async () => {
  const usage = fakeUsage();
  let saves = 0;
  let providerCalls = 0;
  usage.save = async () => { saves += 1; };

  const first = await trackedSpotifyCall(usage, async () => {
    providerCalls += 1;
    return { kind: 'quota_exceeded', status: 429, retryAfterSeconds: 0 };
  });
  assert.equal(first.kind, 'quota_exceeded');
  assert.equal(providerCalls, 1);
  assert.equal(usage.state.spotify.callsThisRun, 1);
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
  assert.equal(saves, 2);

  await assert.rejects(
    trackedSpotifyCall(usage, async () => { providerCalls += 1; return { kind: 'ok' }; }),
    (error) => error?.code === 'SPOTIFY_CIRCUIT_OPEN',
  );
  assert.equal(providerCalls, 1);
  assert.equal(usage.state.spotify.callsThisRun, 1);
});

test('DAB6 is wired only into the scheduled preload and keeps the PWA version unchanged', () => {
  const preload = fs.readFileSync('scripts/preloadStructuredRun.js', 'utf8');
  const version = fs.readFileSync('version.js', 'utf8');
  const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
  assert.match(preload, /installUsageTrackerSpotifyCircuit\(UsageTracker\)/);
  assert.match(preload, /installSpotifyModuleCircuit\(spotify\)/);
  assert.match(version, /APP_VERSION\s*=\s*'v115'/);
  assert.match(serviceWorker, /CACHE_NAME_LITERAL\s*=\s*'v115'/);
});
