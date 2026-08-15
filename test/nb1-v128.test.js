'use strict';

const assert = require('node:assert/strict');
require('../nb1V128');

const { calendarDayDiff, countdownLabel, addUpcomingCountdown } = globalThis.LiveVaultNb1V128;
const now = new Date(2026, 7, 15, 12, 0, 0);

assert.equal(calendarDayDiff('2026-08-15', now), 0);
assert.equal(calendarDayDiff('2026-08-16', now), 1);
assert.equal(calendarDayDiff('2026-10-23', now), 69);
assert.equal(countdownLabel({ date: '2026-08-15' }, now), 'Today');
assert.equal(countdownLabel({ date: '2026-08-16' }, now), 'Tomorrow');
assert.equal(countdownLabel({ date: '2026-10-23' }, now), '69 days until concert');
assert.equal(countdownLabel({ date: '2026-08-14' }, now), '');

const upcoming = '<p class="row-km">59 km away</p>';
assert.equal(
  addUpcomingCountdown(upcoming, { date: '2026-10-23' }, false, now),
  '<p class="row-km nb1-concert-meta">59 km away <span class="nb1-meta-dot">·</span> 69 days until concert</p>',
);
assert.equal(addUpcomingCountdown(upcoming, { date: '2026-10-23' }, true, now), upcoming);

console.log('nb1-v128 tests passed');
