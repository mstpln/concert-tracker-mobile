'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stats = require('../listeningStats');
require('../listeningStatsV81');
const NOW = new Date('2026-08-03T12:00:00.000Z');
const bands = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
const listen = (id, at, duration, extra = {}) => ({ id, listenedAt: at, listenedAtMs: new Date(at).getTime(), listenedDurationMs: duration, recordingTitle: id, releaseTitle: 'Album', artistCreditName: 'Alpha', localBandId: 'a', genre: 'rock', ...extra });
test('v81 rolling period and missing duration semantics', () => {
  const window = stats.resolveWindow('twoWeeks', NOW);
  assert.equal(new Date(window.startMs).toISOString(), '2026-07-20T12:00:00.000Z');
  const values = [listen('known', '2026-08-01T00:00:00Z', 60000), listen('unknown', '2026-08-02T00:00:00Z', null)];
  assert.equal(stats.listenCount(values), 2);
  assert.equal(stats.totalDurationMs(values), 60000);
  assert.equal(stats.hasUnknownDuration(values), true);
});
test('v81 rankings use time, count, recency and conservative album titles', () => {
  const values = [listen('a', '2026-08-01T00:00:00Z', 60000), listen('b', '2026-08-02T00:00:00Z', 60000, { localBandId: 'b', artistCreditName: 'Beta' }), listen('c', '2026-08-03T00:00:00Z', null, { releaseTitle: '' })];
  assert.deepEqual(stats.topBands(values, bands).map((item) => item.bandId), ['a', 'b']);
  assert.equal(stats.topAlbums(values).length, 1);
});
test('v81 yearly data fills empty years and retains counts with unknown time', () => {
  const values = [listen('2019', '2019-01-01T00:00:00Z', 3600000), listen('2021', '2021-01-01T00:00:00Z', null)];
  const yearly = stats.yearlyListening(values, new Date('2022-08-01T00:00:00Z'));
  assert.deepEqual(yearly.map((item) => item.year), [2019, 2020, 2021, 2022]);
  assert.equal(yearly[2].listenCount, 1);
  assert.equal(yearly[2].durationMs, 0);
});
test('v81 source includes approved UI, refresh and privacy boundaries', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'listeningInsightsV81.js'), 'utf8');
  assert.match(ui, /YOUR TOP BANDS · 2 WEEKS/);
  assert.match(ui, /profileListeningTimeframe = 'oneYear'/);
  assert.match(ui, /Top Albums/);
  assert.match(ui, /LISTENING HOURS BY YEAR/);
  assert.match(ui, /Listening time is based on listens with known duration\./);
  assert.match(ui, /registration\.update\(\)/);
  assert.doesNotMatch(ui, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
