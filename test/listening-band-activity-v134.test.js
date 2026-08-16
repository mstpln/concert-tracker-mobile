'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const activity = require('../listeningBandActivity');

const NOW = new Date('2026-08-16T12:00:00.000Z');
const bands = [{ id: 'alpha' }, { id: 'beta' }, { id: 'silent' }];

test('privacy-safe aggregate uses mutually exclusive calendar buckets and contains no raw listening fields', () => {
  const aggregate = activity.buildAggregate([
    { localBandId: 'alpha', listenedAt: '2026-08-15T12:00:00.000Z', recordingTitle: 'private title', stableListenId: 'private-id' },
    { localBandId: 'alpha', listenedAt: '2026-07-01T12:00:00.000Z' },
    { localBandId: 'beta', listenedAt: '2026-04-01T12:00:00.000Z' },
    { localBandId: 'beta', listenedAt: '2025-01-01T12:00:00.000Z' },
    { localBandId: null, listenedAt: '2026-08-15T12:00:00.000Z' },
  ], bands, NOW);
  assert.equal(aggregate.records.alpha.buckets.fourteenDays.listenCount, 1);
  assert.equal(aggregate.records.alpha.buckets.threeMonths.listenCount, 1);
  assert.equal(aggregate.records.beta.buckets.oneYear.listenCount, 1);
  assert.equal(aggregate.records.beta.buckets.allTime.listenCount, 1);
  assert.equal(aggregate.records.silent.buckets.fourteenDays.listenCount, 0);
  assert.equal(aggregate.records.alpha.buckets.fourteenDays.recencyRank, 1);
  assert.equal(aggregate.records.silent.buckets.fourteenDays.recencyRank, null);
  assert.equal(aggregate.mappedListenCount, 4);
  assert.equal(activity.validateAggregate(aggregate, { bands }), true);
  assert.doesNotMatch(JSON.stringify(aggregate), /private title|private-id|recordingTitle|stableListenId|2026-08-15T12:00:00\.000Z/);
});

test('aggregate validation fails closed on catalogue mismatch and malformed counts', () => {
  const aggregate = activity.buildAggregate([], bands, NOW);
  assert.equal(activity.validateAggregate(aggregate, { bands: [...bands, { id: 'new-band' }] }), false);
  const wrongSameSize = structuredClone(aggregate);
  wrongSameSize.records.other = { ...wrongSameSize.records.silent, bandId: 'other' };
  delete wrongSameSize.records.silent;
  assert.equal(activity.validateAggregate(wrongSameSize, { bands }), false);
  aggregate.records.alpha.buckets.allTime.listenCount = -1;
  assert.equal(activity.validateAggregate(aggregate, { bands }), false);
  aggregate.generatedAt = 'not-a-date';
  assert.doesNotThrow(() => activity.validateAggregate(aggregate, { bands }));
  assert.equal(activity.validateAggregate(aggregate, { bands }), false);
});

test('aggregate validation rejects unknown fields at every privacy boundary', () => {
  const cases = [
    (value) => { value.rawListeningHistory = [{ private: true }]; },
    (value) => { value.records.alpha.rawEvents = [{ private: true }]; },
    (value) => { value.records.alpha.buckets.fourteenDays.recordingTitle = 'private'; },
  ];
  for (const mutate of cases) {
    const aggregate = activity.buildAggregate([], bands, NOW);
    mutate(aggregate);
    assert.equal(activity.validateAggregate(aggregate, { bands }), false);
  }
});

test('aggregate totals and ordinal recency ranks must reconcile with every bucket', () => {
  const aggregate = activity.buildAggregate([
    { localBandId: 'alpha', listenedAt: '2026-08-15T12:00:00.000Z' },
    { localBandId: 'beta', listenedAt: '2026-08-14T12:00:00.000Z' },
  ], bands, NOW);
  aggregate.mappedListenCount = 3;
  assert.equal(activity.validateAggregate(aggregate, { bands }), false);
  aggregate.mappedListenCount = 2;
  aggregate.records.beta.buckets.fourteenDays.recencyRank = 1;
  assert.equal(activity.validateAggregate(aggregate, { bands }), false);
});

test('browser publisher uses read-before-strict-write and skips a recent unchanged aggregate', async () => {
  const priorGlobals = { rsGetConnection: global.rsGetConnection, dlReadJsonFile: global.dlReadJsonFile, dlWriteJsonFileIfCurrent: global.dlWriteJsonFileIfCurrent };
  const calls = [];
  try {
    global.rsGetConnection = () => ({ endpoint: 'https://worker.test', token: 'private' });
    global.dlReadJsonFile = async (_remote, path) => { calls.push(`read:${path}`); return null; };
    global.dlWriteJsonFileIfCurrent = async (_remote, path, value) => { calls.push(`write:${path}`); assert.equal(activity.validateAggregate(value, { bands }), true); };
    assert.equal((await activity.publishFromBrowser([], bands, NOW)).kind, 'updated');
    assert.deepEqual(calls, [`read:${activity.PATH}`, `write:${activity.PATH}`]);
  } finally { Object.assign(global, priorGlobals); }
});
