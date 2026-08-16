'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const privacy = require('../devicePrivacy');
const browserPolicy = require('../browserFetchPolicy');
const networkPolicy = require('../scripts/lib/networkPolicy');

function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function workerUnderTest() {
  const code = source('worker.js').replace('export default {', 'globalThis.worker = {');
  const context = { Response, Request, URL, TextDecoder, AbortController, setTimeout, clearTimeout, globalThis: {} };
  vm.runInNewContext(code, context);
  return context.globalThis.worker;
}
function bucket() {
  const activity = JSON.stringify({ kind: 'livevault-listening-band-activity', schemaVersion: 1, generatedAt: '2026-08-16T12:00:00.000Z', catalogueFingerprint: 'fnv1a32:1234abcd', mappedListenCount: 0, sourceLastListenedAt: null, records: {} });
  const items = new Map([
    ['bands.json', { value: '[]', etag: 'bands-1' }],
    ['concerts.json', { value: '[]', etag: 'concerts-1' }],
    ['news.json', { value: '[]', etag: 'news-1' }],
    ['apiUsage.json', { value: '{}', etag: 'usage-1' }],
    ['listening/band-activity.json', { value: activity, etag: 'activity-1' }],
  ]);
  const object = (entry) => entry && ({ body: entry.value, text: async () => entry.value, etag: entry.etag, httpEtag: `"${entry.etag}"` });
  return {
    async get(key) { return object(items.get(key)); },
    async head(key) { return object(items.get(key)); },
    async put(key, value) { const entry = { value: String(value), etag: `${key}-next` }; items.set(key, entry); return object(entry); },
    async delete(key) { items.delete(key); },
  };
}

test('disconnect removes only the Worker connection', () => {
  const calls = [];
  privacy.disconnectDevice({ clearConnection: () => calls.push('connection'), reload: () => calls.push('reload') });
  assert.deepEqual(calls, ['connection', 'reload']);
});

test('erase removes local credentials, source, derived and review stores, identity progress, and only Live Vault shell caches', async () => {
  const calls = [];
  const storage = { removeItem: (key) => calls.push(`storage:${key}`) };
  const cacheStorage = {
    async keys() { return ['concert-tracker-shell-v75', 'concert-tracker-qa-test', 'other-app']; },
    async delete(key) { calls.push(`cache:${key}`); return true; },
  };
  await privacy.eraseDevice({
    clearSpotify: async () => calls.push('spotify'),
    clearHistory: async () => calls.push('history'),
    clearTickets: async () => calls.push('tickets'),
    clearDerivedListening: async () => calls.push('derived-listening'),
    clearReviewListening: async () => calls.push('review-listening'),
    clearConnection: () => calls.push('connection'), storage, cacheStorage,
    reload: () => calls.push('reload'),
  });
  assert.ok(calls.includes('spotify') && calls.includes('history') && calls.includes('tickets'));
  assert.ok(calls.includes('derived-listening'));
  assert.ok(calls.includes('review-listening'));
  assert.equal(privacy.DERIVED_LISTENING_DB_NAME, 'bandmarkr-listening-derived-v1');
  assert.equal(privacy.REVIEW_LISTENING_DB_NAME, 'bandmarkr-listening-review-v1');
  assert.equal(privacy.LISTENING_IDENTITY_CURSOR_KEY, 'bandmarkrListeningIdentityV104Cursor');
  assert.ok(calls.includes('connection'));
  assert.ok(calls.includes('storage:concertTrackerSettings'));
  assert.ok(calls.includes('storage:bandmarkr-listening-canonical-activation-v1'));
  assert.ok(calls.includes('storage:bandmarkrListeningIdentityV104Cursor'));
  assert.ok(calls.includes('cache:concert-tracker-shell-v75'));
  assert.ok(!calls.includes('cache:concert-tracker-qa-test'));
  assert.ok(!calls.includes('cache:other-app'));
  assert.equal(calls.at(-1), 'reload');
});

