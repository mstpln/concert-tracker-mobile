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
    ...extra,
  };
}

function incoming(extra = {}) {
  return {
    bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '19:00', sourceProvider: 'ticketmaster',
    providerEventId: 'tm-old', providerAttractionId: 'tm-artist-a', providerVenueId: 'tm-main',
    providerEventName: 'Artist A', providerOfferType: 'standard', ticketRetailerVerified: true,
    foundAt: '2026-08-31T10:00:00.000Z', ...extra,
  };
}

test('v175 replay does not manufacture a second observation from top-level provider presentation', () => {
  const first = Ingestion.ingestCandidate([existing()], incoming(), options);
  const second = Ingestion.ingestCandidate(first.records, incoming(), options);
  assert.equal(second.changed, false);
  assert.deepEqual(second.records, first.records);
});

test('v175 postponed status makes a still-returned old provider date inactive', () => {
  const result = Ingestion.ingestCandidate([existing()], incoming({ providerEventStatus: 'postponed' }), options).records[0];
  assert.equal(result.id, 'stable-id');
  assert.equal(result.date, null);
  assert.equal(result.time, null);
  assert.equal(result.lifecycleStatus, 'postponed');
  assert.equal(result.lifecycleHistory[0].previousDate, '2026-10-10');
  assert.equal(result.lifecycleHistory[0].replacementDate, '2026-10-10');
});
