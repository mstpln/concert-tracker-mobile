'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const identity = require('../listeningIdentityCompletionV104.js');
const grouping = require('../listeningIdentityGroupingV104.js');

const REC_A = '11111111-2222-4333-8444-555555555555';
const REC_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REL_A = '12345678-1234-4234-8234-123456789abc';
const REL_B = '87654321-4321-4321-8321-cba987654321';
const RG_A = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ART_A = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba';

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

test('lookup plan groups repeated unresolved listens conservatively and separates trusted releases', () => {
  const plan = identity.buildLookupPlan([
    listen({ stableListenId: 'listen:1' }),
    listen({ stableListenId: 'listen:2' }),
    listen({ stableListenId: 'listen:3', musicbrainzReleaseId: REL_A }),
    listen({ stableListenId: 'listen:4', musicbrainzReleaseId: REL_B }),
  ]);
  assert.equal(plan.items.length, 3);
  const unresolved = plan.items.find((item) => !item.releaseMbid);
  assert.deepEqual(unresolved.sourceEventIds, ['listen:1', 'listen:2']);
});

test('lookup plan treats recording-only identity as complete when no trusted release exists', () => {
  const plan = identity.buildLookupPlan([
    listen({ stableListenId: 'recording-only', musicbrainzRecordingId: REC_A }),
    listen({ stableListenId: 'complete-release', musicbrainzRecordingId: REC_A, musicbrainzReleaseId: REL_A, musicbrainzReleaseGroupId: RG_A }),
    listen({ stableListenId: 'release-group-missing', musicbrainzRecordingId: REC_A, musicbrainzReleaseId: REL_A }),
  ]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].releaseMbid, REL_A);
  assert.equal(plan.alreadyResolved, 2);
});

test('ListenBrainz lookup accepts only exact normalized artist and recording and never invents release identity', () => {
  const request = identity.lookupSignature(listen());
  const accepted = identity.exactLookupResult(request, {
    artist_credit_name: ' Synthetic Artist ',
    recording_name: 'Synthetic Song',
    release_name: 'Provider-selected edition',
    artist_mbids: [ART_A],
    recording_mbid: REC_A,
    release_mbid: REL_A,
    metadata: { release: { mbid: REL_A, release_group_mbid: RG_A } },
  });
  assert.equal(accepted.recordingMbid, REC_A);
  assert.deepEqual(accepted.artistMbids, [ART_A]);
  assert.equal(Object.hasOwn(accepted, 'releaseMbid'), false);
  assert.equal(Object.hasOwn(accepted, 'releaseGroupMbid'), false);

  assert.equal(identity.exactLookupResult(request, {
    artist_credit_name: 'Synthetic Artist',
    recording_name: 'Synthetic Song (Live)',
    recording_mbid: REC_A,
  }), null);
});

test('derived mapping keeps a trusted release MBID and adds only its exact release-group context', () => {
  const records = identity.buildIdentityRecords(
    { sourceEventIds: ['listen:1', 'listen:2'], releaseMbid: REL_A },
    { artistMbids: [ART_A], recordingMbid: REC_A, releaseGroupMbid: RG_A },
    '2026-08-07T10:00:00.000Z',
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].recordingMbid, REC_A);
  assert.equal(records[0].releaseMbid, REL_A);
  assert.equal(records[0].releaseGroupMbid, RG_A);
  assert.equal(Object.hasOwn(records[0], 'listenedAt'), false);
  assert.equal(Object.hasOwn(records[0], 'recordingTitle'), false);
});

test('derived mapping does not copy provider release context when no trusted release MBID exists', () => {
  const records = identity.buildIdentityRecords(
    { sourceEventIds: ['listen:1'], releaseMbid: null },
    { recordingMbid: REC_A, releaseMbid: REL_A, releaseGroupMbid: RG_A },
  );
  assert.equal(records[0].recordingMbid, REC_A);
  assert.equal(Object.hasOwn(records[0], 'releaseMbid'), false);
  assert.equal(Object.hasOwn(records[0], 'releaseGroupMbid'), false);
});

test('derived identity fills missing runtime fields but never overwrites trusted source identity', () => {
  const derived = { artistMbids: [ART_A], recordingMbid: REC_A, releaseMbid: REL_A, releaseGroupMbid: RG_A };
  const filled = identity.mergeIdentityIntoEvent(listen(), derived);
  assert.equal(filled.musicbrainzRecordingId, REC_A);
  assert.equal(filled.musicbrainzReleaseId, REL_A);
  assert.equal(filled.musicbrainzReleaseGroupId, RG_A);

  const preserved = identity.mergeIdentityIntoEvent(listen({
    musicbrainzRecordingId: REC_B,
    musicbrainzReleaseId: REL_B,
  }), derived);
  assert.equal(preserved.musicbrainzRecordingId, REC_B);
  assert.equal(preserved.musicbrainzReleaseId, REL_B);
});

