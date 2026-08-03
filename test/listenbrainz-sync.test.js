'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const listenbrainz = require('../listenbrainzSync.js');
const historyV2 = require('../listeningHistoryV2.js');
const incremental = require('../listeningIncrementalVault.js');

test('normalizes ListenBrainz listens without inventing missing duration', () => {
  const event = listenbrainz.normalizeListen({
    listened_at: 1785751200,
    recording_msid: '11111111-2222-4333-8444-555555555555',
    track_metadata: {
      artist_name: 'Synthetic Artist',
      track_name: 'Synthetic Track',
      release_name: 'Synthetic Album',
      additional_info: {
        recording_mbid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        artist_mbids: ['12345678-1234-4123-8123-123456789abc'],
      },
    },
  });
  assert.equal(event.source, 'listenbrainz');
  assert.equal(event.listenedDurationMs, null);
  assert.equal(event.spotifyTrackId, null);
  assert.match(event.stableListenId, /^listenbrainz:/);
  assert.equal(event.musicbrainzArtistIds.length, 1);
});

test('provider-neutral sanitizer preserves Spotify rules and accepts ListenBrainz identity', () => {
  const listen = historyV2.sanitizeEvent({
    stableListenId: 'listenbrainz:1:test',
    listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: null,
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Track',
    source: 'listenbrainz',
    musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  });
  assert.equal(listen.source, 'listenbrainz');
  assert.equal(listen.listenedDurationMs, null);
  assert.equal(listen.musicbrainzRecordingId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

  assert.equal(historyV2.sanitizeEvent({
    stableListenId: 'spotify:invalid', listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: 10000, artistCreditName: 'Artist', recordingTitle: 'Track',
    spotifyTrackId: 'track', source: 'spotify_import',
  }), null);
});

test('fetches only newer listens and uses bounded paging', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ payload: { listens: [{
        listened_at: 1785751201,
        recording_msid: '11111111-2222-4333-8444-555555555555',
        track_metadata: { artist_name: 'Synthetic Artist', track_name: 'Synthetic Track', additional_info: { duration_ms: 180000 } },
      }] } }),
    };
  };
  const events = await listenbrainz.fetchNewListens({
    userName: 'synthetic-user', token: 'synthetic-token', afterMs: 1785751200000, fetchImpl,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].listenedDurationMs, 180000);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /count=100/);
  assert.match(calls[0], /min_ts=1785751200/);
});

test('builds deterministic month-scoped incremental payloads', () => {
  globalThis.LiveVaultSpotifyHistory = { sanitizeEvent: historyV2.sanitizeEvent };
  const payload = incremental.buildPayload('2026-08', [{
    stableListenId: 'listenbrainz:1:test', listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: 180000, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track',
    source: 'listenbrainz',
  }]);
  assert.equal(payload.kind, 'livevault-listening-incremental');
  assert.equal(payload.month, '2026-08');
  assert.equal(payload.summary.eventCount, 1);
});

test('worker exposes only explicit bounded ListenBrainz object paths', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /LISTENBRAINZ_ARCHIVE_PATTERN/);
  assert.match(worker, /listening\\\/listenbrainz/);
  assert.match(worker, /incrementals\.length>10000/);
  assert.match(worker, /role !== 'browser' && role !== 'legacy'/);
  assert.doesNotMatch(worker, /listenbrainz\/\.\*/);
});

test('public QA strips every private v80 listening module', () => {
  const build = fs.readFileSync('scripts/build-qa.js', 'utf8');
  for (const file of ['listeningHistoryV2.js', 'listeningIncrementalVault.js', 'listenbrainzSync.js']) {
    assert.match(build, new RegExp(`replace\\('<script src="${file.replace('.', '\\.')}"><\\/script>', ''\\)`));
  }
});
