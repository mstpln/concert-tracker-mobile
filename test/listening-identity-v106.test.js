'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const completion = require('../listeningIdentityCompletionV104.js');
const v106 = require('../listeningIdentityRecordingV106.js');

const ARTIST = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba';
const RECORDING = '11111111-2222-4333-8444-555555555555';
const RELEASE = '12345678-1234-4234-8234-123456789abc';

function listen(overrides = {}) {
  return {
    stableListenId: 'listen:1',
    localBandId: 'band-1',
    musicbrainzArtistIds: [ARTIST],
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Song',
    releaseTitle: 'Synthetic Album',
    ...overrides,
  };
}

function progressStore() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function emptyStorage() {
  const written = [];
  return {
    written,
    async listIdentities() { return { items: [], nextAfterSourceEventId: null }; },
    async putIdentities(records) { written.push(...records); },
  };
}

test('v106 excludes release-group-only work from manual identity completion', async () => {
  let providerCalls = 0;
  const storage = emptyStorage();
  const result = await v106.completeRecordingIdentities({
    events: [listen({ musicbrainzRecordingId: RECORDING, musicbrainzReleaseId: RELEASE })],
    storage,
    progressStore: progressStore(),
    completion,
    listenbrainz: { connection: () => ({ token: 'synthetic-token' }) },
    fetchImpl: async () => { providerCalls += 1; throw new Error('provider should not be called'); },
  });

  assert.equal(result.checked, 0);
  assert.equal(result.resolvedRecordings, 0);
  assert.equal(result.written, 0);
  assert.equal(providerCalls, 0);
  assert.equal(storage.written.length, 0);
});

test('v106 resolves a missing recording through ListenBrainz without calling MusicBrainz release context', async () => {
  const urls = [];
  const storage = emptyStorage();
  const result = await v106.completeRecordingIdentities({
    events: [listen({ musicbrainzReleaseId: RELEASE })],
    storage,
    progressStore: progressStore(),
    completion,
    listenbrainz: { connection: () => ({ token: 'synthetic-token' }) },
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/musicbrainz/release-context')) throw new Error('MusicBrainz release context must be deferred');
      return {
        status: 200,
        ok: true,
        json: async () => ({
          artist_credit_name: 'Synthetic Artist',
          recording_name: 'Synthetic Song',
          artist_mbids: [ARTIST],
          recording_mbid: RECORDING,
        }),
      };
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.resolvedRecordings, 1);
  assert.equal(result.written, 1);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /api\.listenbrainz\.org/);
  assert.doesNotMatch(urls[0], /musicbrainz\/release-context/);
  assert.equal(storage.written[0].recordingMbid, RECORDING);
  assert.equal(storage.written[0].releaseMbid, RELEASE);
  assert.equal(Object.hasOwn(storage.written[0], 'releaseGroupMbid'), false);
});

test('v106 keeps unresolved recording work resumable and bounded without release-context calls', async () => {
  const progress = progressStore();
  const storage = emptyStorage();
  const requested = [];
  const events = [
    listen({ stableListenId: 'a', recordingTitle: 'Song A', musicbrainzReleaseId: RELEASE }),
    listen({ stableListenId: 'b', recordingTitle: 'Song B', musicbrainzReleaseId: RELEASE }),
  ];
  const options = {
    events,
    storage,
    progressStore: progress,
    completion,
    cap: 1,
    listenbrainz: { connection: () => ({ token: 'synthetic-token' }) },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requested.push(url.searchParams.get('recording_name'));
      assert.doesNotMatch(url.pathname, /musicbrainz\/release-context/);
      return {
        status: 200,
        ok: true,
        json: async () => ({
          artist_credit_name: 'Wrong Artist',
          recording_name: 'No match',
          artist_mbids: [ARTIST],
          recording_mbid: RECORDING,
        }),
      };
    },
  };

  const first = await v106.completeRecordingIdentities(options);
  const second = await v106.completeRecordingIdentities(options);
  assert.equal(first.checked, 1);
  assert.equal(second.checked, 1);
  assert.deepEqual(requested, ['Song A', 'Song B']);
});
