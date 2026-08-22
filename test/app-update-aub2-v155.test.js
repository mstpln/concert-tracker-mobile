'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LineupRole = require('../lineupRoleV155');
const conflictMerge = require('../conflictMerge');
const research = require('../scripts/research');
const { finalFocusedConcertPayload } = require('../scripts/tavilyConcertRun');

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

test('AUB2 automatic defaults never overwrite a concurrently saved user role', () => {
  for (const baseRole of [undefined, 'malformed']) {
    const baseConcert = { id: 'show', notes: 'old' };
    if (baseRole !== undefined) baseConcert.lineupRole = baseRole;
    const base = [baseConcert];
    const intended = LineupRole.initializeConcerts(base).map((concert) => ({ ...concert, notes: 'local edit' }));
    const latest = [{ ...baseConcert, notes: 'old', lineupRole: 'support', providerField: { keep: true } }];

    assert.deepEqual(conflictMerge.merge(base, intended, latest), [{
      id: 'show',
      notes: 'local edit',
      lineupRole: 'support',
      providerField: { keep: true },
    }]);
  }
});

test('AUB2 explicit role edits still win their own stale-write conflict', () => {
  const base = [{ id: 'show', lineupRole: 'headliner', notes: 'old' }];
  const intended = [{ id: 'show', lineupRole: 'support', notes: 'old' }];
  const latest = [{ id: 'show', lineupRole: 'headliner', notes: 'remote edit' }];
  assert.deepEqual(conflictMerge.merge(base, intended, latest), [{ id: 'show', lineupRole: 'support', notes: 'remote edit' }]);
});

test('AUB2 focused Tavily writes initialize new records and preserve stored roles and unknown fields', () => {
  assert.deepEqual(finalFocusedConcertPayload([
    { id: 'new', sourceProvider: 'tavily_groq', future: { keep: true } },
    { id: 'stored', lineupRole: 'support', notes: 'user note' },
  ]), [
    { id: 'new', sourceProvider: 'tavily_groq', future: { keep: true }, lineupRole: 'headliner' },
    { id: 'stored', lineupRole: 'support', notes: 'user note' },
  ]);
});
