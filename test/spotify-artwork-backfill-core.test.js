'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/spotify-artwork-backfill-core.js');

function metadata(records = {}) {
  return {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: null,
    futureTopLevelField: { keep: true },
    records,
  };
}

function event(id) {
  return { spotifyTrackId: id, listenedAtMs: 123, recordingTitle: 'Synthetic title' };
}

test('plans only unique trusted IDs missing from metadata and respects the conservative default cap', () => {
  const events = [event('TrackA'), event('TrackA'), event('TrackB'), event('TrackC'), event('bad-id!')];
  const plan = core.createOrResumePlan({
    events,
    metadata: metadata({ TrackA: { spotifyTrackId: 'TrackA' } }),
  });
  assert.equal(core.DEFAULT_IDS_PER_INVOCATION, 25);
  assert.equal(core.MAX_IDS_PER_INVOCATION, 100);
  assert.deepEqual(plan.plannedIds, ['TrackB', 'TrackC']);
  assert.deepEqual(plan.remainingIds, ['TrackB', 'TrackC']);
});

test('stores relinked provider metadata under the original trusted Spotify ID', () => {
  const plan = core.createOrResumePlan({ events: [event('OriginalTrack123')], metadata: metadata() });
  const next = core.completeSuccess(plan, 'OriginalTrack123', {
    id: 'RelinkedTrack456',
    external_urls: { spotify: 'https://open.spotify.com/track/RelinkedTrack456' },
    album: {
      id: 'Album789',
      external_urls: { spotify: 'https://open.spotify.com/album/Album789' },
      images: [{ url: 'https://i.scdn.co/image/synthetic', width: 640 }],
    },
  }, '2026-08-07T09:00:00.000Z');
  const record = next.stagedRecords.OriginalTrack123;
  assert.equal(record.spotifyTrackId, 'OriginalTrack123');
  assert.equal(record.spotifyTrackUrl, 'https://open.spotify.com/track/OriginalTrack123');
  assert.equal(record.spotifyAlbumId, 'Album789');
  assert.equal(record.artworkUrl, 'https://i.scdn.co/image/synthetic');
  assert.equal(record.spotifyProviderResolvedTrackId, 'RelinkedTrack456');
  assert.equal(record.spotifyProviderRelinked, true);
  assert.deepEqual(next.remainingIds, []);
});

test('resumes the same logical plan after interruption and does not schedule completed IDs again', () => {
  const events = [event('Track1'), event('Track2'), event('Track3'), event('Track4')];
  let checkpoint = core.createOrResumePlan({ events, metadata: metadata(), cap: 4 });
  checkpoint = core.completeSuccess(checkpoint, 'Track1', { id: 'Track1', album: { images: [] } });
  checkpoint = core.completeSuccess(checkpoint, 'Track2', { id: 'Track2', album: { images: [] } });

  const resumed = core.createOrResumePlan({ events, metadata: metadata(), checkpoint, cap: 4 });
  assert.deepEqual(resumed.plannedIds, ['Track1', 'Track2', 'Track3', 'Track4']);
  assert.deepEqual(resumed.remainingIds, ['Track3', 'Track4']);
  assert.ok(resumed.stagedRecords.Track1);
  assert.ok(resumed.stagedRecords.Track2);
});

test('quota stop leaves the current track pending and records the attempted provider call', () => {
  const checkpoint = core.createOrResumePlan({ events: [event('Track1'), event('Track2')], metadata: metadata() });
  const stopped = core.stopWithoutConsuming(checkpoint, 'quota_exceeded');
  assert.deepEqual(stopped.remainingIds, ['Track1', 'Track2']);
  assert.equal(stopped.requestCount, 1);
  assert.equal(stopped.stopReason, 'quota_exceeded');
});

test('404 is terminal for this backfill window and is not repeatedly planned', () => {
  const events = [event('MissingTrack123'), event('OtherTrack456')];
  let checkpoint = core.createOrResumePlan({ events, metadata: metadata() });
  checkpoint = core.completeNotFound(checkpoint, 'MissingTrack123');
  const resumed = core.createOrResumePlan({ events, metadata: metadata(), checkpoint });
  assert.deepEqual(resumed.remainingIds, ['OtherTrack456']);
  assert.deepEqual(resumed.terminalNotFoundIds, ['MissingTrack123']);
});

test('merging staged records preserves unrelated records and unknown future fields', () => {
  const base = metadata({
    ExistingTrack: {
      spotifyTrackId: 'ExistingTrack',
      spotifyTrackUrl: 'https://open.spotify.com/track/ExistingTrack',
      customFutureRecordField: 'keep-me',
    },
  });
  let checkpoint = core.createOrResumePlan({ events: [event('NewTrack')], metadata: base });
  checkpoint = core.completeSuccess(checkpoint, 'NewTrack', {
    id: 'NewTrack',
    album: { id: 'NewAlbum', images: [{ url: 'https://i.scdn.co/image/new' }] },
  });
  const merged = core.mergeStagedRecords(base, checkpoint);
  assert.deepEqual(merged.futureTopLevelField, { keep: true });
  assert.equal(merged.records.ExistingTrack.customFutureRecordField, 'keep-me');
  assert.equal(merged.records.NewTrack.spotifyTrackId, 'NewTrack');
});

test('a synchronized staged record is removed from the private checkpoint without removing pending work', () => {
  const events = [event('Track1'), event('Track2')];
  let checkpoint = core.createOrResumePlan({ events, metadata: metadata() });
  checkpoint = core.completeSuccess(checkpoint, 'Track1', { id: 'Track1', album: { images: [] } });
  const production = core.mergeStagedRecords(metadata(), checkpoint);
  const cleared = core.clearSynchronizedStages(checkpoint, production);
  assert.deepEqual(cleared.stagedRecords, {});
  assert.deepEqual(cleared.remainingIds, ['Track2']);
});
