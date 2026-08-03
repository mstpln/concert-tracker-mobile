'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stats = require('../listeningStats');
require('../listeningStatsV81');

global.document = { addEventListener() {} };
global.bands = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
require('../listeningV82Corrections');
delete global.document;

const NOW = new Date('2026-08-03T12:00:00.000Z');
const bands = global.bands;
const listen = (id, at, duration, extra = {}) => ({ id, listenedAt: at, listenedAtMs: new Date(at).getTime(), listenedDurationMs: duration, recordingTitle: id, releaseTitle: 'Album', artistCreditName: 'Alpha', localBandId: 'a', genre: 'rock', ...extra });

test('v82 rolling period excludes historical records and preserves unknown-duration listens', () => {
  const current = listen('current', '2026-08-01T00:00:00Z', 60000);
  const unknown = listen('unknown', '2026-08-02T00:00:00Z', null);
  const previousSeconds = listen('previous-seconds', '2026-07-15T00:00:00Z', 90000, {
    listenedAtMs: undefined,
    listenedAt: undefined,
    timestamp: Math.floor(Date.parse('2026-07-15T00:00:00Z') / 1000),
  });
  const historical = listen('historical', '2010-01-01T00:00:00Z', 120000);
  const malformed = listen('malformed', 'not-a-date', 180000, { listenedAtMs: undefined });
  const values = [current, unknown, previousSeconds, historical, malformed];

  const fortnight = stats.selectedStats(values, bands, 'twoWeeks', NOW);
  const allTime = stats.selectedStats(values, bands, 'allTime', NOW);
  assert.equal(fortnight.label, '2 weeks');
  assert.deepEqual(fortnight.listens.map((item) => item.id).sort(), ['current', 'unknown']);
  assert.deepEqual(fortnight.previousListens.map((item) => item.id), ['previous-seconds']);
  assert.equal(fortnight.listenCount, 2);
  assert.equal(fortnight.durationMs, 60000);
  assert.equal(fortnight.hasUnknownDuration, true);
  assert.equal(allTime.listenCount, 4);
  assert.notEqual(fortnight.listenCount, allTime.listenCount);
});

test('v82 timestamp normalization accepts ISO, milliseconds and Unix seconds without treating invalid dates as current', () => {
  const milliseconds = Date.parse('2026-08-01T00:00:00Z');
  assert.equal(stats.listenTimeMs({ listenedAtMs: milliseconds }), milliseconds);
  assert.equal(stats.listenTimeMs({ listenedAt: String(milliseconds) }), milliseconds);
  assert.equal(stats.listenTimeMs({ timestamp: Math.floor(milliseconds / 1000) }), milliseconds);
  assert.equal(Number.isFinite(stats.listenTimeMs({ listenedAt: 'invalid' })), false);
});

test('v82 rankings use time, count, recency and conservative album titles', () => {
  const values = [listen('a', '2026-08-01T00:00:00Z', 60000), listen('b', '2026-08-02T00:00:00Z', 60000, { localBandId: 'b', artistCreditName: 'Beta' }), listen('c', '2026-08-03T00:00:00Z', null, { releaseTitle: '' })];
  assert.deepEqual(stats.topBands(values, bands).map((item) => item.bandId), ['a', 'b']);
  assert.equal(stats.topAlbums(values).length, 2);
});

test('v82 genre detail remains compatible with the Stats renderer when duration is unknown', () => {
  const values = [listen('known', '2025-01-01T00:00:00Z', 3600000), listen('unknown', '2025-02-01T00:00:00Z', null)];
  const distribution = stats.genreDistributionByYear(values);
  assert.equal(distribution.length, 1);
  assert.equal(distribution[0].totalListenCount, 2);
  assert.equal(distribution[0].unknownDurationCount, 1);
  assert.equal(distribution[0].durations.Rock, 3600000);
  assert.equal(distribution[0].listenCounts.Rock, 2);
});

test('v82 all-time and yearly calculations remain bounded for archive-scale input', () => {
  const values = Array.from({ length: 120000 }, (_, index) => ({
    id: `archive-${index}`,
    listenedAt: new Date(Date.UTC(2009 + (index % 18), index % 12, 1)).toISOString(),
    listenedDurationMs: 60000,
    recordingTitle: `Track ${index % 20}`,
    releaseTitle: `Album ${index % 5}`,
    artistCreditName: 'Alpha',
    localBandId: 'a',
    genre: 'rock',
  }));
  assert.doesNotThrow(() => stats.selectedStats(values, bands, 'allTime', NOW));
  assert.doesNotThrow(() => stats.yearlyListening(values, NOW));
});

test('v82 source includes authoritative correction, refresh and privacy boundaries', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'listeningInsightsV81.js'), 'utf8');
  const fix = fs.readFileSync(path.join(__dirname, '..', 'listeningV81BootFix.js'), 'utf8');
  const correction = fs.readFileSync(path.join(__dirname, '..', 'listeningV82Corrections.js'), 'utf8');
  assert.match(ui, /YOUR TOP BANDS · 2 WEEKS/);
  assert.match(correction, /timeframe === 'twoWeeks'/);
  assert.match(correction, /totalListenCount/);
  assert.match(correction, /cleanRefreshSvg/);
  assert.match(fix, /setTimeout\(safeReload, fallbackDelay\);[\s\S]*await navigator\.serviceWorker\.getRegistration\(\)/);
  assert.doesNotMatch(`${ui}\n${fix}\n${correction}`, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});

test('v82 build facts, contrast and shell entries remain deterministic', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'listeningV81.css'), 'utf8');
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'LIVEVAULT_BUILD_STATE.json'), 'utf8'));
  assert.match(css, /start-refresh-btn svg/);
  assert.match(css, /@media\(min-width:391px\)/);
  assert.equal(state.appVersion, 'v82');
  assert.equal(state.serviceWorkerCacheVersion, 'v82');
  assert.ok(state.shellFiles.includes('listeningV82Corrections.js'));
});
