'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../scripts/spotify-artwork-backfill.js');

function metadata() {
  return {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: '2026-08-07T09:00:00.000Z',
    records: {},
  };
}

test('metadata write uses If-Match for an existing private document', async () => {
  let observed = null;
  await runner.workerPutJson({
    endpoint: 'https://worker.invalid',
    token: 'synthetic-token',
    pathname: 'listening/spotify-metadata.json',
    value: metadata(),
    etag: '"etag-1"',
    fetchImpl: async (input, init) => {
      observed = { input, init };
      return new Response('OK', { status: 200, headers: { ETag: '"etag-2"' } });
    },
  });
  assert.equal(observed.init.method, 'PUT');
  assert.equal(observed.init.headers['If-Match'], '"etag-1"');
  assert.equal(observed.init.headers['If-None-Match'], undefined);
  assert.match(observed.input, /listening\/spotify-metadata\.json$/);
});

test('metadata create uses If-None-Match star and never performs an unconditional write', async () => {
  let observed = null;
  await runner.workerPutJson({
    endpoint: 'https://worker.invalid',
    token: 'synthetic-token',
    pathname: 'listening/spotify-metadata.json',
    value: metadata(),
    missing: true,
    fetchImpl: async (_input, init) => {
      observed = init;
      return new Response('OK', { status: 200 });
    },
  });
  assert.equal(observed.headers['If-None-Match'], '*');
  await assert.rejects(
    () => runner.workerPutJson({
      endpoint: 'https://worker.invalid',
      token: 'synthetic-token',
      pathname: 'listening/spotify-metadata.json',
      value: metadata(),
      fetchImpl: async () => { throw new Error('must not call'); },
    }),
    /without an ETag or create-only condition/
  );
});

test('ETag conflict fails closed and tells the operator to rebase staged records', async () => {
  await assert.rejects(
    () => runner.workerPutJson({
      endpoint: 'https://worker.invalid',
      token: 'synthetic-token',
      pathname: 'listening/spotify-metadata.json',
      value: metadata(),
      etag: '"stale"',
      fetchImpl: async () => new Response('Document changed', { status: 412 }),
    }),
    (error) => error?.code === 'ETAG_CONFLICT' && /changed during the backfill/.test(error.message)
  );
});

test('Spotify token acquisition does not print or return credentials and rejects missing access tokens', async () => {
  const token = await runner.getSpotifyToken({
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-secret',
    fetchImpl: async (_input, init) => {
      assert.match(init.headers.Authorization, /^Basic /);
      assert.doesNotMatch(init.headers.Authorization, /synthetic-secret/);
      return new Response(JSON.stringify({ access_token: 'synthetic-access-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(token, 'synthetic-access-token');

  await assert.rejects(
    () => runner.getSpotifyToken({
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
      fetchImpl: async () => new Response(JSON.stringify({ token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    }),
    /returned no access token/
  );
});
