'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventModel = require('../eventModelV156');
const conflictMerge = require('../conflictMerge');
const research = require('../scripts/research');
const { finalFocusedConcertPayload } = require('../scripts/tavilyConcertRun');
const { dlConcertStats, dlMyConcerts } = require('../dataLib');
const UiCorrection = require('../appUpdateAub3CorrectionV157');

const base = (overrides = {}) => ({
  id: 'a', bandId: 'band-a', bandName: 'Support A', date: '2026-10-18', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark',
  attending: true, lineupRole: 'support', ticketQuantity: 4, ticketPrice: 1000, distanceKm: 55,
  notes: 'keep', rating: 5, unknownFutureField: { keep: true }, ...overrides,
});

test('v157 automatically groups only strong attended date/venue/non-empty-city context', () => {
  const support = base();
  const headliner = base({ id: 'b', bandId: 'band-b', bandName: 'Headliner', lineupRole: 'headliner' });
  const groups = EventModel.groupConcertPerformances([support, headliner]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].relationship, 'automatic');
  assert.equal(groups[0].validation.valid, true);
  assert.deepEqual(groups[0].records.map((record) => record.id), ['a', 'b']);
  assert.equal(support.eventGroupId, undefined);
  assert.equal(headliner.eventGroupId, undefined);
});

test('v157 missing or different city and other incomplete context fail closed', () => {
  const blankBoth = [base({ city: '' }), base({ id: 'b', bandId: 'band-b', city: '' })];
  assert.equal(EventModel.groupConcertPerformances(blankBoth).length, 2);
  assert.equal(EventModel.sameCandidateContext(blankBoth[0], blankBoth[1]), false);
  assert.deepEqual(EventModel.validateEventGroup(blankBoth).reasons, ['city']);

  const oneBlank = [base(), base({ id: 'b', bandId: 'band-b', city: '' })];
  assert.equal(EventModel.groupConcertPerformances(oneBlank).length, 2);
  const differentCity = [base(), base({ id: 'b', bandId: 'band-b', city: 'Malmo' })];
  assert.equal(EventModel.groupConcertPerformances(differentCity).length, 2);
  const differentVenue = [base(), base({ id: 'b', bandId: 'band-b', venue: 'Forum' })];
  assert.equal(EventModel.groupConcertPerformances(differentVenue).length, 2);
  const differentDate = [base(), base({ id: 'b', bandId: 'band-b', date: '2026-10-19' })];
  assert.equal(EventModel.groupConcertPerformances(differentDate).length, 2);
  const nonAttending = [base(), base({ id: 'b', bandId: 'band-b', attending: false })];
  assert.equal(EventModel.groupConcertPerformances(nonAttending).length, 2);
});

test('v157 lineup role alone never groups and normalization stays conservative', () => {
  const records = [
    base({ venue: '  Royal   Arena ', city: ' Copenhagen ' }),
    base({ id: 'b', bandId: 'band-b', venue: 'royal arena', city: 'copenhagen', lineupRole: 'headliner' }),
  ];
  assert.equal(EventModel.groupConcertPerformances(records).length, 1);
  assert.equal(EventModel.groupConcertPerformances([
    base({ venue: '', city: '' }),
    base({ id: 'b', bandId: 'band-b', venue: '', city: '', lineupRole: 'headliner' }),
  ]).length, 2);
});

test('v157 preserves valid explicit v156 groups without persisting derived IDs', () => {
  const grouped = [
    base({ eventGroupId: 'event-12345678' }),
    base({ id: 'b', bandId: 'band-b', lineupRole: 'headliner', eventGroupId: 'event-12345678' }),
  ];
  const events = EventModel.groupConcertPerformances(grouped);
  assert.equal(events.length, 1);
  assert.equal(events[0].relationship, 'explicit');
  assert.equal(events[0].eventGroupId, 'event-12345678');
  assert.deepEqual(grouped.map((record) => record.eventGroupId), ['event-12345678', 'event-12345678']);
});

