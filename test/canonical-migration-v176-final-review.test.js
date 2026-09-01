'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Migration = require('../scripts/lib/canonicalMigrationV176Final');

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
    address: `${name} Street 1`,
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
    venueAddress: 'Main Hall Street 1',
    canonicalVenueId: VENUE_A,
    ...overrides,
  };
}

test('v176 final planner keeps source-order stable ID when duplicate records are equally user-rich', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-z'),
    concert('concert-a'),
  ]);
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].id, 'concert-z');
  assert.deepEqual(plan.concerts[0].legacyConcertIds, ['concert-a']);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner unions provider related-event evidence across merged records', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', { providerRelatedEventIds: ['tm-related-a'] }),
    concert('concert-b', { providerRelatedEventIds: ['tm-related-b', 'tm-related-a'] }),
  ]);
  assert.equal(plan.concerts.length, 1);
  assert.deepEqual(plan.concerts[0].providerRelatedEventIds, ['tm-related-a', 'tm-related-b']);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner enriches a sparse same-event provider observation from top-level evidence', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-1',
      providerObservations: [{ provider: 'ticketmaster', providerEventId: 'tm-event-1' }],
      time: '20:00',
      ticketUrl: 'https://example.invalid/ticket',
    }),
    concert('concert-b'),
  ]);
  assert.equal(plan.concerts.length, 1);
  const observations = plan.concerts[0].providerObservations.filter((item) => item.provider === 'ticketmaster' && item.providerEventId === 'tm-event-1');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].time, '20:00');
  assert.equal(observations[0].ticketUrl, 'https://example.invalid/ticket');
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner does not synthesize a conflicting observation from migrated hybrid presentation fields on replay', () => {
  const source = [
    concert('concert-a', {
      articleUrl: 'https://example.invalid/announcement',
      city: 'Milan',
      venueAddress: 'Historic address',
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      ticketRetailerVerified: true,
      providerEventId: 'tm-event-1',
      providerVenueId: 'tm-venue-1',
      providerEventName: 'Band A live',
      city: 'Milano',
      venueAddress: 'Provider address',
      ticketUrl: 'https://example.invalid/ticket',
      foundAt: '2026-08-30T12:00:00Z',
    }),
  ];
  const first = Migration.planMigration([venue(VENUE_A, 'Main Hall')], source);
  assert.equal(Migration.validatePlan(first).valid, true);
  assert.equal(first.concerts[0].providerObservations.filter((item) => item.provider === 'ticketmaster').length, 1);
  assert.equal(first.concerts[0].providerObservations.filter((item) => item.provider === 'source').length, 1);

  const second = Migration.planMigration(first.venues, first.concerts, {});
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.concerts, first.concerts);
  assert.deepEqual(second.outputHashes, first.outputHashes);
});

test('v176 final planner does not enrich one provider event with presentation fields retained from another event on replay', () => {
  const source = [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      ticketRetailerVerified: true,
      providerEventId: 'tm-event-a',
      providerAttractionId: 'tm-artist',
      ticketUrl: 'https://example.invalid/a',
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      ticketRetailerVerified: true,
      providerEventId: 'tm-event-b',
      providerVenueId: 'tm-venue-b',
      providerAttractionId: 'tm-artist',
      providerEventName: 'Band A live',
      providerOfferType: 'standard',
      providerEventStatus: 'onsale',
      ticketUrl: 'https://example.invalid/b',
    }),
  ];
  const first = Migration.planMigration([venue(VENUE_A, 'Main Hall')], source);
  assert.equal(Migration.validatePlan(first).valid, true);
  assert.equal(first.concerts[0].providerObservations.length, 2);

  const second = Migration.planMigration(first.venues, first.concerts, {});
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.concerts, first.concerts);
  assert.deepEqual(second.outputHashes, first.outputHashes);
});

