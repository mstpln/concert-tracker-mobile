'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SpotifyHistory = require('../spotifyHistoryImport.js');

test('sanitizes a valid Spotify history event to the strict allowlist', () => {
  const event = SpotifyHistory.sanitizeEvent({
    stableListenId: 'spotify-import:abc',
    listenedAt: '2026-07-15T12:00:00Z',
    listenedDurationMs: 180000,
    artistCreditName: 'Test Artist',
    recordingTitle: 'Test Track',
    releaseTitle: 'Test Album',
    spotifyTrackId: '123',
    source: 'spotify_import',
    ip_addr: '127.0.0.1',
    platform: 'secret device',
    username: 'private-user',
  });

  assert.deepEqual(Object.keys(event), SpotifyHistory.ALLOWED_EVENT_KEYS);
  assert.equal(event.ip_addr, undefined);
  assert.equal(event.platform, undefined);
  assert.equal(event.username, undefined);
});

test('rejects plays shorter than thirty seconds', () => {
  assert.equal(SpotifyHistory.sanitizeEvent({
    stableListenId: 'spotify-import:short',
    listenedAt: '2026-07-15T12:00:00Z',
    listenedDurationMs: 29999,
    artistCreditName: 'Test Artist',
    recordingTitle: 'Test Track',
    spotifyTrackId: '123',
  }), null);
});

test('rejects malformed and non-track history records', () => {
  assert.equal(SpotifyHistory.sanitizeEvent({
    stableListenId: 'spotify-import:podcast',
    listenedAt: '2026-07-15T12:00:00Z',
    listenedDurationMs: 60000,
    episodeName: 'Podcast episode',
  }), null);
});

test('deduplicates stable listen IDs and sorts chronologically', () => {
  const base = {
    listenedDurationMs: 60000,
    artistCreditName: 'Artist',
    recordingTitle: 'Track',
    spotifyTrackId: 'track-id',
  };
  const result = SpotifyHistory.validatePayload({
    kind: 'livevault-listening-history',
    schemaVersion: 1,
    events: [
      { ...base, stableListenId: 'b', listenedAt: '2026-07-16T12:00:00Z' },
      { ...base, stableListenId: 'a', listenedAt: '2026-07-15T12:00:00Z' },
      { ...base, stableListenId: 'a', listenedAt: '2026-07-15T12:00:00Z' },
    ],
  });

  assert.equal(result.events.length, 2);
  assert.equal(result.rejected, 1);
  assert.deepEqual(result.events.map((event) => event.stableListenId), ['a', 'b']);
});
