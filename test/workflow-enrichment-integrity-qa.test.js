'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const scheduler = require('../scripts/lib/schedulerLease');
const wrapper = require('../scripts/run-with-scheduler-lease');
const focused = require('../scripts/tavilyConcertRun');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function storeClient(store) {
  let observedVersion = null;
  return {
    async readJson() {
      observedVersion = store.version;
      return clone(store.value);
    },
    async writeJsonStrict(_filename, value) {
      if (observedVersion !== store.version) {
        const error = new Error('synthetic conflict');
        error.code = 'ETAG_CONFLICT';
        error.status = 412;
        throw error;
      }
      store.value = clone(value);
      store.version += 1;
      observedVersion = store.version;
    },
  };
}

test('scheduled period keys cover only the intended production cadence', () => {
  assert.equal(scheduler.scheduledPeriodKey('structured-research', Date.parse('2026-09-02T12:17:00Z')), '2026-09-02');
  assert.equal(scheduler.scheduledPeriodKey('structured-research', Date.parse('2026-09-03T12:17:00Z')), null);
  assert.equal(scheduler.scheduledPeriodKey('focused-tavily-concert', Date.parse('2026-09-01T07:32:00Z')), '2026-09-01');
  assert.equal(scheduler.scheduledPeriodKey('focused-tavily-concert', Date.parse('2026-09-02T07:32:00Z')), null);
});

test('scheduled completion markers preserve unrelated usage state and suppress the same period', async () => {
  const store = { version: 1, value: { futureUsageField: { keep: true } } };
  const client = storeClient(store);
  await scheduler.markScheduledRunCompleted({
    owner: 'structured-research',
    periodKey: '2026-09-02',
    completedAt: '2026-09-02T05:42:00Z',
    client,
  });
  assert.deepEqual(store.value.futureUsageField, { keep: true });
  assert.equal(store.value.schedulerRunMarkers['structured-research'].periodKey, '2026-09-02');
  assert.equal(await scheduler.scheduledRunAlreadyCompleted({ owner: 'structured-research', periodKey: '2026-09-02', client }), true);
  assert.equal(await scheduler.scheduledRunAlreadyCompleted({ owner: 'structured-research', periodKey: '2026-09-04', client }), false);
});

test('duplicate scheduled wrapper exits before provider work but manual dispatch still runs', async () => {
  let spawned = 0;
  let marked = 0;
  const child = new EventEmitter();
  const withLease = async (_options, operation) => operation({ client: {} });
  const spawnImpl = () => {
    spawned += 1;
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  };

  const skipped = await wrapper.main({
    argv: ['structured-research', '--', 'node', 'scripts/research.js'],
    env: { GITHUB_EVENT_NAME: 'schedule' },
    now: () => Date.parse('2026-09-02T12:17:00Z'),
    withLease,
    spawnImpl,
    alreadyCompleted: async () => true,
    markCompleted: async () => { marked += 1; },
    log: () => {},
  });
  assert.equal(skipped, 0);
  assert.equal(spawned, 0);
  assert.equal(marked, 0);

  const manual = await wrapper.main({
    argv: ['structured-research', '--', 'node', 'scripts/research.js'],
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    now: () => Date.parse('2026-09-02T12:17:00Z'),
    withLease,
    spawnImpl,
    alreadyCompleted: async () => { throw new Error('manual dispatch must not consult schedule marker'); },
    markCompleted: async () => { throw new Error('manual dispatch must not mark schedule period'); },
  });
  assert.equal(manual, 0);
  assert.equal(spawned, 1);
});

test('failed scheduled provider child never marks the period complete', async () => {
  let marked = 0;
  const child = new EventEmitter();
  await assert.rejects(() => wrapper.main({
    argv: ['structured-research', '--', 'node', 'scripts/research.js'],
    env: { GITHUB_EVENT_NAME: 'schedule' },
    now: () => Date.parse('2026-09-04T10:00:00Z'),
    withLease: async (_options, operation) => operation({ client: {} }),
    spawnImpl: () => {
      queueMicrotask(() => child.emit('exit', 1, null));
      return child;
    },
    alreadyCompleted: async () => false,
    markCompleted: async () => { marked += 1; },
  }), /status 1/);
  assert.equal(marked, 0);
});

test('focused Tavily reconciliation preserves stable/user fields and stores weaker provider evidence as an observation', () => {
  const venues = [{
    venueId: 'venue-main', name: 'Main Hall', city: 'Lund', country: 'Sweden',
    address: 'Main Street 1, Lund, Sweden', researchStatus: 'partial', schemaVersion: 1,
  }];
  const existing = [{
    id: 'stable-concert', bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', canonicalVenueId: 'venue-main', date: '2026-10-10', time: '19:00',
    attending: true, ticketCost: 123, futureOwnedField: { keep: true }, sourceProvider: 'ticketmaster',
    providerEventId: 'tm-1', providerAttractionId: 'tm-artist-a', providerOfferType: 'standard',
    ticketRetailerVerified: true, ticketUrl: 'https://tickets.example/standard',
  }];
  const candidate = {
    bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    venueAddress: 'Main Street 1, Lund, Sweden', date: '2026-10-10', time: '20:00',
    sourceProvider: 'tavily_groq', providerEventId: 'web-1', ticketRetailerVerified: false,
    ticketUrl: 'https://listing.example/show', foundAt: '2026-09-04T10:00:00Z',
  };
  const result = focused.reconcileFocusedCandidates(existing, [candidate], venues, '2026-09-04T10:00:00Z');
  assert.equal(result.counts.merged, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'stable-concert');
  assert.equal(result.records[0].ticketCost, 123);
  assert.deepEqual(result.records[0].futureOwnedField, { keep: true });
  assert.equal(result.records[0].sourceProvider, 'ticketmaster');
  assert.equal(result.records[0].providerEventId, 'tm-1');
  assert.equal(result.records[0].ticketUrl, 'https://tickets.example/standard');
  assert.equal(result.records[0].providerObservations.some((item) => item.provider === 'tavily_groq' && item.providerEventId === 'web-1'), true);
});

test('focused Tavily terminal evidence cannot contradict a stronger selected provider presentation', () => {
  const venues = [{ venueId: 'venue-main', name: 'Main Hall', city: 'Lund', country: 'Sweden', schemaVersion: 1 }];
  const existing = [{
    id: 'stable-concert', bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden',
    canonicalVenueId: 'venue-main', date: '2026-10-10', attending: true,
    sourceProvider: 'ticketmaster', providerEventId: 'tm-1', providerEventStatus: 'onsale',
    providerOfferType: 'standard', ticketRetailerVerified: true,
  }];
  const candidate = {
    bandId: 'band-a', bandName: 'Artist A', venue: 'Main Hall', city: 'Lund', country: 'Sweden', date: '2026-10-10',
    sourceProvider: 'tavily_groq', providerEventId: 'web-cancelled', providerEventStatus: 'cancelled',
    ticketRetailerVerified: false, foundAt: '2026-09-04T10:00:00Z',
  };
  const result = focused.reconcileFocusedCandidates(existing, [candidate], venues, '2026-09-04T10:00:00Z');
  assert.equal(result.records[0].providerEventStatus, 'onsale');
  assert.equal(result.records[0].lifecycleStatus, undefined);
  assert.equal(result.records[0].lifecycleReviewRequired, true);
  assert.equal(result.records[0].lifecycleHistory.at(-1).type, 'provider_status_conflict');
});
