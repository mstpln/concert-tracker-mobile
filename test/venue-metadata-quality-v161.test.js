'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const { dedupeDocument } = require('../scripts/venueMetadataDedupeV161');

function venue(overrides = {}) {
  return {
    venueId: 'venue-11111111',
    name: 'Example Arena',
    city: 'London',
    country: 'United Kingdom',
    address: 'Arena Road 1, London, United Kingdom',
    maxCapacity: 10000,
    officialUrl: 'https://example-arena.test/',
    description: 'A synthetic arena used only for venue metadata tests.',
    researchStatus: 'complete',
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: ['https://example-arena.test/facts'],
    schemaVersion: 1,
    ...overrides,
  };
}

test('country and city aliases reuse one canonical venue identity', () => {
  assert.equal(VenueMetadata.canonicalCountryKey('UK'), 'united kingdom');
  assert.equal(VenueMetadata.canonicalCountryKey('Great Britain'), 'united kingdom');
  assert.equal(VenueMetadata.canonicalCountryKey('England'), 'united kingdom');
  assert.equal(VenueMetadata.canonicalCityKey('Göteborg'), 'gothenburg');
  assert.equal(VenueMetadata.canonicalCityKey('København S'), 'copenhagen');
  assert.equal(VenueMetadata.canonicalCityKey('Praha 9'), 'prague');
  assert.equal(VenueMetadata.canonicalCityKey('Saint-Denis (Paris)'), 'saint denis');
  assert.equal(VenueMetadata.canonicalCityKey('Casalecchio di Reno (Bologna)'), 'casalecchio di reno');

  const a = VenueMetadata.venueIdFor({ name: 'Example Arena', city: 'London', country: 'UK' });
  const b = VenueMetadata.venueIdFor({ name: 'Example Arena', city: 'London', country: 'Great Britain' });
  assert.equal(a, b);
});

test('placeholder venues never become venue research seeds', () => {
  for (const name of ['Unknown venue', 'UNKNOWN', 'TBA', 'Venue TBD']) {
    assert.equal(VenueMetadata.createVenueSeed({ venue: name, city: 'London', country: 'UK' }), null);
  }
  const targets = VenueMetadata.uniqueVenueSeeds([
    { id: 'unknown', attending: true, venue: 'Unknown venue', city: 'London', country: 'UK' },
    { id: 'real', attending: true, venue: 'Example Arena', city: 'London', country: 'UK' },
  ]);
  assert.deepEqual(targets.map((row) => row.name), ['Example Arena']);
});

test('known reseller, directory, social and tourism URLs cannot be official venue URLs', () => {
  assert.equal(VenueMetadata.officialVenueUrl('https://www.ticketmaster.de/venue/example'), null);
  assert.equal(VenueMetadata.officialVenueUrl('https://www.visitgavle.se/en/furuvik-live'), null);
  assert.equal(VenueMetadata.officialVenueUrl('https://www.esmadrid.com/en/whats-on/mad-cool-festival'), null);
  assert.equal(VenueMetadata.officialVenueUrl('https://www.timeout.com/example'), null);
  assert.equal(VenueMetadata.officialVenueUrl('https://www.instagram.com/example'), null);
  assert.equal(VenueMetadata.officialVenueUrl('https://example-arena.test/'), 'https://example-arena.test/');
});

test('normalization removes non-official display URLs and unsuccessful research timestamps', () => {
  const unresolved = VenueMetadata.normalizeRecord(venue({
    researchStatus: 'unresolved',
    maxCapacity: undefined,
    officialUrl: 'https://www.visitgavle.se/en/example',
    description: undefined,
    sources: [],
  }));
  assert.equal(unresolved.officialUrl, undefined);
  assert.equal(unresolved.researchedAt, undefined);
  assert.equal(VenueMetadata.isComplete(unresolved), false);

  const evidencedPartial = VenueMetadata.normalizeRecord(venue({ researchStatus: 'partial', maxCapacity: undefined }));
  assert.equal(evidencedPartial.researchedAt, '2026-08-23T12:00:00.000Z');

  const noEvidencePartial = VenueMetadata.normalizeRecord(venue({ researchStatus: 'partial', maxCapacity: undefined, sources: [] }));
  assert.equal(noEvidencePartial.researchedAt, undefined);
});