test('ListenBrainz lookup sends identity text only and does not request release metadata as trusted identity', async () => {
  let requestedUrl;
  let authorization;
  const request = identity.lookupSignature(listen());
  await identity.requestLookupOne(request, 'synthetic-token', async (url, options) => {
    requestedUrl = url;
    authorization = options.headers.Authorization;
    return {
      status: 200,
      ok: true,
      json: async () => ({ artist_credit_name: 'Synthetic Artist', recording_name: 'Synthetic Song', recording_mbid: REC_A }),
    };
  });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get('artist_name'), 'Synthetic Artist');
  assert.equal(url.searchParams.get('recording_name'), 'Synthetic Song');
  assert.equal(url.searchParams.get('release_name'), 'Synthetic Album');
  assert.equal(url.searchParams.has('metadata'), false);
  assert.equal(url.searchParams.has('inc'), false);
  assert.equal(authorization, 'Token synthetic-token');
  assert.doesNotMatch(requestedUrl, /2026-08-01|listen:1|synthetic-token/);
});

test('release context uses only an already trusted release MBID through the BANDMARKR Worker', async () => {
  let requestedUrl;
  let authorization;
  const result = await identity.requestReleaseContext(
    REL_A,
    { endpoint: 'https://worker.example.test', token: 'synthetic-browser-token' },
    async (url, options) => {
      requestedUrl = String(url);
      authorization = options.headers.Authorization;
      return { status: 200, ok: true, json: async () => ({ releaseMbid: REL_A, releaseGroupMbid: RG_A, releaseTitle: 'Ignored for identity' }) };
    },
  );
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/musicbrainz/release-context');
  assert.equal(url.searchParams.get('release_mbid'), REL_A);
  assert.equal(authorization, 'Bearer synthetic-browser-token');
  assert.deepEqual(result, { releaseMbid: REL_A, releaseGroupMbid: RG_A });
  assert.doesNotMatch(requestedUrl, /Synthetic Artist|Synthetic Song|2026-08-01|listen:1/);
});

test('release context fails closed on mismatched provider identity', async () => {
  await assert.rejects(
    identity.requestReleaseContext(
      REL_A,
      { endpoint: 'https://worker.example.test', token: 'synthetic-browser-token' },
      async () => ({ status: 200, ok: true, json: async () => ({ releaseMbid: REL_B, releaseGroupMbid: RG_A }) }),
    ),
    /invalid release identity/i,
  );
});

test('identity completion stops clearly on ListenBrainz rate limiting', async () => {
  await assert.rejects(
    identity.requestLookupOne(identity.lookupSignature(listen()), 'synthetic-token', async () => ({ status: 429, ok: false })),
    /rate limiting/i,
  );
});

test('album policy keeps specific MusicBrainz releases separate even under one release group', () => {
  assert.equal(grouping.ALBUM_EDITION_POLICY, 'specific_release');
  const first = grouping.albumIdentityKey(listen({ musicbrainzReleaseId: REL_A, musicbrainzReleaseGroupId: RG_A }));
  const second = grouping.albumIdentityKey(listen({ musicbrainzReleaseId: REL_B, musicbrainzReleaseGroupId: RG_A }));
  assert.notEqual(first, second);
  assert.match(first, /^mb-release:/);
});

test('release-group identity alone never becomes the grouping key', () => {
  const key = grouping.albumIdentityKey(listen({ musicbrainzReleaseGroupId: RG_A }));
  assert.doesNotMatch(key, /release-group|release_group|abcdefab/);
  assert.match(key, /^fallback:/);
});

test('album ranking remains listen-count first', () => {
  const stats = {
    isValidListen: () => true,
    validDurationMs: (entry) => Number(entry.listenedDurationMs) || 0,
    listenTimeMs: (entry) => Date.parse(entry.listenedAt),
  };
  const rows = grouping.aggregateAlbums([
    listen({ stableListenId: 'a1', musicbrainzReleaseId: REL_A, releaseTitle: 'Album A', listenedDurationMs: 1000 }),
    listen({ stableListenId: 'a2', musicbrainzReleaseId: REL_A, releaseTitle: 'Album A', listenedDurationMs: 1000 }),
    listen({ stableListenId: 'b1', musicbrainzReleaseId: REL_B, releaseTitle: 'Album B', listenedDurationMs: 999999 }),
  ], 10, stats);
  assert.equal(rows[0].releaseTitle, 'Album A');
  assert.equal(rows[0].listenCount, 2);
  assert.equal(rows[1].listenCount, 1);
});
