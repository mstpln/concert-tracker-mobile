'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const VenueMetadata = require('../venueMetadataModelV158');
const { buildReport } = require('../scripts/venueMetadataBackfillDryRun');

const royal = {
  venueId: 'venue-1234abcd',
  name: 'Royal Arena',
  city: 'Copenhagen',
  country: 'Denmark',
  address: 'Hannemanns Allé 18-20\n2300 Copenhagen S\nDenmark',
  maxCapacity: 16000,
  officialUrl: 'https://www.royalarena.dk/',
  description: 'A large indoor arena in Copenhagen used for concerts, entertainment and sport.',
  researchStatus: 'complete',
  researchedAt: '2026-08-23T08:00:00.000Z',
  sources: ['https://www.royalarena.dk/'],
  schemaVersion: 1,
  futureField: { preserve: true },
};

test('capacity is positive-only and formats with spaces', () => {
  assert.equal(VenueMetadata.capacityLabel(16000), 'Max Capacity: 16 000');
  assert.equal(VenueMetadata.capacityLabel(6500), 'Max Capacity: 6 500');
  assert.equal(VenueMetadata.capacityLabel(0), '');
  assert.equal(VenueMetadata.capacityLabel(-5), '');
  assert.equal(VenueMetadata.capacityLabel('6500'), '');
});

test('venue identity is conservative across city, country and conflicting known addresses', () => {
  const rows = [royal, { ...royal, venueId: 'venue-5678abcd', city: 'Other City' }];
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'ROYAL ARENA', city: ' Copenhagen ', country: 'Denmark' }, rows)?.venueId, royal.venueId);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Other Place', country: 'Denmark' }, rows), null);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen', country: 'Sweden' }, rows), null);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', venueAddress: 'Different Street 99' }, [royal]), null);
});

test('ambiguous same-name same-city records fail closed unless country/address disambiguates', () => {
  const first = { ...royal, venueId: 'venue-11111111', country: '', address: 'Street A' };
  const second = { ...royal, venueId: 'venue-22222222', country: '', address: 'Street B' };
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen' }, [first, second]), null);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen', venueAddress: 'Street B' }, [first, second])?.venueId, second.venueId);
});

test('same-name same-city address collisions retain separate deterministic research targets', () => {
  const concerts = [
    { id: 'a', attending: true, venue: 'Shared Hall', city: 'Copenhagen', country: 'Denmark', venueAddress: 'Street A 1' },
    { id: 'b', attending: true, venue: 'Shared Hall', city: 'Copenhagen', country: 'Denmark', venueAddress: 'Street B 2' },
  ];
  const forward = VenueMetadata.uniqueVenueSeeds(concerts);
  const reverse = VenueMetadata.uniqueVenueSeeds([...concerts].reverse());
  assert.equal(forward.length, 2);
  assert.equal(new Set(forward.map((row) => row.venueId)).size, 2);
  assert.deepEqual(forward.map((row) => row.venueId).sort(), reverse.map((row) => row.venueId).sort());
  assert.ok(forward.every((row) => row.venueId === VenueMetadata.venueIdForAddressVariant(row)));

  const countryFilledLater = [
    { ...concerts[0], country: '' },
    concerts[0],
    concerts[1],
  ];
  const later = VenueMetadata.uniqueVenueSeeds(countryFilledLater);
  const earlier = VenueMetadata.uniqueVenueSeeds([concerts[0], { ...concerts[0], country: '' }, concerts[1]]);
  assert.deepEqual(later.map((row) => row.venueId).sort(), earlier.map((row) => row.venueId).sort());
});

test('venue records preserve unknown future fields and validate complete researched data', () => {
  assert.equal(VenueMetadata.recordIsValid(royal), true);
  assert.equal(VenueMetadata.isComplete(royal), true);
  assert.deepEqual(VenueMetadata.normalizeRecord(royal).futureField, { preserve: true });
  assert.equal(VenueMetadata.recordIsValid({ ...royal, maxCapacity: 0 }), false);
  assert.equal(VenueMetadata.recordIsValid({ ...royal, officialUrl: 'http://example.com' }), false);
});

