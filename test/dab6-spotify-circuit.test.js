'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const circuit = require('../scripts/lib/spotifyCircuitBreaker');
const spotifyProvider = require('../scripts/lib/spotify');
const artworkRunner = require('../scripts/spotify-artwork-backfill');
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
    note() {},
  };
}

test('DAB6 honors Retry-After, falls back conservatively, and fails closed on malformed state', () => {
  const usage = fakeUsage();
  const opened = circuit.reportSpotifyCircuitSignal(usage, { type: 'rate_limit', retryAfterSeconds: 12 }, { nowMs: START });
  assert.equal(opened.changed, true);
  assert.equal(usage.state.spotify.circuit.status, 'open');
  assert.equal(usage.state.spotify.circuit.reason, 'rate_limited');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-12T20:00:13.000Z');
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + 5000), 'rate_limit_circuit_open');
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + 14000), null);

  for (const unusable of [null, '', 0, '0', 'invalid']) {
    const fallback = circuit.retryBlockedUntil({ type: 'rate_limit', retryAfter: unusable }, START);
    assert.equal(fallback, START + circuit.RATE_LIMIT_FALLBACK_MS);
  }
  assert.equal(circuit.spotifyCircuitBlockReason({ circuit: { status: 'open', reason: 'rate_limited' } }, START), 'circuit_state_invalid');
});

test('DAB6 quota exhaustion is monotonic, preserves unknown state, and only a later successful probe closes it', () => {
  const usage = fakeUsage();
  usage.state.spotify.circuit = {
    status: 'closed', reason: null, blockedUntil: null, futureField: { preserve: true },
  };
  circuit.reportSpotifyCircuitSignal(usage, { type: 'quota' }, { nowMs: START });
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-13T20:00:00.000Z');
  assert.deepEqual(usage.state.spotify.circuit.futureField, { preserve: true });
  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + circuit.QUOTA_COOLDOWN_MS - 1), 'quota_circuit_open');

  const downgrade = circuit.reportSpotifyCircuitSignal(usage, { type: 'rate_limit', retryAfterSeconds: 1 }, { nowMs: START + 1000 });
  assert.equal(downgrade.changed, false);
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-13T20:00:00.000Z');

  const earlySuccess = circuit.reportSpotifyCircuitSignal(usage, { type: 'success' }, { nowMs: START + 2000 });
  assert.equal(earlySuccess.changed, false);
  assert.equal(usage.state.spotify.circuit.status, 'open');

  assert.equal(circuit.spotifyCircuitBlockReason(usage.state.spotify, START + circuit.QUOTA_COOLDOWN_MS + 1), null);
  const probeSuccess = circuit.reportSpotifyCircuitSignal(usage, { type: 'success' }, { nowMs: START + circuit.QUOTA_COOLDOWN_MS + 1 });
  assert.equal(probeSuccess.changed, true);
  assert.equal(usage.state.spotify.circuit.status, 'closed');
  assert.equal(usage.state.spotify.circuit.reason, null);
  assert.deepEqual(usage.state.spotify.circuit.futureField, { preserve: true });
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

test('DAB6 scheduled Spotify wrappers persist 429 state and close only after a real later provider call', async () => {
  let nowMs = START;
  let saves = 0;
  class FakeUsageTracker {
    constructor() { this.state = { spotify: spotifyState() }; }
    canCallSpotify() { return true; }
    async recordSpotifyCall() { this.state.spotify.callsThisRun += 1; this.state.spotify.callsToday += 1; }
    async save() { saves += 1; }
  }
  circuit.installUsageTrackerSpotifyCircuit(FakeUsageTracker, { now: () => nowMs });
  const usage = new FakeUsageTracker();
  const spotify = {
    searchTrackOutcome: async () => ({ kind: 'error', status: 429, retryAfter: '9' }),
    resolveSongLinks: async (songs, bandName, passedUsage, options) => options.search(songs[0].name, bandName, passedUsage),
    resolveArtistIdentity: async () => ({ kind: 'error', identity: { errorCategory: 'http_429' } }),
    listArtistReleases: async (artistId, passedUsage) => {
      await passedUsage.recordSpotifyCall();
      return { kind: 'error', status: 429, retryAfter: '15' };
    },
    getReleaseTracks: async (releaseId, passedUsage) => {
      await passedUsage.recordSpotifyCall();
      return { kind: 'ok', data: { items: [] } };
    },
    matchPredictedSong: async () => ({ kind: 'no_match' }),
  };
  circuit.installSpotifyModuleCircuit(spotify);

  const result = await spotify.listArtistReleases('artist', usage);
  assert.equal(result.status, 429);
  assert.equal(usage.state.spotify.circuit.reason, 'rate_limited');
  assert.equal(usage.state.spotify.circuit.blockedUntil, '2026-08-12T20:00:16.000Z');
  assert.equal(usage.canCallSpotify(), false);
  assert.equal(saves, 1);

  nowMs += 17000;
  assert.equal(usage.canCallSpotify(), true);
  await spotify.getReleaseTracks('album', usage);
  assert.equal(usage.state.spotify.circuit.status, 'closed');
  assert.equal(saves, 2);
});

