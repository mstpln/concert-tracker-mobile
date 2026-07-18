'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Tickets = require('../ownedTickets.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

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

test('optional cache helpers convert IndexedDB failures into safe cache states', async () => {
  const pdf = new Blob(['%PDF-1.7 cached'], { type: 'application/pdf' });
  assert.equal((await Tickets.readCachedPdf('concert-1', 'ticket-1', async () => pdf)).state, 'cached');
  const unavailableRead = await Tickets.readCachedPdf('concert-1', 'ticket-1', async () => { throw new Error('blocked'); });
  assert.deepEqual(unavailableRead, { blob: null, state: 'unavailable', cacheError: true });
  assert.deepEqual(await Tickets.writeCachedPdf('concert-1', 'ticket-1', pdf, async () => { throw new Error('full'); }), { cached: false, state: 'unavailable', cacheError: true });
  assert.deepEqual(await Tickets.removeCachedPdf('concert-1', 'ticket-1', async () => { throw new Error('blocked'); }), { removed: false, cacheError: true });
  assert.deepEqual(await Tickets.removeCachedConcert('concert-1', async () => { throw new Error('blocked'); }), { removed: false, cacheError: true });
});

test('upload finalization saves permanent metadata before optional caching and cleans up on metadata failure', async () => {
  const order = [];
  const cache = await Tickets.finalizeUploadedPdf({
    saveMetadata: async () => { order.push('metadata'); },
    writeCache: async () => { order.push('cache'); return { cached: true, state: 'cached', cacheError: false }; },
    cleanupRemote: async () => { order.push('remote-cleanup'); }, cleanupCache: async () => { order.push('cache-cleanup'); },
  });
  assert.deepEqual(order, ['metadata', 'cache']);
  assert.equal(cache.cached, true);
  const cleanup = [];
  await assert.rejects(Tickets.finalizeUploadedPdf({
    saveMetadata: async () => { throw new Error('JSON save failed'); }, writeCache: async () => { throw new Error('must not cache'); },
    cleanupRemote: async () => { cleanup.push('remote'); }, cleanupCache: async () => { cleanup.push('cache'); },
  }), /JSON save failed/);
  assert.deepEqual(cleanup.sort(), ['cache', 'remote']);
});

test('metadata-first deletion keeps metadata removed after remote or cache cleanup failures', async () => {
  const order = [];
  const result = await Tickets.removePdfAfterMetadataSave({
    saveMetadata: async () => { order.push('metadata'); },
    cleanupRemote: async () => { order.push('remote'); throw new Error('R2 unavailable'); },
    cleanupCache: async () => { order.push('cache'); return { removed: false, cacheError: true }; },
  });
  assert.deepEqual(order, ['metadata', 'remote', 'cache']);
  assert.match(result.remoteError.message, /R2 unavailable/);
  const targeted = [];
  const whole = await Tickets.removeConcertAfterMetadataSave({
    saveMetadata: async () => { targeted.push('metadata'); },
    pdfTickets: [{ id: 'ticket-1' }, { id: 'ticket-2' }],
    cleanupRemote: async (item) => { targeted.push(item.id); if (item.id === 'ticket-2') throw new Error('R2 failure'); },
    cleanupCache: async () => { targeted.push('cache'); return { removed: false, cacheError: true }; },
  });
  assert.deepEqual(targeted, ['metadata', 'ticket-1', 'ticket-2', 'cache']);
  assert.equal(whole.failures.length, 1);
});

test('opening a cached PDF uses one synchronous popup and no network request', async () => {
  const pdf = new Blob(['%PDF-1.7 cached'], { type: 'application/pdf' });
  const calls = []; let destination = '';
  const popup = { closed: false, opener: 'app', document: { write() {}, close() {} }, location: { set href(value) { destination = value; } } };
  const result = await Tickets.openPdf({ endpoint: 'https://worker.example', token: 'secret' }, 'concert-1', 'ticket-1', {
    openWindow: (...args) => { calls.push(args); return popup; },
    readCache: async () => ({ blob: pdf, state: 'cached', cacheError: false }),
    fetchImpl: async () => { throw new Error('network must not run'); },
    urlApi: { createObjectURL: () => 'blob:cached', revokeObjectURL() {} }, setTimeout() {},
  });
  assert.deepEqual(calls, [['about:blank', '_blank']]);
  assert.equal(popup.opener, null);
  assert.equal(destination, 'blob:cached');
  assert.deepEqual(result, { source: 'cache', fetchedRemotely: false, cacheState: 'cached', cacheWriteFailed: false, popupOpened: true, fallbackUsed: false });
});

