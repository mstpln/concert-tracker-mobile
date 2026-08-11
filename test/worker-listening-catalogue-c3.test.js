'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadWorker() {
  const source = fs.readFileSync('worker.js', 'utf8')
    .replace('export default {', 'globalThis.__bandmarkrWorkerUnderTest = {');
  delete globalThis.__bandmarkrWorkerUnderTest;
  new Function(source)();
  const worker = globalThis.__bandmarkrWorkerUnderTest;
  delete globalThis.__bandmarkrWorkerUnderTest;
  return worker;
}

const ARTIST = '12345678-1234-4234-8234-123456789abc';
const RELEASE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RELEASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORDING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function recording(releases) {
  return {
    recordingMbid: RECORDING,
    title: 'Synthetic Song',
    artistMbids: [ARTIST],
    releases,
  };
}

function release(id, title) {
  return { releaseMbid: id, releaseGroupMbid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title };
}

function catalogue() {
  const a = release(RELEASE_A, 'Release A');
  const b = release(RELEASE_B, 'Release B');
  return {
    kind: 'livevault-musicbrainz-catalogue-cache',
    schemaVersion: 1,
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        sourceEntity: 'release',
        scopeCheckpoints: {
          release_artist: {
            artistMbid: ARTIST,
            sourceEntity: 'release',
            releaseMbids: [RELEASE_A],
            recordings: [recording([a])],
            nextOffset: 1,
            totalCount: 1,
            complete: true,
          },
          release_track_artist: {
            artistMbid: ARTIST,
            sourceEntity: 'release',
            releaseMbids: [RELEASE_B],
            recordings: [recording([b])],
            nextOffset: 1,
            totalCount: 1,
            complete: true,
          },
        },
        coverageScopes: ['release_artist', 'release_track_artist'],
        releaseMbids: [RELEASE_A, RELEASE_B],
        recordings: [recording([a, b])],
        nextOffset: 2,
        totalCount: 2,
        complete: true,
        refreshedAt: '2026-08-11T00:00:00.000Z',
        freshUntil: '2026-09-10T00:00:00.000Z',
      },
    },
  };
}

function bucket(initial = null) {
  let stored = initial;
  let etag = 'etag-1';
  return {
    async get(key) {
      if (key !== 'listening/musicbrainz-catalogue.json' || stored == null) return null;
      return { body: JSON.stringify(stored), httpEtag: `"${etag}"`, async text() { return JSON.stringify(stored); } };
    },
    async head(key) {
      if (key !== 'listening/musicbrainz-catalogue.json' || stored == null) return null;
      return { httpEtag: `"${etag}"` };
    },
    async put(key, body, options) {
      assert.equal(key, 'listening/musicbrainz-catalogue.json');
      const condition = options.onlyIf;
      if (stored == null) {
        if (condition?.etagDoesNotMatch !== '*') return null;
      } else if (condition?.etagMatches !== etag) return null;
      stored = JSON.parse(body);
      etag = 'etag-2';
      return { httpEtag: `"${etag}"` };
    },
  };
}

function request(token, method = 'GET', body, headers = {}) {
  return new Request('https://worker.example.test/listening/musicbrainz-catalogue.json', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const envBase = {
  BROWSER_TOKEN: 'synthetic-browser',
  AUTOMATION_TOKEN: 'synthetic-automation',
  DATA_MAINTENANCE_TOKEN: 'synthetic-maintenance',
};

test('catalogue route is exact and data-maintenance only', async () => {
  const worker = loadWorker();
  const env = { ...envBase, BUCKET: bucket(catalogue()) };
  assert.equal((await worker.fetch(request(null), env)).status, 401);
  assert.equal((await worker.fetch(request(env.BROWSER_TOKEN), env)).status, 403);
  assert.equal((await worker.fetch(request(env.AUTOMATION_TOKEN), env)).status, 403);
  assert.equal((await worker.fetch(request(env.DATA_MAINTENANCE_TOKEN), env)).status, 200);
  const nearby = new Request('https://worker.example.test/listening/musicbrainz-catalogue-extra.json', { headers: { Authorization: `Bearer ${env.DATA_MAINTENANCE_TOKEN}` } });
  assert.equal((await worker.fetch(nearby, env)).status, 404);
});

test('catalogue writes require conditional ETag and accept valid multi-scope assembly', async () => {
  const worker = loadWorker();
  const env = { ...envBase, BUCKET: bucket(null) };
  const noCondition = await worker.fetch(request(env.DATA_MAINTENANCE_TOKEN, 'PUT', catalogue(), { 'Content-Type': 'application/json' }), env);
  assert.equal(noCondition.status, 428);
  const created = await worker.fetch(request(env.DATA_MAINTENANCE_TOKEN, 'PUT', catalogue(), { 'Content-Type': 'application/json', 'If-None-Match': '*' }), env);
  assert.equal(created.status, 200);
  assert.ok(created.headers.get('ETag'));
});

test('catalogue validator rejects forged coverage and malformed scope state', async () => {
  const worker = loadWorker();
  const invalid = catalogue();
  invalid.artists[ARTIST].scopeCheckpoints.release_track_artist.complete = false;
  invalid.artists[ARTIST].scopeCheckpoints.release_track_artist.nextOffset = 0;
  const env = { ...envBase, BUCKET: bucket(null) };
  const response = await worker.fetch(request(env.DATA_MAINTENANCE_TOKEN, 'PUT', invalid, { 'Content-Type': 'application/json', 'If-None-Match': '*' }), env);
  assert.equal(response.status, 400);
});

test('catalogue route enforces the 25 MiB ceiling before parsing', async () => {
  const worker = loadWorker();
  const env = { ...envBase, BUCKET: bucket(null) };
  const response = await worker.fetch(new Request('https://worker.example.test/listening/musicbrainz-catalogue.json', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.DATA_MAINTENANCE_TOKEN}`,
      'Content-Type': 'application/json',
      'If-None-Match': '*',
      'Content-Length': String(25 * 1024 * 1024 + 1),
    },
    body: '{}',
  }), env);
  assert.equal(response.status, 413);
});
