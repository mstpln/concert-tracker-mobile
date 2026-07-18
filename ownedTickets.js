'use strict';
// Private, user-owned concert tickets. Metadata lives additively on a concert;
// PDF bytes stay in the authenticated Worker/R2 path and this device's
// IndexedDB cache, never in concerts.json, localStorage, or the app shell.
(function (global) {
  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const DB_NAME = 'live-vault-owned-tickets';
  const STORE_NAME = 'pdfs';

  function isSafeId(value) { return typeof value === 'string' && ID_RE.test(value); }
  function pdfKey(concertId, ticketId) { return `${concertId}:${ticketId}`; }
  function createId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
  function safeUrl(value) {
    try { const url = new URL(String(value || '').trim()); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
  }
  function validTicket(item) {
    if (!item || !isSafeId(item.id) || !['pdf', 'url'].includes(item.type) || !item.addedAt) return false;
    if (item.type === 'pdf') return Number.isInteger(item.sizeBytes) && item.sizeBytes > 0 && item.sizeBytes <= MAX_PDF_BYTES;
    return !!safeUrl(item.url);
  }
  function normalizedTickets(value) {
    return Array.isArray(value) ? value.filter(validTicket).map((item) => item.type === 'pdf'
      ? { id: item.id, type: 'pdf', addedAt: item.addedAt, sizeBytes: item.sizeBytes }
      : { id: item.id, type: 'url', url: safeUrl(item.url), addedAt: item.addedAt }) : [];
  }
  function orderedTickets(value) {
    return normalizedTickets(value).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)) || a.id.localeCompare(b.id));
  }
  function ticketNames(value) {
    let pdf = 0; let url = 0; const all = orderedTickets(value); const urlCount = all.filter((item) => item.type === 'url').length;
    return all.map((item) => {
      if (item.type === 'pdf') return { ...item, displayName: `Ticket ${++pdf}` };
      url += 1;
      return { ...item, displayName: urlCount === 1 ? 'Ticket link' : `Ticket link ${url}` };
    });
  }
  function statusLabel(value) {
    const tickets = orderedTickets(value); const pdfs = tickets.filter((item) => item.type === 'pdf').length; const links = tickets.length - pdfs;
    if (!tickets.length) return 'Add PDF or ticket link';
    const pdfLabel = pdfs === 1 ? 'PDF' : `${pdfs} PDFs`;
    const linkLabel = links === 1 ? 'ticket link' : `${links} ticket links`;
    if (pdfs && links) return `${pdfLabel} + ${linkLabel} saved`;
    return `${pdfs ? pdfLabel : linkLabel} saved`;
  }
  function summary(costLabel, tickets) { return [costLabel || 'Add ticket cost', statusLabel(tickets)].join(' · '); }
  function errorFor(response, fallback) {
    if (response.status === 401) return new Error('Unauthorized. Reconnect the app and try again.');
    if (response.status === 413) return new Error('PDFs must be 10 MB or smaller.');
    if (response.status === 400) return new Error('This file is not a valid PDF.');
    if (response.status === 404) return new Error('Ticket file not found.');
    return new Error(fallback || `Ticket request failed (${response.status}).`);
  }
  async function validatePdf(file) {
    if (!file || file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('The PDF is empty.');
    if (file.size > MAX_PDF_BYTES) throw new Error('PDFs must be 10 MB or smaller.');
    const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...bytes) !== '%PDF-') throw new Error('This file is not a valid PDF.');
    return file;
  }
  function fileUrl(remote, concertId, ticketId) {
    if (!isSafeId(concertId) || !isSafeId(ticketId)) throw new Error('Invalid ticket identifier.');
    return `${remote.endpoint.replace(/\/$/, '')}/ticket-files/${encodeURIComponent(concertId)}/${encodeURIComponent(ticketId)}.pdf`;
  }
  async function ticketRequest(remote, concertId, ticketId, options = {}, fetchImpl = global.fetch) {
    if (!remote?.endpoint || !remote?.token) throw new Error('No Worker connection is configured.');
    let response;
    try {
      response = await fetchImpl(fileUrl(remote, concertId, ticketId), { ...options, headers: { Authorization: `Bearer ${remote.token}`, ...(options.headers || {}) } });
    } catch { throw new Error('Network unavailable. Try again when you are online.'); }
    if (!response.ok) throw errorFor(response);
    return response;
  }
  async function uploadPdf(remote, concertId, ticketId, file, fetchImpl = global.fetch) {
    await validatePdf(file);
    await ticketRequest(remote, concertId, ticketId, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file }, fetchImpl);
    return { id: ticketId, type: 'pdf', addedAt: new Date().toISOString(), sizeBytes: file.size };
  }
  async function fetchPdf(remote, concertId, ticketId, fetchImpl = global.fetch) {
    const response = await ticketRequest(remote, concertId, ticketId, { method: 'GET' }, fetchImpl);
    const blob = await response.blob();
    if (!blob.size || blob.type && blob.type !== 'application/pdf') throw new Error('Ticket file is not a valid PDF.');
    const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...bytes) !== '%PDF-') throw new Error('Ticket file is not a valid PDF.');
    return blob;
  }
  async function deletePdf(remote, concertId, ticketId, fetchImpl = global.fetch) {
    await ticketRequest(remote, concertId, ticketId, { method: 'DELETE' }, fetchImpl);
  }
  function database() {
    if (!global.indexedDB) return Promise.reject(new Error('Offline ticket storage is unavailable in this browser.'));
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Offline ticket storage failed.'));
    });
  }
  async function cachePut(concertId, ticketId, blob) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(blob, pdfKey(concertId, ticketId)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); });
  }
  async function cacheGet(concertId, ticketId) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readonly'); const request = tx.objectStore(STORE_NAME).get(pdfKey(concertId, ticketId)); request.onsuccess = () => { db.close(); resolve(request.result || null); }; request.onerror = () => reject(request.error); });
  }
  async function cacheDelete(concertId, ticketId) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).delete(pdfKey(concertId, ticketId)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); });
  }
  async function cacheDeleteConcert(concertId) {
    const db = await database();
    return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); const store = tx.objectStore(STORE_NAME); const request = store.openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (String(cursor.key).startsWith(`${concertId}:`)) cursor.delete(); cursor.continue(); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); });
  }
  async function isValidPdfBlob(blob) {
    try {
      if (!blob || !blob.size || (blob.type && blob.type !== 'application/pdf')) return false;
      const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
      return String.fromCharCode(...bytes) === '%PDF-';
    } catch { return false; }
  }
  // IndexedDB is deliberately optional. These helpers turn only local-cache
  // errors into structured results; Worker and concerts.json errors are still
  // allowed to fail the operation visibly.
  async function readCachedPdf(concertId, ticketId, get = cacheGet) {
    try {
      const blob = await get(concertId, ticketId);
      return await isValidPdfBlob(blob)
        ? { blob, state: 'cached', cacheError: false }
        : { blob: null, state: 'missing', cacheError: false };
    } catch { return { blob: null, state: 'unavailable', cacheError: true }; }
  }
  async function writeCachedPdf(concertId, ticketId, blob, put = cachePut) {
    try { await put(concertId, ticketId, blob); return { cached: true, state: 'cached', cacheError: false }; }
    catch { return { cached: false, state: 'unavailable', cacheError: true }; }
  }
  async function removeCachedPdf(concertId, ticketId, remove = cacheDelete) {
    try { await remove(concertId, ticketId); return { removed: true, cacheError: false }; }
    catch { return { removed: false, cacheError: true }; }
  }
  async function removeCachedConcert(concertId, remove = cacheDeleteConcert) {
    try { await remove(concertId); return { removed: true, cacheError: false }; }
    catch { return { removed: false, cacheError: true }; }
  }
  // These small transaction helpers keep the permanent metadata-first rules
  // testable without making IndexedDB a prerequisite for the remote ticket.
  async function finalizeUploadedPdf({ saveMetadata, writeCache, cleanupRemote, cleanupCache }) {
    try { await saveMetadata(); }
    catch (error) {
      await Promise.allSettled([cleanupRemote?.(), cleanupCache?.()]);
      throw error;
    }
    return writeCache ? writeCache() : { cached: false, state: 'missing', cacheError: false };
  }
  async function removePdfAfterMetadataSave({ saveMetadata, cleanupRemote, cleanupCache }) {
    await saveMetadata();
    let remoteError = null;
    try { await cleanupRemote?.(); } catch (error) { remoteError = error; }
    const cache = cleanupCache ? await cleanupCache() : { removed: false, cacheError: false };
    return { remoteError, cache };
  }
  async function removeConcertAfterMetadataSave({ saveMetadata, pdfTickets, cleanupRemote, cleanupCache }) {
    await saveMetadata();
    const failures = [];
    for (const ticket of pdfTickets || []) {
      try { await cleanupRemote?.(ticket); } catch (error) { failures.push(error); }
    }
    const cache = cleanupCache ? await cleanupCache() : { removed: false, cacheError: false };
    return { failures, cache };
  }
  function openingPopup(openWindow) {
    const popup = typeof openWindow === 'function' ? openWindow('about:blank', '_blank') : null;
    if (!popup) return null;
    try {
      popup.opener = null;
      popup.document?.write?.('<title>Opening ticket…</title><p>Opening ticket…</p>');
      popup.document?.close?.();
    } catch { /* The navigation below still works in browsers with restricted WindowProxy access. */ }
    return popup;
  }
  async function openPdf(remote, concertId, ticketId, options = {}) {
    if (typeof options === 'function') options = { openWindow: options };
    const popup = openingPopup(options.openWindow || global.open);
    const urlApi = options.urlApi || global.URL;
    const schedule = options.setTimeout || global.setTimeout;
    const navigateFallback = options.navigateFallback || ((url) => global.location.assign(url));
    const readCache = options.readCache || readCachedPdf;
    const writeCache = options.writeCache || writeCachedPdf;
    const fetchImpl = options.fetchImpl || global.fetch;
    let result = { source: null, fetchedRemotely: false, cacheState: 'missing', cacheWriteFailed: false, popupOpened: !!popup, fallbackUsed: !popup };
    try {
      const cached = await readCache(concertId, ticketId);
      result.cacheState = cached.state;
      let blob = cached.blob;
      if (blob) result.source = 'cache';
      else {
        blob = await fetchPdf(remote, concertId, ticketId, fetchImpl);
        result.source = 'remote'; result.fetchedRemotely = true;
        const write = await writeCache(concertId, ticketId, blob);
        result.cacheState = write.state;
        result.cacheWriteFailed = write.cacheError;
      }
      const objectUrl = urlApi.createObjectURL(blob);
      if (popup && !popup.closed) popup.location.href = objectUrl;
      else navigateFallback(objectUrl);
      schedule(() => urlApi.revokeObjectURL(objectUrl), 60 * 1000);
      return result;
    } catch (error) {
      try { popup?.close?.(); } catch { /* Best effort: never leave a known blank destination. */ }
      error.openResult = result;
      throw error;
    }
  }
  const api = { MAX_PDF_BYTES, isSafeId, createId, safeUrl, validTicket, normalizedTickets, orderedTickets, ticketNames, statusLabel, summary, validatePdf, uploadPdf, fetchPdf, deletePdf, cachePut, cacheGet, cacheDelete, cacheDeleteConcert, isValidPdfBlob, readCachedPdf, writeCachedPdf, removeCachedPdf, removeCachedConcert, finalizeUploadedPdf, removePdfAfterMetadataSave, removeConcertAfterMetadataSave, openPdf };
  global.OwnedTickets = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
