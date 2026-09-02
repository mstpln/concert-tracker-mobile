'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Canonical = require('../canonicalIdentityV174');
const Ingestion = require('../scripts/lib/canonicalConcertIngestionV175');

const venueIndex = Canonical.buildVenueIndex([
  { venueId: 'venue-main', name: 'Main Hall', city: 'Lund', country: 'Sweden', address: 'Main Street 1, Lund, Sweden', researchStatus: 'partial', schemaVersion: 1 },
]);
const options = { venueIndex, now: '2026-08-31T10:00:00.000Z' };

function existing(extra = {}) {
  return {
    id: 'stable-id', bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '19:00', attending: true,
    sourceProvider: 'ticketmaster', providerEventId: 'tm-old', providerAttractionId: 'tm-artist-a',
    providerVenueId: 'tm-main', providerEventName: 'Artist A', providerOfferType: 'standard', ticketRetailerVerified: true,
    ticketUrl: 'https://tickets.example/standard',
    ...extra,
  };
}

function incoming(extra = {}) {
  return {
    bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '19:00', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-old', providerAttractionId: 'tm-artist-a', providerVenueId: 'tm-main',
    providerEventName: 'Artist A', providerOfferType: 'standard', ticketRetailerVerified: true,
    ticketUrl: 'https://tickets.example/standard', foundAt: '2026-08-31T10:00:00.000Z', ...extra,
  };
}

test('v175 replay does not manufacture a second observation from top-level provider presentation', () => {
  const first = Ingestion.ingestCandidate([existing()], incoming(), options);
  const second = Ingestion.ingestCandidate(first.records, incoming(), options);
  assert.equal(second.changed, false);
  assert.deepEqual(second.records, first.records);
});

test('v175 postponed status makes a still-returned old provider date inactive', () => {
  const candidate = incoming({ providerEventStatus: 'postponed' });
  const first = Ingestion.ingestCandidate([existing()], candidate, options);
  const result = first.records[0];
  assert.equal(result.id, 'stable-id');
  assert.equal(result.date, null);
  assert.equal(result.time, null);
  assert.equal(result.lifecycleStatus, 'postponed');
  assert.equal(result.lifecycleHistory[0].previousDate, '2026-10-10');
  assert.equal(result.lifecycleHistory[0].replacementDate, null);
  assert.equal(result.providerObservations.at(-1).date, '2026-10-10');
  assert.equal(result.providerObservations.at(-1).status, 'postponed');

  const replay = Ingestion.ingestCandidate(first.records, candidate, options);
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.records, first.records);
  assert.equal(replay.records[0].lifecycleHistory.length, 1);
});

test('v175 cancellation records no replacement date and replay stays idempotent', () => {
  const candidate = incoming({ providerEventStatus: 'canceled' });
  const first = Ingestion.ingestCandidate([existing()], candidate, options);
  assert.equal(first.records[0].lifecycleStatus, 'cancelled');
  assert.equal(first.records[0].date, '2026-10-10');
  assert.equal(first.records[0].lifecycleHistory[0].previousDate, '2026-10-10');
  assert.equal(first.records[0].lifecycleHistory[0].replacementDate, null);

  const replay = Ingestion.ingestCandidate(first.records, candidate, options);
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.records, first.records);
  assert.equal(replay.records[0].lifecycleHistory.length, 1);
});

test('v175 weaker terminal lifecycle evidence cannot contradict stronger active provider presentation', () => {
  for (const providerEventStatus of ['cancelled', 'postponed']) {
    const candidate = incoming({
      sourceProvider: 'other_provider', providerEventId: `other-${providerEventStatus}`, providerEventStatus,
      ticketRetailerVerified: false, providerOfferType: 'standard', ticketUrl: `https://other.example/${providerEventStatus}`,
    });
    const first = Ingestion.ingestCandidate([existing({ providerEventStatus: 'onsale' })], candidate, options);
    const result = first.records[0];
    assert.equal(result.lifecycleStatus, undefined);
    assert.equal(result.sourceProvider, 'ticketmaster');
    assert.equal(result.providerEventId, 'tm-old');
    assert.equal(result.providerEventStatus, 'onsale');
    assert.equal(result.ticketUrl, 'https://tickets.example/standard');
    assert.equal(result.lifecycleReviewRequired, true);
    assert.equal(result.lifecycleHistory.at(-1).type, 'provider_status_conflict');
    assert.equal(result.lifecycleHistory.at(-1).observedStatus, providerEventStatus);
    assert.equal(result.providerObservations.at(-1).provider, 'other_provider');
    assert.equal(result.providerObservations.at(-1).status, providerEventStatus);

    const replay = Ingestion.ingestCandidate(first.records, candidate, options);
    assert.equal(replay.changed, false);
    assert.deepEqual(replay.records, first.records);
  }
});

test('v175 proven replacement continuity may advance presentation and remains stable on replay', () => {
  const candidate = incoming({
    providerEventId: 'tm-new', providerRelatedEventIds: ['tm-old'], date: '2026-11-12', time: '20:00',
    ticketUrl: 'https://tickets.example/replacement',
  });
  const first = Ingestion.ingestCandidate([existing()], candidate, options);
  assert.equal(first.result.reason, 'provider_replacement_continuity');
  assert.equal(first.records[0].id, 'stable-id');
  assert.equal(first.records[0].providerEventId, 'tm-new');
  assert.equal(first.records[0].date, '2026-11-12');
  assert.equal(first.records[0].ticketUrl, 'https://tickets.example/replacement');

  const replay = Ingestion.ingestCandidate(first.records, candidate, options);
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.records, first.records);
});
