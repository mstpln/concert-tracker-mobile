'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
function worker() { const source = fs.readFileSync('worker.js', 'utf8').replace('export default {', 'globalThis.worker = {'); const context = { Response, Request, URL, TextDecoder, globalThis: {} }; vm.runInNewContext(source, context); return context.globalThis.worker; }
function bucket(values) { return { async get(key) { return key in values ? { body: values[key], text: async () => values[key] } : null; }, async put() {}, async delete() {} }; }
test('read-only token can access only sanitized qa smoke', async () => {
  const api = worker(); const env = { API_TOKEN: 'write-token', READ_ONLY_TOKEN: 'read-token', BUCKET: bucket({ 'bands.json': '[]', 'concerts.json': '[]', 'news.json': '[]', 'apiUsage.json': '{}' }) };
  const smoke = await api.fetch(new Request('https://worker.test/qa-smoke', { headers: { Authorization: 'Bearer read-token' } }), env); const body = await smoke.json(); assert.equal(smoke.status, 200); assert.deepEqual(Object.keys(body.files).sort(), ['apiUsage.json','bands.json','concerts.json','news.json']); assert.equal(JSON.stringify(body).includes('write-token'), false);
  for (const request of [new Request('https://worker.test/bands.json', { headers: { Authorization: 'Bearer read-token' } }), new Request('https://worker.test/concerts.json', { method: 'PUT', headers: { Authorization: 'Bearer read-token' }, body: '[]' }), new Request('https://worker.test/ticket-files/a/b.pdf', { headers: { Authorization: 'Bearer read-token' } })]) assert.equal((await api.fetch(request, env)).status, 401);
  assert.equal((await api.fetch(new Request('https://worker.test/qa-smoke', { headers: { Authorization: 'Bearer write-token' } }), env)).status, 200);
});
test('qa smoke returns sanitized failures for malformed or missing data', async () => {
  const api = worker(); const env = { READ_ONLY_TOKEN: 'read-token', BUCKET: bucket({ 'bands.json': 'not-json', 'concerts.json': '[]', 'news.json': '[]' }) }; const response = await api.fetch(new Request('https://worker.test/qa-smoke', { headers: { Authorization: 'Bearer read-token' } }), env); const body = await response.json(); assert.equal(response.status, 503); assert.equal(body.files['bands.json'].reason, 'invalid'); assert.equal(body.files['apiUsage.json'].reason, 'missing');
});
