'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stats = require('../listeningStats');
require('../listeningStatsV81');

global.document = { addEventListener() {} };
global.bands = [
  { id: 'a', name: 'Alpha', genres: ['pop', 'alternative rock'] },
  { id: 'b', name: 'Beta', genre: 'electronic' },
  { id: 'c', name: 'Gamma', genre: 'folk' },
];
global.listeningEvents = [];
require('../listeningV82Corrections');
require('../listeningV82GenreFix');
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

test('v82 rolling windows are half-open at both 14-day boundaries', () => {
  const currentStart = new Date(NOW.getTime() - 14 * 86400000).toISOString();
  const previousStart = new Date(NOW.getTime() - 28 * 86400000).toISOString();
  const values = [
    listen('current-start', currentStart, 60000),
    listen('now', NOW.toISOString(), 60000),
    listen('previous-start', previousStart, 60000),
    listen('before-previous', new Date(NOW.getTime() - 28 * 86400000 - 1).toISOString(), 60000),
  ];
  const selected = stats.selectedStats(values, bands, 'twoWeeks', NOW);
  assert.deepEqual(selected.listens.map((item) => item.id).sort(), ['current-start', 'now']);
  assert.deepEqual(selected.previousListens.map((item) => item.id), ['previous-start']);
});

test('v82 timestamp normalization accepts ISO, milliseconds, numeric strings and Unix seconds without treating invalid dates as current', () => {
  const milliseconds = Date.parse('2026-08-01T00:00:00Z');
  assert.equal(stats.listenTimeMs({ listenedAtMs: milliseconds }), milliseconds);
  assert.equal(stats.listenTimeMs({ listenedAt: String(milliseconds) }), milliseconds);
  assert.equal(stats.listenTimeMs({ timestamp: Math.floor(milliseconds / 1000) }), milliseconds);
  assert.equal(stats.listenTimeMs({ listenedAtSeconds: Math.floor(milliseconds / 1000) }), milliseconds);
  assert.equal(Number.isFinite(stats.listenTimeMs({ listenedAt: 'invalid' })), false);
});

test('v82 movement produces new, up, down and unchanged outcomes from adjacent windows', () => {
  const currentAt = (hour, minute) => `2026-08-02T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
  const previousAt = (day, hour) => `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
  const current = [
    ...Array.from({ length: 5 }, (_, index) => listen(`a-current-${index}`, currentAt(10, index), 60000)),
    ...Array.from({ length: 4 }, (_, index) => listen(`b-current-${index}`, currentAt(9, index), 60000, { localBandId: 'b', artistCreditName: 'Beta' })),
    ...Array.from({ length: 3 }, (_, index) => listen(`c-current-${index}`, currentAt(8, index), 60000, { localBandId: 'c', artistCreditName: 'Gamma' })),
  ];
  const previous = [
    ...Array.from({ length: 6 }, (_, index) => listen(`b-previous-${index}`, previousAt(14 + index, 10), 60000, { localBandId: 'b', artistCreditName: 'Beta' })),
    ...Array.from({ length: 5 }, (_, index) => listen(`a-previous-${index}`, previousAt(14 + index, 9), 60000)),
    ...Array.from({ length: 3 }, (_, index) => listen(`c-previous-${index}`, previousAt(14 + index, 8), 60000, { localBandId: 'c', artistCreditName: 'Gamma' })),
  ];
  const values = [...current, ...previous, listen('new-current', currentAt(7, 0), 30000, { localBandId: 'new', artistCreditName: 'New Artist' })];
  const extendedBands = [...bands, { id: 'new', name: 'New Artist' }];
  const ranked = stats.selectedStats(values, extendedBands, 'twoWeeks', NOW).topBands;
  const byId = new Map(ranked.map((item) => [item.bandId, item.movement]));
  assert.equal(byId.get('a')?.kind, 'up');
  assert.equal(byId.get('b')?.kind, 'down');
  assert.equal(byId.get('c'), null);
  assert.equal(byId.get('new')?.kind, 'new');
});

test('v82 rankings use time, count, recency and conservative album titles', () => {
  const values = [listen('a', '2026-08-01T00:00:00Z', 60000), listen('b', '2026-08-02T00:00:00Z', 60000, { localBandId: 'b', artistCreditName: 'Beta' }), listen('c', '2026-08-03T00:00:00Z', null, { releaseTitle: '' })];
  assert.deepEqual(stats.topBands(values, bands).map((item) => item.bandId), ['a', 'b']);
  assert.equal(stats.topAlbums(values).length, 2);
});

