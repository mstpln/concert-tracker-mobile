'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const Scheduler = require('../scripts/venueMetadataResearchRun');

function seed() {
  return VenueMetadata.createVenueSeed({
    venue: 'Synthetic Arena',
    city: 'London',
    country: 'UK',
    attending: true,
  });
}

test('scheduler rejects intermediary officialUrl even when Groq cites that search result', () => {
  const target = seed();
  const record = Scheduler.buildResearchedRecord({
    seed: target,
    existing: null,
    extracted: {
      maxCapacity: 5000,
      officialUrl: 'https://www.ticketmaster.com/venue/synthetic-arena',
      address: 'Arena Road 1, London, United Kingdom',
      description: 'A synthetic arena used only for testing.',
      sourceUrls: ['https://www.ticketmaster.com/venue/synthetic-arena'],
      identityConflict: false,
    },
    searchResults: [{
      title: 'Ticket listing',
      url: 'https://www.ticketmaster.com/venue/synthetic-arena',
      content: 'Synthetic listing evidence.',
    }],
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.equal(record.officialUrl, undefined);
  assert.equal(record.researchStatus, 'partial');
  assert.equal(VenueMetadata.isComplete(record), false);
});

test('unsuccessful scheduler outcomes do not retain researchedAt', () => {
  const target = seed();
  const temporary = Scheduler.temporaryFailureRecord(target, null, '2026-08-23T12:00:00.000Z');
  const unresolved = Scheduler.unresolvedRecord(target, null, '2026-08-23T12:00:00.000Z');
  assert.equal(temporary.researchedAt, undefined);
  assert.equal(unresolved.researchedAt, undefined);
});

test('scheduler reconciliation treats UK country aliases as one venue identity', () => {
  const latest = {
    ...seed(),
    venueId: 'venue-11111111',
    country: 'United Kingdom',
    researchStatus: 'partial',
    schemaVersion: 1,
    futureField: { preserve: true },
  };
  const update = {
    ...seed(),
    venueId: 'venue-22222222',
    country: 'England',
    maxCapacity: 5000,
    researchStatus: 'partial',
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: ['https://synthetic-arena.test/facts'],
    schemaVersion: 1,
  };
  const merged = Scheduler.mergeUpdateIntoLatest(latest, update);
  assert.equal(merged.venueId, latest.venueId);
  assert.equal(merged.maxCapacity, 5000);
  assert.deepEqual(merged.futureField, { preserve: true });
});

test('scheduler reconciliation preserves a stable legacy id when country is filled later', () => {
  const latest = {
    ...seed(),
    venueId: 'venue-11111111',
    country: '',
    researchStatus: 'partial',
    schemaVersion: 1,
    futureField: { preserve: true },
  };
  const update = {
    ...seed(),
    venueId: latest.venueId,
    country: 'United Kingdom',
    maxCapacity: 5000,
    researchStatus: 'partial',
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: ['https://synthetic-arena.test/facts'],
    schemaVersion: 1,
  };
  const merged = Scheduler.mergeUpdateIntoLatest(latest, update);
  assert.equal(merged.venueId, latest.venueId);
  assert.equal(merged.maxCapacity, 5000);
  assert.equal(merged.researchedAt, '2026-08-23T12:00:00.000Z');
  assert.deepEqual(merged.futureField, { preserve: true });
});

test('exact known country wins over an otherwise matching countryless record', () => {
  const blankCountry = {
    venueId: 'venue-11111111',
    name: 'Shared Arena',
    city: 'London',
    country: '',
    researchStatus: 'partial',
    schemaVersion: 1,
  };
  const knownCountry = {
    ...blankCountry,
    venueId: 'venue-22222222',
    country: 'United Kingdom',
  };
  const match = VenueMetadata.findVenueRecord(
    { venue: 'Shared Arena', city: 'London', country: 'England' },
    [blankCountry, knownCountry],
  );
  assert.equal(match?.venueId, knownCountry.venueId);
});

test('dedupe does not merge same-name venues when only one address is known without confirmation', () => {
  const knownAddress = {
    venueId: 'venue-11111111',
    name: 'Shared Hall',
    city: 'London',
    country: 'United Kingdom',
    address: 'Street A 1, London',
    researchStatus: 'partial',
    schemaVersion: 1,
  };
  const missingAddress = {
    ...knownAddress,
    venueId: 'venue-22222222',
    address: undefined,
  };
  assert.equal(VenueMetadata.recordsCanConsolidate(knownAddress, missingAddress), false);
});

test('duplicate confirmation cannot merge an unrelated same-country venue', () => {
  const first = {
    venueId: 'venue-11111111',
    name: 'First Arena',
    city: 'London',
    country: 'United Kingdom',
    address: 'First Street 1, London',
    researchStatus: 'partial',
    schemaVersion: 1,
  };
  const unrelated = {
    venueId: 'venue-22222222',
    name: 'Second Hall',
    city: 'Manchester',
    country: 'United Kingdom',
    address: 'Second Street 2, Manchester',
    reviewNote: 'Confirmed duplicate of another venue after manual review.',
    researchStatus: 'partial',
    schemaVersion: 1,
  };
  assert.equal(VenueMetadata.recordsCanConsolidate(first, unrelated), false);
});
