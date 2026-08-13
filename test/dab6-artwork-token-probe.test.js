'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { trackedSpotifyCall } = require('../scripts/spotify-artwork-backfill-production');

function usageWithExpiredCircuit() {
  return {
    state: {
      spotify: {
        callsThisRun: 0,
        callsToday: 0,
        perRunCap: 4000,
        dailyCap: 6000,
        circuit: {
          status: 'open',
          reason: 'quota_exceeded',
          openedAt: '2026-08-10T00:00:00.000Z',
          blockedUntil: '2026-08-11T00:00:00.000Z',
          futureField: { preserve: true },
        },
      },
    },
    canCallSpotify() { return true; },
    async recordSpotifyCall() {
      this.state.spotify.callsThisRun += 1;
      this.state.spotify.callsToday += 1;
    },
    async save() {},
  };
}

test('DAB6 artwork OAuth success cannot close an expired Web API quota circuit', async () => {
  const usage = usageWithExpiredCircuit();

  const token = await trackedSpotifyCall(usage, async () => 'synthetic-token', { allowSuccess: false });
  assert.equal(token, 'synthetic-token');
  assert.equal(usage.state.spotify.circuit.status, 'open');
  assert.equal(usage.state.spotify.circuit.reason, 'quota_exceeded');
  assert.deepEqual(usage.state.spotify.circuit.futureField, { preserve: true });

  const track = await trackedSpotifyCall(usage, async () => ({ kind: 'ok', track: { id: 'synthetic-track' } }));
  assert.equal(track.kind, 'ok');
  assert.equal(usage.state.spotify.circuit.status, 'closed');
  assert.equal(usage.state.spotify.circuit.reason, null);
  assert.deepEqual(usage.state.spotify.circuit.futureField, { preserve: true });
});
