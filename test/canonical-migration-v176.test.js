'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../scripts/lib/canonicalMigrationV176');

function venues() {
  return [
    {
      venueId: 'venue-main',
      name: 'Main Hall',
      currentName: 'Main Hall',
      city: 'Malmo',
      country: 'Sweden',
      address: 'Main Street 1',
      identityAliases: ['Main Hall Arena'],
      providerIdentities: [{ provider: 'ticketmaster', providerVenueId: 'tm-main', name: 'Main Hall' }],
    },
    {
      venueId: 'venue-room',
      name: 'Main Hall Room 2',
      city: 'Malmo',
      country: 'Sweden',
      address: 'Main Street 1',
      customFutureVenueField: 'preserve-me',
    },
    {
      venueId: 'venue-other',
      name: 'Other Arena',
      city: 'Copenhagen',
      country: 'Denmark',
      address: 'Other Street 2',
    },
  ];
}

function baseConcert(overrides = {}) {
  return {
    id: 'concert-user',
    bandId: 'band-1',
    bandName: 'Band One',
    date: '2026-10-10',
    venue: 'Main Hall',
    city: 'Malmo',
    country: 'Sweden',
    venueAddress: 'Main Street 1',
    canonicalVenueId: 'venue-main',
    attending: true,
    ticketPrice: 500,
    ticketQuantity: 1,
    freeTicket: false,
    notes: 'Keep this note',
    lineupRole: 'headliner',
    manuallyAdded: true,
    customFutureConcertField: 'keep-me',
    ...overrides,
  };
}

test('v176 merges a provider-rich duplicate into the stable user-rich concert and retains legacy identity', () => {
  const sourceVenues = venues();
  const sourceConcerts = [
    baseConcert(),
    baseConcert({
      id: 'concert-provider',
      attending: false,
      ticketPrice: undefined,
      ticketQuantity: undefined,
      notes: undefined,
      manuallyAdded: false,
      customFutureConcertField: undefined,
      provider: 'ticketmaster',
      providerVerified: true,
      providerEventId: 'tm-event-1',
      time: '20:00',
      providerObservations: [{ provider: 'ticketmaster', providerEventId: 'tm-event-1', time: '20:00' }],
    }),
  ];

  const plan = Migration.planMigration(sourceVenues, sourceConcerts, {});
  assert.equal(plan.concerts.length, 1);
  const concert = plan.concerts[0];
  assert.equal(concert.id, 'concert-user');
  assert.deepEqual(concert.legacyConcertIds, ['concert-provider']);
  assert.equal(concert.ticketPrice, 500);
  assert.equal(concert.notes, 'Keep this note');
  assert.equal(concert.customFutureConcertField, 'keep-me');
  assert.equal(concert.providerEventId, 'tm-event-1');
  assert.equal(concert.providerObservations.length, 1);
  assert.equal(plan.legacyConcertMap['concert-provider'], 'concert-user');
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 blocks a canonical duplicate when user-owned values genuinely conflict', () => {
  const sourceConcerts = [
    baseConcert({ id: 'concert-a', notes: 'User note A' }),
    baseConcert({ id: 'concert-b', notes: 'User note B', manuallyAdded: false }),
  ];
  const plan = Migration.planMigration(venues(), sourceConcerts, {});
  assert.equal(plan.concerts.length, 2);
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'user_owned_conflict' && item.fields.includes('notes')));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 applies researched venue merge first and preserves historical/raw concert wording', () => {
  const sourceConcerts = [
    baseConcert({
      id: 'concert-room-listing',
      canonicalVenueId: 'venue-room',
      venue: 'Main Hall Room 2',
      roomOrStage: { name: 'Room 2', type: 'room' },
      attending: false,
      ticketPrice: undefined,
      notes: undefined,
      manuallyAdded: false,
    }),
    baseConcert({ id: 'concert-main-listing' }),
  ];
  const decisions = {
    venueMerges: [{ ids: ['venue-main', 'venue-room'], canonicalId: 'venue-main', reason: 'researched_parent_room' }],
  };
  const plan = Migration.planMigration(venues(), sourceConcerts, decisions);
  assert.equal(plan.venues.length, 2);
  const main = plan.venues.find((record) => record.venueId === 'venue-main');
  assert.ok(main.legacyVenueIds.includes('venue-room'));
  assert.equal(main.customFutureVenueField, 'preserve-me');
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].id, 'concert-main-listing');
  assert.equal(plan.legacyVenueMap['venue-room'], 'venue-main');
  assert.equal(plan.concerts[0].venue, 'Main Hall');
});

