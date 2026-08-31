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

test('v176 blocks duplicate source concert IDs even when canonical reconciliation could collapse them', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('duplicate-id'),
    concert('duplicate-id'),
  ]);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'source_duplicate_ids'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks missing source stable IDs before migration readiness', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [concert('')]);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'source_missing_ids'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 rejects a venue distinct decision between a current ID and its own legacy alias', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Main Hall', { legacyVenueIds: ['venue-deadbeef'] }),
  ], [], {
    venueDistinct: [{ ids: [VENUE_A, 'venue-deadbeef'], reason: 'impossible distinction' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'distinct_decision_collapses_to_same_identity'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 rejects a concert distinct decision between a current ID and its own legacy alias', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', { legacyConcertIds: ['concert-old-a'] }),
  ], {
    concertDistinct: [{ ids: ['concert-a', 'concert-old-a'], reason: 'impossible distinction' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'distinct_decision_collapses_to_same_identity'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 does not add an undefined festival primary property while remapping unrelated venue identity', () => {
  const sourceVenues = [venue(VENUE_A, 'Main Hall'), venue(VENUE_B, 'Old Hall')];
  const sourceConcerts = [concert('concert-a', {
    festivalEditionId: 'festival-2026',
    festivalEdition: { id: 'festival-2026', name: 'Festival', year: '2026', status: 'confirmed' },
  })];
  const plan = Migration.planMigration(sourceVenues, sourceConcerts, {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(plan.concerts[0].festivalEdition, 'primaryCanonicalVenueId'), false);
  assert.equal(Migration.sha256(JSON.parse(JSON.stringify(plan.concerts))), plan.outputHashes.concerts);
  assert.equal(Migration.validatePlan(plan).valid, true);
});
