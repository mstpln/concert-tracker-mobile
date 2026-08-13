'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const lease = require('../scripts/lib/schedulerLease');
const wrapper = require('../scripts/run-with-scheduler-lease');
const artwork = require('../scripts/spotify-artwork-backfill-production');
const albumArtwork = require('../scripts/spotify-album-artwork-production');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function authorizedArtworkEnv() {
  return {
    LIVEVAULT_BACKFILL_CONFIRM: artwork.PRODUCTION_EXECUTION_CONFIRMATION,
    LIVEVAULT_BACKFILL_WRITE_CONFIRM: artwork.PRODUCTION_WRITE_CONFIRMATION,
    CF_WORKER_ENDPOINT: 'https://worker.invalid',
    CF_WORKER_BROWSER_TOKEN: 'synthetic-worker-token',
    SPOTIFY_CLIENT_ID: 'synthetic-client-id',
    SPOTIFY_CLIENT_SECRET: 'synthetic-client-secret',
  };
}

test('active lease blocks a second scheduler before provider work', async () => {
  const store = { version: 1, value: { spotify: { callsToday: 4 }, futureField: { keep: true } } };
  const first = await lease.acquireSchedulerLease({
    owner: 'structured-research',
    leaseId: 'lease-one',
    now: () => Date.parse('2026-08-13T08:00:00.000Z'),
    client: storeClient(store),
  });
  assert.equal(store.value.schedulerLease.owner, 'structured-research');
  assert.deepEqual(store.value.futureField, { keep: true });

  await assert.rejects(
    () => lease.acquireSchedulerLease({
      owner: 'focused-tavily-concert',
      leaseId: 'lease-two',
      now: () => Date.parse('2026-08-13T08:01:00.000Z'),
      client: storeClient(store),
    }),
    (error) => error?.code === 'SCHEDULER_LEASE_BUSY'
  );
  await lease.releaseSchedulerLease(first);
  assert.equal(store.value.schedulerLease, undefined);
  assert.deepEqual(store.value.futureField, { keep: true });
});

test('expired lease can be replaced while preserving unknown lease fields', async () => {
  const store = {
    version: 3,
    value: {
      schedulerLease: {
        schemaVersion: 1,
        leaseId: 'expired',
        owner: 'old-run',
        acquiredAt: '2026-08-12T00:00:00.000Z',
        expiresAt: '2026-08-12T06:00:00.000Z',
        futureLeaseField: 'preserve-me',
      },
      unknownTopLevel: 42,
    },
  };
  const handle = await lease.acquireSchedulerLease({
    owner: 'new-run',
    leaseId: 'replacement',
    now: () => Date.parse('2026-08-13T08:00:00.000Z'),
    client: storeClient(store),
  });
  assert.equal(store.value.schedulerLease.leaseId, 'replacement');
  assert.equal(store.value.schedulerLease.futureLeaseField, 'preserve-me');
  assert.equal(store.value.unknownTopLevel, 42);
  assert.equal(store.value.schedulerLease.expiresAt, '2026-08-13T14:00:00.000Z');
  await lease.releaseSchedulerLease(handle);
});

test('acquisition rejects a requested lease longer than the six-hour safety ceiling', async () => {
  const store = { version: 1, value: { futureField: true } };
  await assert.rejects(
    () => lease.acquireSchedulerLease({
      owner: 'too-long',
      leaseMs: lease.DEFAULT_LEASE_MS + 1,
      client: storeClient(store),
    }),
    /between 1 and six hours/
  );
  assert.deepEqual(store.value, { futureField: true });
});

test('persisted schema-v1 lease longer than six hours fails closed', async () => {
  const store = {
    version: 1,
    value: {
      schedulerLease: {
        schemaVersion: 1,
        leaseId: 'overlong',
        owner: 'stale-run',
        acquiredAt: '2026-08-12T00:00:00.000Z',
        expiresAt: '2026-08-12T06:00:00.001Z',
      },
    },
  };
  await assert.rejects(
    () => lease.acquireSchedulerLease({
      owner: 'candidate',
      now: () => Date.parse('2026-08-13T08:00:00.000Z'),
      client: storeClient(store),
    }),
    (error) => error?.code === 'SCHEDULER_LEASE_STATE_INVALID'
  );
  assert.equal(store.value.schedulerLease.leaseId, 'overlong');
});

test('malformed persisted lease fails closed', async () => {
  const store = { version: 1, value: { schedulerLease: { owner: 'broken' } } };
  await assert.rejects(
    () => lease.acquireSchedulerLease({ owner: 'candidate', client: storeClient(store) }),
    (error) => error?.code === 'SCHEDULER_LEASE_STATE_INVALID'
  );
  assert.deepEqual(store.value, { schedulerLease: { owner: 'broken' } });
});

test('strict-write conflict during acquisition is treated as a busy lease', async () => {
  const client = {
    async readJson() { return { unrelated: true }; },
    async writeJsonStrict() {
      const error = new Error('changed concurrently');
      error.code = 'ETAG_CONFLICT';
      throw error;
    },
  };
  await assert.rejects(
    () => lease.acquireSchedulerLease({ owner: 'candidate', client }),
    (error) => error?.code === 'SCHEDULER_LEASE_BUSY'
  );
});