test('v176 keeps same band/date at genuinely different canonical venues as separate concerts', () => {
  const sourceConcerts = [
    baseConcert({ id: 'concert-main', attending: false, ticketPrice: undefined, notes: undefined, manuallyAdded: false }),
    baseConcert({
      id: 'concert-other',
      venue: 'Other Arena',
      city: 'Copenhagen',
      country: 'Denmark',
      venueAddress: 'Other Street 2',
      canonicalVenueId: 'venue-other',
      attending: false,
      ticketPrice: undefined,
      notes: undefined,
      manuallyAdded: false,
    }),
  ];
  const plan = Migration.planMigration(venues(), sourceConcerts, {});
  assert.equal(plan.concerts.length, 2);
  assert.equal(plan.mergeManifest.filter((item) => item.kind === 'concert_merge').length, 0);
});

test('v176 festival decision groups multiple dates and venues into one festival event but does not collapse concerts', () => {
  const sourceConcerts = [
    baseConcert({ id: 'festival-a', bandId: 'band-a', date: '2026-07-03', attending: false, ticketPrice: 900, notes: undefined, manuallyAdded: false }),
    baseConcert({
      id: 'festival-b',
      bandId: 'band-b',
      date: '2026-07-04',
      venue: 'Other Arena',
      city: 'Copenhagen',
      country: 'Denmark',
      venueAddress: 'Other Street 2',
      canonicalVenueId: 'venue-other',
      attending: false,
      ticketPrice: 0,
      freeTicket: true,
      notes: undefined,
      manuallyAdded: false,
    }),
  ];
  const decisions = {
    festivalEditions: [{
      id: 'festival-example-2026',
      name: 'Festival Example',
      year: '2026',
      concertIds: ['festival-a', 'festival-b'],
      primaryCanonicalVenueId: 'venue-main',
    }],
  };
  const plan = Migration.planMigration(venues(), sourceConcerts, decisions);
  assert.equal(plan.concerts.length, 2);
  assert.equal(plan.after.metrics.festivalEventCount, 1);
  assert.equal(plan.after.metrics.eventCount, 1);
  assert.equal(plan.after.metrics.ticketTotal, 900);
});

test('v176 does not apply multi-day grouping to normal concerts', () => {
  const sourceConcerts = [
    baseConcert({ id: 'night-one', date: '2026-11-01', attending: false, ticketPrice: undefined, notes: undefined, manuallyAdded: false }),
    baseConcert({ id: 'night-two', date: '2026-11-02', attending: false, ticketPrice: undefined, notes: undefined, manuallyAdded: false }),
  ];
  const plan = Migration.planMigration(venues(), sourceConcerts, {});
  assert.equal(plan.concerts.length, 2);
  assert.equal(plan.after.metrics.eventCount, 2);
  assert.equal(plan.after.metrics.festivalEventCount, 0);
});

test('v176 dry-run is deterministic and a second migration pass is a no-op', () => {
  const sourceConcerts = [
    baseConcert(),
    baseConcert({
      id: 'concert-provider',
      attending: false,
      ticketPrice: undefined,
      ticketQuantity: undefined,
      notes: undefined,
      manuallyAdded: false,
      provider: 'ticketmaster',
      providerVerified: true,
      providerEventId: 'tm-event-1',
    }),
  ];
  const first = Migration.planMigration(venues(), sourceConcerts, {});
  const second = Migration.planMigration(first.venues, first.concerts, {});
  assert.equal(second.mergeManifest.length, 0);
  assert.deepEqual(second.venues, first.venues);
  assert.deepEqual(second.concerts, first.concerts);
  assert.deepEqual(second.sourceHashes.venues, first.outputHashes.venues);
  assert.deepEqual(second.sourceHashes.concerts, first.outputHashes.concerts);
});

test('v176 audit reports canonical duplicate candidates without mutating source arrays', () => {
  const sourceVenues = venues();
  const sourceConcerts = [baseConcert({ id: 'a' }), baseConcert({ id: 'b', attending: false, ticketPrice: undefined, notes: undefined, manuallyAdded: false })];
  const beforeVenues = JSON.stringify(sourceVenues);
  const beforeConcerts = JSON.stringify(sourceConcerts);
  const report = Migration.audit(sourceVenues, sourceConcerts, {});
  assert.equal(report.concertCandidates.length, 1);
  assert.deepEqual(report.concertCandidates[0].ids.sort(), ['a', 'b']);
  assert.equal(JSON.stringify(sourceVenues), beforeVenues);
  assert.equal(JSON.stringify(sourceConcerts), beforeConcerts);
});
