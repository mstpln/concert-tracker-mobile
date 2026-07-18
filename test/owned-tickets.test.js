'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Tickets = require('../ownedTickets.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function ticket(id, type, extra = {}) { return { id, type, addedAt: extra.addedAt || `2026-07-18T00:00:0${id.slice(-1)}.000Z`, ...(type === 'pdf' ? { sizeBytes: 100 } : { url: 'https://tickets.example/item' }), ...extra }; }

function workerUnderTest() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8').replace('export default {', 'globalThis.worker = {');
  const context = { Response, Request, URL, TextDecoder, globalThis: {} };
  vm.runInNewContext(source, context);
  return context.globalThis.worker;
}

function bucket() {
  const items = new Map();
  return {
    items,
    async get(key) { const value = items.get(key); return value ? { body: value } : null; },
    async put(key, value) { items.set(key, value); },
    async delete(key) { items.delete(key); },
  };
}

test('owned-ticket summaries cover empty, PDFs, links, mixed tickets, and generated names', () => {
  assert.equal(Tickets.statusLabel([]), 'Add PDF or ticket link');
  assert.equal(Tickets.statusLabel([ticket('pdf-1', 'pdf')]), 'PDF saved');
  assert.equal(Tickets.statusLabel([ticket('pdf-1', 'pdf'), ticket('pdf-2', 'pdf')]), '2 PDFs saved');
  assert.equal(Tickets.statusLabel([ticket('url-1', 'url')]), 'ticket link saved');
  assert.equal(Tickets.statusLabel([ticket('url-1', 'url'), ticket('url-2', 'url')]), '2 ticket links saved');
  assert.equal(Tickets.statusLabel([ticket('pdf-1', 'pdf'), ticket('url-1', 'url')]), 'PDF + ticket link saved');
  assert.deepEqual(Tickets.ticketNames([ticket('pdf-2', 'pdf'), ticket('url-1', 'url'), ticket('pdf-1', 'pdf')]).map((item) => item.displayName), ['Ticket 1', 'Ticket link', 'Ticket 2']);
});

test('owned-ticket metadata is additive, validates secure URLs, and ignores malformed records', () => {
  assert.equal(Tickets.safeUrl('https://secure.example/ticket'), 'https://secure.example/ticket');
  assert.equal(Tickets.safeUrl('http://secure.example/ticket'), null);
  assert.equal(Tickets.safeUrl('javascript:alert(1)'), null);
  assert.deepEqual(Tickets.normalizedTickets([ticket('pdf-1', 'pdf'), { id: '../bad', type: 'pdf', addedAt: 'x', sizeBytes: 1 }, { id: 'url-1', type: 'url', addedAt: 'x', url: 'javascript:bad' }]).map((item) => item.id), ['pdf-1']);
});

test('PDF client validation rejects MIME/signature/size failures before upload and uploads valid metadata', async () => {
  const wrongMime = new Blob(['%PDF-valid'], { type: 'text/plain' });
  await assert.rejects(Tickets.validatePdf(wrongMime), /Choose a PDF/);
  const fakePdf = new Blob(['not a PDF'], { type: 'application/pdf' });
  await assert.rejects(Tickets.validatePdf(fakePdf), /not a valid PDF/);
  const tooLarge = new Blob([new Uint8Array(Tickets.MAX_PDF_BYTES + 1)], { type: 'application/pdf' });
  await assert.rejects(Tickets.validatePdf(tooLarge), /10 MB/);
  const valid = new Blob(['%PDF-1.7 test'], { type: 'application/pdf' });
  const calls = [];
  const metadata = await Tickets.uploadPdf({ endpoint: 'https://worker.example', token: 'private-token' }, 'concert-1', 'ticket-1', valid, async (url, init) => { calls.push({ url, init }); return new Response('OK'); });
  assert.equal(metadata.type, 'pdf');
  assert.equal(metadata.sizeBytes, valid.size);
  assert.equal(calls[0].url, 'https://worker.example/ticket-files/concert-1/ticket-1.pdf');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer private-token');
});

test('ticket PDF fetch/delete use only authenticated private endpoints and reject malformed downloaded files', async () => {
  const remote = { endpoint: 'https://worker.example/', token: 'private-token' };
  const calls = [];
  const blob = await Tickets.fetchPdf(remote, 'concert-1', 'ticket-1', async (url, init) => { calls.push({ url, init }); return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }); });
  assert.equal(await blob.text(), '%PDF-1.7');
  await Tickets.deletePdf(remote, 'concert-1', 'ticket-1', async (url, init) => { calls.push({ url, init }); return new Response('OK'); });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer private-token');
  assert.equal(calls[1].init.method, 'DELETE');
  await assert.rejects(Tickets.fetchPdf(remote, 'concert-1', 'ticket-1', async () => new Response('not a PDF', { headers: { 'Content-Type': 'application/pdf' } })), /not a valid PDF/);
});

