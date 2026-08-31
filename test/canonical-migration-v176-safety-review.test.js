'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
    date: '2026-10-10',
    venue: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: VENUE_A,
    attending: false,
    freeTicket: false,
    ticketPrice: 500,
    ticketQuantity: 1,
    lineupRole: 'headliner',
    ...overrides,
  };
}

test('v176 validation blocks unresolved venue identity candidates after planning', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Shared Hall'),
    venue(VENUE_B, 'Shared Hall'),
  ], []);
  assert.equal(plan.unresolvedIdentity.venues.length, 1);
  assert.ok(Migration.validatePlan(plan).errors.includes('unresolved_venue_candidates'));
});

test('v176 requires all pairs in a multi-record concert candidate to be explicitly distinct before audit marks it resolved', () => {
  const sourceConcerts = [concert('concert-a'), concert('concert-b'), concert('concert-c')];
  const partial = Migration.audit([venue(VENUE_A, 'Main Hall')], sourceConcerts, {
    concertDistinct: [{ ids: ['concert-a', 'concert-b'], reason: 'researched pair only' }],
  });
  assert.equal(partial.concertCandidates.length, 1);
  assert.equal(partial.concertCandidates[0].resolvedDistinct, false);
  const complete = Migration.audit([venue(VENUE_A, 'Main Hall')], sourceConcerts, {
    concertDistinct: [{ ids: ['concert-a', 'concert-b', 'concert-c'], reason: 'all three are independently distinct' }],
  });
  assert.equal(complete.concertCandidates[0].resolvedDistinct, true);
});

test('v176 blocks a venue merge when the requested canonical ID is not a decision member', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Hall A'),
    venue(VENUE_B, 'Hall B'),
  ], [], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_C, reason: 'bad decision' }],
  });
  assert.equal(plan.venues.length, 2);
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'canonical_id_not_member'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks an invalid canonical concert survivor instead of silently accepting the decision', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [concert('concert-a'), concert('concert-b')], {
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-missing' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'canonical_id_not_member'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 concert merge decisions are survivor selections only for a complete canonical duplicate group', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Main Hall'),
    venue(VENUE_B, 'Other Hall', { city: 'Copenhagen', country: 'Denmark', address: 'Other Street 2' }),
  ], [
    concert('concert-a'),
    concert('concert-b', { canonicalVenueId: VENUE_B, venue: 'Other Hall', city: 'Copenhagen', country: 'Denmark', venueAddress: 'Other Street 2' }),
  ], {
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-a' }],
  });
  assert.equal(plan.concerts.length, 2);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'merge_decision_not_canonical_duplicate'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks a partial survivor decision when a canonical duplicate group contains additional records', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a'),
    concert('concert-b'),
    concert('concert-c'),
  ], {
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-a' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'merge_decision_incomplete_group'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks contradictory festival membership and leaves conflicting decisions unapplied', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', { bandId: 'band-a' }),
    concert('concert-b', { bandId: 'band-b', lineupRole: 'support' }),
    concert('concert-c', { bandId: 'band-c', lineupRole: 'support' }),
  ], {
    festivalEditions: [
      { id: 'festival-one-2026', name: 'Festival One', year: '2026', concertIds: ['concert-a', 'concert-b'] },
      { id: 'festival-two-2026', name: 'Festival Two', year: '2026', concertIds: ['concert-b', 'concert-c'] },
    ],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'festival' && item.reason === 'festival_membership_conflict'));
  assert.equal(plan.concerts.some((record) => record.festivalEditionId === 'festival-one-2026' || record.festivalEditionId === 'festival-two-2026'), false);
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks conflicting metadata for the same festival edition', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', { bandId: 'band-a' }),
    concert('concert-b', { bandId: 'band-b', lineupRole: 'support' }),
  ], {
    festivalEditions: [
      { id: 'festival-2026', name: 'Festival', year: '2026', concertIds: ['concert-a'] },
      { id: 'festival-2026', name: 'Different Festival', year: '2026', concertIds: ['concert-b'] },
    ],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'festival' && item.reason === 'festival_metadata_conflict'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 venue merge preserves merged-away name and location as historical evidence', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Current Hall'),
    venue(VENUE_B, 'Old Hall', { city: 'Lund', address: 'Old Street 9' }),
  ], [], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'researched continuation' }],
  });
  const merged = plan.venues.find((record) => record.venueId === VENUE_A);
  assert.ok(merged.historicalNames.some((item) => item.name === 'Old Hall' && item.legacyVenueId === VENUE_B));
  assert.ok(merged.locationHistory.some((item) => item.city === 'Lund' && item.address === 'Old Street 9'));
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 provider presentation recognizes v175 sourceProvider and ticketRetailerVerified strength', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-user', { manuallyAdded: true, sourceProvider: 'manual', ticketUrl: 'https://example.invalid/manual' }),
    concert('concert-tm', {
      manuallyAdded: false,
      sourceProvider: 'ticketmaster',
      ticketRetailerVerified: true,
      providerOfferType: 'standard',
      providerEventId: 'tm-1',
      ticketUrl: 'https://example.invalid/tm',
      ticketPrice: undefined,
      ticketQuantity: undefined,
    }),
  ]);
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].id, 'concert-user');
  assert.equal(plan.concerts[0].sourceProvider, 'ticketmaster');
  assert.equal(plan.concerts[0].ticketRetailerVerified, true);
  assert.equal(plan.concerts[0].providerEventId, 'tm-1');
  assert.equal(plan.concerts[0].ticketUrl, 'https://example.invalid/tm');
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 dry-run requires and verifies the exact decision-file hash when decisions are supplied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-decisions-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  const decisionsPath = path.join(dir, 'decisions.json');
  const venueBytes = Buffer.from(`${JSON.stringify([venue(VENUE_A, 'Main Hall')], null, 2)}\n`);
  const concertBytes = Buffer.from(`${JSON.stringify([concert('concert-a')], null, 2)}\n`);
  const decisionBytes = Buffer.from(`${JSON.stringify({}, null, 2)}\n`);
  fs.writeFileSync(venuesPath, venueBytes);
  fs.writeFileSync(concertsPath, concertBytes);
  fs.writeFileSync(decisionsPath, decisionBytes);
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const common = [
    script, 'plan', '--venues', venuesPath, '--concerts', concertsPath, '--decisions', decisionsPath,
    '--expected-venues-sha256', Migration.sha256Bytes(venueBytes),
    '--expected-concerts-sha256', Migration.sha256Bytes(concertBytes),
  ];
  const missing = spawnSync(process.execPath, [...common, '--out-dir', path.join(dir, 'missing')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /expected-decisions-sha256/);
  const wrong = spawnSync(process.execPath, [...common, '--expected-decisions-sha256', '0'.repeat(64), '--out-dir', path.join(dir, 'wrong')], { encoding: 'utf8' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /decisions SHA-256 mismatch/);
  const valid = spawnSync(process.execPath, [...common, '--expected-decisions-sha256', Migration.sha256Bytes(decisionBytes), '--out-dir', path.join(dir, 'valid')], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
});