test('AUB3 link, regroup and unlink remain reversible for existing persisted relationships', () => {
  const records = [base(), base({ id: 'b', bandId: 'band-b' }), base({ id: 'c', bandId: 'band-c' })];
  const linked = EventModel.linkConcerts(records, 'a', 'b', () => 'event-12345678');
  assert.deepEqual(linked.slice(0, 2).map((record) => record.eventGroupId), ['event-12345678', 'event-12345678']);
  assert.equal(linked[0].unknownFutureField.keep, true);
  const regrouped = EventModel.linkConcerts(linked, 'a', 'c', () => 'event-abcdefgh');
  assert.equal(regrouped.find((record) => record.id === 'a').eventGroupId, 'event-abcdefgh');
  assert.equal(regrouped.find((record) => record.id === 'c').eventGroupId, 'event-abcdefgh');
  assert.equal(regrouped.find((record) => record.id === 'b').eventGroupId, undefined);
  const unlinked = EventModel.unlinkConcert(regrouped, 'a');
  assert.equal(unlinked.find((record) => record.id === 'a').eventGroupId, undefined);
  assert.equal(unlinked.find((record) => record.id === 'c').eventGroupId, undefined);
});

test('AUB3 refuses accidental persisted event ID collisions', () => {
  const records = [
    base(), base({ id: 'b', bandId: 'band-b' }),
    base({ id: 'c', bandId: 'band-c', eventGroupId: 'event-collision1' }),
    base({ id: 'd', bandId: 'band-d', eventGroupId: 'event-collision1' }),
  ];
  assert.throws(() => EventModel.linkConcerts(records, 'a', 'b', () => 'event-collision1'), /safe event relationship/);
});

test('v157 orders multiple automatic supports before headliner without moving unrelated slots', () => {
  const records = [
    base({ id: 'h', bandName: 'Headliner', lineupRole: 'headliner' }),
    base({ id: 'x', bandName: 'Unrelated', date: '2026-10-19', lineupRole: 'headliner' }),
    base({ id: 's1', bandName: 'Support A' }),
    base({ id: 's2', bandName: 'Support B' }),
  ];
  assert.deepEqual(EventModel.orderPerformances(records).map((record) => record.id), ['s1', 'x', 's2', 'h']);
});

test('v157 same-role ordering remains deterministic', () => {
  const records = [base({ id: 's2', bandName: 'Second support' }), base({ id: 's1', bandName: 'First support' }), base({ id: 'h', lineupRole: 'headliner' })];
  assert.deepEqual(EventModel.orderPerformances(records).map((record) => record.id), ['s2', 's1', 'h']);
  assert.deepEqual(EventModel.orderPerformances(records).map((record) => record.id), ['s2', 's1', 'h']);
});

test('v157 event ticket, cost and journey resolvers deduplicate and never sum conflicts', () => {
  const duplicate = [base(), base({ id: 'b' })];
  assert.deepEqual(EventModel.resolveEventTicketQuantity(duplicate), { value: 4, conflict: false, knownCount: 2, values: [4] });
  assert.equal(EventModel.resolveEventTicketCost(duplicate).value, 4000);
  assert.equal(EventModel.resolveEventDistance(duplicate).value, 55);
  const conflict = [base(), base({ id: 'b', ticketQuantity: 2, ticketPrice: 800, distanceKm: 60 })];
  assert.deepEqual(EventModel.resolveEventTicketQuantity(conflict), { value: 2, conflict: true, knownCount: 2, values: [4, 2] });
  assert.equal(EventModel.resolveEventTicketCost(conflict).value, 1600);
  assert.equal(EventModel.resolveEventTicketCost(conflict).conflict, true);
  assert.equal(EventModel.resolveEventDistance(conflict).value, 55);
  const stats = dlConcertStats(conflict.map((record) => ({ ...record, date: '2025-10-18' })));
  assert.equal(stats.eventMetricConflictCount, 1);
  assert.equal(stats.totalSpend, 1600);
  const missing = [base({ ticketQuantity: undefined, ticketPrice: undefined, distanceKm: undefined }), base({ id: 'b', ticketQuantity: null, ticketPrice: null, distanceKm: null })];
  assert.equal(EventModel.resolveEventTicketQuantity(missing).value, null);
  assert.equal(EventModel.resolveEventTicketCost(missing).value, null);
  assert.equal(EventModel.resolveEventDistance(missing).value, null);
});

