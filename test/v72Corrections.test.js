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

test('upcoming listening window is the rolling three months before now', () => {
  const window = corrections.concertListeningWindow({ bandId: 'a', date: '2027-01-01' }, false, new Date('2026-08-01T12:00:00Z'));
  assert.equal(new Date(window.startMs).toISOString(), '2026-05-01T12:00:00.000Z');
  assert.equal(window.endMs, Date.parse('2026-08-01T12:00:00.000Z') + 1);
});

test('past listening window is the three months before the concert date', () => {
  const window = corrections.concertListeningWindow({ bandId: 'a', date: '2026-07-01' }, true, new Date('2026-08-01T12:00:00Z'));
  assert.equal(new Date(window.startMs).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(window.endMs, Date.parse('2026-07-01T00:00:00.000Z'));
});