test('v176 final planner preserves conflicting observations for the same provider event instead of discarding one', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-1',
      time: '19:00',
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-1',
      time: '20:00',
    }),
  ]);
  const observations = plan.concerts[0].providerObservations.filter((item) => item.provider === 'ticketmaster' && item.providerEventId === 'tm-event-1');
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((item) => item.time).sort(), ['19:00', '20:00']);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner preserves distinct provider observation timestamps for the same event', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      providerObservations: [{
        provider: 'ticketmaster',
        providerEventId: 'tm-event-1',
        time: '20:00',
        observedAt: '2026-08-30T10:00:00Z',
      }],
    }),
    concert('concert-b', {
      providerObservations: [{
        provider: 'ticketmaster',
        providerEventId: 'tm-event-1',
        time: '20:00',
        observedAt: '2026-08-30T11:00:00Z',
      }],
    }),
  ]);
  const observations = plan.concerts[0].providerObservations.filter((item) => item.provider === 'ticketmaster' && item.providerEventId === 'tm-event-1');
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((item) => item.observedAt).sort(), ['2026-08-30T10:00:00Z', '2026-08-30T11:00:00Z']);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner preserves provider article evidence even when the provider has no event or venue ID', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a'),
    concert('concert-b', {
      sourceProvider: 'tavily',
      providerSource: 'tavily-search',
      articleUrl: 'https://example.invalid/announcement',
      foundAt: '2026-08-30T12:00:00Z',
    }),
  ]);
  assert.equal(plan.concerts.length, 1);
  const observation = plan.concerts[0].providerObservations.find((item) => item.provider === 'tavily');
  assert.ok(observation);
  assert.equal(observation.providerEventId, null);
  assert.equal(observation.articleUrl, 'https://example.invalid/announcement');
  assert.equal(observation.source, 'tavily-search');
  assert.equal(observation.foundAt, '2026-08-30T12:00:00Z');
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner preserves unnamespaced article evidence and raw location through replay', () => {
  const source = [
    concert('concert-a'),
    concert('concert-b', {
      venue: 'Historic Hall wording',
      city: 'Historic City wording',
      country: 'Historic Country wording',
      venueAddress: 'Historic address wording',
      articleUrl: 'https://example.invalid/artist-events',
      foundAt: '2026-08-30T12:00:00Z',
    }),
  ];
  const first = Migration.planMigration([venue(VENUE_A, 'Main Hall')], source);
  assert.equal(first.concerts.length, 1);
  const observation = first.concerts[0].providerObservations.find((item) => item.provider === 'source');
  assert.ok(observation);
  assert.equal(observation.providerEventId, null);
  assert.equal(observation.articleUrl, 'https://example.invalid/artist-events');
  assert.equal(observation.venue, 'Historic Hall wording');
  assert.equal(observation.city, 'Historic City wording');
  assert.equal(observation.country, 'Historic Country wording');
  assert.equal(observation.address, 'Historic address wording');
  assert.equal(observation.foundAt, '2026-08-30T12:00:00Z');

  const second = Migration.planMigration(first.venues, first.concerts);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.concerts, first.concerts);
  assert.deepEqual(second.outputHashes, first.outputHashes);
});

test('v176 final planner preserves distinct timestamps from unnamespaced ticket evidence', () => {
  const source = [
    concert('concert-a', {
      ticketUrl: 'https://example.invalid/ticket',
      ticketRetailerVerified: true,
      foundAt: '2026-08-30T10:00:00Z',
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-1',
      ticketUrl: 'https://example.invalid/ticket',
      ticketRetailerVerified: true,
      foundAt: '2026-08-30T11:00:00Z',
    }),
  ];
  const first = Migration.planMigration([venue(VENUE_A, 'Main Hall')], source);
  const observation = first.concerts[0].providerObservations.find((item) => item.provider === 'source');
  assert.ok(observation);
  assert.equal(observation.ticketUrl, 'https://example.invalid/ticket');
  assert.equal(observation.foundAt, '2026-08-30T10:00:00Z');

  const second = Migration.planMigration(first.venues, first.concerts);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.deepEqual(second.concerts, first.concerts);
  assert.deepEqual(second.outputHashes, first.outputHashes);
});

test('v176 final planner keeps match and verification metadata scoped to each provider observation', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-a',
      artistMatchMethod: 'validated_name_fallback',
      ticketRetailerVerified: true,
      providerConfidence: 80,
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-b',
      artistMatchMethod: 'confirmed_attraction_id',
      ticketRetailerVerified: true,
      providerConfidence: 100,
    }),
  ]);
  const first = plan.concerts[0].providerObservations.find((item) => item.providerEventId === 'tm-event-a');
  const second = plan.concerts[0].providerObservations.find((item) => item.providerEventId === 'tm-event-b');
  assert.equal(first.artistMatchMethod, 'validated_name_fallback');
  assert.equal(first.ticketRetailerVerified, true);
  assert.equal(first.providerConfidence, 80);
  assert.equal(second.artistMatchMethod, 'confirmed_attraction_id');
  assert.equal(second.ticketRetailerVerified, true);
  assert.equal(second.providerConfidence, 100);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 discovery metadata differences do not block a canonical provider duplicate merge', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-a',
      foundAt: '2026-08-30T10:00:00Z',
      isNew: true,
    }),
    concert('concert-b', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-event-b',
      foundAt: '2026-08-30T11:00:00Z',
      isNew: false,
    }),
  ]);
  assert.equal(plan.blocked.some((item) => item.reason === 'unknown_field_conflict'), false);
  assert.equal(plan.concerts.length, 1);
  assert.deepEqual(
    plan.concerts[0].providerObservations.map((item) => item.foundAt).sort(),
    ['2026-08-30T10:00:00Z', '2026-08-30T11:00:00Z'],
  );
});

