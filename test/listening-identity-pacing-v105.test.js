'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pacing = require('../listeningIdentityPacingV105.js');

const REL_A = '12345678-1234-4234-8234-123456789abc';
const REL_B = '87654321-4321-4321-8321-cba987654321';
const RG_A = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const RG_B = 'abcdefab-cdef-4abc-8def-abcdefabcdea';

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('v105 keeps non-MusicBrainz fetches untouched', async () => {
  const calls = [];
  const pacedFetch = pacing.createPacedFetch(async (input) => {
    calls.push(String(input));
    return response({ ok: true });
  });
  await pacedFetch('https://api.listenbrainz.org/1/metadata/lookup/?artist_name=Synthetic');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /listenbrainz/);
});

test('v105 spaces distinct MusicBrainz release-context requests by at least 1500 ms', async () => {
  let current = 10000;
  const sleeps = [];
  const calls = [];
  const pacedFetch = pacing.createPacedFetch(async (input) => {
    const url = new URL(String(input));
    const releaseMbid = url.searchParams.get('release_mbid');
    calls.push({ releaseMbid, at: current });
    return response({ releaseMbid, releaseGroupMbid: releaseMbid === REL_A ? RG_A : RG_B });
  }, {
    now: () => current,
    sleep: async (ms) => { sleeps.push(ms); current += ms; },
  });

  await pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`);
  current += 100;
  await pacedFetch(`https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_B}`);

  assert.equal(pacing.MUSICBRAINZ_MIN_INTERVAL_MS, 1500);
  assert.deepEqual(sleeps, [1400]);
  assert.equal(calls[1].at - calls[0].at, 1500);
});

test('v105 reuses an exact release-context result during the same run', async () => {
  let providerCalls = 0;
  const pacedFetch = pacing.createPacedFetch(async () => {
    providerCalls += 1;
    return response({ releaseMbid: REL_A, releaseGroupMbid: RG_A });
  });
  const url = `https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`;
  const first = await pacedFetch(url);
  const second = await pacedFetch(url);
  assert.equal(providerCalls, 1);
  assert.deepEqual(await first.json(), { releaseMbid: REL_A, releaseGroupMbid: RG_A });
  assert.deepEqual(await second.json(), { releaseMbid: REL_A, releaseGroupMbid: RG_A });
});

test('v105 never caches malformed or mismatched release-context data', async () => {
  let providerCalls = 0;
  const pacedFetch = pacing.createPacedFetch(async () => {
    providerCalls += 1;
    return response({ releaseMbid: REL_B, releaseGroupMbid: RG_B });
  });
  const url = `https://worker.example.test/musicbrainz/release-context?release_mbid=${REL_A}`;
  await pacedFetch(url);
  await pacedFetch(url);
  assert.equal(providerCalls, 2);
});
