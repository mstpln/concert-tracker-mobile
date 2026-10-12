'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calendarDaysSince, lastAttendedModel } = require('../musicSectionsV183.js');

test('v183 uses calendar days, not elapsed hours, including DST transitions', () => {
  const now = new Date(2026, 9, 11, 0, 15);
  assert.equal(calendarDaysSince('2026-10-11', now), 0);
  assert.equal(calendarDaysSince('2026-10-10', now), 1);
  assert.equal(calendarDaysSince('2026-09-03', now), 38);
  assert.equal(calendarDaysSince('2026-10-12', now), null);
  assert.equal(calendarDaysSince('2026-02-30', now), null);
  assert.equal(calendarDaysSince('', now), null);
  assert.equal(calendarDaysSince('2026-03-29', new Date(2026, 2, 30, 0, 15)), 1);
});

test('v183 last attended model resolves latest artist and safely handles missing events', () => {
  const now = new Date(2026, 9, 11, 16, 0);
  const bands = [{ id: 'old', name: 'Earlier Band' }, { id: 'last', name: 'Latest Artist' }];
  const items = [
    { bandId: 'old', bandName: 'Old name', date: '2026-08-01', time: '21:00' },
    { bandId: 'last', bandName: 'New name', date: '2026-09-03', time: '19:30' },
  ];
  assert.equal(lastAttendedModel([], bands, now), null);
  assert.equal(lastAttendedModel([{ date: '2026-10-20', bandName: 'Future' }], bands, now), null);
  const result = lastAttendedModel(items, bands, now);
  assert.equal(result.artist, 'Latest Artist');
  assert.equal(result.formattedDate, '3 SEPTEMBER 2026');
  assert.equal(result.elapsed, '38 days ago');
  assert.equal(lastAttendedModel([{ date: '2026-10-11', bandName: 'Today Band' }], [], now).elapsed, 'Today');
  assert.equal(lastAttendedModel([{ date: '2026-10-10', bandName: 'Yesterday Band' }], [], now).elapsed, '1 day ago');
});

test('v183 shell, release version and app-only navigation remain synchronized', () => {
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const html = read('index.html'), sw = read('service-worker.js');
  const build = JSON.parse(read('docs/LIVEVAULT_BUILD_STATE.json'));
  assert.match(html, /<script src="startConcertTabsV181.js"><\/script>\s*<script src="musicSectionsV183.js"><\/script>/);
  assert.match(html, /href="musicSectionsV183.css"/);
  const release = read('version.js').match(/^const APP_VERSION = '(v\d+)';/m)?.[1];
  assert.ok(release, 'missing current APP_VERSION');
  assert.equal(sw.match(/^const CACHE_NAME_LITERAL = '(v\d+)';/m)?.[1], release);
  assert.equal(build.appVersion, release);
  assert.equal(build.serviceWorkerCacheVersion, release);
  assert.equal(build.versionsMatch, true);
  assert.ok(build.shellFiles.includes('musicSectionsV183.css'));
  assert.ok(build.shellFiles.includes('musicSectionsV183.js'));
  assert.doesNotMatch(read('musicSectionsV183.js'), /dlWriteJsonFile|fetch\(|localStorage|chrome\.storage/);
});