test('v176 final planner recognizes explicit concert merge members supplied only through legacy aliases', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-z', { legacyConcertIds: ['concert-old-z'] }),
    concert('concert-a', { legacyConcertIds: ['concert-old-a'] }),
  ], {
    concertMerges: [{
      ids: ['concert-old-z', 'concert-old-a'],
      canonicalId: 'concert-old-a',
      reason: 'researched duplicate through legacy aliases',
    }],
  });
  assert.equal(plan.concerts.length, 1);
  assert.equal(plan.concerts[0].id, 'concert-a');
  assert.equal(plan.blocked.some((item) => item.reason === 'conflicting_overlapping_merge_decisions'), false);
  assert.equal(Migration.validatePlan(plan).valid, true);
});

test('v176 final planner blocks overlapping venue merge decisions with conflicting survivors', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Hall A'),
    venue(VENUE_B, 'Hall B'),
    venue(VENUE_C, 'Hall C'),
  ], [], {
    venueMerges: [
      { ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A, reason: 'first' },
      { ids: [VENUE_A, VENUE_C], canonicalId: VENUE_C, reason: 'conflicting overlap' },
    ],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'conflicting_overlapping_merge_decisions'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 final planner blocks overlapping concert survivor decisions with conflicting survivors', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a'),
    concert('concert-b'),
    concert('concert-c'),
  ], {
    concertMerges: [
      { ids: ['concert-a', 'concert-b', 'concert-c'], canonicalId: 'concert-a' },
      { ids: ['concert-a', 'concert-b', 'concert-c'], canonicalId: 'concert-b' },
    ],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'conflicting_overlapping_merge_decisions'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 final planner detects merge-versus-distinct contradiction through a legacy venue alias', () => {
  const plan = Migration.planMigration([
    venue(VENUE_A, 'Hall A'),
    venue(VENUE_B, 'Hall B', { legacyVenueIds: ['venue-deadbeef'] }),
  ], [], {
    venueMerges: [{ ids: [VENUE_A, VENUE_B], canonicalId: VENUE_A }],
    venueDistinct: [{ ids: [VENUE_A, 'venue-deadbeef'], reason: 'legacy alias says distinct' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'venue' && item.reason === 'merge_conflicts_with_legacy_distinct'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 final planner detects merge-versus-distinct contradiction through a legacy concert alias', () => {
  const plan = Migration.planMigration([venue(VENUE_A, 'Main Hall')], [
    concert('concert-a'),
    concert('concert-b', { legacyConcertIds: ['concert-old-b'] }),
  ], {
    concertMerges: [{ ids: ['concert-a', 'concert-b'], canonicalId: 'concert-a' }],
    concertDistinct: [{ ids: ['concert-a', 'concert-old-b'], reason: 'legacy alias says distinct' }],
  });
  assert.ok(plan.blocked.some((item) => item.kind === 'concert' && item.reason === 'merge_conflicts_with_legacy_distinct'));
  assert.equal(Migration.validatePlan(plan).valid, false);
});

test('v176 CLI refuses a non-empty output directory so stale artifacts cannot survive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-v176-stale-output-'));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'stale.json'), '{}\n');
  const venueBytes = Buffer.from(`${JSON.stringify([venue(VENUE_A, 'Main Hall')], null, 2)}\n`);
  const concertBytes = Buffer.from(`${JSON.stringify([concert('concert-a')], null, 2)}\n`);
  fs.writeFileSync(venuesPath, venueBytes);
  fs.writeFileSync(concertsPath, concertBytes);
  const script = path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
  const run = spawnSync(process.execPath, [
    script, 'plan', '--venues', venuesPath, '--concerts', concertsPath,
    '--expected-venues-sha256', Migration.sha256Bytes(venueBytes),
    '--expected-concerts-sha256', Migration.sha256Bytes(concertBytes),
    '--out-dir', outDir,
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must be absent or empty/);
  assert.equal(fs.existsSync(path.join(outDir, 'stale.json')), true);
});

test('v176 final planner remains idempotent with provider evidence finalization', () => {
  const source = [
    concert('concert-z', {
      sourceProvider: 'ticketmaster',
      providerEventId: 'tm-z',
      providerRelatedEventIds: ['tm-related'],
    }),
    concert('concert-a'),
  ];
  const first = Migration.planMigration([venue(VENUE_A, 'Main Hall')], source, {});
  const second = Migration.planMigration(first.venues, first.concerts, {});
  assert.equal(Migration.validatePlan(first).valid, true);
  assert.equal(Migration.validatePlan(second).valid, true);
  assert.equal(second.mergeManifest.length, 0);
  assert.deepEqual(second.venues, first.venues);
  assert.deepEqual(second.concerts, first.concerts);
});
