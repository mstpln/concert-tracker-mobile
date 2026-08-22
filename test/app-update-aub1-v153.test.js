'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const base = require('../appUpdateAub1V153.js');
const corrections = require('../appUpdateAub1V153Corrections.js');

const HOUR = 60 * 60 * 1000;
const statsApi = {
  isValidListen(listen) {
    return Number.isFinite(Number(listen?.listenedAtMs)) && Number(listen?.listenedDurationMs) > 0;
  },
  listenTimeMs(listen) {
    return Number(listen?.listenedAtMs);
  },
  validDurationMs(listen) {
    const value = Number(listen?.listenedDurationMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  },
  formatDuration(value) {
    return `${Math.round(Number(value || 0) / HOUR)} h`;
  },
};

function listen(iso, hours, localBandId = 'band-1') {
  return {
    listenedAtMs: Date.parse(iso),
    listenedDurationMs: hours * HOUR,
    localBandId,
  };
}

test('AUB1 activity metrics use unique UTC listening dates and active-day averages', () => {
  const listens = [
    listen('2025-01-02T01:00:00Z', 1),
    listen('2025-01-02T22:00:00Z', 2),
    listen('2025-01-03T12:00:00Z', 1),
  ];

  const result = base.activityMetrics(listens, statsApi);
  assert.equal(result.activeDays, 2);
  assert.equal(result.durationMs, 4 * HOUR);
  assert.equal(result.dailyAverageMs, 2 * HOUR);
});

test('AUB1 completed-year average follows the continuous represented calendar-year span and excludes current year', () => {
  const bands = [{ id: 'band-1' }];
  const listens = [
    listen('2022-01-02T12:00:00Z', 1),
    listen('2022-02-03T12:00:00Z', 1),
    listen('2024-07-04T12:00:00Z', 2),
    listen('2026-01-05T12:00:00Z', 4),
    listen('2024-08-01T12:00:00Z', 10, 'unlinked-band'),
  ];

  const result = corrections.completedYearActivity(
    listens,
    new Date('2026-08-21T08:00:00Z'),
    bands,
    statsApi,
  );

  assert.deepEqual(result.completedYears.map((item) => [item.year, item.activeDays]), [
    [2022, 2],
    [2023, 0],
    [2024, 1],
    [2025, 0],
  ]);
  assert.equal(result.activeDaysPerYear, 0.75);
  assert.equal(result.allTime.activeDays, 4);
  assert.equal(result.allTime.durationMs, 8 * HOUR);
  assert.equal(result.allTime.dailyAverageMs, 2 * HOUR);
});

test('AUB1 alert relevance is singular and follows Nearby > SE > EU > none for single and tour alerts', () => {
  const nearby = (concert) => concert?.nearby === true;
  const europe = (country) => ['Sweden', 'Denmark', 'Germany'].includes(country);
  const foundAt = '2026-08-20T10:00:00Z';
  let concerts = [
    { bandId: 'b1', foundAt, country: 'Germany' },
    { bandId: 'b1', foundAt, country: 'Sweden' },
    { bandId: 'b1', foundAt, country: 'Denmark', nearby: true },
  ];

  assert.equal(corrections.relevanceTag({ country: 'Sweden' }, concerts, nearby, europe), 'SE');
  assert.equal(corrections.relevanceTag({ country: 'Germany' }, concerts, nearby, europe), 'EU');
  assert.equal(corrections.relevanceTag({ country: 'Canada' }, concerts, nearby, europe), '');
  assert.equal(corrections.relevanceTag({ country: 'Sweden', nearby: true }, concerts, nearby, europe), 'Nearby');
  assert.equal(corrections.relevanceTag({ isBatch: true, bandId: 'b1', foundAt }, concerts, nearby, europe), 'Nearby');

  concerts = concerts.map((concert) => ({ ...concert, nearby: false }));
  assert.equal(corrections.relevanceTag({ isBatch: true, bandId: 'b1', foundAt }, concerts, nearby, europe), 'SE');

  concerts = concerts.filter((concert) => concert.country !== 'Sweden');
  assert.equal(corrections.relevanceTag({ isBatch: true, bandId: 'b1', foundAt }, concerts, nearby, europe), 'EU');
});

test('AUB1 approved Stats glyph has angular trend plus arrowhead and no dots or box', () => {
  assert.match(base.STATS_SVG, /aub1-stats-glyph/);
  assert.match(base.STATS_SVG, /M3\.5 18\.5/);
  assert.match(base.STATS_SVG, /M16\.8 6\.6/);
  assert.equal(base.STATS_SVG.includes('<circle'), false);
  assert.equal(base.STATS_SVG.includes('<rect'), false);
  assert.equal((base.STATS_SVG.match(/<path/g) || []).length, 2);
  assert.match(base.EQUALIZER_SVG, /M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5/);
});
