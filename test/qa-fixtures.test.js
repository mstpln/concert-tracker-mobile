'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveVaultQaFixtures } = require('../qa/fixtures/qa-fixtures.js');
const { validateQaFixtures } = require('../qa/qa-fixture-validator.js');

function valid() { return createLiveVaultQaFixtures(); }
function result(value) { return validateQaFixtures(value); }

test('fixture factory returns deep-independent datasets', () => {
  const first = valid();
  const second = valid();
  first.bands[0].name = 'changed';
  first.concerts[0].futureFeatureData.nested.value = 'changed';
  assert.notEqual(second.bands[0].name, 'changed');
  assert.equal(second.concerts[0].futureFeatureData.nested.value, 'concert-preserve-me');
});

test('committed QA fixtures pass comprehensive validation', () => assert.equal(result(valid()).valid, true));

test('fixture counts meet the scenario matrix', () => {
  const fixtures = valid();
  assert.ok(fixtures.bands.length >= 8);
  assert.ok(fixtures.concerts.length >= 12);
  assert.ok(fixtures.news.length >= 12);
});

test('band, concert and news IDs are unique', () => {
  const fixtures = valid();
  for (const key of ['bands', 'concerts', 'news']) assert.equal(new Set(fixtures[key].map((item) => item.id)).size, fixtures[key].length);
});

test('all concert and news band references resolve', () => {
  const fixtures = valid();
  const ids = new Set(fixtures.bands.map((band) => band.id));
  assert.ok(fixtures.concerts.every((concert) => ids.has(concert.bandId)));
  assert.ok(fixtures.news.every((item) => ids.has(item.bandId)));
});

test('provider statuses and retry scenarios exist', () => {
  const fixtures = valid();
  const records = fixtures.bands.flatMap((band) => [band.musicbrainz, band.musicbrainz?.ticketmaster, band.musicbrainz?.spotify]).filter(Boolean);
  for (const status of ['confirmed', 'manual_confirmed', 'needs_review', 'no_match', 'error']) assert.ok(records.some((record) => record.status === status));
  assert.ok(records.some((record) => (record.reviewCandidates || []).length >= 2));
});

test('past, show-day and upcoming concerts exist', () => {
  const fixtures = valid();
  assert.ok(fixtures.concerts.some((concert) => concert.attended && concert.date < '2027-07-16'));
  assert.ok(fixtures.concerts.some((concert) => concert.date === '2027-07-16'));
  assert.ok(fixtures.concerts.some((concert) => concert.date > '2027-07-16'));
});

test('one-PDF, one-URL and two-PDF ticket scenarios exist', () => {
  const concerts = valid().concerts;
  assert.ok(concerts.some((concert) => concert.ownedTickets?.length === 1 && concert.ownedTickets[0].type === 'pdf'));
  assert.ok(concerts.some((concert) => concert.ownedTickets?.length === 1 && concert.ownedTickets[0].type === 'url'));
  assert.ok(concerts.some((concert) => concert.ownedTickets?.length === 2 && concert.ownedTickets.every((ticket) => ticket.type === 'pdf')));
});

test('setlist, weather and insight scenarios exist', () => {
  const concerts = valid().concerts;
  assert.ok(concerts.some((concert) => concert.predictedSetlist?.status === 'ready'));
  assert.ok(concerts.some((concert) => concert.setlist?.songs?.length));
  assert.ok(concerts.some((concert) => concert.setlistInsights?.insights?.length));
  assert.ok(concerts.some((concert) => concert.weather?.status === 'ready'));
  assert.ok(concerts.some((concert) => concert.weather?.status === 'unavailable'));
});

test('release and news categories exist', () => {
  const categories = new Set(valid().news.map((item) => item.category));
  for (const category of ['concert', 'album', 'ep', 'single', 'news']) assert.ok(categories.has(category));
});

test('unknown future fields are present for preservation tests', () => {
  const fixtures = valid();
  assert.ok(fixtures.bands.some((band) => band.futureFeatureData?.keep));
  assert.ok(fixtures.concerts.some((concert) => concert.futureFeatureData || concert.unknownProviderFutureField));
});

test('fixtures contain no forbidden real provider domains', () => assert.equal(result(valid()).errors.some((error) => error.includes('forbidden provider')), false));

test('validator rejects duplicate IDs', () => {
  const fixtures = valid();
  fixtures.bands[1].id = fixtures.bands[0].id;
  assert.equal(result(fixtures).valid, false);
});

test('validator rejects unresolved band references', () => {
  const fixtures = valid();
  fixtures.concerts[0].bandId = 'missing';
  assert.ok(result(fixtures).errors.some((error) => error.includes('unknown bandId')));
});

test('validator rejects forbidden external URLs', () => {
  const fixtures = valid();
  fixtures.news[0].url = 'https://open.spotify.com/item';
  assert.equal(result(fixtures).valid, false);
});

test('validator rejects malformed ticket metadata', () => {
  const fixtures = valid();
  fixtures.concerts.find((concert) => concert.id === 'qa-one-pdf').ownedTickets[0].sizeBytes = 0;
  assert.ok(result(fixtures).errors.some((error) => error.includes('invalid PDF size')));
});

test('validator rejects removal of manual confirmation', () => {
  const fixtures = valid();
  for (const band of fixtures.bands) for (const record of [band.musicbrainz, band.musicbrainz?.ticketmaster, band.musicbrainz?.spotify]) if (record?.status === 'manual_confirmed') record.status = 'confirmed';
  assert.ok(result(fixtures).errors.some((error) => error.includes('manual_confirmed')));
});

test('validator rejects removal of show-day scenario', () => {
  const fixtures = valid();
  for (const concert of fixtures.concerts) if (concert.date === '2027-07-16') concert.date = '2027-07-17';
  assert.ok(result(fixtures).errors.some((error) => error.includes('show-day')));
});
