'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const vault = require('../listeningVault.js');

test('builds a deterministic sanitized Spotify archive payload', () => {
  globalThis.LiveVaultSpotifyHistory = {
    sanitizeEvent(event) {
      return {
        stableListenId: event.stableListenId,
        listenedAt: new Date(event.listenedAt).toISOString(),
        listenedDurationMs: event.listenedDurationMs,
        artistCreditName: event.artistCreditName,
        recordingTitle: event.recordingTitle,
        releaseTitle: event.releaseTitle || null,
        spotifyTrackId: event.spotifyTrackId,
        source: 'spotify_import',
      };
    },
  };

  const payload = vault.buildPayload([
    {
      stableListenId: 'b',
      listenedAt: '2026-07-30T10:00:00Z',
      listenedDurationMs: 180000,
      artistCreditName: 'Artist B',
      recordingTitle: 'Track B',
      spotifyTrackId: 'track-b',
    },
    {
      stableListenId: 'a',
      listenedAt: '2026-07-29T10:00:00Z',
      listenedDurationMs: 120000,
      artistCreditName: 'Artist A',
      recordingTitle: 'Track A',
      spotifyTrackId: 'track-a',
      localBandId: 'derived-only',
    },
  ]);

  assert.equal(payload.kind, 'livevault-listening-history');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.summary.eventCount, 2);
  assert.equal(payload.events[0].stableListenId, 'a');
  assert.equal(payload.events[0].localBandId, undefined);
});

test('worker exposes only bounded explicit listening-vault routes', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /listening\/manifest\.json/);
  assert.match(worker, /spotify-history/);
  assert.match(worker, /MAX_LISTENING_ARCHIVE_BYTES = 100 \* 1024 \* 1024/);
  assert.match(worker, /role !== 'browser' && role !== 'legacy'/);
  assert.match(worker, /If-None-Match/);
  assert.doesNotMatch(worker, /listening\/\.\*/);
});

test('QA build strips all private listening-vault modules', () => {
  const build = fs.readFileSync('scripts/build-qa.js', 'utf8');
  assert.match(build, /listeningVaultBridge\.js/);
  assert.match(build, /listeningVault\.js/);
  assert.match(build, /replace\('<script src="listeningVault\.js"><\\\/script>'/);
});
