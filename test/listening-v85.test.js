'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../listeningStats.js');
require('../listeningStatsV81.js');
require('../listeningV85RankingAndStatsUnits.js');

const api = globalThis.ListeningStats;
const base = Date.UTC(2026, 7, 3, 12, 0, 0);
const listen = (title, album, durationMs, offset, extra = {}) => ({
  listenedAtMs: base - offset,
  listenedDurationMs: durationMs,
  recordingTitle: title,
  releaseTitle: album,
  artistCreditName: 'Synthetic Artist',
  localBandId: 'band-a',
  ...extra,
});

test('Top Tracks and Top Albums rank by listen count before known duration', () => {
  const listens = [
    listen('Long Track', 'Long Album', 600000, 1000),
    listen('Short Track', 'Short Album', 60000, 2000),
    listen('Short Track', 'Short Album', 60000, 3000),
    listen('Short Track', 'Short Album', 60000, 4000),
  ];

  const tracks = api.topTracks(listens, 10);
  const albums = api.topAlbums(listens, 10);
  assert.equal(tracks[0].recordingTitle, 'Short Track');
  assert.equal(tracks[0].listenCount, 3);
  assert.equal(albums[0].releaseTitle, 'Short Album');
  assert.equal(albums[0].listenCount, 3);
});

test('selectedStats exposes listen-ranked tracks and albums for every timeframe', () => {
  const listens = [
    listen('Long Track', 'Long Album', 900000, 1000),
    listen('Short Track', 'Short Album', 30000, 2000),
    listen('Short Track', 'Short Album', 30000, 3000),
  ];
  const bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  const result = api.selectedStats(listens, bands, 'allTime', new Date(base));
  assert.equal(result.topTracks[0].recordingTitle, 'Short Track');
  assert.equal(result.topAlbums[0].releaseTitle, 'Short Album');
});

test('unknown-duration listens count toward track and album ranking', () => {
  const listens = [
    listen('Known Once', 'Known Once Album', 600000, 1000),
    listen('Unknown Twice', 'Unknown Twice Album', undefined, 2000),
    listen('Unknown Twice', 'Unknown Twice Album', undefined, 3000),
  ];
  const tracks = api.topTracks(listens, 10);
  const albums = api.topAlbums(listens, 10);
  assert.equal(tracks[0].recordingTitle, 'Unknown Twice');
  assert.equal(tracks[0].listenCount, 2);
  assert.equal(albums[0].releaseTitle, 'Unknown Twice Album');
});
