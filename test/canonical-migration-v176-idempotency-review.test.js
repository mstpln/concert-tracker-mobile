'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../scripts/lib/canonicalMigrationV176');

const VENUE_A = 'venue-a1b2c3d4';
const VENUE_B = 'venue-b1c2d3e4';
const VENUE_C = 'venue-c1d2e3f4';

function venue(id, name, overrides = {}) {
  return {
    venueId: id,
    name,
    currentName: name,
    city: 'Malmo',
    country: 'Sweden',
    address: 'Main Street 1',
    ...overrides,
  };
}

function concert(id, overrides = {}) {
  return {
    id,
    bandId: 'band-a',
    bandName: 'Band A',
    date: '2026-07-03',
    venue: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: VENUE_A,
    attending: false,
    ...overrides,
  };
}

test('v176 rerunning the identical research registry against migrated output is a no-op', () => {
  const sourceVenues = [
    venue(VENUE_A, 'Main Hall'),
    venue(VENUE_B, 'Main Hall Room 2'),
  ];
  const sourceConcerts = [
    concert('concert-a', { manuallyAdded: true, sourceProvider: 'manual' }),
    concert('concert-b', {
      canonicalVenueId: VENUE_B,
      venue: 'Main Hall Room 2',
      manuallyAdded: false,
      sourceProvider: 'ticketmaster',
      ticketRetailerVerified: true,
      providerEventId: 'tm-b',
    }),
  ];
  const decisions = {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'researched parent room' }],
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-a' }],
    festivalEditions: [{
      id: 'festival-2026',
      name: 'Festival',
      year: '2026',
      concertIds: ['concert-a', 'concert-b'],
      primaryCanonicalVenueId: VENUE_B,
    }],
  };
  const first = Migration.planMigration(sourceVenues, sourceConcerts, decisions);
  assert.equal(Migration.validatePlan(first).valid, true);
  assert.equal(first.venues.length, 1);
  assert.equal(first.concerts.length, 1);
  assert.equal(first.concerts[0].festivalEdition.primaryCanonicalVenueId, VENUE_A);
  const second = Migration.planMigration(first.venues, first.concerts, decisions);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.equal(second.mergeManifest.length, 0);
  assert.deepEqual(second.venues, first.venues);
  assert.deepEqual(second.concerts, first.concerts);
  assert.equal(second.legacyVenueMap[VENUE_B], VENUE_A);
  assert.equal(second.legacyConcertMap['concert-b'], 'concert-a');
});

test('v176 preserves top-level legacy provider IDs as provider observations before a duplicate disappears', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-a',
      providerVenueId: 'tm-venue-a',
      ticketUrl: 'https://example.invalid/a',
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-b',
      providerVenueId: 'tm-venue-a',
      ticketUrl: 'https://example.invalid/b',
    }),
  ]);
  assert.equal(plan.concerts.length, 1);
  const ids = plan.concerts[0].providerObservations.map((item) => item.providerEventId).sort();
  assert.deepEqual(ids, ['tm-a', 'tm-b']);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 rejects ambiguous ownership of a legacy venue ID', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Hall A', { legacyVenueIds: ['venue-deadbeef'] }),
    venue(VENUE_B, 'Hall B', { legacyVenueIds: ['venue-deadbeef'] }),
  ], []);
  assert.equal(plan.invariants.orphans.valid, false);
  assert.ok(plan.invariants.orphans.errors.some((item) => item.reason === 'duplicate_legacy_venue_id_owners'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 rejects ambiguous ownership of a legacy concert ID', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Main Hall'),
    venue(VENUE_C, 'Other Hall', { city: 'Copenhagen', country: 'Denmark', address: 'Other Street 2' }),
  ], [
    concert('concert-a', { legacyConcertIds: ['concert-old'] }),
    concert('concert-c', {
      bandId: 'band-c',
      canonicalVenueId: VENUE_C,
      venue: 'Other Hall',
      city: 'Copenhagen',
      country: 'Denmark',
      venueAddress: 'Other Street 2',
      legacyConcertIds: ['concert-old'],
    }),
  ]);
  assert.equal(plan.invariants.orphans.valid, false);
  assert.ok(plan.invariants.orphans.errors.some((item) => item.reason === 'duplicate_legacy_concert_id_owners'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 festival decisions do not erase an existing verified primary venue when the decision omits it', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      festivalEditionId: 'festival-2026',
      festivalEdition: {
        id: 'festival-2026',
        name: 'Festival',
        year: '2026',
        status: 'confirmed',
        primaryCanonicalVenueId: VENUE_A,
      },
    }),
  ], {
    festivalEditions: [{ id: 'festival-2026', name: 'Festival', year: '2026', concertIds: ['concert-a'] }],
  });
  assert.equal(plan.concerts[0].festivalEdition.primaryCanonicalVenueId, VENUE_A);
  assert.equal(Migration.validatePlan(plan).valid, true);
});
