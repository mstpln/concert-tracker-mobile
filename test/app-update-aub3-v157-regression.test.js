'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventModel = require('../eventModelV156');

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
