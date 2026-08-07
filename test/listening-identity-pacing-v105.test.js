'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pacing = require('../listeningIdentityPacingV105.js');

const REL_A = '12345678-1234-4234-8234-123456789abc';
const REL_B = '87654321-4321-4321-8321-cba987654321';

function response(status = 200) {
  return new Response('{}', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('v105 keeps non-MusicBrainz fetches untouched', async () => {
  const calls = [];
  const sleeps = [];
  const pacedFetch = pacing.createPacedFetch(async (input) => {
    calls.push(String(input));
    return response();
  }, { sleep: async (ms) => sleeps.push(ms) });
  await pacedFetch('https://api.listenbrainz.org/1/metadata/lookup/?artist_name=Synthetic');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /listenbrainz/);
  assert.deepEqual(sleeps, []);
});

test('v105 spaces MusicBrainz release-context request starts by at least 2000 ms', async () => {
  let current = 10000;
  const sleeps = [];
  const calls = [];
  const pacedFetch = pacing.createPacedFetch(async (input) => {
    calls.push({ url: String(input), at: current });
    return response();
  }, {
    now: () => current,
    sleep: async (ms) => { sleeps.push(ms); current += ms; },
  });

  await pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`);
  current += 100;
  await pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_B}`);

  assert.equal(pacing.MUSICBRAINZ_MIN_INTERVAL_MS, 2000);
  assert.deepEqual(sleeps, [1900]);
  assert.equal(calls[1].at - calls[0].at, 2000);
});

test('v105 reserves separate pacing slots for concurrent MusicBrainz requests', async () => {
  let current = 20000;
  const sleeps = [];
  const calls = [];
  const pacedFetch = pacing.createPacedFetch(async (input) => {
    calls.push({ url: String(input), at: current });
    return response();
  }, {
    now: () => current,
    sleep: async (ms) => { sleeps.push(ms); current += ms; },
  });

  await Promise.all([
    pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`),
    pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_B}`),
  ]);

  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].at - calls[0].at, 2000);
});

test('v105 does not retry a MusicBrainz rate-limit response', async () => {
  let calls = 0;
  const pacedFetch = pacing.createPacedFetch(async () => {
    calls += 1;
    return response(503);
  });
  const result = await pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`);
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
});
