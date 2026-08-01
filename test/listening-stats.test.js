'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stats = require('../listeningStats');
const fixtures = require('../listeningFixtures');

const NOW = new Date('2027-07-16T12:00:00.000Z');
const BANDS = [
  { id: 'band-a', name: 'Alpha', musicbrainz: { mbid: 'mbid-a', spotify: { id: 'spotify-a' } } },
  { id: 'band-b', name: 'Beta', musicbrainz: { mbid: 'mbid-b' } },
  { id: 'band-c', name: 'Gamma' },
  { id: 'band-d', name: 'Delta' },
  { id: 'band-e', name: 'Epsilon' },
];

function listen(id, listenedAt, duration, overrides = {}) {
  return { id, listenedAt, listenedAtMs: new Date(listenedAt).getTime(), listenedDurationMs: duration, recordingTitle: id, artistCreditName: 'Alpha', localBandId: 'band-a', genre: 'rock', source: 'synthetic-listenbrainz', ...overrides };
}

test('synthetic fixtures are deterministic and normalized for future ListenBrainz adapters', () => {
  const first = fixtures.createSyntheticListens(BANDS, NOW);
  const second = fixtures.createSyntheticListens(BANDS, NOW);
  assert.deepEqual(first, second);
  assert.ok(first.length > 100);
  for (const item of first) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.listenedAt, 'string');
    assert.equal(typeof item.listenedAtMs, 'number');
    assert.equal(typeof item.listenedDurationMs, 'number');
    assert.equal(item.source, 'synthetic-listenbrainz');
    assert.equal(typeof item.recordingTitle, 'string');
    assert.equal(typeof item.artistCreditName, 'string');
  }
  assert.ok(first.some((item) => !item.musicbrainzRecordingId));
  assert.ok(first.some((item) => item.localBandId === null));
  assert.ok(first.some((item) => item.artworkPath === null));
});

test('synthetic listening history is enabled only by the isolated QA bootstrap', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const qaBootstrap = fs.readFileSync(path.join(root, 'qa', 'qa-bootstrap.js'), 'utf8');
  assert.match(app, /window\.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true\s*\? ListeningFixtures\.createSyntheticListens/);
  assert.match(qaBootstrap, /window\.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ = true;/);
});

test('three-month and previous-period boundaries are half-open and calendar based', () => {
  const window = stats.resolveWindow('threeMonths', NOW);
  assert.equal(new Date(window.startMs).toISOString(), '2027-04-16T12:00:00.000Z');
  assert.equal(new Date(window.previousStartMs).toISOString(), '2027-01-16T12:00:00.000Z');
  const values = [
    listen('before', '2027-04-16T11:59:59.999Z', 1000),
    listen('start', '2027-04-16T12:00:00.000Z', 1000),
    listen('now', '2027-07-16T12:00:00.000Z', 1000),
    listen('future', '2027-07-16T12:00:00.001Z', 1000),
  ];
  assert.deepEqual(stats.listensForWindow(values, window).map((item) => item.id), ['start', 'now']);
});

test('one-year and all-time windows resolve consistently', () => {
  const year = stats.resolveWindow('oneYear', NOW);
  assert.equal(new Date(year.startMs).toISOString(), '2026-07-16T12:00:00.000Z');
  assert.equal(new Date(year.previousStartMs).toISOString(), '2025-07-16T12:00:00.000Z');
  const values = [listen('old', '2019-01-01T00:00:00.000Z', 1000), listen('new', NOW.toISOString(), 1000)];
  const all = stats.resolveWindow('allTime', NOW, values);
  assert.equal(new Date(all.startMs).toISOString(), '2019-01-01T00:00:00.000Z');
  assert.equal(all.previousStartMs, null);
});

test('duration, listen count, and last listened ignore invalid played duration', () => {
  const values = [
    listen('a', '2027-01-01T00:00:00Z', 60000),
    listen('b', '2027-01-02T00:00:00Z', 120000),
    listen('zero', '2027-01-03T00:00:00Z', 0),
    listen('negative', '2027-01-04T00:00:00Z', -1),
    listen('bad', '2027-01-05T00:00:00Z', 'bad'),
  ];
  assert.equal(stats.totalDurationMs(values), 180000);
  assert.equal(stats.listenCount(values), 2);
  assert.equal(stats.lastListened(values).id, 'b');
});

