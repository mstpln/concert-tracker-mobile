'use strict';

const assert = require('node:assert/strict');
const { buildListeningIndex, aggregateWindow } = require('../uiPerformanceV127');
const ListeningStats = require('../listeningStats');
require('../listeningStatsV81');

function listen(localBandId, listenedAtMs, listenedDurationMs) {
  return { localBandId, listenedAtMs, listenedDurationMs };
}

const bands = [{ id: 'a' }, { id: 'b' }];
const source = [
  listen('a', 1000, 60000),
  listen('a', 2000, null),
  listen('a', 3000, 120000),
  listen('b', 2000, 30000),
  listen('missing', 2000, 99999),
  listen('a', Number.NaN, 50000),
];

const index = buildListeningIndex(source, bands, ListeningStats);
assert.equal(index.sourceVisits, source.length, 'source history must be scanned exactly once while building the index');
assert.deepEqual(aggregateWindow(index, 'a', 1000, 3000), { durationMs: 60000, listenCount: 2 });
assert.deepEqual(aggregateWindow(index, 'a', 1000, 4000), { durationMs: 180000, listenCount: 3 });
assert.deepEqual(aggregateWindow(index, 'b', 0, 5000), { durationMs: 30000, listenCount: 1 });
assert.equal(aggregateWindow(index, 'missing', 0, 5000), null);

const large = Array.from({ length: 250000 }, (_, i) => listen(`band-${i % 400}`, i * 1000, i % 7 === 0 ? null : 180000));
const largeBands = Array.from({ length: 400 }, (_, i) => ({ id: `band-${i}` }));
const largeIndex = buildListeningIndex(large, largeBands, ListeningStats);
assert.equal(largeIndex.sourceVisits, 250000);
for (let i = 0; i < 75; i += 1) {
  const result = aggregateWindow(largeIndex, `band-${i % 400}`, 0, Number.MAX_SAFE_INTEGER);
  assert.ok(result && result.listenCount > 0);
}
assert.equal(largeIndex.sourceVisits, 250000, '75 concert-card queries must not rescan the source archive');

console.log('ui-performance-v127 tests passed');