test('research completion requires complete status, timestamp and source evidence', () => {
  for (const researchStatus of ['partial', 'unresolved', 'temporary_error', 'review_needed']) {
    assert.equal(VenueMetadata.isComplete({ ...royal, researchStatus }), false);
  }
  assert.equal(VenueMetadata.isComplete({ ...royal, researchedAt: undefined }), false);
  assert.equal(VenueMetadata.isComplete({ ...royal, sources: [] }), false);
  assert.equal(VenueMetadata.isComplete({ ...royal, sources: undefined }), false);

  const concerts = [{ id: 'a', attending: true, venue: royal.name, city: royal.city, country: royal.country, venueAddress: royal.address }];
  assert.equal(buildReport(concerts, [{ ...royal, researchStatus: 'review_needed' }], {}).researchNeeded, 1);
  assert.equal(buildReport(concerts, [royal], {}).researchNeeded, 0);
});

test('address helper supports stored full strings and structured address fields', () => {
  assert.deepEqual(VenueMetadata.addressLines('Street 1\n1234 City\nCountry'), ['Street 1', '1234 City', 'Country']);
  assert.deepEqual(VenueMetadata.addressLines({ street: 'Street 1', postalCode: '1234', city: 'City', country: 'Country' }), ['Street 1', '1234 City', 'Country']);
});

test('default backfill target set is attended-only and deduplicates repeated venues', () => {
  const concerts = [
    { id: 'a', attending: true, venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark' },
    { id: 'b', attending: true, venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark' },
    { id: 'c', attending: false, venue: 'Other Hall', city: 'Malmö', country: 'Sweden' },
  ];
  const targets = VenueMetadata.uniqueVenueSeeds(concerts);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, 'Royal Arena');
  assert.equal(buildReport(concerts, [], {}).researchNeeded, 1);
  assert.equal(buildReport(concerts, [], { attendedOnly: false }).totalUniqueTargets, 2);
});

test('runtime wiring keeps metadata separate from concert records and source evidence out of visible markup', () => {
  const ui = fs.readFileSync('venueMetadataV158.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('venueMetadataV158.css', 'utf8');
  assert.match(ui, /dlReadJsonFile\(remote, 'venues\.json', \[\]\)/);
  assert.doesNotMatch(ui, /\.sources\b/);
  assert.match(ui, /venue-card-max-capacity/);
  assert.match(ui, /venue-detail-official-link/);
  assert.match(ui, /venue-max-capacity-next/);
  assert.ok(index.indexOf('venueMetadataModelV158.js') < index.indexOf('dataLib.js'));
  assert.ok(index.indexOf('appUpdateAub3CorrectionV157.js') < index.indexOf('venueMetadataV158.js'));
  assert.match(css, /right: 16px;[\s\S]*bottom: 14px;/);
});

test('primary Worker owns venue storage, validates venue records and restricts writes to data-maintenance', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(worker, /ALLOWED_FILES = new Set\(\[[^\]]*'venues\.json'/);
  assert.match(worker, /filename==='venues\.json'&&request\.method==='PUT'&&role!=='data-maintenance'/);
  assert.match(worker, /venueDocumentIsValid\(parsed\)/);
  assert.match(worker, /requiredWriteCondition\(request,env,filename\)/);
  assert.doesNotMatch(worker, /TAVILY_API_KEY|GROQ_API_KEY/);
  assert.match(wrangler, /"main": "\.\/worker\.js"/);
});

test('optional venue metadata is not a production smoke prerequisite before backfill', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  const match = worker.match(/QA_SMOKE_JSON_ROOT_TYPES = \{[^}]*\}/);
  assert.ok(match);
  assert.match(match[0], /'bands\.json':'array'/);
  assert.match(match[0], /'concerts\.json':'array'/);
  assert.match(match[0], /'news\.json':'array'/);
  assert.match(match[0], /'apiUsage\.json':'object'/);
  assert.doesNotMatch(match[0], /venues\.json/);
  assert.match(worker, /Object\.entries\(QA_SMOKE_JSON_ROOT_TYPES\)/);
});
