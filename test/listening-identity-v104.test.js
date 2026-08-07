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

test('lookup plan groups repeated listens by one artist/track signature', () => {
  const plan = identity.buildLookupPlan([
    listen({ stableListenId: 'listen:1', releaseTitle: 'Edition A' }),
    listen({ stableListenId: 'listen:2', releaseTitle: 'Edition B' }),
  ]);
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0].sourceEventIds, ['listen:1', 'listen:2']);
});

test('lookup plan skips existing recording MBIDs and allows missing release titles', () => {
  const plan = identity.buildLookupPlan([
    listen({ stableListenId: 'resolved', musicbrainzRecordingId: REC_A, musicbrainzReleaseId: REL_A }),
    listen({ stableListenId: 'missing-release', releaseTitle: null }),
  ]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.alreadyResolved, 1);
  assert.equal(plan.ineligible, 0);
  assert.equal(plan.releaseIdentityPresent, 1);
});

test('exact lookup accepts only exact normalized artist and recording text', () => {
  const request = identity.lookupSignature(listen());
  const accepted = identity.exactLookupResult(request, {
    artist_credit_name: ' Synthetic Artist ',
    recording_name: 'Synthetic Song',
    release_name: 'A provider-selected release that is not trusted here',
    artist_mbids: [ART_A],
    recording_mbid: REC_A,
    release_mbid: REL_A,
  });
  assert.equal(accepted.recordingMbid, REC_A);
  assert.deepEqual(accepted.artistMbids, [ART_A]);
  assert.equal(Object.hasOwn(accepted, 'releaseMbid'), false);

  assert.equal(identity.exactLookupResult(request, {
    artist_credit_name: 'Synthetic Artist',
    recording_name: 'Synthetic Song (Live)',
    recording_mbid: REC_A,
  }), null);
});

test('reordered lookup responses cannot attach the wrong recording MBID', () => {
  const requests = [
    identity.lookupSignature(listen()),
    identity.lookupSignature(listen({ recordingTitle: 'Other Song' })),
  ];
  const response = [
    { artist_credit_name: 'Synthetic Artist', recording_name: 'Other Song', recording_mbid: REC_B, release_mbid: REL_B },
    { artist_credit_name: 'Synthetic Artist', recording_name: 'Synthetic Song', recording_mbid: REC_A, release_mbid: REL_A },
  ];
  const resolved = identity.normalizeLookupResponse(response, requests);
  assert.equal(resolved[0].recordingMbid, REC_A);
  assert.equal(resolved[1].recordingMbid, REC_B);
});

test('derived mapping writes recording identity only and never invents a release identity', () => {
  const records = identity.buildIdentityRecords(
    { sourceEventIds: ['listen:1', 'listen:2'] },
    { artistMbids: [ART_A], recordingMbid: REC_A, releaseMbid: REL_A, releaseGroupMbid: RG_A },
    '2026-08-07T10:00:00.000Z',
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].recordingMbid, REC_A);
  assert.equal(Object.hasOwn(records[0], 'releaseMbid'), false);
  assert.equal(Object.hasOwn(records[0], 'releaseGroupMbid'), false);
  assert.equal(Object.hasOwn(records[0], 'listenedAt'), false);
  assert.equal(Object.hasOwn(records[0], 'recordingTitle'), false);
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

test('lookup request sends identity text only and no listening timestamp or event ID', async () => {
  let body;
  await identity.requestLookupBatch([
    identity.lookupSignature(listen()),
  ], 'synthetic-token', async (_url, options) => {
    body = JSON.parse(options.body);
    return { status: 200, ok: true, json: async () => [] };
  });
  assert.deepEqual(Object.keys(body.recordings[0]).sort(), ['artist_name', 'recording_name', 'release_name']);
  assert.doesNotMatch(JSON.stringify(body), /2026-08-01|listen:1|synthetic-token/);
});

test('identity completion stops clearly on lookup rate limiting', async () => {
  await assert.rejects(
    identity.requestLookupBatch([identity.lookupSignature(listen())], 'synthetic-token', async () => ({ status: 429, ok: false })),
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