test('release refuses to clear a lease now owned by another run', async () => {
  const store = {
    version: 2,
    value: {
      schedulerLease: {
        schemaVersion: 1,
        leaseId: 'other-lease',
        owner: 'other-run',
        acquiredAt: '2026-08-13T08:00:00.000Z',
        expiresAt: '2026-08-13T14:00:00.000Z',
      },
    },
  };
  await assert.rejects(
    () => lease.releaseSchedulerLease({ leaseId: 'our-lease', client: storeClient(store) }),
    (error) => error?.code === 'SCHEDULER_LEASE_LOST'
  );
  assert.equal(store.value.schedulerLease.leaseId, 'other-lease');
});

test('release rereads and preserves unrelated apiUsage changes made during the run', async () => {
  const store = { version: 1, value: { spotify: { callsToday: 1 } } };
  const handle = await lease.acquireSchedulerLease({ owner: 'structured-research', leaseId: 'ours', client: storeClient(store) });
  store.value.spotify.callsToday = 9;
  store.value.futureState = { addedDuringRun: true };
  store.version += 1;
  const released = await lease.releaseSchedulerLease(handle);
  assert.equal(released, true);
  assert.equal(store.value.spotify.callsToday, 9);
  assert.deepEqual(store.value.futureState, { addedDuringRun: true });
  assert.equal(store.value.schedulerLease, undefined);
});

test('withSchedulerLease releases after an operation error', async () => {
  const store = { version: 1, value: {} };
  await assert.rejects(
    () => lease.withSchedulerLease({ owner: 'failing-run', leaseId: 'failing', client: storeClient(store) }, async () => {
      throw new Error('synthetic operation failure');
    }),
    /synthetic operation failure/
  );
  assert.equal(store.value.schedulerLease, undefined);
});

test('scheduler command wrapper acquires lease around the exact child command', async () => {
  const order = [];
  const child = new EventEmitter();
  const resultPromise = wrapper.main({
    argv: ['structured-research', '--', 'node', '-r', './scripts/preloadStructuredRun.js', 'scripts/research.js'],
    withLease: async (options, operation) => {
      order.push(`lease:${options.owner}`);
      const result = await operation();
      order.push('release');
      return result;
    },
    spawnImpl: (command, args, options) => {
      order.push(`spawn:${command}:${args.join(' ')}`);
      assert.equal(options.stdio, 'inherit');
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
    env: { SYNTHETIC: '1' },
  });
  assert.equal(await resultPromise, 0);
  assert.deepEqual(order, [
    'lease:structured-research',
    'spawn:node:-r ./scripts/preloadStructuredRun.js scripts/research.js',
    'release',
  ]);
});

test('scheduler command wrapper rejects arguments between owner and separator', () => {
  assert.throws(
    () => wrapper.parseArgs(['structured-research', 'ignored', '--', 'node', 'scripts/research.js']),
    /Usage:/
  );
});

test('legacy trusted artwork CLI acquires the shared lease before loading usage', async () => {
  const order = [];
  const previousEndpoint = process.env.CF_WORKER_ENDPOINT;
  const previousToken = process.env.CF_WORKER_TOKEN;
  try {
    await artwork.runProductionCli({
      argv: ['--execute', '--cap', '1'],
      env: authorizedArtworkEnv(),
      log: () => {},
      withLeaseImpl: async (options, operation) => {
        order.push(`lease:${options.owner}`);
        return operation();
      },
      usageFactory: async () => {
        order.push('usage');
        return { async save() {} };
      },
      runBackfillImpl: async () => ({ staged: 0 }),
    });
    assert.deepEqual(order, ['lease:spotify-artwork-maintenance', 'usage']);
  } finally {
    if (previousEndpoint === undefined) delete process.env.CF_WORKER_ENDPOINT; else process.env.CF_WORKER_ENDPOINT = previousEndpoint;
    if (previousToken === undefined) delete process.env.CF_WORKER_TOKEN; else process.env.CF_WORKER_TOKEN = previousToken;
  }
});

test('album-oriented trusted artwork CLI acquires the shared lease before maintenance work', async () => {
  const order = [];
  const previousEndpoint = process.env.CF_WORKER_ENDPOINT;
  const previousToken = process.env.CF_WORKER_TOKEN;
  try {
    const summary = await albumArtwork.runProductionCli({
      argv: ['--execute', '--write', '--cap', '1'],
      env: authorizedArtworkEnv(),
      log: () => {},
      withLeaseImpl: async (options, operation) => {
        order.push(`lease:${options.owner}`);
        return operation();
      },
      runAlbumArtworkImpl: async () => {
        order.push('artwork');
        return { providerAlbumGroupsPlanned: 0 };
      },
    });
    assert.equal(summary.providerAlbumGroupsPlanned, 0);
    assert.deepEqual(order, ['lease:spotify-album-artwork-maintenance', 'artwork']);
  } finally {
    if (previousEndpoint === undefined) delete process.env.CF_WORKER_ENDPOINT; else process.env.CF_WORKER_ENDPOINT = previousEndpoint;
    if (previousToken === undefined) delete process.env.CF_WORKER_TOKEN; else process.env.CF_WORKER_TOKEN = previousToken;
  }
});
