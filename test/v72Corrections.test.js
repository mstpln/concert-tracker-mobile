'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.ListeningStats = require('../listeningStats');
const corrections = require('../v72Corrections');

test('all-time window handles a large history without spread-argument failure', () => {
  const listens = Array.from({ length: 300000 }, (_, index) => ({
    listenedAt: new Date(Date.UTC(2009, 0, 1) + index * 60000).toISOString(),
    listenedDurationMs: 30000,
  }));
  const window = corrections.safeResolveWindow('allTime', new Date('2026-08-01T00:00:00Z'), listens);
  assert.equal(window.bucket, 'year');
  assert.equal(window.startMs, Date.parse('2009-01-01T00:00:00.000Z'));
  assert.equal(window.previousStartMs, null);
});

test('genre classification follows the approved broad groups', () => {
  assert.equal(corrections.classifyGenre('alternative metal'), 'Rock');
  assert.equal(corrections.classifyGenre('indie pop'), 'Pop');
  assert.equal(corrections.classifyGenre('R&B'), 'Hip-hop/R&B');
  assert.equal(corrections.classifyGenre('drum and bass'), 'Electronic');
  assert.equal(corrections.classifyGenre('jazz'), 'Other');
});

test('stored genre order selects the first matching approved group', () => {
  assert.equal(corrections.classifyBand({ genres: ['folk', 'hard rock', 'pop'] }), 'Rock');
  assert.equal(corrections.classifyBand({ genres: ['indie pop', 'garage rock'] }), 'Pop');
  assert.equal(corrections.classifyBand({ genre: 'country, techno' }), 'Electronic');
});

test('upcoming listening window rolls six calendar months through the current instant', () => {
  const window = corrections.concertListeningWindow({ bandId: 'a', date: '2027-01-01' }, false, new Date('2026-08-01T12:00:00Z'));
  assert.equal(new Date(window.startMs).toISOString(), '2026-02-01T12:00:00.000Z');
  assert.equal(window.endMs, Date.parse('2026-08-01T12:00:00.000Z') + 1);
});

test('concert-day upcoming classification uses the rolling rule and excludes future listens', () => {
  global.bands = [{ id: 'a', name: 'Artist A' }];
  const concert = { bandId: 'a', date: '2026-08-01' };
  const now = new Date('2026-08-01T12:00:00.000Z');
  const aggregate = corrections.concertListeningAggregate(concert, false, now, [
    { localBandId: 'a', listenedAt: '2026-02-01T12:00:00.000Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-02-01T11:59:59.999Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-08-01T12:00:00.000Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-08-01T12:00:00.001Z', listenedDurationMs: 60000 },
  ]);
  assert.deepEqual(aggregate, { durationMs: 120000, listenCount: 2 });
});

test('recent past window includes three months before through now and excludes future listens', () => {
  global.bands = [{ id: 'a', name: 'Artist A' }];
  const concert = { bandId: 'a', date: '2026-07-01' };
  const now = new Date('2026-08-01T12:00:00.000Z');
  const window = corrections.concertListeningWindow(concert, true, now);
  assert.equal(new Date(window.startMs).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(window.endMs, now.getTime() + 1);
  const aggregate = corrections.concertListeningAggregate(concert, true, now, [
    { localBandId: 'a', listenedAt: '2026-04-01T00:00:00.000Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-03-31T23:59:59.999Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-08-01T12:00:00.000Z', listenedDurationMs: 60000 },
    { localBandId: 'a', listenedAt: '2026-08-01T12:00:00.001Z', listenedDurationMs: 60000 },
  ]);
  assert.deepEqual(aggregate, { durationMs: 120000, listenCount: 2 });
});

test('past window includes the exact plus-three-month boundary and then freezes', () => {
  const concert = { bandId: 'a', date: '2026-01-31' };
  const atBoundary = corrections.concertListeningWindow(concert, true, new Date('2026-04-30T12:00:00.000Z'));
  const longAfter = corrections.concertListeningWindow(concert, true, new Date('2026-10-01T12:00:00.000Z'));
  assert.equal(new Date(atBoundary.startMs).toISOString(), '2025-10-31T00:00:00.000Z');
  assert.equal(new Date(atBoundary.endMs).toISOString(), '2026-04-30T00:00:00.001Z');
  assert.equal(new Date(longAfter.endMs).toISOString(), '2026-04-30T00:00:00.001Z');
});

test('old past aggregate includes the frozen boundary and excludes later listening', () => {
  global.bands = [{ id: 'a', name: 'Artist A' }];
  const aggregate = corrections.concertListeningAggregate(
    { bandId: 'a', date: '2026-01-31' },
    true,
    new Date('2026-10-01T12:00:00.000Z'),
    [
      { localBandId: 'a', listenedAt: '2025-10-31T00:00:00.000Z', listenedDurationMs: 60000 },
      { localBandId: 'a', listenedAt: '2026-04-30T00:00:00.000Z', listenedDurationMs: 60000 },
      { localBandId: 'a', listenedAt: '2026-04-30T00:00:00.001Z', listenedDurationMs: 60000 },
      { localBandId: 'a', listenedAt: '2026-09-01T00:00:00.000Z', listenedDurationMs: 60000 },
    ],
  );
  assert.deepEqual(aggregate, { durationMs: 120000, listenCount: 2 });
});

test('calendar-month shifts clamp month ends and preserve leap-day boundaries', () => {
  const upcomingMonthEnd = corrections.concertListeningWindow({ bandId: 'a', date: '2024-12-01' }, false, new Date('2024-08-31T15:30:00.000Z'));
  assert.equal(new Date(upcomingMonthEnd.startMs).toISOString(), '2024-02-29T15:30:00.000Z');

  const leapConcert = corrections.concertListeningWindow({ bandId: 'a', date: '2024-05-31' }, true, new Date('2025-01-01T00:00:00.000Z'));
  assert.equal(new Date(leapConcert.startMs).toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(new Date(leapConcert.endMs).toISOString(), '2024-08-31T00:00:00.001Z');
});

test('upcoming-to-past transition switches calculation anchors without changing global windows', () => {
  const concert = { bandId: 'a', date: '2026-08-01' };
  const upcoming = corrections.concertListeningWindow(concert, false, new Date('2026-08-01T23:59:59.999Z'));
  const past = corrections.concertListeningWindow(concert, true, new Date('2026-08-02T00:00:00.000Z'));
  assert.equal(new Date(upcoming.startMs).toISOString(), '2026-02-01T23:59:59.999Z');
  assert.equal(new Date(past.startMs).toISOString(), '2026-05-01T00:00:00.000Z');
  assert.equal(new Date(past.endMs).toISOString(), '2026-08-02T00:00:00.001Z');

  const globalWindow = corrections.safeResolveWindow('threeMonths', new Date('2026-08-01T12:00:00.000Z'), []);
  assert.equal(new Date(globalWindow.startMs).toISOString(), '2026-05-01T12:00:00.000Z');
  assert.equal(globalWindow.label, '3 months');
});
