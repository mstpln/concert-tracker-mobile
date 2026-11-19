'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Admission = require('../scripts/lib/concertEuropeAdmission');
const Focused = require('../scripts/tavilyConcertRun');

const ROOT = path.resolve(__dirname, '..');
const show = (country, id = 'show') => ({
  id, bandId: 'qa-band', bandName: 'QA Artist', date: '2027-07-18',
  venue: 'Synthetic Hall', city: 'Example City', country,
  sourceProvider: 'tavily_groq', providerEventId: id,
  ticketRetailerVerified: false,
});

test('future auto-admission uses the existing European app scope, including non-EU countries', () => {
  for (const country of ['Sweden', 'SE', 'Denmark', 'DK', 'Norway', 'United Kingdom', 'UK', 'Switzerland', 'Turkey', 'Serbia']) {
    assert.equal(Admission.canAutoAdmitConcert(show(country)), true, country);
  }
  for (const country of ['USA', 'US', 'Canada', 'Australia', 'Japan', 'Israel', 'Unknown', '', null, undefined]) {
    assert.equal(Admission.canAutoAdmitConcert(show(country)), false, String(country));
  }
  assert.equal(Admission.canAutoAdmitConcert(null), false);
  assert.equal(Admission.canAutoAdmitConcert({}), false);
  assert.deepEqual(Admission.europeOnlyCandidates(undefined), []);
});

test('mixed automatic candidates retain only Europe without mutating their original records', () => {
  const candidates = [show('Sweden', 'eu'), show('USA', 'us'), show('', 'unknown')];
  const before = JSON.parse(JSON.stringify(candidates));
  assert.deepEqual(Admission.europeOnlyCandidates(candidates), [candidates[0]]);
  assert.deepEqual(candidates, before);
});

test('focused research cannot add foreign or unknown-country candidates, and retains all historical records', () => {
  const savedOutside = { ...show('USA', 'user-owned'), date: '2024-07-18', attending: true, notes: 'Do not delete', favorite: true, unknownFutureField: { kept: 1 } };
  const savedUnknown = { ...show('', 'unknown-user-owned'), date: '2025-07-18', attending: false, ticketUrl: 'https://example.invalid/ticket', manuallyAdded: true };
  const original = [savedOutside, savedUnknown];
  const incoming = [show('Japan', 'new-jp'), show('', 'new-missing'), show('Sweden', 'new-se')];

  const result = Focused.reconcileFocusedCandidates(original, incoming, [], '2026-11-19T00:00:00.000Z');
  assert.equal(result.counts.added, 1);
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.slice(0, 2), original);
  assert.deepEqual(original, [savedOutside, savedUnknown]);

  const replay = Focused.reconcileFocusedCandidates(result.records, incoming, [], '2026-11-19T01:00:00.000Z');
  assert.equal(replay.counts.added, 0);
  assert.equal(replay.records.length, 3);
  assert.deepEqual(replay.records.slice(0, 2), original);
});

test('both scheduled pipelines and Ticketmaster enforce admission before persistence', () => {
  const main = fs.readFileSync(path.join(ROOT, 'scripts/research.js'), 'utf8');
  const focused = fs.readFileSync(path.join(ROOT, 'scripts/tavilyConcertRun.js'), 'utf8');
  const ticketmaster = fs.readFileSync(path.join(ROOT, 'scripts/lib/ticketmaster.js'), 'utf8');
  assert.match(main, /candidates = ConcertEuropeAdmission\.europeOnlyCandidates\(candidates\)/);
  assert.match(main, /if \(!ConcertEuropeAdmission\.canAutoAdmitConcert\(candidate\)\) continue/);
  assert.match(main, /isValidFullDate\(s\.date\).*ConcertEuropeAdmission\.canAutoAdmitConcert\(s\)/);
  assert.match(focused, /for \(const candidate of ConcertEuropeAdmission\.europeOnlyCandidates\(candidates\)\)/);
  assert.match(focused, /const upcomingCandidates = ConcertEuropeAdmission\.europeOnlyCandidates\(candidates\)/);
  assert.match(ticketmaster, /if \(!ConcertEuropeAdmission\.canAutoAdmitConcert\(venue\)\) return null/);
});
