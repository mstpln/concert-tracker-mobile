'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../listeningStats');
require('../listeningStatsV81');

global.bands = [{ id: 'a', name: 'Alpha', genres: ['rock'] }];
global.listeningEvents = [];
global.document = { addEventListener() {} };
require('../listeningV82Corrections');
require('../listeningV82GenreFix');
delete global.document;
const chartFix = require('../listeningV83ChartFix');

const NOW = new Date('2026-08-03T12:00:00.000Z');
const DAY_LABEL = /^(?:\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2})$/;
const listen = (id, at, duration = 60000) => ({
  id,
  listenedAt: at,
  listenedDurationMs: duration,
  recordingTitle: id,
  releaseTitle: 'Album',
  artistCreditName: 'Alpha',
  localBandId: 'a',
});

test('v83 two-week charts use daily buckets and never fall through to yearly grouping', () => {
  const values = [
    listen('recent-a', '2026-08-02T10:00:00.000Z', 3600000),
    listen('recent-b', '2026-07-27T10:00:00.000Z', 1800000),
    listen('old', '2012-01-01T10:00:00.000Z', 7200000),
    listen('unknown', '2026-08-01T10:00:00.000Z', null),
  ];
  const selected = stats.selectedStats(values, global.bands, 'twoWeeks', NOW);
  assert.equal(selected.window.bucket, 'day');
  assert.ok(selected.buckets.length >= 14 && selected.buckets.length <= 15);
  assert.ok(selected.buckets.every((bucket) => DAY_LABEL.test(bucket.label)));
  assert.equal(selected.buckets.reduce((sum, bucket) => sum + bucket.listenCount, 0), 3);
  assert.equal(selected.buckets.reduce((sum, bucket) => sum + bucket.durationMs, 0), 5400000);
  assert.ok(selected.buckets.some((bucket) => bucket.durationMs === 0));
  assert.ok(selected.buckets.every((bucket) => !/^20\d{2}$/.test(bucket.label)));
});

test('v83 nice yearly axis is rounded, labelled from zero and stable for the same full series', () => {
  const first = chartFix.niceAxis(1267, 4);
  const second = chartFix.niceAxis(Math.max(1267, 300, 900), 4);
  assert.equal(first.max, second.max);
  assert.equal(first.ticks[0], 0);
  assert.equal(first.ticks.at(-1), first.max);
  assert.ok(first.max >= 1267);
  assert.ok(first.ticks.length >= 3);
});

test('v83 shell correction exposes no storage mutation or provider access', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../listeningV83ChartFix'), 'utf8');
  assert.match(source, /Listening hours/);
  assert.match(source, /kind === 'day'/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|indexedDB|remote\.|dlWriteJsonFile/);
});