test('browser and Node fetch policies add bounded abort signals without retrying', async () => {
  for (const policy of [browserPolicy, networkPolicy]) {
    let calls = 0;
    const target = {
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async (_input, init) => { calls += 1; assert.ok(init.signal); return new Response('ok'); },
    };
    const wrapped = policy.install(target, { timeoutMs: 1000 });
    const response = await wrapped('https://example.test');
    assert.equal(await response.text(), 'ok');
    assert.equal(calls, 1);
  }
});

test('Worker separates browser and automation roles while retaining staged legacy access', async () => {
  const worker = workerUnderTest();
  const env = { BROWSER_TOKEN: 'browser', AUTOMATION_TOKEN: 'automation', API_TOKEN: 'legacy', READ_ONLY_TOKEN: 'smoke', BUCKET: bucket() };
  const get = (path, token) => worker.fetch(new Request(`https://worker.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);

  assert.equal((await get('/bands.json', 'browser')).status, 200);
  assert.equal((await get('/bands.json', 'automation')).status, 200);
  assert.equal((await get('/bands.json', 'legacy')).status, 200);
  assert.equal((await get('/ticket-files/show-1/ticket-1.pdf', 'automation')).status, 403);
  assert.equal((await get('/listening/band-activity.json', 'automation')).status, 200);
  assert.equal((await get('/listening/manifest.json', 'automation')).status, 403);
  assert.equal((await get('/listening/spotify-history/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json.gz', 'automation')).status, 403);
  assert.equal((await worker.fetch(new Request('https://worker.test/listening/band-activity.json', { method: 'PUT', headers: { Authorization: 'Bearer automation', 'Content-Type': 'application/json', 'If-Match': '"activity-1"' }, body: '{}' }), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://worker.test/listening/band-activity.json', { method: 'PUT', headers: { Authorization: 'Bearer browser', 'Content-Type': 'application/json', 'If-Match': '"activity-1"' }, body: '{}' }), env)).status, 400);
  const emptyActivity = { kind: 'livevault-listening-band-activity', schemaVersion: 1, generatedAt: '2026-08-16T12:00:00.000Z', catalogueFingerprint: 'fnv1a32:1234abcd', mappedListenCount: 0, sourceLastListenedAt: null, records: {} };
  assert.equal((await worker.fetch(new Request('https://worker.test/listening/band-activity.json', { method: 'PUT', headers: { Authorization: 'Bearer browser', 'Content-Type': 'application/json', 'If-Match': '"activity-1"' }, body: JSON.stringify(emptyActivity) }), env)).status, 200);
  assert.equal((await get('/ticket-files/show-1/ticket-1.pdf', 'browser')).status, 404);
  assert.equal((await get('/bands.json', 'smoke')).status, 401);
  assert.equal((await get('/qa-smoke', 'smoke')).status, 200);
});

test('shell and production workflow retain the approved security hardening', () => {
  const index = source('index.html');
  const sw = source('service-worker.js');
  const version = source('version.js');
  const workflow = source('.github/workflows/research.yml');
  const workerClient = source('scripts/lib/workerClient.js');
  const cacheVersion = sw.match(/^const CACHE_NAME_LITERAL = '([^']+)';/m)?.[1] || null;
  const appVersion = version.match(/^const APP_VERSION = '([^']+)';/m)?.[1] || null;

  assert.ok(index.indexOf('browserFetchPolicy.js') < index.indexOf('remoteStore.js'));
  assert.ok(index.indexOf('app.js') < index.indexOf('devicePrivacy.js'));
  assert.ok(appVersion);
  assert.equal(cacheVersion, appVersion);
  assert.match(sw, /browserFetchPolicy\.js/);
  assert.match(sw, /devicePrivacy\.js/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workerClient, /networkPolicy\.install\(globalThis\)/);
});