test('remote PDF opens when cache is unavailable, and a blocked popup uses the current-tab fallback', async () => {
  let fallback = ''; let opens = 0;
  const result = await Tickets.openPdf({ endpoint: 'https://worker.example', token: 'secret' }, 'concert-1', 'ticket-1', {
    openWindow: () => { opens += 1; return null; },
    readCache: async () => ({ blob: null, state: 'unavailable', cacheError: true }),
    writeCache: async () => ({ cached: false, state: 'unavailable', cacheError: true }),
    fetchImpl: async () => new Response('%PDF-1.7 remote', { headers: { 'Content-Type': 'application/pdf' } }),
    navigateFallback: (url) => { fallback = url; },
    urlApi: { createObjectURL: () => 'blob:remote', revokeObjectURL() {} }, setTimeout() {},
  });
  assert.equal(opens, 1);
  assert.equal(fallback, 'blob:remote');
  assert.deepEqual(result, { source: 'remote', fetchedRemotely: true, cacheState: 'unavailable', cacheWriteFailed: true, popupOpened: false, fallbackUsed: true });
});

test('a failed PDF load closes its temporary destination and does not report a cached result', async () => {
  let closed = false;
  const popup = { closed: false, opener: null, document: { write() {}, close() {} }, location: {}, close() { closed = true; } };
  await assert.rejects(
    Tickets.openPdf({ endpoint: 'https://worker.example', token: 'secret' }, 'concert-1', 'ticket-1', {
      openWindow: () => popup,
      readCache: async () => ({ blob: null, state: 'missing', cacheError: false }),
      fetchImpl: async () => { throw new Error('offline'); },
      urlApi: { createObjectURL() { throw new Error('not reached'); }, revokeObjectURL() {} }, setTimeout() {},
    }),
    (error) => error.message === 'Network unavailable. Try again when you are online.' && error.openResult.source === null && error.openResult.cacheState === 'missing',
  );
  assert.equal(closed, true);
});

