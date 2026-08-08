'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createListeningMaintenanceUsageGate } = require('../scripts/lib/listeningMaintenanceUsage');

function fakeUsage() {
  return {
    state: {},
    spotifyAllowed: true,
    musicbrainzAllowed: true,
    spotifyRecords: 0,
    musicbrainzRecords: 0,
    canCallSpotify() { return this.spotifyAllowed; },
    async recordSpotifyCall() { this.spotifyRecords += 1; },
    canCallMusicbrainz() { return this.musicbrainzAllowed; },
    async recordMusicbrainzAttempt() { this.musicbrainzRecords += 1; },
  };
}

test('maintenance usage gate records Spotify and MusicBrainz through existing UsageTracker hooks', async () => {
  const usage = fakeUsage();
  const gate = createListeningMaintenanceUsageGate(usage, { now: () => Date.parse('2026-08-08T09:00:00.000Z') });
  assert.equal(await gate.reserve('spotify'), true);
  assert.equal(await gate.reserve('musicbrainz'), true);
  assert.equal(usage.spotifyRecords, 1);
  assert.equal(usage.musicbrainzRecords, 1);
  assert.equal(gate.state.spotifyCallsThisRun, 1);
  assert.equal(gate.state.musicbrainzCallsThisRun, 1);
});

test('maintenance usage gate fails closed when shared provider quota is unavailable', async () => {
  const usage = fakeUsage();
  usage.spotifyAllowed = false;
  usage.musicbrainzAllowed = false;
  const gate = createListeningMaintenanceUsageGate(usage);
  assert.equal(await gate.reserve('spotify'), false);
  assert.equal(await gate.reserve('musicbrainz'), false);
  assert.equal(usage.spotifyRecords, 0);
  assert.equal(usage.musicbrainzRecords, 0);
});

test('ListenBrainz uses an internal per-run courtesy cap and pacing without claiming a provider allowance', async () => {
  const usage = fakeUsage();
  let clock = 1000;
  const sleeps = [];
  const gate = createListeningMaintenanceUsageGate(usage, {
    listenbrainzPerRunCap: 2,
    listenbrainzMinDelayMs: 1000,
    now: () => clock,
    async sleepImpl(ms) { sleeps.push(ms); clock += ms; },
  });

  assert.equal(await gate.reserve('listenbrainz'), true);
  clock += 100;
  assert.equal(await gate.reserve('listenbrainz'), true);
  assert.deepEqual(sleeps, [900]);
  assert.equal(await gate.reserve('listenbrainz'), false);
  assert.equal(gate.state.listenbrainzCallsThisRun, 2);
});

test('finish writes aggregate maintenance diagnostics only', async () => {
  const usage = fakeUsage();
  let clock = Date.parse('2026-08-08T09:00:00.000Z');
  const gate = createListeningMaintenanceUsageGate(usage, { now: () => clock });
  await gate.reserve('spotify');
  clock += 5000;
  const summary = gate.finish({ haltReason: 'batch_limit' });
  assert.deepEqual(summary, {
    startedAt: '2026-08-08T09:00:00.000Z',
    finishedAt: '2026-08-08T09:00:05.000Z',
    spotifyCalls: 1,
    musicbrainzCalls: 0,
    listenbrainzCalls: 0,
    haltReason: 'batch_limit',
  });
});
