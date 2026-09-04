'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const focused = require('../scripts/tavilyConcertRun');

test('focused Tavily exact replay is reported as unchanged rather than a merge', () => {
  const venues = [{ venueId: 'venue-main', name: 'Main Hall', city: 'Lund', country: 'Sweden', schemaVersion: 1 }];
  const candidate = {
    bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    canonicalVenueId: 'venue-main', date: '2026-10-10', time: '20:00',
    sourceProvider: 'tavily_groq', providerEventId: 'web-1', ticketRetailerVerified: false,
    ticketUrl: 'https://listing.example/show', foundAt: '2026-09-04T10:00:00Z',
  };
  const first = focused.reconcileFocusedCandidates([], [candidate], venues, '2026-09-04T10:00:00Z');
  assert.equal(first.counts.added, 1);
  assert.equal(first.counts.unchanged, 0);

  const replay = focused.reconcileFocusedCandidates(first.records, [candidate], venues, '2026-09-04T11:00:00Z');
  assert.equal(replay.counts.merged, 0);
  assert.equal(replay.counts.lifecycle, 0);
  assert.equal(replay.counts.unchanged, 1);
  assert.deepEqual(replay.records, first.records);
});

test('focused Tavily advances empty-result backoff only after a successful provider evaluation', () => {
  const success = { _lastTavilyOutcome: 'success', _lastGroqOutcome: 'success' };
  assert.equal(focused.focusedEvaluationSucceeded(success), true);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'success', _lastGroqOutcome: 'not_run' }), true);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'failed', _lastGroqOutcome: 'not_run' }), false);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'skipped', _lastGroqOutcome: 'not_run' }), false);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'success', _lastGroqOutcome: 'failed' }), false);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'success', _lastGroqOutcome: 'skipped' }), false);
  assert.equal(focused.focusedEvaluationSucceeded({ _lastTavilyOutcome: 'success', _lastGroqOutcome: 'pending' }), false);
  assert.equal(focused.focusedEvaluationSucceeded(success, true), false);
});
