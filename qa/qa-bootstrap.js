'use strict';
(() => {
  const PREFIX = 'livevault-qa:'; const DATA_KEY = `${PREFIX}data`; const SETTINGS_KEY = `${PREFIX}settings`; const PDF_KEY = `${PREFIX}pdfs`;
  const QA_NOW = Date.parse('2027-07-16T12:00:00.000Z');
  const NativeDate = window.Date;
  class DeterministicDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [QA_NOW])); }
    static now() { return QA_NOW; }
  }
  window.Date = DeterministicDate;
  window.__LIVEVAULT_QA_NOW__ = new NativeDate(QA_NOW).toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initial = () => clone(window.LiveVaultQaFixtures);
  const load = () => { try { return JSON.parse(localStorage.getItem(DATA_KEY)) || initial(); } catch { return initial(); } };
  const save = (data) => localStorage.setItem(DATA_KEY, JSON.stringify(data));
  const reset = () => { localStorage.removeItem(DATA_KEY); localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(PDF_KEY); save(initial()); };
  const response = (body, init = {}) => new Response(body, init);
  window.rsGetConnection = () => ({ endpoint: 'https://qa.invalid', token: 'qa-synthetic-token' });
  window.rsSaveConnection = () => {}; window.rsClearConnection = () => reset();
  window.chrome = { storage: { local: { async get(keys) { const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); if (keys === undefined) return all; if (typeof keys === 'string') return { [keys]: all[keys] }; const out = {}; for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) out[key] = all[key]; return out; }, async set(value) { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'), ...value })); }, async remove(keys) { const all = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); for (const key of Array.isArray(keys) ? keys : [keys]) delete all[key]; localStorage.setItem(SETTINGS_KEY, JSON.stringify(all)); } } } };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === 'https://qa.invalid') {
      const path = url.pathname.replace(/^\//, ''); const method = (options.method || 'GET').toUpperCase(); const data = load();
      if (path.startsWith('ticket-files/')) { const pdfs = JSON.parse(localStorage.getItem(PDF_KEY) || '{}'); if (method === 'GET') return pdfs[path] ? response(Uint8Array.from([37,80,68,70,45,49,46,52,10]), { status: 200, headers: { 'Content-Type': 'application/pdf' } }) : response('Not found', { status: 404 }); if (method === 'PUT') { pdfs[path] = true; localStorage.setItem(PDF_KEY, JSON.stringify(pdfs)); return response('OK'); } if (method === 'DELETE') { delete pdfs[path]; localStorage.setItem(PDF_KEY, JSON.stringify(pdfs)); return response('OK'); } }
      if (localStorage.getItem(`${PREFIX}fail-read`) === path) return response('Synthetic read failure', { status: 503 });
      if (localStorage.getItem(`${PREFIX}fail-write`) === path) return response('Synthetic write failure', { status: 503 });
      if (!['bands.json', 'concerts.json', 'news.json', 'apiUsage.json'].includes(path)) return response('Not found', { status: 404 });
      const key = path.replace('.json', ''); if (method === 'GET') return response(JSON.stringify(data[key]), { status: 200, headers: { 'Content-Type': 'application/json' } }); if (method === 'PUT') { data[key] = JSON.parse(options.body); save(data); return response('OK'); }
      return response('Method not allowed', { status: 405 });
    }
    if (url.origin !== location.origin) throw new Error(`QA blocked external request: ${url.origin}`);
    return originalFetch(input, options);
  };
  document.addEventListener('DOMContentLoaded', () => { const banner = document.createElement('aside'); banner.dataset.testid = 'qa-banner'; banner.className = 'qa-banner'; banner.innerHTML = `QA PREVIEW · SYNTHETIC DATA <small>${window.__LIVEVAULT_QA_BUILD_ID__ || 'local'}</small> <button type="button" data-testid="qa-reset">Reset QA Data</button>`; document.body.prepend(banner); banner.querySelector('button').addEventListener('click', () => { reset(); location.reload(); }); });
  save(load());
})();
