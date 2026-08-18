'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const api = require(path.join('..', 'alignedListeningBandsV144.js'));

const groups = ['Rock', 'Pop', 'Hip-hop/R&B', 'Electronic', 'Other'];
const stats = {
  GENRE_GROUPS: groups,
  genreGroup(value) {
    const text = String(value || '').toLowerCase();
    if (/rock|metal|punk/.test(text)) return 'Rock';
    if (/pop/.test(text)) return 'Pop';
    if (/hip-hop|hip hop|r&b|rhythm/.test(text)) return 'Hip-hop/R&B';
    if (/electronic|dance|techno/.test(text)) return 'Electronic';
    return 'Other';
  },
  isValidListen(listen) {
    return Number.isFinite(this.listenTimeMs(listen));
  },
  listenTimeMs(listen) {
    return Date.parse(listen.listenedAt);
  },
  validDurationMs(listen) {
    return Number(listen.listenedDurationMs) || 0;
  },
  formatDuration(value) {
    const minutes = Math.round((Number(value) || 0) / 60000);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `${hours} h ${remainder} min` : `${remainder} min`;
  },
};

function listen(id, bandId, durationMinutes, date = '2026-03-01T12:00:00.000Z') {
  return { id, localBandId: bandId, listenedAt: date, listenedDurationMs: durationMinutes * 60000 };
}

test('v144 selected-year genre data uses stored band genres for both time and listen shares', () => {
  const bands = [
    { id: 'rock', genre: 'alternative rock' },
    { id: 'pop', genre: 'pop' },
    { id: 'hip', genre: 'hip-hop' },
    { id: 'electronic', genre: 'electronic' },
    { id: 'other', genre: 'ambient' },
  ];
  const listens = [
    listen('r1', 'rock', 60),
    listen('r2', 'rock', 30),
    listen('r3', 'rock', 30),
    listen('p1', 'pop', 60),
    listen('h1', 'hip', 30),
    listen('e1', 'electronic', 15),
    listen('o1', 'other', 15),
    // Source-event genre is deliberately misleading; stored band genre wins.
    { ...listen('r4', 'rock', 60), genre: 'pop' },
    // Untracked listens must not leak into the tracked-band genre chart.
    listen('untracked', 'missing-band', 600),
  ];

  const result = api.buildGenreDistributionByYear(listens, bands, stats);
  assert.equal(result.length, 1);
  const year = result[0];
  assert.equal(year.year, 2026);
  assert.equal(year.totalDurationMs, 300 * 60000);
  assert.equal(year.totalListenCount, 8);
  assert.equal(year.durations.Rock, 180 * 60000);
  assert.equal(year.listenCounts.Rock, 4);
  assert.equal(year.percentages.Rock, 60);
  assert.equal(year.listenPercentages.Rock, 50);
  assert.equal(year.percentages.Pop, 20);
  assert.equal(year.listenPercentages.Pop, 12.5);
  assert.equal(Object.values(year.listenCounts).reduce((sum, value) => sum + value, 0), year.totalListenCount);
});

test('v144 genre detail rows expose separate time and listen percentages', () => {
  const item = api.buildGenreDistributionByYear([
    listen('r1', 'rock', 88),
    listen('r2', 'rock', 0),
    listen('p1', 'pop', 12),
    listen('p2', 'pop', 0),
  ], [
    { id: 'rock', genre: 'rock' },
    { id: 'pop', genre: 'pop' },
  ], stats)[0];

  const rows = api.genreDetailRows(item, stats);
  const total = rows.find((row) => row.label === 'Total');
  const rock = rows.find((row) => row.label === 'Rock');
  assert.equal(total.value, '1 h 40 min · 4 listens');
  assert.match(rock.value, /^1 h 28 min \(88 %\) · 2 listens \(50 %\)$/);
  assert.doesNotMatch(total.value, /%/);
});

test('v144 My Bands statuses show only favorite and alerts-off exceptional states', () => {
  assert.deepEqual(api.statusKinds({ favorite: false, muted: false }), []);
  assert.deepEqual(api.statusKinds({ favorite: true, muted: false }), ['favorite']);
  assert.deepEqual(api.statusKinds({ favorite: false, muted: true }), ['muted']);
  assert.deepEqual(api.statusKinds({ favorite: true, muted: true }), ['favorite', 'muted']);
});

test('v144 stored-genre attribution preserves first recognized stored genre semantics', () => {
  assert.equal(api.bandGenreGroup({ genres: ['unmapped style', 'pop', 'rock'] }, stats), 'Pop');
  assert.equal(api.bandGenreGroup({ genre: ['unknown thing', 'metal'] }, stats), 'Rock');
  assert.equal(api.bandGenreGroup({ genre: 'ambient' }, stats), 'Other');
});
