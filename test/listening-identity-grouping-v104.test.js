'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const grouping = require('../listeningIdentityGroupingV104.js');

const REL_A = '12345678-1234-4234-8234-123456789abc';
const REL_B = '87654321-4321-4321-8321-cba987654321';

const stats = {
  isValidListen: () => true,
  validDurationMs: (entry) => Number(entry.listenedDurationMs) || 0,
  listenTimeMs: (entry) => Date.parse(entry.listenedAt),
};

function listen(id, overrides = {}) {
  return {
    stableListenId: id,
    listenedAt: '2026-08-01T10:00:00.000Z',
    listenedDurationMs: 180000,
    artistCreditName: 'Synthetic Artist',
    releaseTitle: 'Synthetic Album',
    ...overrides,
  };
}

test('one partially enriched release does not split otherwise identical historical album listens', () => {
  const rows = grouping.aggregateAlbums([
    listen('known', { musicbrainzReleaseId: REL_A }),
    listen('unknown-1'),
    listen('unknown-2'),
  ], 10, stats);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].listenCount, 3);
  assert.equal(rows[0].musicbrainzReleaseId, REL_A);
});

test('two conflicting trusted MusicBrainz releases split same-title editions while unresolved listens stay separate', () => {
  const rows = grouping.aggregateAlbums([
    listen('edition-a', { musicbrainzReleaseId: REL_A }),
    listen('edition-b', { musicbrainzReleaseId: REL_B }),
    listen('unknown'),
  ], 10, stats);
  assert.equal(rows.length, 3);
  assert.deepEqual(new Set(rows.map((row) => row.releaseKey)), new Set([
    `mb-release:${REL_A}`,
    `mb-release:${REL_B}`,
    'fallback:synthetic artist|synthetic album',
  ]));
});

test('one MusicBrainz release and one Spotify album identity do not split a cross-provider text group without a bridge', () => {
  const rows = grouping.aggregateAlbums([
    listen('mb', { musicbrainzReleaseId: REL_A }),
    listen('spotify', { spotifyAlbumId: 'SpotifyAlbum123' }),
    listen('unknown'),
  ], 10, stats);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].listenCount, 3);
});
