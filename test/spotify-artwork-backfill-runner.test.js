'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../scripts/spotify-artwork-backfill.js');

function event(id) {
  return { spotifyTrackId: id, stableListenId: `listen-${id}`, listenedAt: '2026-08-07T00:00:00.000Z' };
}

function metadata(records = {}) {
  return {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: null,
    futureTopLevelField: { keep: true },
    records,
  };
}

function harness({ events, remote = metadata(), checkpoint = null, responses = {}, writeEnabled = false, cap = 25 } = {}) {
  let savedCheckpoint = checkpoint;
  let remoteState = { metadata: remote, etag: '"fixture-etag"', missing: false };
  const requested = [];
  const writes = [];
  const sleeps = [];
  return {
    requested,
    writes,
    sleeps,
    get checkpoint() { return savedCheckpoint; },
    get remote() { return remoteState; },
    run: () => runner.runBackfill({
      cap,
      delayMs: 1000,
      writeEnabled,
      loadEvents: async () => events,
      readMetadata: async () => remoteState,
      writeMetadata: async ({ value, etag, missing }) => {
        writes.push({ value, etag, missing });
        remoteState = { metadata: value, etag: '"next-etag"', missing: false };
      },
      loadCheckpoint: async () => savedCheckpoint,
      saveCheckpoint: async (value) => { savedCheckpoint = JSON.parse(JSON.stringify(value)); },
      getToken: async () => 'synthetic-token',
      fetchTrack: async ({ id }) => {
        requested.push(id);
        return responses[id] || { kind: 'ok', status: 200, track: { id, album: { images: [] } } };
      },
      sleepImpl: async (ms) => { sleeps.push(ms); },
      now: () => '2026-08-07T09:30:00.000Z',
    }),
  };
}

test('runner checkpoints each completed track and resumes without repeating provider requests', async () => {
  const first = harness({
    events: [event('Track1'), event('Track2'), event('Track3')],
    responses: {
      Track2: { kind: 'quota_exceeded', status: 429 },
    },
  });
  const firstSummary = await first.run();
  assert.deepEqual(first.requested, ['Track1', 'Track2']);
  assert.equal(firstSummary.stopped, 'spotify_development_quota_exceeded');
  assert.deepEqual(first.checkpoint.remainingIds, ['Track2', 'Track3']);
  assert.ok(first.checkpoint.stagedRecords.Track1);

  const second = harness({
    events: [event('Track1'), event('Track2'), event('Track3')],
    checkpoint: first.checkpoint,
  });
  const secondSummary = await second.run();
  assert.deepEqual(second.requested, ['Track2', 'Track3']);
  assert.equal(secondSummary.stopped, null);
  assert.deepEqual(second.checkpoint.remainingIds, []);
  assert.ok(second.checkpoint.stagedRecords.Track1);
  assert.ok(second.checkpoint.stagedRecords.Track2);
  assert.ok(second.checkpoint.stagedRecords.Track3);
});

test('provider-only staging does not expand into a fresh logical batch before staged records are synchronized', async () => {
  const events = [event('Track1'), event('Track2'), event('Track3'), event('Track4')];
  const first = harness({ events, cap: 2 });
  await first.run();
  assert.deepEqual(first.requested, ['Track1', 'Track2']);
  assert.deepEqual(first.checkpoint.remainingIds, []);
  assert.deepEqual(Object.keys(first.checkpoint.stagedRecords).sort(), ['Track1', 'Track2']);

  const second = harness({ events, cap: 2, checkpoint: first.checkpoint });
  const summary = await second.run();
  assert.deepEqual(second.requested, []);
  assert.equal(summary.staged, 2);
  assert.deepEqual(second.checkpoint.plannedIds, ['Track1', 'Track2']);
});

