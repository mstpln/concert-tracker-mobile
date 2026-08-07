'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const identity = require('../listeningIdentityCompletionV104.js');

const REC_A = '11111111-2222-4333-8444-555555555555';
const ART_A = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba';
const ART_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function listen(overrides = {}) {
  return {
    stableListenId: 'listen:1',
    source: 'spotify_import',
    listenedAt: '2026-08-01T10:00:00.000Z',
    listenedDurationMs: 180000,
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

test('trusted band artist identity is reused only from confirmed MusicBrainz bands', () => {
  const events = [
    listen({ stableListenId: 'a', localBandId: 'band-a' }),
    listen({ stableListenId: 'b', localBandId: 'band-b' }),
  ];
  const enriched = identity.addTrustedBandArtistIdentity(events, [
    { id: 'band-a', musicbrainz: { mbid: ART_A, status: 'manual_confirmed' } },
    { id: 'band-b', musicbrainz: { mbid: ART_B, status: 'needs_review' } },
  ]);
  assert.deepEqual(enriched[0].musicbrainzArtistIds, [ART_A]);
  assert.equal(enriched[1].musicbrainzArtistIds, undefined);
});

test('lookup plan never groups conflicting trusted artist identities together', () => {
  const plan = identity.buildLookupPlan([
    listen({ stableListenId: 'a', musicbrainzArtistIds: [ART_A] }),
    listen({ stableListenId: 'b', musicbrainzArtistIds: [ART_B] }),
  ]);
  assert.equal(plan.items.length, 2);
  assert.deepEqual(new Set(plan.items.map((item) => item.artistMbids[0])), new Set([ART_A, ART_B]));
});

test('trusted artist MBID must agree with ListenBrainz recording mapping', () => {
  const request = identity.lookupSignature(listen(), { artistMbids: [ART_A] });
  assert.equal(identity.exactLookupResult(request, {
    artist_credit_name: 'Synthetic Artist',
    recording_name: 'Synthetic Song',
    artist_mbids: [ART_B],
    recording_mbid: REC_A,
  }), null);

  const accepted = identity.exactLookupResult(request, {
    artist_credit_name: 'Synthetic Artist',
    recording_name: 'Synthetic Song',
    artist_mbids: [ART_A, ART_B],
    recording_mbid: REC_A,
  });
  assert.deepEqual(accepted.artistMbids, [ART_A]);
  assert.equal(accepted.recordingMbid, REC_A);
});

test('identity evidence is appended instead of replacing existing provenance', () => {
  const existing = new Map([['listen:1', {
    sourceEventId: 'listen:1',
    evidence: [{ type: 'baseline_source_identity', version: 1 }],
  }]]);
  const records = identity.buildIdentityRecords(
    { sourceEventIds: ['listen:1'] },
    { recordingMbid: REC_A },
    '2026-08-07T10:00:00.000Z',
    existing,
  );
  assert.deepEqual(records[0].evidence, [
    { type: 'baseline_source_identity', version: 1 },
    { type: 'listenbrainz_musicbrainz_recording_mapping', version: 1 },
  ]);
});

test('malformed ListenBrainz JSON fails closed with clear provider feedback', async () => {
  await assert.rejects(identity.requestLookupOne(
    identity.lookupSignature(listen()),
    'synthetic-token',
    async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
  ), /invalid identity data/i);
});

test('malformed MusicBrainz JSON fails closed with clear provider feedback', async () => {
  await assert.rejects(identity.requestReleaseContext(
    '12345678-1234-4234-8234-123456789abc',
    { endpoint: 'https://worker.example.test', token: 'synthetic-browser-token' },
    async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
  ), /invalid release identity data/i);
});

test('progress storage is proven writable before any provider request starts', async () => {
  let providerCalls = 0;
  const broken = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() {},
  };
  await assert.rejects(identity.complete({
    events: [listen()],
    progressStore: broken,
    storage: { async listIdentities() { return { items: [], nextAfterSourceEventId: null }; } },
    listenbrainz: { connection: () => ({ token: 'synthetic-token' }) },
    fetchImpl: async () => { providerCalls += 1; return { status: 500, ok: false }; },
  }), /no provider request was started/i);
  assert.equal(providerCalls, 0);
});

test('resumable cursor advances past unresolved rows before wrapping for retry', async () => {
  const progress = progressStore();
  const storage = {
    async listIdentities() { return { items: [], nextAfterSourceEventId: null }; },
    async putIdentities() {},
  };
  const events = [
    listen({ stableListenId: 'a', recordingTitle: 'Song A' }),
    listen({ stableListenId: 'b', recordingTitle: 'Song B' }),
    listen({ stableListenId: 'c', recordingTitle: 'Song C' }),
  ];
  const requested = [];
  const options = {
    events,
    storage,
    progressStore: progress,
    cap: 1,
    listenbrainz: { connection: () => ({ token: 'synthetic-token' }) },
    fetchImpl: async (url) => {
      requested.push(new URL(url).searchParams.get('recording_name'));
      return {
        status: 200,
        ok: true,
        json: async () => ({ artist_credit_name: 'Wrong Artist', recording_name: 'No match', recording_mbid: REC_A }),
      };
    },
  };
  await identity.complete(options);
  await identity.complete(options);
  await identity.complete(options);
  assert.deepEqual(requested, ['Song A', 'Song B', 'Song C']);
  const fourth = await identity.complete(options);
  assert.equal(fourth.wrapped, true);
  assert.deepEqual(requested, ['Song A', 'Song B', 'Song C', 'Song A']);
});