test('Ticket cost form is scoped for aligned preparation fields and past cards reuse the same Ticket panel', () => {
  assert.match(app, /const rows = \[\n    \['ticket', 'ticket', 'Ticket', ticketPrepSummaryHtml\(c\), ticketPreparationPanelHtml\(c\)\],\n    \['playlist'/);
  assert.match(app, /\$\{isPast \? pastConcertDetailsGroupHtml\(c\) : concertPrepGroupHtml\(c\)\}/);
  assert.match(app, /pastDetailRowHtml\(c, 'ticket', 'ticket', 'Ticket', ticketPrepSummaryHtml\(c\), ticketPreparationPanelHtml\(c\), \{ statusHtml: true \}\)/);
  assert.match(app, /<strong>My ticket<\/strong><p>Upload a ticket PDF for offline access, or save a link to your mobile ticket\.<\/p>/);
  assert.match(app, /<div class="ticket-cost-form\$\{inPreparation \? ' ticket-cost-form-preparation' : ''\}">/);
  assert.match(app, /\$\{inPreparation \? 'Price per ticket' : 'Price'\}/);
  assert.match(app, /<span class="review-cost-label">Tickets<\/span>/);
  assert.doesNotMatch(app, /Number of tickets/);
  assert.doesNotMatch(app, /Optional label|Rename ticket|ticket-name-input/);
});

test('PDF Open actions are ordered in the shared action row while PDF item rows retain only Remove', () => {
  const itemStart = app.indexOf('function ownedTicketItemHtml');
  const itemEnd = app.indexOf('function ticketOwnedPanelHtml', itemStart);
  const itemHtml = app.slice(itemStart, itemEnd);
  assert.match(itemHtml, /item\.type === 'pdf'\n    \? `<button[^`]*ticket-remove-btn/);
  assert.doesNotMatch(itemHtml, /item\.type === 'pdf'[\s\S]*ticket-pdf-open-btn/);
  assert.match(itemHtml, /ticket-link-edit-btn[\s\S]*ticket-remove-btn/);
  const panelStart = app.indexOf('function ticketOwnedPanelHtml');
  const panelEnd = app.indexOf('function ticketPreparationPanelHtml', panelStart);
  const panelHtml = app.slice(panelStart, panelEnd);
  assert.match(panelHtml, /const pdfOpenButtons = items\.filter\(\(item\) => item\.type === 'pdf'\)\.map/);
  assert.match(panelHtml, /class="btn-primary ticket-pdf-open-btn owned-ticket-open-btn"[^`]*>Open \$\{escapeHtml\(item\.displayName\)\}<\/button>/);
  assert.ok(panelHtml.indexOf('${pdfOpenButtons}') < panelHtml.indexOf('ticket-pdf-select-btn'));
  assert.ok(panelHtml.indexOf('ticket-pdf-select-btn') < panelHtml.indexOf('ticket-link-add-btn'));
  assert.match(app, /OwnedTickets\.openPdf\(remote, btn\.dataset\.concertId, btn\.dataset\.ticketId\)/);
});

test('Ticket panel CSS scopes the aligned grid and keeps primary open buttons distinct from per-item removal', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
  assert.match(css, /\.ticket-cost-form-preparation \.review-cost-row \{\n  display: grid; grid-template-columns: minmax\(0, 1fr\) 112px;/);
  assert.match(css, /\.ticket-cost-form-preparation \.review-cost-label \{ white-space: nowrap; \}/);
  assert.match(css, /@media \(max-width: 360px\) \{\n  \.ticket-cost-form-preparation \.review-cost-row \{ grid-template-columns: minmax\(0, 1fr\) 104px;/);
  assert.match(css, /\.owned-ticket-open-btn \{ white-space: nowrap; \}/);
  assert.match(css, /\.owned-ticket-item-actions \.btn-secondary \{ margin: 0; padding: 6px 8px; font-size: 11\.5px; \}/);
});

test('ticket metadata changes merge latest concert records and leave public ticketUrl and cost data independent', () => {
  assert.match(app, /async function patchLatestConcert\(concertId, patch\)/);
  assert.match(app, /ownedTickets: \[\.\.\.OwnedTickets\.orderedTickets\(latest\.ownedTickets\), metadata\]/);
  assert.match(app, /ticketPrice, ticketQuantity:/);
  assert.match(app, /exportConcertRows\(rows\)/);
  const upload = app.indexOf('const metadata = await OwnedTickets.uploadPdf');
  const metadataSave = app.indexOf('saveMetadata: () => patchLatestConcert(concertId, (latest) => ({ ...latest, ownedTickets:', upload);
  const cacheWrite = app.indexOf('writeCache: () => OwnedTickets.writeCachedPdf', upload);
  assert.ok(upload >= 0 && metadataSave > upload && cacheWrite > metadataSave, 'remote upload, then metadata save, then optional cache write');
  assert.match(app, /OwnedTickets\.finalizeUploadedPdf\(/);
  assert.match(app, /OwnedTickets\.openPdf\(remote, btn\.dataset\.concertId, btn\.dataset\.ticketId\)/);
  assert.match(app, /OwnedTickets\.removePdfAfterMetadataSave\(/);
  assert.match(app, /const failures = await removeManuallyAddedConcert\(concertId\);/);
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

test('release shell includes owned-ticket code and keeps the v64 cache pair synchronized', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const version = fs.readFileSync(path.join(__dirname, '..', 'version.js'), 'utf8');
  assert.match(index, /<script src="ownedTickets\.js"><\/script>/);
  assert.match(sw, /'\.\/ownedTickets\.js'/);
  assert.match(sw, /CACHE_NAME_LITERAL = 'v64'/);
  assert.match(version, /APP_VERSION = 'v64'/);
});

test('show-day ticket actions open a saved link directly and expose at most four PDF tickets', () => {
  const showDayStart = app.indexOf('function showDayTicketActionsHtml');
  const showDayEnd = app.indexOf('function countdownCardHtml', showDayStart);
  const showDay = app.slice(showDayStart, showDayEnd);

  assert.match(showDay, /OwnedTickets\.orderedTickets\(concert\.ownedTickets\)/);
  assert.match(showDay, /filter\(\(item\) => item\.type === 'pdf'\)\.slice\(0, 4\)/);
  assert.match(showDay, /tickets\.find\(\(item\) => item\.type === 'url'\)/);
  assert.match(showDay, /href="\$\{escapeAttr\(link\.url\)\}"/);
  assert.match(showDay, /countdown-pdf-open-btn/);
  assert.match(showDay, /Ticket \$\{index \+ 1\}/);
  assert.match(app, /\$\{showDayTicketActionsHtml\(nextConcert\)\}/);
  assert.match(app, /OwnedTickets\.openPdf\(remote, btn\.dataset\.concertId, btn\.dataset\.ticketId\)/);
  assert.match(css, /\.countdown-ticket-actions-multiple \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.countdown-ticket-actions-multiple \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
