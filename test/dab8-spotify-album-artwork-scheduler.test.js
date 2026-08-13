'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../scripts/spotify-album-artwork-scheduler');
const productionSafety = require('../scripts/spotify-artwork-backfill-production');

function authorizedEnv() {
  return {
    LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM: scheduler.SCHEDULE_AUTHORIZATION,
    CF_WORKER_ENDPOINT: 'https://worker.example.test',
    CF_WORKER_BROWSER_TOKEN: 'synthetic-browser-token',
    SPOTIFY_CLIENT_ID: 'synthetic-client-id',
    SPOTIFY_CLIENT_SECRET: 'synthetic-client-secret',
  };
}

test('DAB8 defaults to one bounded daily trusted-local maintenance opportunity', () => {
  const options = scheduler.parseArgs(['--execute-scheduled']);
  assert.equal(options.executeScheduled, true);
  assert.equal(options.intervalHours, 24);
  assert.equal(options.cap, 25);
  assert.equal(options.delayMs, 1000);
  assert.equal(options.market, 'SE');
  assert.equal(options.statePath, '.livevault-maintenance/spotify-album-artwork-schedule.json');
});

test('DAB8 rejects unsafe cap, pacing, interval and state paths', () => {
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--cap', '101']), /between 1 and 100/);
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--delay-ms', '999']), /at least 1000/);
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--interval-hours', '0']), /positive whole number/);
  assert.throws(() => scheduler.assertPrivateStatePath('schedule.json'), /\.livevault-maintenance/);
});

test('DAB8 due gate is exact at the 24-hour boundary', () => {
  const state = { schemaVersion: 1, lastAttemptAt: '2026-08-12T10:00:00.000Z' };
  assert.equal(scheduler.scheduleDecision(state, { now: '2026-08-13T09:59:59.999Z' }).due, false);
  assert.equal(scheduler.scheduleDecision(state, { now: '2026-08-13T10:00:00.000Z' }).due, true);
});

test('DAB8 malformed durable local schedule state fails closed', () => {
  assert.throws(() => scheduler.validateState({ schemaVersion: 2 }), /schema is unsupported/);
  assert.throws(() => scheduler.validateState({ schemaVersion: 1, lastAttemptAt: 'not-a-date' }), /invalid lastAttemptAt/);
  assert.throws(() => scheduler.validateState({ schemaVersion: 1, lastOutcome: 'maybe' }), /invalid lastOutcome/);
});

test('DAB8 refuses scheduled production execution before invoking the album runner without its dedicated authorization', async () => {
  let runs = 0;
  await assert.rejects(() => scheduler.runScheduledCli({
    argv: ['--execute-scheduled'],
    env: {},
    log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1 }),
    writeStateImpl: async () => {},
    runAlbumArtworkCliImpl: async () => { runs += 1; },
  }), /schedule authorization/i);
  assert.equal(runs, 0);
});

test('DAB8 fresh state performs zero production work and reports next due time', async () => {
  let runs = 0;
  let writes = 0;
  const logs = [];
  const result = await scheduler.runScheduledCli({
    argv: ['--execute-scheduled'],
    env: authorizedEnv(),
    now: () => '2026-08-13T10:00:00.000Z',
    log: (value) => logs.push(value),
    readStateImpl: async () => ({ schemaVersion: 1, lastAttemptAt: '2026-08-13T09:00:00.000Z', futureField: { preserved: true } }),
    writeStateImpl: async () => { writes += 1; },
    runAlbumArtworkCliImpl: async () => { runs += 1; },
  });
  assert.equal(result.status, 'not_due');
  assert.equal(result.nextDueAt, '2026-08-14T09:00:00.000Z');
  assert.equal(runs, 0);
  assert.equal(writes, 0);
  assert.equal(logs.length, 1);
});

test('DAB8 due run bridges one schedule authorization into the existing production gates and preserves safety arguments', async () => {
  const states = [];
  let clockCalls = 0;
  let invocation = null;
  const result = await scheduler.runScheduledCli({
    argv: ['--execute-scheduled', '--cap', '7', '--delay-ms', '1500', '--market', 'us'],
    env: authorizedEnv(),
    now: () => {
      clockCalls += 1;
      return clockCalls === 1 ? '2026-08-13T10:00:00.000Z' : '2026-08-13T10:02:00.000Z';
    },
    log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1, futureField: { preserved: true } }),
    writeStateImpl: async (_path, state) => { states.push(JSON.parse(JSON.stringify(state))); },
    runAlbumArtworkCliImpl: async (options) => {
      invocation = options;
      return { providerAlbumGroupsPlanned: 7 };
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(invocation.argv, ['--execute', '--write', '--cap', '7', '--delay-ms', '1500', '--market', 'US']);
  assert.equal(invocation.env.LIVEVAULT_BACKFILL_CONFIRM, productionSafety.PRODUCTION_EXECUTION_CONFIRMATION);
  assert.equal(invocation.env.LIVEVAULT_BACKFILL_WRITE_CONFIRM, productionSafety.PRODUCTION_WRITE_CONFIRMATION);
  assert.equal(invocation.env.CF_WORKER_BROWSER_TOKEN, 'synthetic-browser-token');
  assert.equal(states.length, 2);
  assert.equal(states[0].lastAttemptAt, '2026-08-13T10:00:00.000Z');
  assert.equal(states[0].futureField.preserved, true);
  assert.equal(states[1].lastCompletedAt, '2026-08-13T10:02:00.000Z');
  assert.equal(states[1].lastOutcome, 'completed');
  assert.equal(states[1].futureField.preserved, true);
});

test('DAB8 failed due run records the attempt and failure so an external wake loop cannot hot-loop provider work', async () => {
  const states = [];
  await assert.rejects(() => scheduler.runScheduledCli({
    argv: ['--execute-scheduled'],
    env: authorizedEnv(),
    now: () => '2026-08-13T10:00:00.000Z',
    log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1 }),
    writeStateImpl: async (_path, state) => { states.push(JSON.parse(JSON.stringify(state))); },
    runAlbumArtworkCliImpl: async () => { throw new Error('synthetic provider stop'); },
  }), /synthetic provider stop/);

  assert.equal(states.length, 2);
  assert.equal(states[1].lastAttemptAt, '2026-08-13T10:00:00.000Z');
  assert.equal(states[1].lastOutcome, 'failed');
  assert.equal(scheduler.scheduleDecision(states[1], { now: '2026-08-13T10:30:00.000Z' }).due, false);
});
