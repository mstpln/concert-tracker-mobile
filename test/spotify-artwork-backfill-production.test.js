'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../scripts/spotify-artwork-backfill-production.js');
const runner = require('../scripts/spotify-artwork-backfill.js');

test('tracked Spotify call records usage before the provider operation', async () => {
  const order = [];
  const usage = {
    canCallSpotify: () => true,
    recordSpotifyCall: async () => { order.push('usage'); },
  };
  const result = await production.trackedSpotifyCall(usage, async () => {
    order.push('provider');
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.deepEqual(order, ['usage', 'provider']);
});

test('usage guard stops before a provider operation when project accounting disallows another call', async () => {
  let called = false;
  const usage = {
    canCallSpotify: () => false,
    recordSpotifyCall: async () => { throw new Error('must not record'); },
  };
  await assert.rejects(
    () => production.trackedSpotifyCall(usage, async () => { called = true; }),
    /provider-usage safety stopped/
  );
  assert.equal(called, false);
});

test('production checkpoint path is restricted to the ignored maintenance directory', () => {
  const accepted = production.assertPrivateCheckpointPath('.livevault-maintenance/spotify-artwork-backfill.json');
  assert.match(accepted, /\.livevault-maintenance/);
  assert.throws(() => production.assertPrivateCheckpointPath('spotify-artwork-backfill.json'), /must stay inside/);
  assert.throws(() => production.assertPrivateCheckpointPath('.livevault-maintenance/../checkpoint.json'), /must stay inside/);
});

test('private checkpoint is normalized before production use and unknown fields are not carried forward', async () => {
  const normalized = await production.loadValidatedCheckpoint('.livevault-maintenance/test.json', async () => ({
    schemaVersion: 1,
    plannedIds: ['Track1'],
    remainingIds: [],
    stagedRecords: {
      Track1: {
        spotifyTrackId: 'Track1',
        spotifyTrackUrl: 'https://open.spotify.com/track/Track1',
        spotifyAlbumId: null,
        spotifyAlbumUrl: null,
        artworkUrl: 'https://images.invalid/cover.jpg',
        fetchedAt: '2026-08-07T09:00:00.000Z',
        source: 'spotify_exact_track_id',
        injectedSecretField: 'must-not-survive',
      },
    },
    terminalNotFoundIds: [],
    requestCount: 1,
    topLevelInjectedField: 'drop-me',
  }));
  assert.equal(normalized.topLevelInjectedField, undefined);
  assert.equal(normalized.stagedRecords.Track1.injectedSecretField, undefined);
  assert.equal(normalized.stagedRecords.Track1.spotifyTrackId, 'Track1');
});

test('structurally invalid private checkpoint fails closed before provider work can start', async () => {
  await assert.rejects(
    () => production.loadValidatedCheckpoint('.livevault-maintenance/test.json', async () => ({
      schemaVersion: 1,
      plannedIds: ['Track1'],
      remainingIds: ['Track1'],
      stagedRecords: {
        Track1: {
          spotifyTrackId: 'Track1',
          spotifyTrackUrl: 'https://open.spotify.com/track/Track1',
          spotifyAlbumId: null,
          spotifyAlbumUrl: null,
          artworkUrl: null,
          fetchedAt: '2026-08-07T09:00:00.000Z',
          source: 'spotify_exact_track_id',
        },
      },
      terminalNotFoundIds: [],
      requestCount: 1,
    })),
    /checkpoint is invalid/
  );
});

test('production CLI is inert without --execute or the explicit confirmation value', async () => {
  let usageLoaded = false;
  const usageFactory = async () => { usageLoaded = true; throw new Error('must not load'); };
  await assert.rejects(
    () => production.runProductionCli({ argv: [], env: {}, usageFactory, log: () => {} }),
    /add --execute/
  );
  await assert.rejects(
    () => production.runProductionCli({ argv: ['--execute'], env: {}, usageFactory, log: () => {} }),
    /LIVEVAULT_BACKFILL_CONFIRM/
  );
  assert.equal(usageLoaded, false);
});

test('production wrapper wires source, checkpoint and usage accounting without exposing credentials to output', async () => {
  const previousEndpoint = process.env.CF_WORKER_ENDPOINT;
  const previousToken = process.env.CF_WORKER_TOKEN;
  const logs = [];
  const usage = {
    canCallSpotify: () => true,
    recordSpotifyCall: async () => {},
    saveCalls: 0,
    async save() { this.saveCalls += 1; },
  };
  let captured = null;
  const env = {
    LIVEVAULT_BACKFILL_CONFIRM: runner.EXECUTION_CONFIRMATION,
    CF_WORKER_ENDPOINT: 'https://worker.invalid',
    CF_WORKER_BROWSER_TOKEN: 'private-worker-token',
    SPOTIFY_CLIENT_ID: 'private-client-id',
    SPOTIFY_CLIENT_SECRET: 'private-client-secret',
  };
  try {
    const summary = await production.runProductionCli({
      argv: ['--execute', '--cap', '5'],
      env,
      fetchImpl: async () => { throw new Error('network must be controlled by injected runner'); },
      log: (value) => logs.push(String(value)),
      usageFactory: async () => usage,
      runBackfillImpl: async (options) => {
        captured = options;
        assert.equal(options.cap, 5);
        assert.equal(options.writeEnabled, false);
        return {
          trustedTrackIds: 10,
          metadataRecordsBefore: 2,
          metadataRecordsAfter: 2,
          planned: 5,
          remaining: 5,
          terminalNotFound: 0,
          staged: 0,
          providerRequestsThisInvocation: 0,
          synced: false,
          stopped: null,
        };
      },
    });
    assert.equal(summary.planned, 5);
    assert.ok(captured);
    assert.equal(usage.saveCalls, 1);
    assert.equal(process.env.CF_WORKER_ENDPOINT, 'https://worker.invalid');
    assert.equal(process.env.CF_WORKER_TOKEN, 'private-worker-token');
    const output = logs.join('\n');
    assert.doesNotMatch(output, /private-worker-token|private-client-secret|private-client-id/);
  } finally {
    if (previousEndpoint === undefined) delete process.env.CF_WORKER_ENDPOINT; else process.env.CF_WORKER_ENDPOINT = previousEndpoint;
    if (previousToken === undefined) delete process.env.CF_WORKER_TOKEN; else process.env.CF_WORKER_TOKEN = previousToken;
  }
});