test('upcoming Ticket row is first while past ticket-cost presentation remains intact', () => {
  assert.match(app, /const rows = \[\n    \['ticket', 'ticket', 'Ticket', ticketPrepSummaryHtml\(c\), ticketPreparationPanelHtml\(c\)\],\n    \['playlist'/);
  assert.match(app, /\$\{isPast \? ticketCostBlockHtml\(c\) : ''\}/);
  assert.match(app, /\$\{isPast \? mcLinksRowHtml\(c, true\) : concertPrepGroupHtml\(c\)\}/);
  assert.match(app, /<strong>My ticket<\/strong><p>Upload a ticket PDF for offline access, or save a link to your mobile ticket\.<\/p>/);
  assert.doesNotMatch(app, /Optional label|Rename ticket|ticket-name-input/);
});

test('ticket metadata changes merge latest concert records and leave public ticketUrl and cost data independent', () => {
  assert.match(app, /async function patchLatestConcert\(concertId, patch\)/);
  assert.match(app, /ownedTickets: \[\.\.\.OwnedTickets\.orderedTickets\(latest\.ownedTickets\), metadata\]/);
  assert.match(app, /ticketPrice, ticketQuantity:/);
  assert.match(app, /exportConcertRows\(rows\)/);
  assert.match(app, /cleanupDeletedConcertTickets\(c\)/);
  assert.match(app, /OwnedTickets\.cachePut\(concertId, ticketId, file\)/);
  assert.match(app, /OwnedTickets\.openPdf\(remote, btn\.dataset\.concertId, btn\.dataset\.ticketId\)/);
});

test('Worker preserves JSON routes and secures private ticket PDF routes', async () => {
  const worker = workerUnderTest(); const store = bucket(); const env = { API_TOKEN: 'secret', BUCKET: store };
  const auth = { Authorization: 'Bearer secret' };
  const json = await worker.fetch(new Request('https://worker.test/concerts.json', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: '[]' }), env);
  assert.equal(json.status, 200);
  const unauthorized = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf'), { BUCKET: store, API_TOKEN: 'secret' });
  assert.equal(unauthorized.status, 401);
  const traversal = await worker.fetch(new Request('https://worker.test/ticket-files/../secret.pdf', { headers: auth }), env);
  assert.equal(traversal.status, 404);
  const fake = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: 'not pdf' }), env);
  assert.equal(fake.status, 400);
  const wrongMime = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/plain' }, body: '%PDF-1.7' }), env);
  assert.equal(wrongMime.status, 400);
  const uploaded = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: '%PDF-1.7' }), env);
  assert.equal(uploaded.status, 200);
  const downloaded = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { headers: auth }), env);
  assert.equal(downloaded.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(downloaded.headers.get('Content-Type'), 'application/pdf');
  const deleted = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'DELETE', headers: auth }), env);
  assert.equal(deleted.status, 200);
  const cors = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'OPTIONS' }), env);
  assert.match(cors.headers.get('Access-Control-Allow-Methods'), /DELETE/);
});

test('Worker rejects oversized ticket PDFs and keeps private paths separate from the JSON allowlist', async () => {
  const worker = workerUnderTest(); const store = bucket(); const env = { API_TOKEN: 'secret', BUCKET: store }; const auth = { Authorization: 'Bearer secret', 'Content-Type': 'application/pdf' };
  const oversized = new Uint8Array(10 * 1024 * 1024 + 1); oversized.set(new TextEncoder().encode('%PDF-'));
  const response = await worker.fetch(new Request('https://worker.test/ticket-files/concert-1/ticket-1.pdf', { method: 'PUT', headers: auth, body: oversized }), env);
  assert.equal(response.status, 413);
  const unknown = await worker.fetch(new Request('https://worker.test/not-allowed.json', { headers: { Authorization: 'Bearer secret' } }), env);
  assert.equal(unknown.status, 404);
});

test('release shell includes owned-ticket code and keeps the v56 cache pair synchronized', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const version = fs.readFileSync(path.join(__dirname, '..', 'version.js'), 'utf8');
  assert.match(index, /<script src="ownedTickets\.js"><\/script>/);
  assert.match(sw, /'\.\/ownedTickets\.js'/);
  assert.match(sw, /CACHE_NAME_LITERAL = 'v56'/);
  assert.match(version, /APP_VERSION = 'v56'/);
});
