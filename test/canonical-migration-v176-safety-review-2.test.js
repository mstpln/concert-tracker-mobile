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

function venue(id, name) {
  return { venueId: id, name, currentName: name, city: 'Malmo', country: 'Sweden', address: `${name} Street 1` };
}

function concert(id) {
  return {
    id,
    bandId: 'band-a',
    date: '2026-10-10',
    venue: 'Hall A',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Hall A Street 1',
    canonicalVenueId: VENUE_A,
  };
}

test('v176 requires an explicit canonical survivor for researched venue merges', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Hall A'), venue(VENUE_B, 'Hall B')], [], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], reason: 'missing survivor' }],
  });
  assert.equal(plan.venues.length, 2);
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'canonical_id_not_member'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 blocks malformed distinct decisions that reference missing source IDs', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Shared Hall'), venue(VENUE_B, 'Shared Hall')], [], {
    venueDistinct: [{ ids: [VENUE_A, VENUE_B, 'venue-deadbeef'], reason: 'contains typo' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'distinct_decision_member_missing'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 chained venue merges keep every legacy source mapped to the final survivor', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Hall A'),
    venue(VENUE_B, 'Hall B'),
    venue(VENUE_C, 'Hall C'),
  ], [], {
    venueMerges: [
      { ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'first continuation' },
      { ids: [VENUE_A, VENUE_C], canonicalId: VENUE_C, reason: 'second continuation' },
    ],
  });
  assert.equal(plan.venues.length, 1);
  assert.equal(plan.venues[0].venueId, VENUE_C);
  assert.equal(plan.legacyVenueMap[VENUE_A], VENUE_C);
  assert.equal(plan.legacyVenueMap[VENUE_B], VENUE_C);
  assert.equal(plan.legacyVenueMap[VENUE_C], VENUE_C);
  assert.deepEqual(plan.reverseVenueMap[VENUE_C].sort(), [VENUE_A, VENUE_B, VENUE_C].sort());
  assert.equal(plan.invariants.orphans.valid, true);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 invalidates every decision for a festival identity after conflicting metadata is found', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Hall A')], [
    { ...concert('a'), bandId: 'band-a' },
    { ...concert('b'), bandId: 'band-b' },
    { ...concert('c'), bandId: 'band-c' },
  ], {
    festivalEditions: [
      { id: 'festival-2026', name: 'Festival', year: '2026', concertIds: ['a'] },
      { id: 'festival-2026', name: 'Wrong Festival', year: '2026', concertIds: ['b'] },
      { id: 'festival-2026', name: 'Festival', year: '2026', concertIds: ['c'] },
    ],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'festival' && item.reason === 'festival_metadata_conflict'));
  assert.equal(plan.concerts.some((record) => record.festivalEditionId === 'festival-2026'), false);
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 audit refuses to overwrite a supplied input file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-audit-output-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  fs.writeFileSync(venuesPath, `${JSON.stringify([venue(VENUE_A, 'Hall A')], null, 2)}\n`);
  fs.writeFileSync(concertsPath, `${JSON.stringify([concert('concert-a')], null, 2)}\n`);
  const original = fs.readFileSync(venuesPath);
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const run = spawnSync(process.execPath, [script, 'audit', '--venues', venuesPath, '--concerts', concertsPath, '--out', venuesPath], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must not overwrite a source input file/);
  assert.deepEqual(fs.readFileSync(venuesPath), original);
});

test('v176 plan refuses an output directory that contains supplied source inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-plan-output-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  const venueBytes = Buffer.from(`${JSON.stringify([venue(VENUE_A, 'Hall A')], null, 2)}\n`);
  const concertBytes = Buffer.from(`${JSON.stringify([concert('concert-a')], null, 2)}\n`);
  fs.writeFileSync(venuesPath, venueBytes);
  fs.writeFileSync(concertsPath, concertBytes);
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const run = spawnSync(process.execPath, [
    script, 'plan', '--venues', venuesPath, '--concerts', concertsPath,
    '--expected-venues-sha256', Migration.sha256Bytes(venueBytes),
    '--expected-concerts-sha256', Migration.sha256Bytes(concertBytes),
    '--out-dir', dir,
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must not contain a source input file/);
});
