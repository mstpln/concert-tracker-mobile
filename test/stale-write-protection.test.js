'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const merge = require('../conflictMerge');

function workerUnderTest() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8').replace('export default {', 'globalThis.worker = {');
  const context = { Response, Request, URL, Headers, TextDecoder, globalThis: {} };
  vm.runInNewContext(source, context);
  return context.globalThis.worker;
}

function conditionalBucket(initial = {}) {
  const items = new Map();
  let version = 0;
  for (const [key, value] of Object.entries(initial)) items.set(key, { value, etag: `seed-${++version}` });
  const object = (entry) => entry ? {
    body: entry.value,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    text: async () => String(entry.value),
  } : null;
  return {
    items,
    async get(key) { return object(items.get(key)); },
    async head(key) { return object(items.get(key)); },
    async put(key, value, options = {}) {
      const current = items.get(key);
      const condition = options.onlyIf;
      if (condition instanceof Headers || typeof condition?.get === 'function') {
        throw new TypeError('R2 onlyIf must use the conditional object shape');
      }
      if (condition?.etagMatches && (!current || current.etag !== condition.etagMatches)) return null;
      if (condition?.etagDoesNotMatch === '*' && current) return null;
      const entry = { value, etag: `etag-${++version}` };
      items.set(key, entry);
      return object(entry);
    },
    async delete(key) { items.delete(key); },
  };
}

test('three-way merge preserves unrelated remote fields while applying local user changes', () => {
  const base = [{ id: 'band-1', favorite: false, provider: { status: 'pending' }, futureField: { keep: true } }];
  const local = [{ id: 'band-1', favorite: true, provider: { status: 'pending' }, futureField: { keep: true } }];
  const remote = [{ id: 'band-1', favorite: false, provider: { status: 'confirmed', id: 'provider-1' }, futureField: { keep: true }, newField: 42 }];
  assert.deepEqual(merge.merge(base, local, remote), [{
    id: 'band-1', favorite: true, provider: { status: 'confirmed', id: 'provider-1' }, futureField: { keep: true }, newField: 42,
  }]);
});

test('stable-id arrays preserve remote additions and protect remotely changed records from stale deletion', () => {
  const base = [{ id: 'a', note: 'old' }, { id: 'b', note: 'unchanged' }];
  const local = [{ id: 'b', note: 'local' }, { id: 'c', note: 'added locally' }];
  const remote = [{ id: 'a', note: 'updated remotely' }, { id: 'b', note: 'unchanged', provider: true }, { id: 'd', note: 'added remotely' }];
  assert.deepEqual(merge.merge(base, local, remote), [
    { id: 'a', note: 'updated remotely' },
    { id: 'b', note: 'local', provider: true },
    { id: 'd', note: 'added remotely' },
    { id: 'c', note: 'added locally' },
  ]);
});

test('Worker exposes ETags and uses the production R2 conditional object shape', async () => {
  const worker = workerUnderTest();
  const store = conditionalBucket({ 'bands.json': '[{"id":"band-1"}]' });
  const env = { API_TOKEN: 'secret', BUCKET: store };
  const auth = { Authorization: 'Bearer secret' };

  const read = await worker.fetch(new Request('https://worker.test/bands.json', { headers: auth }), env);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('ETag'), '"seed-1"');

  const firstWrite = await worker.fetch(new Request('https://worker.test/bands.json', {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': '"seed-1"' },
    body: '[{"id":"band-1","favorite":true}]',
  }), env);
  assert.equal(firstWrite.status, 200);
  assert.equal(firstWrite.headers.get('ETag'), '"etag-2"');

  const staleWrite = await worker.fetch(new Request('https://worker.test/bands.json', {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json', 'If-Match': '"seed-1"' },
    body: '[{"id":"band-1","favorite":false}]',
  }), env);
  assert.equal(staleWrite.status, 412);
  assert.equal(store.items.get('bands.json').value, '[{"id":"band-1","favorite":true}]');
});

test('Worker allows first creation but blocks unconditional overwrite of an existing document', async () => {
  const worker = workerUnderTest();
  const store = conditionalBucket();
  const env = { API_TOKEN: 'secret', BUCKET: store };
  const headers = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

  const create = await worker.fetch(new Request('https://worker.test/news.json', { method: 'PUT', headers, body: '[]' }), env);
  assert.equal(create.status, 200);
  const overwrite = await worker.fetch(new Request('https://worker.test/news.json', { method: 'PUT', headers, body: '[]' }), env);
  assert.equal(overwrite.status, 428);
});

test('browser and automation clients retain read versions and retry one conflict through the shared merge helper', () => {
  const browser = fs.readFileSync(path.join(__dirname, '..', 'remoteStore.js'), 'utf8');
  const automation = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'workerClient.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');

  assert.match(browser, /RS_DOCUMENT_STATE/);
  assert.match(browser, /headers\['If-Match'\] = state\.etag/);
  assert.match(browser, /res\.status === 412/);
  assert.match(browser, /LiveVaultConflictMerge\.merge\(base, intended, latest\)/);
  assert.match(automation, /documentState/);
  assert.match(automation, /headers\['If-Match'\] = state\.etag/);
  assert.match(automation, /conflictMerge\.merge\(base, intended, latest\)/);
  assert.ok(index.indexOf('<script src="conflictMerge.js"></script>') < index.indexOf('<script src="remoteStore.js"></script>'));
  assert.match(sw, /'\.\/conflictMerge\.js'/);
  assert.match(sw, /CACHE_NAME_LITERAL = 'v76'/);
});