test('DAB6 scheduled provider surfaces explicit Spotify QUOTA_EXCEEDED without retrying', async () => {
  const usage = fakeUsage();
  let providerCalls = 0;
  let sleeps = 0;
  const response = {
    ok: false,
    status: 429,
    headers: { get: () => null },
    json: async () => ({ error: { status: 429, message: 'quota', reason: 'QUOTA_EXCEEDED' } }),
  };
  const outcome = await spotifyProvider.searchTrackOutcome('Song', 'Example Band', usage, {
    getToken: async () => 'synthetic-token',
    sleepImpl: async () => { sleeps += 1; },
    fetchImpl: async () => { providerCalls += 1; return response; },
  });
  assert.equal(outcome.kind, 'quota_exceeded');
  assert.equal(outcome.status, 429);
  assert.equal(providerCalls, 1);
  assert.equal(sleeps, 0);
});

test('DAB6 artwork 429 parsing preserves usable Retry-After and leaves missing or invalid values for the conservative fallback', async () => {
  const makeResponse = (headerValue) => ({
    ok: false,
    status: 429,
    headers: { get: () => headerValue },
    clone() { return this; },
    json: async () => ({ error: { status: 429, message: 'rate limited' } }),
  });

  const withDelay = await artworkRunner.fetchSpotifyTrack({
    id: 'synthetic-track', token: 'synthetic-token', fetchImpl: async () => makeResponse('12'),
  });
  assert.equal(withDelay.kind, 'rate_limited');
  assert.equal(withDelay.retryAfter, '12');
  assert.equal(withDelay.retryAfterSeconds, 12);

  for (const headerValue of [null, '', 'invalid', '0']) {
    const withoutDelay = await artworkRunner.fetchSpotifyTrack({
      id: 'synthetic-track', token: 'synthetic-token', fetchImpl: async () => makeResponse(headerValue),
    });
    assert.equal(withoutDelay.kind, 'rate_limited');
    assert.equal(withoutDelay.retryAfterSeconds, null);
    assert.equal(circuit.retryBlockedUntil(withoutDelay, START), START + circuit.RATE_LIMIT_FALLBACK_MS);
  }
});

test('DAB6 trusted artwork maintenance persists quota state, avoids redundant success saves, and refuses a second provider call', async () => {
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

  const cleanUsage = fakeUsage();
  let cleanSaves = 0;
  cleanUsage.save = async () => { cleanSaves += 1; };
  const cleanResult = await trackedSpotifyCall(cleanUsage, async () => ({ kind: 'ok' }));
  assert.equal(cleanResult.kind, 'ok');
  assert.equal(cleanSaves, 1);
});

test('DAB6 fails safely when changed circuit state cannot be persisted', async () => {
  const usage = fakeUsage();
  usage.save = async () => { throw new Error('synthetic persistence failure'); };
  await assert.rejects(
    circuit.applyAndPersistSpotifyCircuitSignal(usage, { type: 'quota' }, { nowMs: START }),
    (error) => error?.code === 'SPOTIFY_CIRCUIT_SAVE_FAILED' && /could not be persisted/.test(error.message),
  );
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
});

test('DAB6 is wired only into the scheduled preload and keeps the PWA version unchanged', () => {
  const preload = fs.readFileSync('scripts/preloadStructuredRun.js', 'utf8');
  const version = fs.readFileSync('version.js', 'utf8');
  const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
  assert.match(preload, /installUsageTrackerSpotifyCircuit\(UsageTracker\)/);
  assert.match(preload, /installSpotifyModuleCircuit\(spotify\)/);
  assert.match(version, /APP_VERSION\s*=\s*["']v115["']/);
  assert.match(serviceWorker, /CACHE_NAME_LITERAL\s*=\s*["']v115["']/);
});
