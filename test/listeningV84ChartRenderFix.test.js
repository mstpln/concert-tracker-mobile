'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadModule(statsApi) {
  const path = require.resolve('../listeningV84ChartRenderFix.js');
  delete require.cache[path];
  global.ListeningStats = statsApi;
  const api = require('../listeningV84ChartRenderFix.js');
  delete global.ListeningStats;
  return api;
}

function statsApi() {
  const listenTimeMs = (listen) => Number.isFinite(Number(listen.listenedAtMs))
    ? Number(listen.listenedAtMs)
    : Date.parse(listen.listenedAt);
  const validDurationMs = (listen) => Number(listen.listenedDurationMs) > 0 ? Number(listen.listenedDurationMs) : 0;
  const topBands = (listens, bands) => {
    const totals = new Map();
    for (const listen of listens) {
      const item = totals.get(listen.localBandId) || { bandId: listen.localBandId, bandName: bands.find((band) => band.id === listen.localBandId)?.name, durationMs: 0, listenCount: 0 };
      item.durationMs += validDurationMs(listen);
      item.listenCount += 1;
      totals.set(listen.localBandId, item);
    }
    return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs).map((item, index) => ({ ...item, rank: index + 1 }));
  };
  return {
    listenTimeMs,
    validDurationMs,
    isValidListen: (listen) => Number.isFinite(listenTimeMs(listen)),
    topBands,
    rankMovement: (current) => current,
    topTracks: () => [],
    topAlbums: () => [],
    formatDuration: (duration) => `${Math.round(duration / 60000)} min`,
  };
}

test('v84 builds consecutive daily buckets for the rolling two-week window', () => {
  const stats = statsApi();
  const api = loadModule(stats);
  const now = new Date('2026-08-03T12:00:00Z');
  const window = api.explicitTwoWeekWindow(now);
  const listens = [
    { listenedAt: '2026-07-21T14:00:00Z', listenedDurationMs: 180000 },
    { listenedAtMs: Date.parse('2026-08-03T10:00:00Z'), listenedDurationMs: 240000 },
    { listenedAt: '2020-01-01T00:00:00Z', listenedDurationMs: 999000 },
  ];
  const buckets = api.buildDailyBuckets(listens, window, stats);
  assert.equal(buckets.length, 15);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.listenCount, 0), 2);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.durationMs, 0), 420000);
  assert.ok(buckets.every((bucket) => !/^20\d{2}$/.test(bucket.label)));
});

test('v84 two-week stats exclude old events and include unknown-duration listens', () => {
  const stats = statsApi();
  const api = loadModule(stats);
  const now = new Date('2026-08-03T12:00:00Z');
  const bands = [{ id: 'band-a', name: 'Band A' }];
  const listens = [
    { localBandId: 'band-a', listenedAt: '2026-08-02T10:00:00Z', listenedDurationMs: 180000 },
    { localBandId: 'band-a', listenedAt: '2026-08-01T10:00:00Z', listenedDurationMs: null },
    { localBandId: 'band-a', listenedAt: '2020-01-01T00:00:00Z', listenedDurationMs: 999000 },
  ];
  const result = api.authoritativeTwoWeekStats(listens, bands, now, stats);
  assert.equal(result.timeframe, 'twoWeeks');
  assert.equal(result.window.bucket, 'day');
  assert.equal(result.listenCount, 2);
  assert.equal(result.durationMs, 180000);
  assert.equal(result.unknownDurationCount, 1);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.listenCount, 0), 2);
});

test('v84 visible chart markup exposes daily timeframe metadata', () => {
  const stats = statsApi();
  const api = loadModule(stats);
  const now = new Date();
  const listens = [{ listenedAt: now.toISOString(), listenedDurationMs: 180000 }];
  const html = api.renderTwoWeekChart({ timeframe: 'twoWeeks', listens }, stats);
  assert.match(html, /data-v84-visible-two-week-chart="true"/);
  assert.match(html, /data-listening-chart-timeframe="twoWeeks"/);
  assert.match(html, /data-listening-bucket-kind="day"/);
  assert.match(html, /Most active day:/);
  assert.doesNotMatch(html, /Most active year:/);
});