test('v157 synthetic shared night is one event, two performances and Support first', () => {
  const support = base({ id: 'synthetic-support', bandId: 'band-support', bandName: 'Synthetic Support', date: '2025-11-06', venue: 'Synthetic Bio', city: 'Copenhagen', ticketPrice: 0, ticketQuantity: 1, distanceKm: 42 });
  const headliner = base({ id: 'synthetic-headliner', bandId: 'band-headliner', bandName: 'Synthetic Headliner', date: '2025-11-06', venue: 'Synthetic Bio', city: 'Copenhagen', lineupRole: 'headliner', ticketPrice: 643, ticketQuantity: 1, distanceKm: 42 });
  const ordered = dlMyConcerts([headliner, support]).past;
  assert.deepEqual(ordered.map((record) => record.id), ['synthetic-support', 'synthetic-headliner']);
  const stats = dlConcertStats([headliner, support]);
  assert.equal(stats.totalShows, 1);
  assert.equal(stats.performanceCount, 2);
  assert.equal(stats.kmTraveled, 84);
  assert.notEqual(stats.totalSpend, 643);
});

test('AUB3 malformed explicit groups are detected and presentation supports multiple support acts', () => {
  const records = [base({ id: 's1' }), base({ id: 's2', bandName: 'Support B' }), base({ id: 'h', bandName: 'Headliner', lineupRole: 'headliner' })];
  const presentation = EventModel.presentationForEvent(records);
  assert.deepEqual(presentation.eventPerformances.map((record) => record.bandName), ['Support A', 'Support B', 'Headliner']);
  assert.equal(presentation.bandName, 'Headliner');
  assert.equal(EventModel.validateEventGroup(records).valid, true);
  assert.deepEqual(EventModel.validateEventGroup([records[0], { ...records[1], date: '2026-10-19', venue: 'Other' }]).reasons, ['date', 'venue']);
});

test('AUB3 provider refresh and stale grouping preserve relationship and user fields', () => {
  const latest = [base({ eventGroupId: 'event-12345678', lineupRole: 'support' })];
  const payload = research.finalConcertWritePayload(
    [base({ venue: 'Old venue', eventGroupId: 'event-oldgroup', lineupRole: 'headliner' })],
    [], { latestConcerts: latest, pipelineUpdatedIds: new Set(['a']) },
  );
  assert.equal(payload[0].eventGroupId, 'event-12345678');
  assert.equal(payload[0].lineupRole, 'support');
  assert.equal(payload[0].notes, 'keep');
  assert.equal(payload[0].rating, 5);
  assert.deepEqual(payload[0].unknownFutureField, { keep: true });

  const merged = conflictMerge.merge(
    [base()],
    EventModel.linkConcerts([base(), base({ id: 'b' })], 'a', 'b', () => 'event-12345678'),
    [base({ notes: 'newer note', rating: 4, unknownFutureField: { newer: true } })],
  );
  assert.equal(merged[0].eventGroupId, 'event-12345678');
  assert.equal(merged[0].notes, 'newer note');
  assert.equal(merged[0].rating, 4);
  assert.deepEqual(merged[0].unknownFutureField, { newer: true });

  const concurrent = conflictMerge.merge(
    [base(), base({ id: 'b', bandId: 'band-b' })],
    EventModel.linkConcerts([base(), base({ id: 'b', bandId: 'band-b' })], 'a', 'b', () => 'event-12345678'),
    [base({ notes: 'latest a', unknownFutureField: { a: true } }), base({ id: 'b', bandId: 'band-b', notes: 'latest b', rating: 3, extra: 'preserve' })],
  );
  assert.deepEqual(concurrent.map((record) => record.eventGroupId), ['event-12345678', 'event-12345678']);
  assert.deepEqual(concurrent.map((record) => record.notes), ['latest a', 'latest b']);
  assert.equal(concurrent[1].extra, 'preserve');
});

