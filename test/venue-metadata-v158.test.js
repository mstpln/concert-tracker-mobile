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

test('venue identity is conservative across city and country', () => {
  const rows = [royal, { ...royal, venueId: 'venue-5678abcd', city: 'Other City' }];
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'ROYAL ARENA', city: ' Copenhagen ', country: 'Denmark' }, rows)?.venueId, royal.venueId);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Other Place', country: 'Denmark' }, rows), null);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen', country: 'Sweden' }, rows), null);
});

test('ambiguous same-name same-city records fail closed unless country/address disambiguates', () => {
  const first = { ...royal, venueId: 'venue-11111111', country: '', address: 'Street A' };
  const second = { ...royal, venueId: 'venue-22222222', country: '', address: 'Street B' };
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen' }, [first, second]), null);
  assert.equal(VenueMetadata.findVenueRecord({ venue: 'Royal Arena', city: 'Copenhagen', venueAddress: 'Street B' }, [first, second])?.venueId, second.venueId);
});

test('venue records preserve unknown future fields and validate complete researched data', () => {
  assert.equal(VenueMetadata.recordIsValid(royal), true);
  assert.equal(VenueMetadata.isComplete(royal), true);
  assert.deepEqual(VenueMetadata.normalizeRecord(royal).futureField, { preserve: true });
  assert.equal(VenueMetadata.recordIsValid({ ...royal, maxCapacity: 0 }), false);
  assert.equal(VenueMetadata.recordIsValid({ ...royal, officialUrl: 'http://example.com' }), false);
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

test('primary Worker owns venue storage and restricts venue writes to data-maintenance', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(worker, /ALLOWED_FILES = new Set\(\[[^\]]*'venues\.json'/);
  assert.match(worker, /filename==='venues\.json'&&request\.method==='PUT'&&role!=='data-maintenance'/);
  assert.match(worker, /requiredWriteCondition\(request,env,filename\)/);
  assert.doesNotMatch(worker, /TAVILY_API_KEY|GROQ_API_KEY/);
  assert.match(wrangler, /"main": "\.\/worker\.js"/);
});
