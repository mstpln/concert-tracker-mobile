'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'uiPerformanceV126.js'), 'utf8');

function createHarness() {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(`
    let bands = [{ id: 'band-a', name: 'Band A', lastKnownConcertDate: null }];
    let concerts = [{ id: 'show-a', bandId: 'band-a', date: '2026-08-20', attending: false }];
    let news = [];
    let listeningEvents = [];
    let concertsSubTab = 'concerts';
    let europeOnly = false;
    let nearbyOnly = false;
    let venuesNearbyOnly = false;
    let venuesEuropeOnly = false;
    let venuesPastOnly = false;
    let hideInactiveBands = false;
    let inactivityYears = 3;
    let selectedGenre = 'all';
    let mutedOnly = false;
    let newsSubTab = 'alerts';
    const TAB_SCREENS = { myconcerts: 'screen-myconcerts', concerts: 'screen-concerts', mybands: 'screen-mybands', news: 'screen-news' };
    const screens = Object.fromEntries(Object.values(TAB_SCREENS).map((id) => [id, { childElementCount: 1 }]));
    const calls = { myconcerts: 0, concerts: 0, mybands: 0, news: 0, writes: 0, loads: 0, nav: 0 };
    function el(id) { return screens[id] || { childElementCount: 0 }; }
    function dlCurrentDate() { return new Date('2026-08-15T12:00:00Z'); }
    function renderMyConcertsScreen() { calls.myconcerts += 1; }
    function renderConcertsScreen() { calls.concerts += 1; }
    function renderMyBandsScreen() { calls.mybands += 1; }
    function renderNewsScreen() { calls.news += 1; }
    function goToTab(tab) {
      calls.nav += 1;
      if (tab === 'myconcerts') renderMyConcertsScreen();
      else if (tab === 'concerts') renderConcertsScreen();
      else if (tab === 'mybands') renderMyBandsScreen();
      else if (tab === 'news') renderNewsScreen();
    }
    async function dlWriteJsonFile(_remote, _filename, _data) { calls.writes += 1; }
    async function loadDataAndShowApp() { calls.loads += 1; }
    function dlEffectiveLastShowDate(band, list) {
      let latest = null;
      if (band.lastKnownConcertDate) latest = new Date(band.lastKnownConcertDate + 'T00:00:00');
      for (const concert of list) {
        if (concert.bandId !== band.id || !concert.date) continue;
        const date = new Date(concert.date + 'T00:00:00');
        if (!latest || date > latest) latest = date;
      }
      return latest;
    }
    function dlBandActivity(band, list, thresholdYears, today = dlCurrentDate()) {
      const lastDate = dlEffectiveLastShowDate(band, list);
      if (!lastDate) return { status: 'unknown', lastDate: null, lastYear: null };
      const current = new Date(today); current.setHours(0, 0, 0, 0);
      const lastYear = lastDate.getFullYear();
      if (lastDate >= current) return { status: 'active', lastDate, lastYear };
      const yearsAgo = (current - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
      return { status: yearsAgo >= thresholdYears ? 'inactive' : 'active', lastDate, lastYear };
    }
    globalThis.__harness = {
      calls,
      go: (tab) => goToTab(tab),
      render: (tab) => ({ myconcerts: renderMyConcertsScreen, concerts: renderConcertsScreen, mybands: renderMyBandsScreen, news: renderNewsScreen }[tab])(),
      write: (filename) => dlWriteJsonFile({}, filename, []),
      load: () => loadDataAndShowApp(),
      activity: (band, list, years, today) => dlBandActivity(band, list, years, today),
      setConcertSubTab: (value) => { concertsSubTab = value; },
      setNewsSubTab: (value) => { newsSubTab = value; },
      appendConcert: (concert) => { concerts.push(concert); },
    };
  `, context);
  vm.runInContext(source, context);
  return context.__harness;
}

test('reuses an unchanged root tab without rebuilding its DOM', () => {
  const harness = createHarness();
  harness.go('mybands');
  harness.go('mybands');
  assert.equal(harness.calls.nav, 2);
  assert.equal(harness.calls.mybands, 1);
});

test('subtab state changes force the authoritative renderer to run again', () => {
  const harness = createHarness();
  harness.go('concerts');
  harness.go('concerts');
  assert.equal(harness.calls.concerts, 1);
  harness.setConcertSubTab('venues');
  harness.go('concerts');
  assert.equal(harness.calls.concerts, 2);

  harness.go('news');
  harness.setNewsSubTab('news');
  harness.go('news');
  assert.equal(harness.calls.news, 2);
});

test('successful writes invalidate affected cached root tabs', async () => {
  const harness = createHarness();
  harness.go('mybands');
  harness.go('mybands');
  assert.equal(harness.calls.mybands, 1);
  await harness.write('bands.json');
  harness.go('mybands');
  assert.equal(harness.calls.mybands, 2);

  harness.go('concerts');
  harness.go('concerts');
  assert.equal(harness.calls.concerts, 1);
  await harness.write('concerts.json');
  harness.go('concerts');
  assert.equal(harness.calls.concerts, 2);
});

test('activity index preserves existing classification semantics', () => {
  const harness = createHarness();
  const band = { id: 'band-z', name: 'Band Z', lastKnownConcertDate: '2020-01-01' };
  const list = [
    { bandId: 'other', date: '2030-01-01' },
    { bandId: 'band-z', date: '2025-05-01' },
    { bandId: 'band-z', date: '2024-05-01' },
  ];
  const activity = harness.activity(band, list, 3, new Date('2026-08-15T12:00:00Z'));
  assert.equal(activity.status, 'active');
  assert.equal(activity.lastYear, 2025);
  assert.equal(activity.lastDate.toISOString().slice(0, 10), '2025-05-01');
});

test('concert writes invalidate the activity index for in-place mutations', async () => {
  const harness = createHarness();
  const band = { id: 'band-a', name: 'Band A', lastKnownConcertDate: null };
  const list = [{ bandId: 'band-a', date: '2020-01-01' }];
  assert.equal(harness.activity(band, list, 3, new Date('2026-08-15T12:00:00Z')).lastYear, 2020);
  list.push({ bandId: 'band-a', date: '2026-09-01' });
  await harness.write('concerts.json');
  assert.equal(harness.activity(band, list, 3, new Date('2026-08-15T12:00:00Z')).lastYear, 2026);
});
