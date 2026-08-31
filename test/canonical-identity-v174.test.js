'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Canonical = require('../canonicalIdentityV174');

function venue(overrides = {}) {
  return {
    venueId: 'venue-aaaabbbb', name: 'Malmö Arena', city: 'Malmö', country: 'Sweden',
    address: 'Hyllie Stationstorg 4, Malmö, Sweden', researchStatus: 'partial', schemaVersion: 1, ...overrides,
  };
}

const venues = [
  venue({ identityAliases: [{ name: 'Malmö Arena', city: 'Malmö', country: 'Sweden', address: 'Hyllie Stationstorg 2, Malmö, Sweden' }] }),
  venue({ venueId: 'venue-aaaacccc', name: 'Ippodromo SNAI San Siro', city: 'Milano', country: 'Italy', address: 'Piazzale dello Sport 16, Milano, Italy', identityAliases: [{ name: 'Ippodromo SNAI San Siro', city: 'Milan', country: 'Italy', address: 'Piazzale dello Sport 16, Milan, Italy' }] }),
  venue({ venueId: 'venue-aaaadddd', name: 'The O2', city: 'London', country: 'United Kingdom', address: 'Peninsula Square, London, United Kingdom', identityAliases: [{ name: 'The O2', city: 'Greenwich', country: 'United Kingdom', address: 'Peninsula Square, Greenwich, United Kingdom' }] }),
  venue({ venueId: 'venue-aaaaeeee', name: 'The O2 Belfast', currentName: 'The O2 Belfast', city: 'Belfast', country: 'United Kingdom', address: '2 Queens Quay, Belfast, United Kingdom', historicalNames: [{ name: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom', address: '2 Queens Quay, Belfast, United Kingdom' }] }),
  venue({ venueId: 'venue-aaaaffff', name: 'Utilita Arena Newcastle', city: 'Newcastle upon Tyne', country: 'United Kingdom', address: 'Arena Way, Newcastle upon Tyne, United Kingdom', identityAliases: [{ name: 'Utilita Arena Newcastle', city: 'Newcastle', country: 'United Kingdom', address: 'Arena Way, Newcastle, United Kingdom' }] }),
  venue({ venueId: 'venue-bbbb0001', name: 'Fållan', currentName: 'Fållan', city: 'Stockholm', country: 'Sweden', address: 'Current Fållan Address, Stockholm, Sweden', locationHistory: [{ city: 'Stockholm', country: 'Sweden', address: 'Old Fållan Address, Stockholm, Sweden', validTo: '2025-12-31' }] }),
  venue({ venueId: 'venue-bbbb0002', name: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', address: 'Water Street, Manchester, United Kingdom', subLocations: [{ name: 'Warehouse', type: 'room' }] }),
  venue({ venueId: 'venue-bbbb0003', name: 'Slagthuset', city: 'Malmö', country: 'Sweden', address: 'Jörgen Kocksgatan, Malmö, Sweden', subLocations: [{ name: 'Slagthusets Teater', type: 'theatre' }, { name: 'Teatern', type: 'theatre' }] }),
  venue({ venueId: 'venue-bbbb0004', name: 'O2 Institute Birmingham', city: 'Birmingham', country: 'United Kingdom', address: '78 Digbeth, Birmingham, United Kingdom', subLocations: [{ name: 'Institute2', type: 'room' }] }),
  venue({ venueId: 'venue-bbbb0005', name: 'Razzmatazz', city: 'Barcelona', country: 'Spain', address: 'Carrer dels Almogàvers, Barcelona, Spain', subLocations: [{ name: 'Razzmatazz 1', type: 'room' }, { name: 'Razzmatazz 2', type: 'room' }] }),
  venue({ venueId: 'venue-bbbb0006', name: 'AFAS Dome', city: 'Antwerp', country: 'Belgium', address: 'Schijnpoortweg 119, Antwerp, Belgium' }),
  venue({ venueId: 'venue-bbbb0007', name: 'Lotto Arena Antwerpen', city: 'Antwerp', country: 'Belgium', address: 'Schijnpoortweg 119, Antwerp, Belgium' }),
  venue({ venueId: 'venue-bbbb0008', name: 'Bramham Park', city: 'Leeds', country: 'United Kingdom', address: 'Bramham Park, Leeds, United Kingdom', identityAliases: [{ name: 'Bramham Park (Leeds Festival)', city: 'Leeds', country: 'United Kingdom', address: 'Bramham Park, Leeds, United Kingdom' }] }),
  venue({ venueId: 'venue-bbbb0009', name: 'Wollaton Park', city: 'Nottingham', country: 'United Kingdom', address: 'Wollaton Road, Nottingham, United Kingdom', identityAliases: [{ name: 'Wollaton Park (Splendour)', city: 'Nottingham', country: 'United Kingdom', address: 'Wollaton Road, Nottingham, United Kingdom' }] }),
  venue({ venueId: 'venue-bbbb000a', name: 'Roskilde Festival', city: 'Roskilde', country: 'Denmark', address: 'Darupvej, Roskilde, Denmark' }),
  venue({ venueId: 'venue-bbbb000b', name: 'Established Site', city: 'Madrid', country: 'Spain', address: 'Site Road, Madrid, Spain', subLocations: [{ name: 'Temporary Purpose-Built Stadium', type: 'temporary_structure' }, { name: 'Premium Loge Club', type: 'hospitality' }] }),
  venue({ venueId: 'venue-bbbb000c', name: 'O2 Academy Brixton', city: 'London', country: 'United Kingdom', address: '211 Stockwell Road, London, United Kingdom' }),
  venue({ venueId: 'venue-bbbb000d', name: 'O2 Academy Birmingham', city: 'Birmingham', country: 'United Kingdom', address: '16-18 Horsefair, Birmingham, United Kingdom' }),
  venue({ venueId: 'venue-bbbb000e', name: 'Provider Hall', city: 'Copenhagen', country: 'Denmark', address: 'Provider Street 1, Copenhagen, Denmark', providerIdentities: [{ provider: 'ticketmaster', venueId: 'KOVZ-provider-main', name: 'Provider Hall Main Room', city: 'Copenhagen', country: 'Denmark' }] }),
];
const index = Canonical.buildVenueIndex(venues);

test('v174 resolves aliases, locality variants, relocation/history and provider venue IDs', () => {
  const cases = [
    [{ venue: 'Malmö Arena', city: 'Malmö', country: 'Sweden', venueAddress: 'Hyllie Stationstorg 2, Malmö, Sweden' }, 'venue-aaaabbbb'],
    [{ venue: 'Ippodromo SNAI San Siro', city: 'Milan', country: 'Italy', venueAddress: 'Piazzale dello Sport 16, Milan, Italy' }, 'venue-aaaacccc'],
    [{ venue: 'The O2', city: 'Greenwich', country: 'United Kingdom', venueAddress: 'Peninsula Square, Greenwich, United Kingdom' }, 'venue-aaaadddd'],
    [{ venue: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom' }, 'venue-aaaaeeee'],
    [{ venue: 'Utilita Arena Newcastle', city: 'Newcastle', country: 'United Kingdom' }, 'venue-aaaaffff'],
    [{ venue: 'Fållan', city: 'Stockholm', country: 'Sweden', venueAddress: 'Old Fållan Address, Stockholm, Sweden' }, 'venue-bbbb0001'],
    [{ venue: 'Provider wording', city: 'Copenhagen', provider: 'ticketmaster', providerVenueId: 'KOVZ-provider-main' }, 'venue-bbbb000e'],
  ];
  for (const [input, expected] of cases) assert.equal(Canonical.resolveCanonicalVenue(input, index).canonicalVenueId, expected);
});

test('v174 resolves rooms/stages/temporary/hospitality to parent and preserves independent venues', () => {
  for (const [name, city, expected] of [
    ['Warehouse', 'Manchester', 'venue-bbbb0002'], ['Teatern', 'Malmö', 'venue-bbbb0003'],
    ['Institute2', 'Birmingham', 'venue-bbbb0004'], ['Razzmatazz 2', 'Barcelona', 'venue-bbbb0005'],
    ['Temporary Purpose-Built Stadium', 'Madrid', 'venue-bbbb000b'], ['Premium Loge Club', 'Madrid', 'venue-bbbb000b'],
  ]) {
    const resolved = Canonical.resolveCanonicalVenue({ venue: name, city }, index);
    assert.equal(resolved.canonicalVenueId, expected);
    assert.ok(resolved.roomOrStage);
  }
  assert.notEqual(Canonical.resolveCanonicalVenue({ venue: 'AFAS Dome', city: 'Antwerp' }, index).canonicalVenueId, Canonical.resolveCanonicalVenue({ venue: 'Lotto Arena Antwerpen', city: 'Antwerp' }, index).canonicalVenueId);
  assert.notEqual(Canonical.resolveCanonicalVenue({ venue: 'O2 Academy Brixton', city: 'London' }, index).canonicalVenueId, Canonical.resolveCanonicalVenue({ venue: 'O2 Academy Birmingham', city: 'Birmingham' }, index).canonicalVenueId);
  assert.equal(Canonical.resolveCanonicalVenue({ venue: 'Bramham Park (Leeds Festival)', city: 'Leeds' }, index).canonicalVenueId, 'venue-bbbb0008');
  assert.equal(Canonical.resolveCanonicalVenue({ venue: 'Wollaton Park (Splendour)', city: 'Nottingham' }, index).canonicalVenueId, 'venue-bbbb0009');
  assert.equal(Canonical.resolveCanonicalVenue({ venue: 'Roskilde Festival', city: 'Roskilde' }, index).canonicalVenueId, 'venue-bbbb000a');
});

test('v174 does not generalize an unreviewed conflicting address', () => {
  const result = Canonical.resolveCanonicalVenue({ venue: 'Malmö Arena', city: 'Malmö', country: 'Sweden', venueAddress: 'Completely Different Street 99, Malmö, Sweden' }, index);
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.reason, 'venue_location_conflict');
});

test('v174 concert identity ignores time, provider ID, room and offer but not date or canonical venue', () => {
  const base = { id: 'katseye-1', bandId: 'band-katseye', bandName: 'KATSEYE', date: '2026-09-10', venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', time: '19:00', providerEventId: 'tm-standard' };
  for (const candidate of [
    { ...base, id: 'katseye-2', time: '21:30', providerEventId: 'tm-second' },
    { ...base, id: 'katseye-3', venue: 'Warehouse', providerEventId: 'tm-vip', providerOfferType: 'vip' },
    { ...base, id: 'katseye-4', venue: 'Warehouse', providerEventId: 'tm-hotel', providerOfferType: 'hotel_package' },
  ]) assert.equal(Canonical.canonicalConcertRelationship(base, candidate, index).kind, 'same');
  assert.equal(Canonical.canonicalConcertRelationship(base, { ...base, id: 'next-day', date: '2026-09-11' }, index).kind, 'distinct');
  assert.equal(Canonical.canonicalConcertRelationship(base, { ...base, id: 'other-venue', venue: 'AFAS Dome', city: 'Antwerp', country: 'Belgium' }, index).kind, 'distinct');
});

test('v174 read view collapses 3-9 provider rows and fails closed on user-owned conflicts', () => {
  const base = { bandId: 'band-katseye', bandName: 'KATSEYE', date: '2026-09-10', venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom' };
  const parallel = Array.from({ length: 9 }, (_, i) => ({ ...base, id: `provider-${i}`, time: `${18 + (i % 4)}:00`, providerEventId: `tm-${i}` }));
  assert.equal(Canonical.canonicalConcertReadView(parallel, index).records.length, 1);
  const legacy = { ...base, id: 'legacy-user-rich', attending: true, rating: 5, notes: 'Keep my data', ticketPrice: 900, ticketQuantity: 1 };
  const view = Canonical.canonicalConcertReadView([{ ...base, id: 'provider-rich', ticketUrl: 'https://example.test/tickets' }, legacy], index);
  assert.equal(view.records[0].id, 'legacy-user-rich');
  assert.equal(view.records[0].notes, 'Keep my data');
  const conflict = Canonical.canonicalConcertReadView([{ ...legacy, notes: 'A' }, { ...legacy, id: 'other-user-rich', notes: 'B' }], index);
  assert.equal(conflict.records.length, 2);
  assert.deepEqual(conflict.conflicts[0].fields, ['notes']);
});

test('v174 event grouping uses canonical venue/date and festival edition override', () => {
  globalThis.VenueMetadataV158 = { getRecords: () => venues };
  const support = { id: 'support', bandId: 'band-support', date: '2026-10-18', venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', attending: true, lineupRole: 'support', ticketPrice: 0, ticketQuantity: 1, distanceKm: 55 };
  const headliner = { id: 'headliner', bandId: 'band-headliner', date: '2026-10-18', venue: 'Warehouse', city: 'Manchester', country: 'United Kingdom', attending: true, lineupRole: 'headliner', ticketPrice: 1000, ticketQuantity: 1, distanceKm: 55 };
  let groups = Canonical.EventModelV174.groupConcertPerformances([support, headliner]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].validation.valid, true);
  assert.equal(Canonical.EventModelV174.resolveEventTicketCost(groups[0].records).value, 1000);
  assert.equal(Canonical.EventModelV174.groupConcertPerformances([{ ...headliner, id: 'fri' }, { ...headliner, id: 'sat', date: '2026-10-19' }]).length, 2);

  const festivalA = { ...support, id: 'festival-a', date: '2026-06-25', venue: 'Roskilde Festival', city: 'Roskilde', country: 'Denmark', festivalEditionId: 'roskilde-2026', distanceKm: 80 };
  const festivalB = { ...headliner, id: 'festival-b', date: '2026-06-27', venue: 'Bramham Park', city: 'Leeds', country: 'United Kingdom', festivalEditionId: 'roskilde-2026', distanceKm: 900 };
  groups = Canonical.EventModelV174.groupConcertPerformances([festivalA, festivalB]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].relationship, 'festival');
  assert.equal(Canonical.EventModelV174.resolveEventDistance(groups[0].records).value, 80);
  assert.equal(Canonical.EventModelV174.groupConcertPerformances([festivalA, { ...festivalA, id: 'next-year', date: '2027-06-25', festivalEditionId: 'roskilde-2027' }]).length, 2);
});

test('v174 festival travel uses verified primary venue otherwise shortest venue distance', () => {
  globalThis.VenueMetadataV158 = { getRecords: () => venues };
  const records = [
    { id: 'a', bandId: 'a', date: '2026-07-01', venue: 'Roskilde Festival', city: 'Roskilde', country: 'Denmark', distanceKm: 80, festivalEdition: { id: 'cityfest-2026', primaryCanonicalVenueId: 'venue-bbbb0008' } },
    { id: 'b', bandId: 'b', date: '2026-07-02', venue: 'Bramham Park', city: 'Leeds', country: 'United Kingdom', distanceKm: 900, festivalEdition: { id: 'cityfest-2026', primaryCanonicalVenueId: 'venue-bbbb0008' } },
  ];
  assert.equal(Canonical.EventModelV174.resolveEventDistance(records).value, 900);
  assert.equal(Canonical.EventModelV174.resolveEventDistance(records.map((r) => ({ ...r, festivalEdition: { id: 'cityfest-2026' } }))).value, 80);
});

test('v174 historical concert display remains historical while upcoming uses current venue facts', () => {
  const historical = { id: 'past', bandId: 'band-a', date: '2025-05-01', venue: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom', venueAddress: '2 Queens Quay, Belfast, United Kingdom' };
  const now = new Date('2026-08-30T00:00:00.000Z');
  assert.equal(Canonical.displayVenueForConcert(historical, index, now).venue, 'SSE Arena Belfast');
  const upcoming = Canonical.displayVenueForConcert({ ...historical, id: 'future', date: '2027-05-01' }, index, now);
  assert.equal(upcoming.venue, 'The O2 Belfast');
  assert.equal(upcoming.canonicalVenueId, 'venue-aaaaeeee');
});

test('v174 venue normalization preserves unknown fields and legacy IDs', () => {
  const normalized = Canonical.VenueModelV174.normalizeRecord(venue({ historicalNames: ['Old Malmö Arena'], locationHistory: [{ city: 'Malmö', address: 'Old 1' }], providerIdentities: [{ provider: 'ticketmaster', venueId: 'tm-venue' }], subLocations: ['Room A'], legacyVenueIds: ['venue-deadbeef'], unknownFutureField: { preserve: true } }));
  assert.deepEqual(normalized.unknownFutureField, { preserve: true });
  assert.deepEqual(normalized.legacyVenueIds, ['venue-deadbeef']);
});

test('v174 document normalization skips malformed records and safely consolidates rich duplicates', () => {
  const normalized = Canonical.VenueModelV174.normalizeDocument([
    null,
    venue({ venueId: 'invalid', city: '' }),
    venue({
      currentName: 'Malmö Arena',
      currentLocation: { city: 'Malmö', country: 'Sweden', address: 'Hyllie Stationstorg 4, Malmö, Sweden' },
      historicalNames: ['Malmö Isstadion'],
      locationHistory: [{ city: 'Malmö', address: 'Old Address 1' }],
      unknownFutureField: { preserve: true },
    }),
    venue({
      providerIdentities: [{ provider: 'ticketmaster', venueId: 'tm-malmo' }],
      subLocations: [{ name: 'Room A', type: 'room' }],
      legacyVenueIds: ['venue-deadbeef'],
    }),
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].currentName, 'Malmö Arena');
  assert.deepEqual(normalized[0].currentLocation, { city: 'Malmö', country: 'Sweden', address: 'Hyllie Stationstorg 4, Malmö, Sweden' });
  assert.deepEqual(normalized[0].historicalNames, ['Malmö Isstadion']);
  assert.deepEqual(normalized[0].locationHistory, [{ city: 'Malmö', address: 'Old Address 1' }]);
  assert.deepEqual(normalized[0].providerIdentities, [{ provider: 'ticketmaster', venueId: 'tm-malmo' }]);
  assert.deepEqual(normalized[0].subLocations, [{ name: 'Room A', type: 'room' }]);
  assert.deepEqual(normalized[0].legacyVenueIds, ['venue-deadbeef']);
  assert.deepEqual(normalized[0].unknownFutureField, { preserve: true });
  assert.doesNotThrow(() => Canonical.buildVenueIndex([null, venue({ venueId: 'invalid', city: '' }), normalized[0]]));
});

test('v174 raw fallback uses normalized address evidence conservatively', () => {
  const first = Canonical.resolveCanonicalVenue({ venue: 'Uncatalogued Hall', city: 'Lund', country: 'Sweden', venueAddress: 'Main Street 12, Lund, Sweden' }, []);
  const formattingEquivalent = Canonical.resolveCanonicalVenue({ venue: 'Uncatalogued Hall', city: 'Lund', country: 'Sweden', venueAddress: 'Main Street 12 Lund Sweden' }, []);
  const conflicting = Canonical.resolveCanonicalVenue({ venue: 'Uncatalogued Hall', city: 'Lund', country: 'Sweden', venueAddress: 'Other Street 99, Lund, Sweden' }, []);
  assert.equal(first.key, formattingEquivalent.key);
  assert.notEqual(first.key, conflicting.key);
});

test('v174 unique ID indexes resolve one owner and fail closed on collisions', () => {
  const uniqueProvider = Canonical.buildVenueIndex([
    venue({ providerIdentities: [{ provider: 'ticketmaster', venueId: 'shared-provider-id' }] }),
    venue({ venueId: 'venue-bbbbbbbb', name: 'Namespace Hall', city: 'Lund', address: 'Namespace Street 1, Lund, Sweden', providerIdentities: [{ provider: 'spotify', venueId: 'shared-provider-id' }] }),
  ]);
  assert.equal(Canonical.resolveCanonicalVenue({ provider: 'ticketmaster', providerVenueId: 'shared-provider-id' }, uniqueProvider).canonicalVenueId, 'venue-aaaabbbb');
  assert.equal(Canonical.resolveCanonicalVenue({ provider: 'spotify', providerVenueId: 'shared-provider-id' }, uniqueProvider).canonicalVenueId, 'venue-bbbbbbbb');

  const collisions = Canonical.buildVenueIndex([
    venue({ name: 'First Hall', address: 'First Street 1, Malmö, Sweden', legacyVenueIds: ['venue-cafebabe'], providerIdentities: [{ provider: 'ticketmaster', venueId: 'collision-id' }] }),
    venue({ venueId: 'venue-bbbbbbbb', name: 'Second Hall', address: 'Second Street 2, Malmö, Sweden', legacyVenueIds: ['venue-cafebabe'], providerIdentities: [{ provider: 'ticketmaster', venueId: 'collision-id' }] }),
    venue({ name: 'Conflicting Canonical Hall', address: 'Third Street 3, Malmö, Sweden' }),
  ]);
  assert.equal(Canonical.resolveCanonicalVenue({ provider: 'ticketmaster', providerVenueId: 'collision-id' }, collisions).reason, 'provider_venue_id_collision');
  assert.equal(Canonical.resolveCanonicalVenue({ venueId: 'venue-cafebabe' }, collisions).reason, 'legacy_venue_id_collision');
  assert.equal(Canonical.resolveCanonicalVenue({ venueId: 'venue-aaaabbbb' }, collisions).reason, 'venue_id_collision');
});

test('v174 indexed identity resolution stays fast at 3300 concerts / 530 venues', () => {
  const scaleVenues = Array.from({ length: 530 }, (_, i) => venue({ venueId: `venue-${i.toString(16).padStart(8, '0')}`, name: `Synthetic Venue ${i}`, city: `Synthetic City ${i}`, address: `Synthetic Street ${i}, Synthetic City ${i}, Sweden` }));
  const scaleIndex = Canonical.buildVenueIndex(scaleVenues);
  const concerts = Array.from({ length: 3300 }, (_, i) => ({ id: `synthetic-${i}`, bandId: `band-${i % 379}`, date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`, venue: `Synthetic Venue ${i % 530}`, city: `Synthetic City ${i % 530}`, country: 'Sweden', venueAddress: `Synthetic Street ${i % 530}, Synthetic City ${i % 530}, Sweden` }));
  const started = performance.now();
  for (const concert of concerts) assert.equal(Canonical.canonicalConcertIdentity(concert, scaleIndex).kind, 'same');
  assert.ok(performance.now() - started < 1500);
});
