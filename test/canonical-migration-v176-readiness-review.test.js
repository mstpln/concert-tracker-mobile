'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../scripts/lib/canonicalMigrationV176Contract');

const VENUE_A = 'venue-a1b2c3d4';
const VENUE_B = 'venue-b1c2d3e4';

function venue(id, name, overrides = {}) {
  return { venueId: id, name, currentName: name, city: 'Malmo', country: 'Sweden', address: 'Main Street 1', ...overrides };
}

function concert(id, overrides = {}) {
  return {
    id,
    bandId: 'band-a',
    date: '2026-10-10',
    venue: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: VENUE_A,
    ...overrides,
  };
}

test('v176 allows only an intentional postponed DATE TBD record to remain unresolved', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('postponed-a', { date: null, lifecycleStatus: 'postponed' }),
  ]);
  assert.deepEqual(plan.unresolved, [{ id: 'postponed-a', reason: 'date_missing_or_tbd' }]);
  assert.equal(plan.blocked.some((item) => item.reason === 'unresolved_canonical_identity'), false);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 blocks a non-postponed record with missing active date', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('missing-date', { date: null }),
  ]);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'unresolved_canonical_identity' && item.id === 'missing-date'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks an ordinary concert whose venue remains ambiguous even after venue identities are researched as distinct', () => {
  const venues = [
    venue(VENUE_A, 'Shared Hall', { address: 'Street A' }),
    venue(VENUE_B, 'Shared Hall', { address: 'Street B' }),
  ];
  const sourceConcert = {
    id: 'ambiguous-concert',
    bandId: 'band-a',
    date: '2026-10-10',
    venue: 'Shared Hall',
    city: 'Malmo',
    country: 'Sweden',
  };
  const decisions = {
    venueDistinct: [{ ids: [VENUE_A, VENUE_B], reason: 'independent venues' }],
  };
  const plan = Migration.planMigration(venues, [sourceConcert], decisions);
  assert.equal(plan.unresolvedIdentity.venues.length, 0);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'unresolved_canonical_identity' && item.id === 'ambiguous-concert'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 ignores matching room-only sublocation names when finding venue merge candidates', () => {
  const report = Migration.audit([
    venue(VENUE_A, 'Arena A', { subLocations: [{ name: 'Main Hall', type: 'room' }] }),
    venue(VENUE_B, 'Arena B', { subLocations: [{ name: 'Main Hall', type: 'room' }] }),
  ], []);
  assert.equal(report.venueCandidates.length, 0);
  assert.equal(report.unresolvedVenueCandidates.length, 0);
});

test('v176 blocks a concert survivor decision that would replace a more user-owned stable ID', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-user', {
      manuallyAdded: true,
      attending: true,
      notes: 'Keep this user concert identity',
    }),
    concert('concert-provider', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-1',
    }),
  ], {
    concertMerges: [{ ids: ['concert-user', 'concert-provider'], canonicalId: 'concert-provider' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'canonical_survivor_not_user_rich'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 permits an explicit survivor among equally user-safe duplicate IDs', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a'),
    concert('concert-b'),
  ], {
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-b' }],
  });
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].id, 'concert-b');
  assert.equal(Migration.validatePlan(plan).valid, true);
});
