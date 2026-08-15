'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'uiPerformanceV126.js'), 'utf8');

function createHarness({ bandCount = 1, concertCount = 1 } = {}) {
  const context = vm.createContext({ console });
  vm.runInContext(`
    let activityCalls = 0;
    let bands = Array.from({ length: ${bandCount} }, (_, index) => ({
      id: 'band-' + index,
      name: 'Band ' + index,
      lastKnownConcertDate: index % 3 === 0 ? '2020-01-01' : null,
    }));
    let concerts = Array.from({ length: ${concertCount} }, (_, index) => ({
      id: 'show-' + index,
      bandId: 'band-' + (index % Math.max(1, ${bandCount})),
      date: String(2020 + (index % 6)) + '-06-01',
    }));
    function dlCurrentDate() { return new Date('2026-08-15T12:00:00Z'); }
    function dlEffectiveLastShowDate(band, concertList) {
      let latest = band.lastKnownConcertDate ? new Date(band.lastKnownConcertDate + 'T00:00:00') : null;
      for (const concert of concertList) {
        if (concert.bandId !== band.id || !concert.date) continue;
        const date = new Date(concert.date + 'T00:00:00');
        if (!latest || date > latest) latest = date;
      }
      return latest;
    }
    function dlBandActivity(band, concertList, thresholdYears, today = dlCurrentDate()) {
      activityCalls += 1;
      const lastDate = dlEffectiveLastShowDate(band, concertList);
      if (!lastDate) return { status: 'unknown', lastDate: null, lastYear: null };
      const current = new Date(today); current.setHours(0, 0, 0, 0);
      const lastYear = lastDate.getFullYear();
      if (lastDate >= current) return { status: 'active', lastDate, lastYear };
      const yearsAgo = (current - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
      return { status: yearsAgo >= thresholdYears ? 'inactive' : 'active', lastDate, lastYear };
    }
    function renderMyBandsScreen() {
      return bands.map((band) => dlBandActivity(band, concerts, 3));
    }
    globalThis.__harness = {
      render: () => renderMyBandsScreen(),
      originalActivity: (band, list, years, today) => dlBandActivity(band, list, years, today),
      getActivityCalls: () => activityCalls,
    };
  `, context);
  vm.runInContext(source, context);
  context.__harness.api = context.LiveVaultUiPerformanceV126;
  return context.__harness;
}

test('latest-concert index returns the newest valid date for each band', () => {
  const harness = createHarness();
  const index = harness.api.buildLatestConcertByBand([
    { bandId: 'a', date: '2024-01-01' },
    { bandId: 'b', date: '2025-02-01' },
    { bandId: 'a', date: '2026-03-01' },
    { bandId: 'a', date: null },
    { bandId: null, date: '2030-01-01' },
    { bandId: 'b', date: 'not-a-date' },
  ]);
  assert.equal(index.get('a').toISOString().slice(0, 10), '2026-03-01');
  assert.equal(index.get('b').toISOString().slice(0, 10), '2025-02-01');
  assert.equal(index.size, 2);
});

test('indexed effective date preserves stored last-known concert precedence semantics', () => {
  const harness = createHarness();
  const latest = harness.api.buildLatestConcertByBand([
    { bandId: 'a', date: '2025-05-01' },
    { bandId: 'b', date: '2024-05-01' },
  ]);
  assert.equal(
    harness.api.indexedEffectiveLastShowDate({ id: 'a', lastKnownConcertDate: '2023-01-01' }, latest).toISOString().slice(0, 10),
    '2025-05-01'
  );
  assert.equal(
    harness.api.indexedEffectiveLastShowDate({ id: 'b', lastKnownConcertDate: '2026-01-01' }, latest).toISOString().slice(0, 10),
    '2026-01-01'
  );
  assert.equal(harness.api.indexedEffectiveLastShowDate({ id: 'c' }, latest), null);
});

test('wrapped My Bands renderer preserves activity results', () => {
  const harness = createHarness({ bandCount: 12, concertCount: 80 });
  const expected = vm.runInNewContext(`
    const bands = Array.from({ length: 12 }, (_, index) => ({ id: 'band-' + index, lastKnownConcertDate: index % 3 === 0 ? '2020-01-01' : null }));
    const concerts = Array.from({ length: 80 }, (_, index) => ({ bandId: 'band-' + (index % 12), date: String(2020 + (index % 6)) + '-06-01' }));
    function effective(band) {
      let latest = band.lastKnownConcertDate ? new Date(band.lastKnownConcertDate + 'T00:00:00') : null;
      for (const concert of concerts) {
        if (concert.bandId !== band.id) continue;
        const date = new Date(concert.date + 'T00:00:00');
        if (!latest || date > latest) latest = date;
      }
      return latest;
    }
    bands.map((band) => {
      const lastDate = effective(band);
      if (!lastDate) return ['unknown', null];
      const current = new Date('2026-08-15T12:00:00Z'); current.setHours(0, 0, 0, 0);
      const yearsAgo = (current - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
      return [yearsAgo >= 3 ? 'inactive' : 'active', lastDate.getFullYear()];
    });
  `);
  const actual = harness.render().map((item) => [item.status, item.lastYear]);
  assert.deepEqual(actual, expected);
});

test('large synthetic render builds one index and does not retain stale concert state', () => {
  const harness = createHarness({ bandCount: 400, concertCount: 5000 });
  const first = harness.render();
  assert.equal(first.length, 400);
  assert.equal(harness.getActivityCalls(), 0, 'legacy per-band activity helper should be bypassed during wrapped render');

  // A second render rebuilds from current in-memory data rather than reusing a
  // cross-render cache. This is the safety property that prevents stale UI.
  const second = harness.render();
  assert.equal(second.length, 400);
  assert.equal(harness.getActivityCalls(), 0);
});
