'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventModelV174, validateExplicitEventGroup } = require('../canonicalEventGroupV174');

const GROUP_ID = 'event-userowned-174';

test('v174 keeps a valid explicit eventGroupId authoritative across inferred venue and date conflicts', () => {
  const records = [
    {
      id: 'explicit-a',
      bandId: 'band-a',
      bandName: 'Support A',
      date: '2026-10-18',
      venue: 'Aviva Studios',
      city: 'Manchester',
      country: 'United Kingdom',
      eventGroupId: GROUP_ID,
      attending: true,
      lineupRole: 'support',
    },
    {
      id: 'explicit-b',
      bandId: 'band-b',
      bandName: 'Headliner B',
      date: '2026-10-19',
      venue: 'AFAS Dome',
      city: 'Antwerp',
      country: 'Belgium',
      eventGroupId: GROUP_ID,
      attending: true,
      lineupRole: 'headliner',
    },
  ];

  assert.deepEqual(validateExplicitEventGroup(records), { valid: true, reasons: [] });
  const groups = EventModelV174.groupConcertPerformances(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].relationship, 'explicit');
  assert.equal(groups[0].eventGroupId, GROUP_ID);
  assert.equal(groups[0].validation.valid, true);
  assert.deepEqual(groups[0].records.map((record) => record.id), ['explicit-a', 'explicit-b']);
});

test('v174 explicit authority still fails closed for malformed or mixed group IDs', () => {
  const base = { id: 'a', eventGroupId: GROUP_ID };
  assert.equal(validateExplicitEventGroup([{ ...base }, { id: 'b', eventGroupId: 'not-valid' }]).valid, false);
  assert.equal(validateExplicitEventGroup([{ ...base }, { id: 'b', eventGroupId: 'event-userowned-175' }]).valid, false);
  assert.equal(validateExplicitEventGroup([]).valid, false);
});

test('v174 does not reorder an authoritative explicit group across different dates', () => {
  const records = [
    { id: 'headliner', date: '2026-10-19', eventGroupId: GROUP_ID, lineupRole: 'headliner' },
    { id: 'support', date: '2026-10-18', eventGroupId: GROUP_ID, lineupRole: 'support' },
  ];
  const ordered = EventModelV174.orderPerformances(records);
  assert.deepEqual(ordered.map((record) => record.id), ['headliner', 'support']);
});