test('same venue id normalization preserves compatible secondary-only fields', () => {
  const rows = VenueMetadata.normalizeDocument([
    venue(),
    venue({
      researchStatus: 'partial',
      maxCapacity: undefined,
      futureField: { preserve: true },
      sources: ['https://example-arena.test/secondary-facts'],
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].futureField, { preserve: true });
  assert.deepEqual(
    new Set(rows[0].sources),
    new Set([
      'https://example-arena.test/facts',
      'https://example-arena.test/secondary-facts',
    ]),
  );
});

test('same venue id normalization preserves conflicting future-field records separately', () => {
  const rows = VenueMetadata.normalizeDocument([
    venue({ futureProviderState: { owner: 'manual', value: 1 } }),
    venue({ futureProviderState: { owner: 'manual', value: 2 } }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.futureProviderState.value).sort(), [1, 2]);
});

test('confirmed duplicate aliases consolidate while preserving one stable id and legacy ids', () => {
  const rows = [
    venue(),
    venue({
      venueId: 'venue-22222222',
      city: 'London',
      country: 'England',
      address: 'Arena Road 1, London, United Kingdom',
      reviewNote: 'Confirmed duplicate of Example Arena, London - same physical venue.',
      futureField: { preserve: true },
    }),
  ];
  const { cleaned, report } = dedupeDocument(rows);
  assert.equal(report.removed, 1);
  assert.equal(cleaned.length, 1);
  assert.ok(cleaned[0].legacyVenueIds.includes('venue-22222222'));
  assert.ok(cleaned[0].identityAliases.some((alias) => alias.country === 'England'));
  assert.deepEqual(cleaned[0].futureField, { preserve: true });
});

test('same-name venues with conflicting streets are not automatically merged', () => {
  const rows = [
    venue({ venueId: 'venue-11111111', address: 'Street A 1, London, United Kingdom' }),
    venue({ venueId: 'venue-22222222', address: 'Street B 2, London, United Kingdom' }),
  ];
  const { cleaned } = dedupeDocument(rows);
  assert.equal(cleaned.length, 2);
});

test('confirmed relocation is not merged into one physical venue record', () => {
  const rows = [
    venue({ venueId: 'venue-11111111', address: 'Old Road 1, London, United Kingdom' }),
    venue({
      venueId: 'venue-22222222',
      address: 'New Road 2, London, United Kingdom',
      reviewNote: 'Confirmed same venue brand after it relocated; addresses differ because the venue moved.',
    }),
  ];
  const { cleaned } = dedupeDocument(rows);
  assert.equal(cleaned.length, 2);
});

test('conflicting unknown future fields prevent automatic consolidation', () => {
  const rows = [
    venue({ venueId: 'venue-11111111', futureProviderState: { owner: 'manual', value: 1 } }),
    venue({ venueId: 'venue-22222222', country: 'England', futureProviderState: { owner: 'manual', value: 2 } }),
  ];
  const { cleaned } = dedupeDocument(rows);
  assert.equal(cleaned.length, 2);
  assert.deepEqual(cleaned.map((row) => row.futureProviderState.value).sort(), [1, 2]);
});

test('dedupe removes placeholder records and invalid official URLs without inventing facts', () => {
  const rows = [
    venue({ venueId: 'venue-11111111' }),
    venue({
      venueId: 'venue-22222222',
      name: 'Unknown venue',
      researchStatus: 'unresolved',
      maxCapacity: undefined,
      officialUrl: undefined,
      description: undefined,
      sources: [],
    }),
    venue({
      venueId: 'venue-33333333',
      name: 'Tourism Venue',
      city: 'Madrid',
      country: 'Spain',
      officialUrl: 'https://www.esmadrid.com/en/whats-on/example',
      researchStatus: 'partial',
    }),
  ];
  const { cleaned } = dedupeDocument(rows);
  assert.equal(cleaned.some((row) => VenueMetadata.isPlaceholderVenueName(row.name)), false);
  const tourism = cleaned.find((row) => row.name === 'Tourism Venue');
  assert.equal(tourism.officialUrl, undefined);
  assert.equal(tourism.researchStatus, 'partial');
});
