'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spotify = require('../scripts/lib/spotify');

function usage() {
  return { calls: 0, canCallSpotify: () => true, recordSpotifyCall: async function () { this.calls += 1; }, note() {} };
}
function response(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (name) => headers[name.toLowerCase()] || null }, json: async () => body };
}

test('exact artist lookup uses the trusted id URL and accepts only the matching response id', async () => {
  const seen = [];
  const result = await spotify.getArtistExact('trusted123', usage(), {
    getToken: async () => 'token',
    fetchImpl: async (url) => { seen.push(url); return response(200, { id: 'trusted123', images: [] }); },
  });
  assert.equal(result.kind, 'ok');
  assert.deepEqual(seen, ['https://api.spotify.com/v1/artists/trusted123']);
  const mismatch = await spotify.getArtistExact('trusted123', usage(), { getToken: async () => 'token', fetchImpl: async () => response(200, { id: 'other', images: [] }) });
  assert.deepEqual(mismatch, { kind: 'error', error: 'artist_id_mismatch' });
});

test('exact lookup preserves 429/quota outcomes without retrying', async () => {
  let calls = 0;
  const result = await spotify.getArtistExact('trusted123', usage(), {
    getToken: async () => 'token',
    fetchImpl: async () => { calls += 1; return response(429, { error: {} }, { 'retry-after': '60' }); },
  });
  assert.equal(result.status, 429);
  assert.equal(result.retryAfter, '60');
  assert.equal(calls, 1);
});

test('exact lookup retries one 5xx or network failure through UsageTracker', async () => {
  for (const mode of ['5xx', 'network']) {
    let calls = 0;
    const tracker = usage();
    const result = await spotify.getArtistExact('trusted123', tracker, {
      getToken: async () => 'token',
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          if (mode === 'network') throw new Error('socket failed');
          return response(503, {});
        }
        return response(200, { id: 'trusted123', images: [] });
      },
    });
    assert.equal(result.kind, 'ok');
    assert.equal(calls, 2);
    assert.equal(tracker.calls, 2);
  }
});
