'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Migration = require('../scripts/lib/canonicalMigrationV176');

function venue(id = 'venue-main', name = 'Main Hall') {
  return { venueId: id, name, currentName: name, city: 'Malmo', country: 'Sweden', address: 'Main Street 1' };
}

function concert(overrides = {}) {
  return {
    id: 'concert-a',
    bandId: 'band-a',
    bandName: 'Band A',
    date: '2026-10-10',
    venue: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: 'venue-main',
    attending: false,
    freeTicket: false,
    ticketPrice: 500,
    ticketQuantity: 1,
    lineupRole: 'headliner',
    ...overrides,
  };
}

test('v176 preserves explicit false user-owned values when canonical duplicates merge', () => {
  const plan = Migration.planMigration([venue()], [
    concert({ id: 'concert-a', manuallyAdded: true, attending: false, freeTicket: false }),
    concert({ id: 'concert-b', manuallyAdded: false, attending: undefined, freeTicket: undefined, ticketPrice: undefined, ticketQuantity: undefined }),
  ]);
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].attending, false);
  assert.equal(plan.concerts[0].freeTicket, false);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 protected invariant understands legal ID collapse and protects attended historical date', () => {
  const source = [
    concert({ id: 'historic-a', date: '2020-02-20', attending: true, manuallyAdded: true, notes: 'historical' }),
    concert({ id: 'historic-b', date: '2020-02-20', attending: undefined, manuallyAdded: false, notes: undefined, ticketPrice: undefined, ticketQuantity: undefined }),
  ];
  const plan = Migration.planMigration([venue()], source);
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].date, '2020-02-20');
  assert.equal(plan.invariants.protected.valid, true);
  assert.equal(plan.legacyConcertMap['historic-b'], 'historic-a');
  assert.deepEqual(plan.reverseConcertMap['historic-a'].sort(), ['historic-a', 'historic-b']);
});

test('v176 emits complete identity mappings for unchanged records', () => {
  const plan = Migration.planMigration([venue(), venue('venue-b', 'Venue B')], [concert()]);
  assert.equal(plan.legacyVenueMap['venue-main'], 'venue-main');
  assert.equal(plan.legacyVenueMap['venue-b'], 'venue-b');
  assert.equal(plan.legacyConcertMap['concert-a'], 'concert-a');
  assert.deepEqual(plan.reverseVenueMap['venue-b'], ['venue-b']);
});