test('v82 final genre override preserves ordered stored-band genre ownership and unknown-duration detail', () => {
  const values = [
    listen('known', '2025-01-01T00:00:00Z', 3600000),
    listen('unknown', '2025-02-01T00:00:00Z', null),
    listen('beta', '2025-03-01T00:00:00Z', 1800000, { localBandId: 'b', artistCreditName: 'Beta' }),
  ];
  const distribution = stats.genreDistributionByYear(values);
  assert.equal(distribution.length, 1);
  assert.equal(distribution[0].totalListenCount, 3);
  assert.equal(distribution[0].unknownDurationCount, 1);
  assert.equal(distribution[0].durations.Rock, 0);
  assert.equal(distribution[0].durations.Pop, 3600000);
  assert.equal(distribution[0].listenCounts.Pop, 2);
  assert.equal(distribution[0].durations.Electronic, 1800000);
  const popOnly = stats.yearlyListening(values, new Date('2025-12-31T00:00:00Z'), 'Pop');
  assert.equal(popOnly[0].listenCount, 2);
});

test('v82 all-time and yearly calculations remain bounded for archive-scale input', () => {
  const values = Array.from({ length: 250500 }, (_, index) => ({
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

test('v82 source includes authoritative correction, final genre override, refresh and privacy boundaries', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'listeningInsightsV81.js'), 'utf8');
  const fix = fs.readFileSync(path.join(__dirname, '..', 'listeningV81BootFix.js'), 'utf8');
  const correction = fs.readFileSync(path.join(__dirname, '..', 'listeningV82Corrections.js'), 'utf8');
  const genreFix = fs.readFileSync(path.join(__dirname, '..', 'listeningV82GenreFix.js'), 'utf8');
  assert.match(ui, /YOUR TOP BANDS · 2 WEEKS/);
  assert.match(correction, /timeframe === 'twoWeeks'/);
  assert.match(correction, /totalListenCount/);
  assert.match(correction, /cleanRefreshSvg/);
  assert.match(genreFix, /bandGenreGroup/);
  assert.match(fix, /setTimeout\(safeReload, fallbackDelay\);[\s\S]*await navigator\.serviceWorker\.getRegistration\(\)/);
  assert.doesNotMatch(`${ui}\n${fix}\n${correction}\n${genreFix}`, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});

test('v82 synthetic browser fixtures include production-style timestamps, malformed optional records and long history', () => {
  const fixtures = require('../listeningFixtures');
  const values = fixtures.createSyntheticListens(bands, NOW);
  assert.ok(values.some((item) => item.source === 'spotify_import' && item.listenedAtMs == null && /^\d+$/.test(String(item.listenedAt))));
  assert.ok(values.some((item) => item.source === 'listenbrainz' && Number.isFinite(item.timestamp)));
  assert.ok(values.some((item) => item.listenedAt === 'not-a-real-date' && item.futureOptionalMetadata?.malformedButNonFatal));
  assert.ok(values.some((item) => stats.listenTimeMs(item) < Date.UTC(2011, 0, 1)));
});

test('current build facts, contrast and shell entries remain deterministic', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'listeningV81.css'), 'utf8');
  const concertCss = fs.readFileSync(path.join(__dirname, '..', 'concertCardsV86.css'), 'utf8');
  const brandCss = fs.readFileSync(path.join(__dirname, '..', 'bandmarkrV87.css'), 'utf8');
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'LIVEVAULT_BUILD_STATE.json'), 'utf8'));
  assert.match(css, /start-refresh-btn svg/);
  assert.match(css, /@media\(min-width:391px\)/);
  assert.match(concertCss, /--concert-card-background-v86:\s*#232a32/);
  assert.match(brandCss, /--bandmarkr-blue:\s*#024ddf/);
  assert.equal(state.appVersion, 'v95');
  assert.equal(state.serviceWorkerCacheVersion, 'v95');
  assert.ok(state.shellFiles.includes('concertCardsV86.css'));
  assert.ok(state.shellFiles.includes('bandmarkrV87.css'));
  assert.ok(state.shellFiles.includes('listeningV82Corrections.js'));
  assert.ok(state.shellFiles.includes('listeningV82GenreFix.js'));
  assert.ok(state.shellFiles.includes('listeningV83ChartFix.js'));
  assert.ok(state.shellFiles.includes('listeningV84ChartRenderFix.js'));
  assert.ok(state.shellFiles.includes('listeningV85RankingAndStatsUnits.js'));
  assert.ok(state.shellFiles.includes('listeningIdentityContracts.js'));
  assert.ok(state.shellFiles.includes('listeningDerivedStorage.js'));
  assert.ok(state.shellFiles.includes('listeningDerivedMigration.js'));
  assert.ok(state.shellFiles.includes('listeningReviewRollout.js'));
  assert.ok(state.shellFiles.includes('listeningCanonicalActivation.js'));
  assert.ok(state.shellFiles.includes('listeningReviewRollout.css'));
  assert.ok(state.shellFiles.includes('listeningSpotifyIdentityReview.js'));
  assert.ok(state.shellFiles.includes('listeningSpotifyIdentityReviewUi.js'));
});
