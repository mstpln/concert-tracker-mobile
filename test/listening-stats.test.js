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

function fixtureTime(item) {
  const candidates = [item.listenedAtMs, item.listenedAtUnix, item.listenedAtSeconds, item.timestamp, item.listenedAt];
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(candidate));
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

test('synthetic fixtures are deterministic and include normalized plus production-shaped listening records', () => {
  const first = fixtures.createSyntheticListens(BANDS, NOW);
  const second = fixtures.createSyntheticListens(BANDS, NOW);
  assert.deepEqual(first, second);
  assert.ok(first.length > 100);
  for (const item of first) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.recordingTitle, 'string');
    assert.equal(typeof item.artistCreditName, 'string');
    assert.ok(['synthetic-listenbrainz', 'spotify_import', 'listenbrainz'].includes(item.source));
    if (item.id !== 'synthetic-production-shape-malformed-optional') assert.equal(Number.isFinite(fixtureTime(item)), true);
    assert.ok(item.listenedDurationMs == null || (typeof item.listenedDurationMs === 'number' && item.listenedDurationMs > 0));
  }
  assert.ok(first.some((item) => item.source === 'synthetic-listenbrainz' && typeof item.listenedAt === 'string' && typeof item.listenedAtMs === 'number'));
  assert.ok(first.some((item) => item.source === 'spotify_import' && item.listenedAtMs == null));
  assert.ok(first.some((item) => item.source === 'listenbrainz' && Number.isFinite(item.timestamp)));
  assert.ok(first.some((item) => item.listenedAt === 'not-a-real-date'));
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
    listen('before-current', '2027-04-16T11:59:59.999Z', 60000),
    listen('current-start', '2027-04-16T12:00:00.000Z', 60000),
    listen('now', '2027-07-16T12:00:00.000Z', 60000),
    listen('after-now', '2027-07-16T12:00:00.001Z', 60000),
    listen('previous-start', '2027-01-16T12:00:00.000Z', 60000),
  ];
  assert.deepEqual(stats.listensForWindow(values, window).map((item) => item.id), ['current-start', 'now']);
  assert.deepEqual(stats.previousListensForWindow(values, window).map((item) => item.id), ['before-current', 'previous-start']);
});

test('one-year and all-time windows resolve consistently', () => {
  const values = [listen('old', '2020-03-01T00:00:00.000Z', 60000), listen('recent', '2027-06-01T00:00:00.000Z', 60000)];
  const year = stats.resolveWindow('oneYear', NOW, values);
  assert.equal(new Date(year.startMs).toISOString(), '2026-07-16T12:00:00.000Z');
  const all = stats.resolveWindow('allTime', NOW, values);
  assert.equal(new Date(all.startMs).toISOString(), '2020-03-01T00:00:00.000Z');
  assert.equal(all.previousStartMs, null);
});

test('duration, listen count, and last listened ignore invalid played duration', () => {
  const values = [
    listen('valid', '2027-07-01T00:00:00.000Z', 60000),
    listen('zero', '2027-07-02T00:00:00.000Z', 0),
    listen('bad', '2027-07-03T00:00:00.000Z', 'invalid'),
  ];
  assert.equal(stats.totalDurationMs(values), 60000);
  assert.equal(stats.listenCount(values), 1);
  assert.equal(stats.lastListened(values).id, 'valid');
});

test('top bands and tracks use duration, count, then normalized name tie-breakers', () => {
  const bands = [{ id: 'a', name: 'Álpha' }, { id: 'b', name: 'Beta' }];
  const values = [
    listen('zeta', '2027-07-01T00:00:00.000Z', 60000, { recordingTitle: 'Zeta', localBandId: 'a' }),
    listen('alpha', '2027-07-02T00:00:00.000Z', 60000, { recordingTitle: 'Alpha', localBandId: 'b', artistCreditName: 'Beta' }),
  ];
  assert.deepEqual(stats.topBands(values, bands).map((item) => item.bandId), ['a', 'b']);
  assert.deepEqual(stats.topTracks(values).map((item) => item.recordingTitle), ['Alpha', 'Zeta']);
});

test('unmatched and deleted artists remain in listens but not linked rankings', () => {
  const bands = [{ id: 'a', name: 'Alpha' }];
  const values = [
    listen('linked', '2027-07-01T00:00:00.000Z', 60000, { localBandId: 'a' }),
    listen('unmatched', '2027-07-02T00:00:00.000Z', 60000, { localBandId: null }),
    listen('deleted', '2027-07-03T00:00:00.000Z', 60000, { localBandId: 'deleted' }),
  ];
  const selected = stats.selectedStats(values, bands, 'allTime', NOW);
  assert.equal(selected.listens.length, 3);
  assert.deepEqual(selected.topBands.map((item) => item.bandId), ['a']);
});

test('rank movement represents up, down, New, unchanged, and all-time omission', () => {
  const current = [
    { bandId: 'a', rank: 1 },
    { bandId: 'b', rank: 2 },
    { bandId: 'c', rank: 3 },
    { bandId: 'd', rank: 4 },
  ];
  const previous = [
    { bandId: 'b', rank: 1 },
    { bandId: 'a', rank: 2 },
    { bandId: 'c', rank: 3 },
  ];
  const moved = stats.rankMovement(current, previous, 'threeMonths');
  assert.deepEqual(moved.map((item) => item.movement?.kind || null), ['up', 'down', null, 'new']);
  assert.ok(stats.rankMovement(current, previous, 'allTime').every((item) => item.movement === null));
});

test('weekly, monthly, and yearly buckets fill missing periods with zero', () => {
  const values = [listen('one', '2027-04-17T00:00:00.000Z', 3600000), listen('two', '2027-07-15T00:00:00.000Z', 7200000)];
  const weekWindow = stats.resolveWindow('threeMonths', NOW, values);
  const weeks = stats.timeBuckets(values, weekWindow, 'week');
  assert.ok(weeks.length >= 13);
  assert.ok(weeks.some((item) => item.durationMs === 0));
  const yearWindow = stats.resolveWindow('allTime', NOW, [listen('old', '2025-01-01T00:00:00.000Z', 60000), ...values]);
  assert.deepEqual(stats.timeBuckets([listen('old', '2025-01-01T00:00:00.000Z', 60000), ...values], yearWindow, 'year').map((item) => item.label), ['2025', '2026', '2027']);
});

test('genre distribution totals 100 percent and maps unknown genres to Other', () => {
  const values = [
    listen('rock', '2026-01-01T00:00:00.000Z', 3600000, { genre: 'alternative rock' }),
    listen('other', '2026-02-01T00:00:00.000Z', 3600000, { genre: 'neo-classical' }),
  ];
  const distribution = stats.genreDistributionByYear(values);
  assert.equal(distribution.length, 1);
  assert.equal(Object.values(distribution[0].percentages).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(distribution[0].percentages.Rock, 50);
  assert.equal(distribution[0].percentages.Other, 50);
});

test('empty data and large durations format without fabricated values', () => {
  assert.equal(stats.selectedStats([], BANDS, 'threeMonths', NOW).listenCount, 0);
  assert.equal(stats.formatDuration(0), '0 min');
  assert.equal(stats.formatDuration(10000 * 3600000 + 59 * 60000), '10,000 h 59 min');
});
