'use strict';

(() => {
  const PREFIX = 'livevault-qa:';
  const DATA_KEY = `${PREFIX}data`;
  const SETTINGS_KEY = `${PREFIX}settings`;
  const PDF_KEY = `${PREFIX}pdfs`;
  const FAILURE_KEY = `${PREFIX}failures`;
  const QA_TICKET_DB = 'live-vault-qa-owned-tickets';
  const PRODUCTION_TICKET_DB = 'live-vault-owned-tickets';
  const QA_NOW = '2027-07-16T12:00:00.000Z';
  const JSON_FILES = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json']);
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const DEFAULT_PDF_BYTES = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]);

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initial = () => clone(window.LiveVaultQaFixtures);
  const loadJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const loadData = () => loadJson(DATA_KEY, initial());
  const saveData = (value) => saveJson(DATA_KEY, value);
  const loadSettings = () => loadJson(SETTINGS_KEY, {});
  const saveSettings = (value) => saveJson(SETTINGS_KEY, value);
  const loadPdfs = () => loadJson(PDF_KEY, {});
  const savePdfs = (value) => saveJson(PDF_KEY, value);
  const loadFailures = () => loadJson(FAILURE_KEY, {});

  function seedPdfEntries() {
    const pdfs = loadPdfs();
    let changed = false;
    for (const concert of loadData().concerts || []) {
      for (const ticket of concert.ownedTickets || []) {
        if (ticket.type !== 'pdf') continue;
        const path = `ticket-files/${concert.id}/${ticket.id}.pdf`;
        if (!pdfs[path]) {
          pdfs[path] = Array.from(DEFAULT_PDF_BYTES);
          changed = true;
        }
      }
    }
    if (changed) savePdfs(pdfs);
  }

  function resetQaData() {
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PDF_KEY);
    localStorage.removeItem(FAILURE_KEY);
    saveData(initial());
    seedPdfEntries();
    if (window.indexedDB?.deleteDatabase) window.indexedDB.deleteDatabase(QA_TICKET_DB);
  }

  window.__LIVEVAULT_QA_NOW__ = QA_NOW;
  window.rsGetConnection = () => ({ endpoint: 'https://qa.invalid', token: 'qa-synthetic-token' });
  window.rsSaveConnection = () => {};
  window.rsClearConnection = () => resetQaData();

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const all = loadSettings();
          if (keys === undefined) return all;
          if (typeof keys === 'string') return { [keys]: all[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, all[key]]));
          return Object.fromEntries(Object.entries(keys || {}).map(([key, fallback]) => [key, key in all ? all[key] : fallback]));
        },
        async set(value) {
          saveSettings({ ...loadSettings(), ...value });
        },
        async remove(keys) {
          const all = loadSettings();
          for (const key of Array.isArray(keys) ? keys : [keys]) delete all[key];
          saveSettings(all);
        },
      },
    },
  };

  const originalIndexedDbOpen = window.indexedDB?.open?.bind(window.indexedDB);
  if (originalIndexedDbOpen) {
    window.indexedDB.open = (name, version) => originalIndexedDbOpen(name === PRODUCTION_TICKET_DB ? QA_TICKET_DB : name, version);
  }

  const originalFetch = window.fetch.bind(window);
  const response = (body, init = {}) => new Response(body, init);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== 'https://qa.invalid') {
      if (url.origin !== location.origin) throw new Error(`QA blocked external request: ${url.origin}`);
      return originalFetch(input, options);
    }

    const method = (options.method || 'GET').toUpperCase();
    const path = url.pathname.replace(/^\//, '');
    const failures = loadFailures();
    if (Number(failures.delayMs) > 0) await delay(Number(failures.delayMs));

    if (path.startsWith('ticket-files/')) {
      const match = path.match(/^ticket-files\/([^/]+)\/([^/]+)\.pdf$/);
      if (!match || !SAFE_ID.test(match[1]) || !SAFE_ID.test(match[2])) return response('Invalid ticket identifier', { status: 400 });
      const pdfs = loadPdfs();
      if (method === 'GET') {
        if (failures.ticketRead) return response('Synthetic ticket read failure', { status: 503 });
        const bytes = pdfs[path];
        return bytes ? response(Uint8Array.from(bytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' } }) : response('Not found', { status: 404 });
      }
      if (method === 'PUT') {
        if (failures.ticketUpload) return response('Synthetic ticket upload failure', { status: 503 });
        const type = options.headers instanceof Headers ? options.headers.get('Content-Type') : options.headers?.['Content-Type'] || options.headers?.['content-type'];
        if (type !== 'application/pdf') return response('PDF required', { status: 400 });
        const bytes = new Uint8Array(await new Response(options.body).arrayBuffer());
        if (!bytes.length || bytes.length > MAX_PDF_BYTES || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return response('Invalid PDF', { status: bytes.length > MAX_PDF_BYTES ? 413 : 400 });
        pdfs[path] = Array.from(bytes);
        savePdfs(pdfs);
        return response('OK', { status: 200 });
      }
      if (method === 'DELETE') {
        if (failures.ticketDelete) return response('Synthetic ticket delete failure', { status: 503 });
        delete pdfs[path];
        savePdfs(pdfs);
        return response('OK', { status: 200 });
      }
      return response('Method not allowed', { status: 405 });
    }

    if (!JSON_FILES.has(path)) return response('Not found', { status: 404 });
    if (failures.missing === path) return response('Not found', { status: 404 });
    if (method === 'GET') {
      if (failures.read === path) return response('Synthetic read failure', { status: 503 });
      if (failures.malformed === path) return response('{malformed', { status: 200, headers: { 'Content-Type': 'application/json' } });
      const key = path.slice(0, -5);
      return response(JSON.stringify(clone(loadData()[key])), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'PUT') {
      if (failures.write === path) return response('Synthetic write failure', { status: 503 });
      let parsed;
      try { parsed = JSON.parse(String(options.body || '')); } catch { return response('Malformed JSON', { status: 400 }); }
      const data = loadData();
      data[path.slice(0, -5)] = parsed;
      saveData(data);
      return response('OK', { status: 200 });
    }
    return response('Method not allowed', { status: 405 });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('aside');
    banner.dataset.testid = 'qa-banner';
    banner.className = 'qa-banner';
    banner.innerHTML = `QA PREVIEW · SYNTHETIC DATA <small>${window.__LIVEVAULT_QA_BUILD_ID__ || 'local'}</small> <button type="button" data-testid="qa-reset">Reset QA Data</button>`;
    document.body.prepend(banner);
    banner.querySelector('button').addEventListener('click', () => {
      resetQaData();
      location.reload();
    });
  });

  saveData(loadData());
  seedPdfEntries();
})();
