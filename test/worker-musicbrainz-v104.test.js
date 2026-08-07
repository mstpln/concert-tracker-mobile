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

const RELEASE = '12345678-1234-4234-8234-123456789abc';
const GROUP = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const env = {
  BROWSER_TOKEN: 'synthetic-browser-token',
  AUTOMATION_TOKEN: 'synthetic-automation-token',
};

function request(token, mbid = RELEASE) {
  return new Request(`https://worker.example.test/musicbrainz/release-context?release_mbid=${encodeURIComponent(mbid)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function withFetch(mock, operation) {
  const previous = global.fetch;
  global.fetch = mock;
  try { return await operation(); } finally { global.fetch = previous; }
}

test('MusicBrainz Worker route requires browser role', async () => {
  const worker = loadWorker();
  assert.equal((await worker.fetch(request(null), env)).status, 401);
  assert.equal((await worker.fetch(request(env.AUTOMATION_TOKEN), env)).status, 403);
});

test('MusicBrainz Worker route rejects invalid release IDs before provider access', async () => {
  const worker = loadWorker();
  let providerCalls = 0;
  const response = await withFetch(async () => {
    providerCalls += 1;
    throw new Error('must not run');
  }, () => worker.fetch(request(env.BROWSER_TOKEN, '../not-an-mbid'), env));
  assert.equal(response.status, 400);
  assert.equal(providerCalls, 0);
});

test('MusicBrainz Worker route requests exact release context and returns sanitized identity only', async () => {
  const worker = loadWorker();
  let providerUrl;
  let providerHeaders;
  const response = await withFetch(async (url, options) => {
    providerUrl = new URL(String(url));
    providerHeaders = options.headers;
    return new Response(JSON.stringify({
      id: RELEASE,
      title: 'Provider title must not be returned',
      'release-group': { id: GROUP, title: 'Provider group title must not be returned' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, () => worker.fetch(request(env.BROWSER_TOKEN), env));

  assert.equal(response.status, 200);
  assert.equal(providerUrl.pathname, `/ws/2/release/${RELEASE}`);
  assert.equal(providerUrl.searchParams.get('inc'), 'release-groups');
  assert.equal(providerUrl.searchParams.get('fmt'), 'json');
  assert.match(providerHeaders['User-Agent'], /^BANDMARKR\/104 /);
  assert.deepEqual(await response.json(), { releaseMbid: RELEASE, releaseGroupMbid: GROUP });
});

test('MusicBrainz Worker route fails closed on mismatched, malformed and rate-limited provider responses', async () => {
  const worker = loadWorker();

  const mismatch = await withFetch(
    async () => new Response(JSON.stringify({ id: GROUP, 'release-group': { id: GROUP } }), { status: 200 }),
    () => worker.fetch(request(env.BROWSER_TOKEN), env),
  );
  assert.equal(mismatch.status, 502);

  const malformed = await withFetch(
    async () => new Response('{bad json', { status: 200 }),
    () => worker.fetch(request(env.BROWSER_TOKEN), env),
  );
  assert.equal(malformed.status, 502);

  const limited = await withFetch(
    async () => new Response('slow down', { status: 429 }),
    () => worker.fetch(request(env.BROWSER_TOKEN), env),
  );
  assert.equal(limited.status, 503);
});