test('v176 blocks a researched venue merge that contradicts an explicit distinct decision', () => {
  const plan = Migration.planMigration(
    [venue('venue-a', 'Shared Name'), venue('venue-b', 'Shared Name')],
    [],
    {
      venueDistinct: [{ ids: ['venue-a', 'venue-b'], reason: 'independent venues' }],
      venueMerges: [{ ids: ['venue-a', 'venue-b'], canonicalId: 'venue-a', reason: 'contradictory merge' }],
    },
  );
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'merge_conflicts_with_explicit_distinct'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks festival decisions with missing concert members', () => {
  const plan = Migration.planMigration([venue()], [concert()], {
    festivalEditions: [{ id: 'festival-2026', name: 'Festival', year: '2026', concertIds: ['concert-a', 'missing-concert'] }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'festival' && item.reason === 'decision_member_missing'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 orphan checks reject dangling canonical venue and duplicate IDs', () => {
  const result = Migration.orphanChecks(
    [venue()],
    [concert({ id: 'dup' }), concert({ id: 'dup', canonicalVenueId: 'missing-venue' })],
    { 'venue-main': 'venue-main' },
    { dup: 'dup' },
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.reason === 'duplicate_concert_ids'));
  assert.ok(result.errors.some((item) => item.reason === 'concert_canonical_venue_orphan'));
});

test('v176 event metrics use the migrated local venue index after researched venue reconciliation', () => {
  const sourceVenues = [
    venue('venue-main', 'Main Hall'),
    { ...venue('venue-room', 'Main Hall Room 2'), currentName: 'Main Hall Room 2' },
  ];
  const sourceConcerts = [
    concert({ id: 'concert-a', bandId: 'band-a', canonicalVenueId: 'venue-main', venue: 'Main Hall' }),
    concert({ id: 'concert-b', bandId: 'band-b', canonicalVenueId: 'venue-room', venue: 'Main Hall Room 2', lineupRole: 'support' }),
  ];
  const plan = Migration.planMigration(sourceVenues, sourceConcerts, {
    venueMerges: [{ ids: ['venue-main', 'venue-room'], canonicalId: 'venue-main', reason: 'researched_parent_room' }],
  });
  assert.equal(plan.concerts.length, 2);
  assert.equal(plan.after.metrics.eventCount, 1);
  assert.equal(plan.invariants.invalidEvents.length, 0);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 migration event metrics preserve authoritative explicit event groups across venue and date', () => {
  const sourceVenues = [venue(), { ...venue('venue-b', 'Venue B'), city: 'Copenhagen', country: 'Denmark', address: 'Other Street 2' }];
  const sourceConcerts = [
    concert({ id: 'explicit-a', eventGroupId: 'event-user-1' }),
    concert({ id: 'explicit-b', bandId: 'band-b', date: '2026-10-11', eventGroupId: 'event-user-1', venue: 'Venue B', city: 'Copenhagen', country: 'Denmark', venueAddress: 'Other Street 2', canonicalVenueId: 'venue-b', lineupRole: 'support' }),
  ];
  const plan = Migration.planMigration(sourceVenues, sourceConcerts, {});
  assert.equal(plan.after.metrics.eventCount, 1);
  assert.equal(plan.invariants.invalidEvents.length, 0);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 dry-run CLI refuses a plan when exact input hashes are absent or wrong', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-hash-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  fs.writeFileSync(venuesPath, `${JSON.stringify([venue()], null, 2)}\n`);
  fs.writeFileSync(concertsPath, `${JSON.stringify([concert()], null, 2)}\n`);
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const missing = spawnSync(process.execPath, [script, 'plan', '--venues', venuesPath, '--concerts', concertsPath, '--out-dir', path.join(dir, 'out-missing')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /expected-venues-sha256/);
  const wrong = spawnSync(process.execPath, [script, 'plan', '--venues', venuesPath, '--concerts', concertsPath, '--expected-venues-sha256', '0'.repeat(64), '--expected-concerts-sha256', '0'.repeat(64), '--out-dir', path.join(dir, 'out-wrong')], { encoding: 'utf8' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /SHA-256 mismatch/);
});

test('v176 dry-run CLI writes byte-identical backups and reversible artifacts with matching hashes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-ok-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  const venueBytes = Buffer.from(`${JSON.stringify([venue()], null, 2)}\n`);
  const concertBytes = Buffer.from(`${JSON.stringify([concert()], null, 2)}\n`);
  fs.writeFileSync(venuesPath, venueBytes);
  fs.writeFileSync(concertsPath, concertBytes);
  const venueHash = Migration.sha256Bytes(venueBytes);
  const concertHash = Migration.sha256Bytes(concertBytes);
  const outDir = path.join(dir, 'out');
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const run = spawnSync(process.execPath, [
    script, 'plan', '--venues', venuesPath, '--concerts', concertsPath,
    '--expected-venues-sha256', venueHash, '--expected-concerts-sha256', concertHash,
    '--out-dir', outDir,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(fs.readFileSync(path.join(outDir, 'source', 'venues.original.json')), venueBytes);
  assert.deepEqual(fs.readFileSync(path.join(outDir, 'source', 'concerts.original.json')), concertBytes);
  const rollback = JSON.parse(fs.readFileSync(path.join(outDir, 'rollback-manifest.json'), 'utf8'));
  assert.equal(rollback.sourceFileHashes.venues, venueHash);
  assert.equal(rollback.sourceFileHashes.concerts, concertHash);
  assert.deepEqual(rollback.reverseVenueMap['venue-main'], ['venue-main']);
  assert.deepEqual(rollback.reverseConcertMap['concert-a'], ['concert-a']);
});

test('v176 production-scale synthetic dry run is deterministic', () => {
  const sourceVenues = Array.from({ length: 530 }, (_, index) => ({
    venueId: `venue-${index}`,
    name: `Synthetic Venue ${index}`,
    city: `City ${index % 40}`,
    country: 'Synthetic Country',
    address: `Street ${index}`,
  }));
  const sourceConcerts = Array.from({ length: 3262 }, (_, index) => ({
    id: `concert-${index}`,
    bandId: `band-${index % 400}`,
    date: `2027-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    venue: sourceVenues[index % sourceVenues.length].name,
    city: sourceVenues[index % sourceVenues.length].city,
    country: 'Synthetic Country',
    venueAddress: sourceVenues[index % sourceVenues.length].address,
    canonicalVenueId: sourceVenues[index % sourceVenues.length].venueId,
  }));
  const first = Migration.planMigration(sourceVenues, sourceConcerts, {});
  const second = Migration.planMigration(first.venues, first.concerts, {});
  assert.equal(Migration.validatePlan(first).valid, true);
  assert.equal(second.mergeManifest.length, 0);
  assert.deepEqual(second.venues, first.venues);
  assert.deepEqual(second.concerts, first.concerts);
});
