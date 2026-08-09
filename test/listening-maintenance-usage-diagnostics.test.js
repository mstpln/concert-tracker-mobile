'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createListeningMaintenanceUsageGate } = require('../scripts/lib/listeningMaintenanceUsage');

function fakeUsage(overrides = {}) {
  const state = {
    spotify: { callsThisRun: 0, perRunCap: 100, callsToday: 0, dailyCap: 100 },
    musicbrainz: { callsThisRun: 0, perRunCap: 100, lastCallAt: null },
    listeningMaintenance: {},
    ...overrides,
  };
  return {
    state,
    canCallSpotify() {
      return state.spotify.callsThisRun < state.spotify.perRunCap && state.spotify.callsToday < state.spotify.dailyCap;
    },
    async recordSpotifyCall() {
      state.spotify.callsThisRun += 1;
      state.spotify.callsToday += 1;
    },
    canCallMusicbrainz() {
      return state.musicbrainz.callsThisRun < state.musicbrainz.perRunCap;
    },
    async recordMusicbrainzAttempt() {
      state.musicbrainz.callsThisRun += 1;
      state.musicbrainz.lastCallAt = new Date(0).toISOString();
    },
  };
}

test('Spotify usage gate distinguishes daily and per-run caps without exposing private data', async () => {
  const dailyUsage = fakeUsage({
    spotify: { callsThisRun: 0, perRunCap: 100, callsToday: 100, dailyCap: 100 },
    musicbrainz: { callsThisRun: 0, perRunCap: 100, lastCallAt: null },
    listeningMaintenance: {},
  });
  const dailyGate = createListeningMaintenanceUsageGate(dailyUsage, { sleepImpl: async () => {} });
  assert.equal(await dailyGate.reserve('spotify'), false);
  assert.equal(dailyGate.blockReason('spotify'), 'daily_cap');

  const runUsage = fakeUsage({
    spotify: { callsThisRun: 100, perRunCap: 100, callsToday: 0, dailyCap: 1000 },
    musicbrainz: { callsThisRun: 0, perRunCap: 100, lastCallAt: null },
    listeningMaintenance: {},
  });
  const runGate = createListeningMaintenanceUsageGate(runUsage, { sleepImpl: async () => {} });
  // The maintenance gate intentionally resets its own per-invocation counters,
  // while UsageTracker's provider counter remains authoritative for this cap.
  runUsage.state.spotify.callsThisRun = 100;
  assert.equal(await runGate.reserve('spotify'), false);
  assert.equal(runGate.blockReason('spotify'), 'per_run_cap');
});

test('MusicBrainz and ListenBrainz per-run caps produce explicit safe reasons', async () => {
  const usage = fakeUsage();
  const gate = createListeningMaintenanceUsageGate(usage, {
    listenbrainzPerRunCap: 1,
    listenbrainzMinDelayMs: 0,
    sleepImpl: async () => {},
    now: () => 1000,
  });

  usage.state.musicbrainz.callsThisRun = usage.state.musicbrainz.perRunCap;
  assert.equal(await gate.reserve('musicbrainz'), false);
  assert.equal(gate.blockReason('musicbrainz'), 'per_run_cap');

  assert.equal(await gate.reserve('listenbrainz'), true);
  assert.equal(await gate.reserve('listenbrainz'), false);
  assert.equal(gate.blockReason('listenbrainz'), 'per_run_cap');
});

test('successful reservation clears an older block reason', async () => {
  const usage = fakeUsage({
    spotify: { callsThisRun: 0, perRunCap: 100, callsToday: 100, dailyCap: 100 },
    musicbrainz: { callsThisRun: 0, perRunCap: 100, lastCallAt: null },
    listeningMaintenance: {},
  });
  const gate = createListeningMaintenanceUsageGate(usage, { sleepImpl: async () => {} });
  assert.equal(await gate.reserve('spotify'), false);
  assert.equal(gate.blockReason('spotify'), 'daily_cap');

  usage.state.spotify.callsToday = 0;
  assert.equal(await gate.reserve('spotify'), true);
  assert.equal(gate.blockReason('spotify'), null);
});
