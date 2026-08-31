'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../scripts/lib/canonicalMigrationV176Contract');

const VENUE_A = 'venue-a1b2c3d4';
const VENUE_B = 'venue-b1c2d3e4';

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
    date: '2026-10-10',
    venue: 'Malmö Arena',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: VENUE_A,
    ...overrides,
  };
}

test('v176 exhaustive audit catches venue identity candidates across diacritic normalization', () => {
  const report = Migration.audit([
    venue(VENUE_A, 'Malmö Arena'),
    venue(VENUE_B, 'Malmo Arena'),
  ], []);
  assert.equal(report.venueCandidates.length, 1);
  assert.deepEqual(report.venueCandidates[0].ids, [VENUE_A, VENUE_B]);
  assert.equal(report.unresolvedVenueCandidates.length, 1);
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Malmö Arena'),
    venue(VENUE_B, 'Malmo Arena'),
  ], []);
  assert.ok(Migration.validatePlan(plan).errors.includes('unresolved_venue_candidates'));
});

test('v176 exhaustive audit resolves a normalized candidate through a legacy-aware distinct decision', () => {
  const venues = [
    venue(VENUE_A, 'Malmö Arena'),
    venue(VENUE_B, 'Malmo Arena', { legacyVenueIds: ['venue-deadbeef'] }),
  ];
  const decisions = {
    venueDistinct: [{ ids: [VENUE_A, 'venue-deadbeef'], reason: 'researched independent venues' }],
  };
  const report = Migration.audit(venues, [], decisions);
  assert.equal(report.venueCandidates.length, 1);
  assert.equal(report.venueCandidates[0].resolvedDistinct, true);
  assert.equal(report.unresolvedVenueCandidates.length, 0);
  const plan = Migration.planMigration(venues, [], decisions);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 remaps an existing structured festival primary venue after researched venue reconciliation without a new festival decision', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Main Hall'),
    venue(VENUE_B, 'Old Festival Grounds'),
  ], [
    concert('concert-a', {
      venue: 'Main Hall',
      festivalEditionId: 'festival-2026',
      festivalEdition: {
        id: 'festival-2026',
        name: 'Festival',
        year: '2026',
        status: 'confirmed',
        primaryCanonicalVenueId: VENUE_B,
      },
    }),
  ], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'researched continuation' }],
  });
  assert.equal(plan.concerts[0].festivalEdition.primaryCanonicalVenueId, VENUE_A);
  assert.equal(plan.invariants.orphans.valid, true);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 remaps legacy root festival primary venue references after researched venue reconciliation', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Main Hall'),
    venue(VENUE_B, 'Old Festival Grounds'),
  ], [
    concert('concert-a', {
      venue: 'Main Hall',
      festivalPrimaryVenueId: VENUE_B,
    }),
  ], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'researched continuation' }],
  });
  assert.equal(plan.concerts[0].festivalPrimaryVenueId, VENUE_A);
  assert.equal(plan.invariants.orphans.valid, true);
  assert.equal(Migration.validatePlan(plan).valid, true);
});
