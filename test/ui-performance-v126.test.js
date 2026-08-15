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
    let renderCalls = 0;
    let hideInactiveBands = false;
    let inactivityYears = 3;
    let selectedGenre = 'all';
    let mutedOnly = false;
    const screen = { childElementCount: 1 };
    let bands = Array.from({ length: ${bandCount} }, (_, index) => ({
      id: 'band-' + index,
      name: 'Band ' + index,
      genre: index % 2 ? 'Rock' : 'Metal',
      muted: false,
      lastKnownConcertDate: index % 3 === 0 ? '2020-01-01' : null,
    }));
    let concerts = Array.from({ length: ${concertCount} }, (_, index) => ({
      id: 'show-' + index,
      bandId: 'band-' + (index % Math.max(1, ${bandCount})),
      date: String(2020 + (index % 6)) + '-06-01',
    }));
    function el(id) { return id === 'screen-mybands' ? screen : null; }
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
      renderCalls += 1;
      return bands.map((band) => dlBandActivity(band, concerts, inactivityYears));
    }
    globalThis.__harness = {
      render: () => renderMyBandsScreen(),
      getActivityCalls: () => activityCalls,
      getRenderCalls: () => renderCalls,
      mutateName: (index, name) => { bands[index].name = name; },
      mutateGenre: (index, genre) => { bands[index].genre = genre; },
      mutateConcertDate: (index, date) => { concerts[index].date = date; },
      setMutedOnly: (value) => { mutedOnly = value; },
      emptyScreen: () => { screen.childElementCount = 0; },
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

test('indexed effective date preserves stored last-known concert precedence', () => {
  const harness = createHarness();
  const latest = harness.api.buildLatestConcertByBand([
    { bandId: 'a', date: '2025-05-01' },
    { bandId: 'b', date: '2024-05-01' },
  ]);
  assert.equal(harness.api.indexedEffectiveLastShowDate({ id: 'a', lastKnownConcertDate: '2023-01-01' }, latest).toISOString().slice(0, 10), '2025-05-01');
  assert.equal(harness.api.indexedEffectiveLastShowDate({ id: 'b', lastKnownConcertDate: '2026-01-01' }, latest).toISOString().slice(0, 10), '2026-01-01');
  assert.equal(harness.api.indexedEffectiveLastShowDate({ id: 'c' }, latest), null);
});

test('unchanged My Bands view reuses existing DOM after the first render', () => {
  const harness = createHarness({ bandCount: 400, concertCount: 5000 });
  const first = harness.render();
  assert.equal(first.length, 400);
  assert.equal(harness.getRenderCalls(), 1);
  assert.equal(harness.getActivityCalls(), 0, 'legacy O(bands x concerts) activity helper is bypassed');
  const second = harness.render();
  assert.equal(second, undefined);
  assert.equal(harness.getRenderCalls(), 1, 'unchanged view does not rebuild hundreds of rows');
});

test('every visible My Bands dependency invalidates render reuse', () => {
  const harness = createHarness({ bandCount: 4, concertCount: 12 });
  harness.render();
  harness.mutateName(0, 'Renamed Band');
  harness.render();
  harness.mutateGenre(1, 'Pop');
  harness.render();
  harness.setMutedOnly(true);
  harness.render();
  harness.mutateConcertDate(0, '2030-01-01');
  harness.render();
  assert.equal(harness.getRenderCalls(), 5);
});

test('empty My Bands DOM is rebuilt even when the data key is unchanged', () => {
  const harness = createHarness({ bandCount: 3, concertCount: 6 });
  harness.render();
  harness.emptyScreen();
  harness.render();
  assert.equal(harness.getRenderCalls(), 2);
});
