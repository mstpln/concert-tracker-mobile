'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventModel = require('../eventModelV156');
const { dlConcertStats } = require('../dataLib');

const base = (overrides = {}) => ({
  id: 'a',
  bandId: 'band-a',
  bandName: 'Support A',
  date: '2026-10-18',
  venue: 'Royal Arena',
  city: 'Copenhagen',
  attending: true,
  lineupRole: 'support',
  eventGroupId: 'event-legacy12',
  ...overrides,
});

test('v157 preserves explicit v156 group identity when historical city is missing', () => {
  const records = [
    base({ city: '' }),
    base({ id: 'b', bandId: 'band-b', bandName: 'Headliner', lineupRole: 'headliner', city: undefined }),
  ];
  const events = EventModel.groupConcertPerformances(records);
  assert.equal(events.length, 1);
  assert.equal(events[0].relationship, 'explicit');
  assert.equal(events[0].validation.valid, true);
  assert.deepEqual(EventModel.orderPerformances(records).map((record) => record.id), ['a', 'b']);
  assert.deepEqual(records.map((record) => record.eventGroupId), ['event-legacy12', 'event-legacy12']);
});

test('v157 explicit groups still fail closed when known cities disagree', () => {
  const records = [
    base({ city: 'Copenhagen' }),
    base({ id: 'b', bandId: 'band-b', city: 'Malmo', lineupRole: 'headliner' }),
  ];
  const event = EventModel.groupConcertPerformances(records)[0];
  assert.equal(event.relationship, 'explicit');
  assert.equal(event.validation.valid, false);
  assert.deepEqual(event.validation.reasons, ['city']);
});

test('v157 automatic grouping still requires non-empty matching city', () => {
  const records = [
    { ...base({ city: '' }), eventGroupId: undefined },
    { ...base({ id: 'b', bandId: 'band-b', city: '' }), eventGroupId: undefined },
  ];
  const events = EventModel.groupConcertPerformances(records);
  assert.equal(events.length, 2);
  assert.equal(events.every((event) => event.relationship === 'single'), true);
  assert.deepEqual(EventModel.validateEventGroup(records).reasons, ['city']);
});

test('v160 grouped ticket cost sums performance contributions while travel remains once per event', () => {
  const support = {
    ...base(),
    id: 'synthetic-support',
    bandId: 'synthetic-support-band',
    bandName: 'Synthetic Support',
    date: '2025-11-06',
    venue: 'Synthetic Bio',
    city: 'Copenhagen',
    eventGroupId: undefined,
    lineupRole: 'support',
    ticketQuantity: 1,
    ticketPrice: 0,
    distanceKm: 42,
  };
  const headliner = {
    ...support,
    id: 'synthetic-headliner',
    bandId: 'synthetic-headliner-band',
    bandName: 'Synthetic Headliner',
    lineupRole: 'headliner',
    ticketPrice: 643,
  };
  const event = EventModel.groupConcertPerformances([headliner, support]);
  assert.equal(event.length, 1);
  assert.equal(event[0].relationship, 'automatic');
  assert.equal(event[0].validation.valid, true);
  assert.deepEqual(EventModel.orderPerformances([headliner, support]).map((record) => record.id), ['synthetic-support', 'synthetic-headliner']);
  assert.equal(EventModel.resolveEventTicketQuantity(event[0].records).value, 1);
  assert.equal(EventModel.resolveEventTicketCost(event[0].records).value, 643);
  assert.equal(EventModel.resolveEventTicketCost(event[0].records).unitPrice, 643);
  assert.equal(EventModel.resolveEventTicketCost(event[0].records).conflict, false);
  assert.equal(EventModel.resolveEventDistance(event[0].records).value, 42);

  const stats = dlConcertStats([headliner, support]);
  assert.equal(stats.totalShows, 1);
  assert.equal(stats.performanceCount, 2);
  assert.equal(stats.totalSpend, 643);
  assert.equal(stats.averageTicketPrice, 643);
  assert.equal(stats.kmTraveled, 84);
});