test('runner treats 404 as terminal and does not request that ID on a later invocation', async () => {
  const first = harness({
    events: [event('MissingTrack'), event('OtherTrack')],
    responses: {
      MissingTrack: { kind: 'not_found', status: 404 },
      OtherTrack: { kind: 'quota_exceeded', status: 429 },
    },
  });
  await first.run();
  assert.deepEqual(first.checkpoint.terminalNotFoundIds, ['MissingTrack']);

  const second = harness({
    events: [event('MissingTrack'), event('OtherTrack')],
    checkpoint: first.checkpoint,
  });
  await second.run();
  assert.deepEqual(second.requested, ['OtherTrack']);
});

test('write-enabled runner merges staged metadata conditionally and preserves unknown fields', async () => {
  const base = metadata({
    ExistingTrack: {
      spotifyTrackId: 'ExistingTrack',
      spotifyTrackUrl: 'https://open.spotify.com/track/ExistingTrack',
      futureRecordField: 'keep',
    },
  });
  const run = harness({ events: [event('NewTrack')], remote: base, writeEnabled: true });
  const summary = await run.run();
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].etag, '"fixture-etag"');
  assert.deepEqual(run.writes[0].value.futureTopLevelField, { keep: true });
  assert.equal(run.writes[0].value.records.ExistingTrack.futureRecordField, 'keep');
  assert.equal(run.writes[0].value.records.NewTrack.spotifyTrackId, 'NewTrack');
  assert.equal(summary.synced, true);
  assert.deepEqual(run.checkpoint.stagedRecords, {});
});

test('runner enforces the invocation cap without expanding the persisted logical batch', async () => {
  const events = Array.from({ length: 8 }, (_, index) => event(`Track${index + 1}`));
  const run = harness({ events, cap: 3 });
  const summary = await run.run();
  assert.equal(summary.planned, 3);
  assert.equal(run.requested.length, 3);
  assert.equal(run.sleeps.length, 2);
  assert.deepEqual(run.checkpoint.plannedIds, ['Track1', 'Track2', 'Track3']);
});

test('provider error stops before consuming the current ID', async () => {
  const run = harness({
    events: [event('Track1'), event('Track2')],
    responses: { Track1: { kind: 'forbidden', status: 403 } },
  });
  const summary = await run.run();
  assert.equal(summary.stopped, 'spotify_track_request_forbidden');
  assert.deepEqual(run.checkpoint.remainingIds, ['Track1', 'Track2']);
  assert.equal(run.checkpoint.requestCount, 1);
});

test('CLI remains inert without --execute and requires an explicit maintenance confirmation', async () => {
  await assert.rejects(
    () => runner.runCli({ argv: [], env: {}, fetchImpl: async () => { throw new Error('network must not run'); }, log: () => {} }),
    /add --execute/
  );
  await assert.rejects(
    () => runner.runCli({ argv: ['--execute'], env: {}, fetchImpl: async () => { throw new Error('network must not run'); }, log: () => {} }),
    /LIVEVAULT_BACKFILL_CONFIRM/
  );
});

test('Spotify response classifier distinguishes quota, ordinary rate limit and malformed success', async () => {
  const quota = await runner.fetchSpotifyTrack({
    id: 'Track1', token: 'synthetic',
    fetchImpl: async () => new Response(JSON.stringify({ error: { status: 429, reason: 'QUOTA_EXCEEDED' } }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    }),
  });
  assert.equal(quota.kind, 'quota_exceeded');

  const limited = await runner.fetchSpotifyTrack({
    id: 'Track1', token: 'synthetic',
    fetchImpl: async () => new Response(JSON.stringify({ error: { status: 429 } }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '17' },
    }),
  });
  assert.equal(limited.kind, 'rate_limited');
  assert.equal(limited.retryAfterSeconds, 17);

  const malformed = await runner.fetchSpotifyTrack({
    id: 'Track1', token: 'synthetic',
    fetchImpl: async () => new Response(JSON.stringify({ id: 'bad-id!' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(malformed.kind, 'malformed');
});
