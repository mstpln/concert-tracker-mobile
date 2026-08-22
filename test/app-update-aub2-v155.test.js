'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LineupRole = require('../lineupRoleV155');
const research = require('../scripts/research');

test('AUB2 initializes missing or invalid roles once without losing unknown fields', () => {
  const legacy = { id: 'legacy', notes: 'keep', future: { nested: true } };
  const initialized = LineupRole.initializeConcert(legacy);
  assert.deepEqual(initialized, { ...legacy, lineupRole: 'headliner' });
  assert.equal(LineupRole.initializeConcert(initialized), initialized);
  assert.equal(LineupRole.initializeConcert({ id: 'bad', lineupRole: 'guest' }).lineupRole, 'headliner');
});

test('AUB2 accepts only the two roles and preserves user/unknown fields when editing', () => {
  const concert = { id: 'show', lineupRole: 'headliner', notes: 'user note', future: { keep: true } };
  assert.deepEqual(LineupRole.withRole(concert, 'support'), { ...concert, lineupRole: 'support' });
  assert.throws(() => LineupRole.withRole(concert, 'guest'), /headliner or support/);
});

test('AUB2 attending defaults only absent roles and preserves an existing support choice', () => {
  assert.equal(LineupRole.withAttending({ id: 'new' }, true).lineupRole, 'headliner');
  assert.equal(LineupRole.withAttending({ id: 'existing', lineupRole: 'support' }, true).lineupRole, 'support');
  assert.equal(LineupRole.withAttending({ id: 'off', lineupRole: 'support' }, false).lineupRole, 'support');
});

test('AUB2 performance stats count each past performance once and logically default legacy records', () => {
  const stats = LineupRole.performanceStats([
    { id: 'legacy' },
    { id: 'headliner', lineupRole: 'headliner' },
    { id: 'support', lineupRole: 'support' },
  ]);
  assert.deepEqual(stats, {
    total: 3,
    headliner: { count: 2, percentage: 67 },
    support: { count: 1, percentage: 33 },
  });
  assert.deepEqual(LineupRole.performanceStats([]), {
    total: 0,
    headliner: { count: 0, percentage: 0 },
    support: { count: 0, percentage: 0 },
  });
});

test('AUB2 pipeline refresh preserves stored user role and initializes new records', () => {
  const latest = [{ id: 'stored', venue: 'Latest venue', lineupRole: 'support', notes: 'keep' }];
  const payload = research.finalConcertWritePayload(
    [{ id: 'stored', venue: 'Old venue', lineupRole: 'headliner' }],
    [{ id: 'new', venue: 'New venue', future: { keep: true } }],
    { latestConcerts: latest, ticketmasterUpgrades: [], pipelineUpdatedIds: new Set() },
  );
  assert.equal(payload[0].lineupRole, 'support');
  assert.equal(payload[0].notes, 'keep');
  assert.deepEqual(payload[1], { id: 'new', venue: 'New venue', future: { keep: true }, lineupRole: 'headliner' });
});