test('top bands and tracks use duration, count, then normalized name tie-breakers', () => {
  const values = [
    listen('Zulu', '2027-07-01T00:00:00Z', 1000, { localBandId: 'band-b', artistCreditName: 'Beta', recordingTitle: 'Zulu' }),
    listen('Alpha', '2027-07-02T00:00:00Z', 1000, { localBandId: 'band-a', recordingTitle: 'Alpha' }),
  ];
  assert.deepEqual(stats.topBands(values, BANDS).map((item) => item.bandName), ['Alpha', 'Beta']);
  assert.deepEqual(stats.topTracks(values).map((item) => item.recordingTitle), ['Alpha', 'Zulu']);
});

test('unmatched and deleted artists remain in listens but not linked rankings', () => {
  const values = [
    listen('matched', '2027-07-01T00:00:00Z', 1000),
    listen('unmatched', '2027-07-02T00:00:00Z', 5000, { localBandId: null, artistCreditName: 'Unknown' }),
    listen('deleted', '2027-07-03T00:00:00Z', 5000, { localBandId: 'missing-band', artistCreditName: 'Deleted' }),
  ];
  assert.equal(stats.totalDurationMs(values), 11000);
  assert.deepEqual(stats.topBands(values, BANDS).map((item) => item.bandId), ['band-a']);
});

test('rank movement represents up, down, New, unchanged, and all-time omission', () => {
  const current = [{ bandId: 'a', rank: 1 }, { bandId: 'b', rank: 2 }, { bandId: 'c', rank: 3 }, { bandId: 'd', rank: 4 }];
  const previous = [{ bandId: 'b', rank: 1 }, { bandId: 'a', rank: 2 }, { bandId: 'd', rank: 4 }];
  const moved = stats.rankMovement(current, previous, 'threeMonths');
  assert.deepEqual(moved.map((item) => item.movement?.kind || null), ['up', 'down', 'new', null]);
  assert.ok(stats.rankMovement(current, previous, 'allTime').every((item) => item.movement === null));
});

test('weekly, monthly, and yearly buckets fill missing periods with zero', () => {
  const values = [listen('only', '2027-07-01T00:00:00Z', 3600000)];
  const weekly = stats.timeBuckets(values, stats.resolveWindow('threeMonths', NOW), 'week');
  const monthly = stats.timeBuckets(values, stats.resolveWindow('oneYear', NOW), 'month');
  const yearly = stats.timeBuckets(values, stats.resolveWindow('allTime', NOW, values), 'year');
  assert.ok(weekly.length >= 13);
  assert.equal(new Date(weekly[0].startAt).getUTCDay(), 1);
  assert.equal(monthly.length, 13);
  assert.equal(yearly.length, 1);
  assert.ok(weekly.some((bucket) => bucket.durationMs === 0));
  assert.equal(weekly.reduce((sum, bucket) => sum + bucket.durationMs, 0), 3600000);
});

test('genre distribution totals 100 percent and maps unknown genres to Other', () => {
  const distribution = stats.genreDistributionByYear([
    listen('rock', '2026-01-01T00:00:00Z', 1000, { genre: 'metal' }),
    listen('unknown', '2026-02-01T00:00:00Z', 1000, { genre: 'uncategorized' }),
  ]);
  assert.equal(Object.values(distribution[0].percentages).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(distribution[0].percentages.Rock, 50);
  assert.equal(distribution[0].percentages.Other, 50);
});

test('empty data and large durations format without fabricated values', () => {
  const selected = stats.selectedStats([], BANDS, 'threeMonths', NOW);
  assert.equal(selected.listenCount, 0);
  assert.equal(selected.durationMs, 0);
  assert.equal(selected.lastListened, null);
  assert.deepEqual(selected.topBands, []);
  assert.equal(stats.formatDuration(9876543210), '2,743 h 29 min');
});
