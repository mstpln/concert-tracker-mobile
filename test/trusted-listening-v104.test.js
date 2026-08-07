'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const REL_A = '12345678-1234-4234-8234-123456789abc';
const REL_B = '87654321-4321-4321-8321-cba987654321';

function loadTrusted() {
  global.ListeningStats = {
    isValidListen: () => true,
    validDurationMs: () => 180000,
    listenTimeMs: (listen) => Date.parse(listen.listenedAt || '2026-08-01T10:00:00.000Z'),
  };
  delete require.cache[require.resolve('../trustedListeningV99.js')];
  const api = require('../trustedListeningV99.js');
  delete global.ListeningStats;
  return api;
}

function listen(releaseMbid, spotifyAlbumId) {
  return {
    artistCreditName: 'Synthetic Artist',
    releaseTitle: 'Synthetic Album',
    musicbrainzReleaseId: releaseMbid,
    spotifyAlbumId,
    spotifyAlbumUrl: `https://open.spotify.com/album/${spotifyAlbumId}`,
    listenedAt: '2026-08-01T10:00:00.000Z',
  };
}

test('specific MusicBrainz edition resolves Spotify metadata only from the same edition', () => {
  const trusted = loadTrusted();
  const source = [listen(REL_A, 'SpotifyAlbumA'), listen(REL_B, 'SpotifyAlbumB')];
  const result = trusted.exactMetadataForItem({
    releaseKey: `mb-release:${REL_A}`,
    releaseTitle: 'Synthetic Album',
    artistCreditName: 'Synthetic Artist',
  }, true, source);
  assert.equal(result.spotifyAlbumId, 'SpotifyAlbumA');
  assert.equal(result.spotifyAlbumUrl, 'https://open.spotify.com/album/SpotifyAlbumA');
});

test('fallback same-title album stays non-clickable when Spotify editions conflict', () => {
  const trusted = loadTrusted();
  const source = [listen(REL_A, 'SpotifyAlbumA'), listen(REL_B, 'SpotifyAlbumB')];
  const result = trusted.exactMetadataForItem({
    releaseKey: 'fallback:synthetic artist|synthetic album',
    releaseTitle: 'Synthetic Album',
    artistCreditName: 'Synthetic Artist',
  }, true, source);
  assert.equal(result, null);
});