test('AUB3 focused Tavily writes preserve grouping, lineup and unknown user fields', () => {
  const existing = base({ eventGroupId: 'event-12345678', lineupRole: 'support' });
  const payload = finalFocusedConcertPayload([{ ...existing, researchStatus: 'fresh' }]);
  assert.equal(payload[0].eventGroupId, 'event-12345678');
  assert.equal(payload[0].lineupRole, 'support');
  assert.equal(payload[0].notes, 'keep');
  assert.equal(payload[0].rating, 5);
  assert.deepEqual(payload[0].unknownFutureField, { keep: true });
});

test('AUB3 stats keep performances separate while event totals deduplicate explicit and automatic groups', () => {
  const grouped = [
    base({ date: '2025-10-18', eventGroupId: 'event-12345678' }),
    base({ id: 'b', bandId: 'band-b', bandName: 'Headliner', date: '2025-10-18', lineupRole: 'headliner', eventGroupId: 'event-12345678' }),
  ];
  const independent = base({ id: 'c', bandId: 'band-c', bandName: 'Independent', date: '2025-10-19', lineupRole: 'headliner' });
  const stats = dlConcertStats([...grouped, independent], [
    { id: 'band-a', genre: 'Metal' }, { id: 'band-b', genre: 'Rock' }, { id: 'band-c', genre: 'Punk' },
  ]);
  assert.equal(stats.performanceCount, 3);
  assert.equal(stats.totalShows, 2);
  assert.equal(stats.totalUniqueArtists, 3);
  assert.equal(stats.totalSpend, 8000);
  assert.equal(stats.averageTicketPrice, 4000);
  assert.equal(stats.kmTraveled, 220);
  assert.equal(stats.uniqueVenues, 1);
  assert.equal(stats.uniqueCities, 1);
  assert.equal(stats.countries, 1);
  assert.equal(stats.ratedCount, 3);
  assert.equal(stats.pctWithRating, 100);
  assert.equal(stats.topArtists.length, 0);
});

test('AUB3 malformed explicit groups fail closed for additive cost and journey totals', () => {
  const malformed = [
    base({ date: '2025-10-18', eventGroupId: 'event-12345678' }),
    base({ id: 'b', date: '2025-10-19', venue: 'Other venue', eventGroupId: 'event-12345678' }),
  ];
  const stats = dlConcertStats(malformed);
  assert.equal(stats.totalShows, 2);
  assert.equal(stats.performanceCount, 2);
  assert.equal(stats.totalSpend, 0);
  assert.equal(stats.knownSpendCount, 0);
  assert.equal(stats.kmTraveled, 0);
  assert.equal(stats.knownDistanceCount, 0);
  assert.equal(stats.invalidEventGroupCount, 1);
  assert.equal(stats.eventMetricConflictCount, 0);
  assert.equal(EventModel.nextEventPresentation(malformed).id, 'a');
});

test('v157 manual Add Concert year helper exposes exactly current year plus one future year', () => {
  const html = UiCorrection.yearOptionsHtml(2026);
  assert.match(html, /value="2027"/);
  assert.match(html, /value="2026"/);
  assert.doesNotMatch(html, /value="2028"/);
  assert.match(html, /value="1960"/);
  assert.doesNotMatch(html, /value="1959"/);
});
