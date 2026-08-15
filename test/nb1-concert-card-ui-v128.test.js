'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../uiPerformanceV127.js');

test('NB1 countdown labels use Today, Tomorrow, and days until concert', () => {
  const now = new Date(2026, 7, 15, 12, 0, 0);
  assert.equal(ui.concertCountdownLabel('2026-08-15', now), 'Today');
  assert.equal(ui.concertCountdownLabel('2026-08-16', now), 'Tomorrow');
  assert.equal(ui.concertCountdownLabel('2026-10-23', now), '69 days until concert');
  assert.equal(ui.concertCountdownLabel('2026-08-14', now), '');
});

test('NB1 decorates the existing blue distance row without touching past cards', () => {
  const source = '<p class="row-sub">Fri 23 Oct</p><p class="row-km">59 km away</p><div class="concert-prep-group"></div>';
  const now = new Date(2026, 7, 15, 12, 0, 0);
  const upcoming = ui.decorateUpcomingConcertMeta(source, { date: '2026-10-23' }, false, now);
  assert.match(upcoming, /<p class="row-km">59 km away<span class="concert-countdown-inline"> · 69 days until concert<\/span><\/p>/);
  assert.equal(ui.decorateUpcomingConcertMeta(source, { date: '2026-10-23' }, true, now), source);
});

test('NB1 still shows the countdown when distance is unavailable', () => {
  const source = '<p class="row-sub">Sun 16 Aug</p><div class="concert-prep-group"></div>';
  const now = new Date(2026, 7, 15, 12, 0, 0);
  const upcoming = ui.decorateUpcomingConcertMeta(source, { date: '2026-08-16' }, false, now);
  assert.match(upcoming, /<p class="row-km concert-countdown-only">Tomorrow<\/p><div class="concert-prep-group">/);
});
