'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../scripts/lib/canonicalMigrationV176Contract');

const VENUE_A = 'venue-a1b2c3d4';
const VENUE_B = 'venue-b1c2d3e4';

function venue(id, overrides = {}) {
  return {
    venueId: id,
    name: 'Main Hall',
    currentName: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    address: 'Correct Street 1',
    ...overrides,
  };
}

function concert(id, overrides = {}) {
  return {
    id,
    bandId: 'band-a',
    bandName: 'Band A',
    date: '2026-10-10',
    venue: 'Provider Hall',
    city: 'Wrong City',
    country: 'Sweden',
    venueAddress: 'Wrong Street 9',
    ...overrides,
  };
}

test('v176 researched venue correction resolves known metadata without inventing location history', () => {
  const decisions = {
    venueCorrections: [{
      venueId: VENUE_B,
      set: { address: 'Correct Street 1', reviewNote: 'confirmed continuation' },
      clear: ['researchStatus'],
      reason: 'provider address was attached to the wrong identity',
      evidence: ['official venue page'],
    }],
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'same venue' }],
  };
  const plan = Migration.planMigration([
    venue(VENUE_A, { reviewNote: 'confirmed continuation' }),
    venue(VENUE_B, { address: 'Wrong Street 9', researchStatus: 'pending', reviewNote: 'stale note' }),
  ], [], decisions);
  assert.equal(Migration.validatePlan(plan).valid, true);
  assert.equal(plan.venues.length, 1);
  assert.equal(plan.venues[0].address, 'Correct Street 1');
  assert.equal(plan.venues[0].locationHistory, undefined);
  assert.ok(plan.mergeManifest.some((item) => item.kind === 'venue_correction' && item.venueId === VENUE_B));
  assert.ok(plan.mergeManifest.some((item) => item.kind === 'venue_merge'));

  const second = Migration.planMigration(plan.venues, plan.concerts, decisions);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.venues, plan.venues);
  assert.equal(second.mergeManifest.length, 0);
});

test('v176 researched concert venue assignment preserves raw provider wording and enables identity', () => {
  const decisions = {
    concertVenueAssignments: [{
      concertIds: ['concert-a'],
      canonicalVenueId: VENUE_A,
      reason: 'official event page identifies the canonical venue',
      evidence: ['official event page'],
    }],
  };
  const plan = Migration.planMigration([venue(VENUE_A)], [concert('concert-a')], decisions);
  assert.equal(Migration.validatePlan(plan).valid, true);
  assert.equal(plan.concerts[0].canonicalVenueId, VENUE_A);
  assert.equal(plan.concerts[0].venue, 'Provider Hall');
  assert.equal(plan.concerts[0].city, 'Wrong City');
  assert.ok(plan.mergeManifest.some((item) => item.kind === 'concert_venue_assignment'));

  const second = Migration.planMigration(plan.venues, plan.concerts, decisions);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.concerts, plan.concerts);
  assert.equal(second.mergeManifest.length, 0);
});

test('v176 researched concert venue assignments fail closed on conflicts and missing targets', () => {
  const conflicting = Migration.planMigration([venue(VENUE_A), venue(VENUE_B, { name: 'Other Hall', currentName: 'Other Hall' })], [concert('concert-a')], {
    concertVenueAssignments: [
      { concertIds: ['concert-a'], canonicalVenueId: VENUE_A },
      { concertIds: ['concert-a'], canonicalVenueId: VENUE_B },
    ],
  });
  assert.ok(conflicting.blocked.some((item) => item.reason === 'conflicting_venue_assignments'));
  assert.equal(Migration.validatePlan(conflicting).valid, false);

  const missing = Migration.planMigration([venue(VENUE_A)], [concert('concert-a')], {
    concertVenueAssignments: [{ concertIds: ['concert-a'], canonicalVenueId: 'venue-deadbeef' }],
  });
  assert.ok(missing.blocked.some((item) => item.reason === 'venue_assignment_target_missing'));
  assert.equal(Migration.validatePlan(missing).valid, false);
});

test('v176 venue corrections reject stable identity mutation', () => {
  const plan = Migration.planMigration([venue(VENUE_A)], [], {
    venueCorrections: [{ venueId: VENUE_A, set: { venueId: VENUE_B } }],
  });
  assert.ok(plan.blocked.some((item) => item.reason === 'venue_correction_fields_invalid'));
  assert.equal(plan.venues[0].venueId, VENUE_A);
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 venue corrections reject user-owned fields and contradictory registry entries', () => {
  const protectedField = Migration.planMigration([venue(VENUE_A)], [], {
    venueCorrections: [{ venueId: VENUE_A, set: { notes: 'research must not overwrite this' } }],
  });
  assert.ok(protectedField.blocked.some((item) => item.reason === 'venue_correction_fields_invalid'));

  const conflicting = Migration.planMigration([venue(VENUE_A)], [], {
    venueCorrections: [
      { venueId: VENUE_A, set: { address: 'First answer' } },
      { venueId: VENUE_A, set: { address: 'Second answer' } },
    ],
  });
  assert.ok(conflicting.blocked.some((item) => item.reason === 'conflicting_venue_corrections'));
  assert.equal(conflicting.venues[0].address, 'Correct Street 1');
  assert.equal(Migration.validatePlan(conflicting).valid, false);
});
