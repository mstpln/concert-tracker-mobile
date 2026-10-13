'use strict';

(() => {
  const PREFIX = 'livevault-qa:';
  const DATA_KEY = `${PREFIX}data`;
  const SETTINGS_KEY = `${PREFIX}settings`;
  const PDF_KEY = `${PREFIX}pdfs`;
  const FAILURE_KEY = `${PREFIX}failures`;
  const PROFILE_KEY = `${PREFIX}profile`;
  const QA_TICKET_DB = 'live-vault-qa-owned-tickets';
  const PRODUCTION_TICKET_DB = 'live-vault-owned-tickets';
  const QA_NOW = '2027-07-16T12:00:00.000Z';
  const JSON_FILES = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json', 'discoverRecommendations.json']);
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const DEFAULT_PDF_BYTES = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]);

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initial = () => {
    const fixtures = clone(window.LiveVaultQaFixtures);
    if (loadJson(PROFILE_KEY, 'populated') === 'empty') {
      fixtures.bands = [];
      fixtures.concerts = [];
      fixtures.news = [];
    }
    return fixtures;
  };
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
  const isSyntheticToken = (value) => typeof value === 'string' && /^(?:qa-)?synthetic-/i.test(value);
  const safeSettings = (value) => Object.fromEntries(Object.entries(value || {}).filter(([key, candidate]) => {
    if (!/(?:secret|token|api.?key|credential|password|authorization)/i.test(key)) return true;
    if (isSyntheticToken(candidate)) return true;
    return key === 'spotifyUserAuthorization'
      && isSyntheticToken(candidate?.accessToken)
      && isSyntheticToken(candidate?.refreshToken);
  }));
  const loadSettings = () => {
    const stored = loadJson(SETTINGS_KEY, {});
    const safe = safeSettings(stored);
    if (Object.keys(safe).length !== Object.keys(stored).length) saveJson(SETTINGS_KEY, safe);
    return safe;
  };
  const saveSettings = (value) => saveJson(SETTINGS_KEY, safeSettings(value));
  const loadPdfs = () => loadJson(PDF_KEY, {});
  const savePdfs = (value) => saveJson(PDF_KEY, value);
  const loadFailures = () => loadJson(FAILURE_KEY, loadJson(PROFILE_KEY, 'populated') === 'error'
    ? { read: 'concerts.json' }
    : loadJson(PROFILE_KEY, 'populated') === 'loading' ? { delayMs: 1200 } : {});
  const localPresentationUrl = 'assets/listening/album-blue.svg';
  const localMediaUrl = (value) => /^https?:\/\//i.test(String(value))
    ? localPresentationUrl
    : value;
  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: innerHtmlDescriptor.configurable,
    enumerable: innerHtmlDescriptor.enumerable,
    get() { return innerHtmlDescriptor.get.call(this); },
    set(value) {
      const safeMarkup = String(value).replace(
        /((?:src|srcset)\s*=\s*)(["'])(https?:\/\/[^"']*)\2/gi,
        (_match, prefix, quote, url) => `${prefix}${quote}${localMediaUrl(url)}${quote}`,
      );
      return innerHtmlDescriptor.set.call(this, safeMarkup);
    },
  });
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttribute(name, value) {
    const mediaAttribute = ['src', 'srcset', 'poster'].includes(String(name).toLowerCase());
    return originalSetAttribute.call(this, name, mediaAttribute ? localMediaUrl(value) : value);
  };

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
  window.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ = true;
  window.__LIVEVAULT_QA_FAKE_BACKEND__ = true;
  window.rsGetConnection = () => ({ endpoint: 'https://qa.invalid', token: 'qa-synthetic-token' });
  window.rsSaveConnection = () => {};
  window.rsClearConnection = () => resetQaData();
  const nativeWindowOpen = window.open.bind(window);
  window.open = (url, ...options) => {
    try {
      const target = new URL(url, location.href);
      if (target.origin === location.origin || target.protocol === 'blob:') return nativeWindowOpen(url, ...options);
    } catch {}
    return null;
  };
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    let target;
    try { target = new URL(link.href, location.href); } catch { return; }
    if (target.origin !== location.origin) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

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
  const originalIndexedDbDelete = window.indexedDB?.deleteDatabase?.bind(window.indexedDB);
  const mapDatabaseName = (name) => name === PRODUCTION_TICKET_DB || name === QA_TICKET_DB
    ? QA_TICKET_DB
    : `${PREFIX}${name}`;
  if (originalIndexedDbOpen) {
    window.indexedDB.open = (name, version) => originalIndexedDbOpen(mapDatabaseName(name), version);
    if (originalIndexedDbDelete) {
      window.indexedDB.deleteDatabase = (name) => originalIndexedDbDelete(mapDatabaseName(name));
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (window.SpotifyUser) {
      window.SpotifyUser.beginAuthorization = async () => {
        throw new Error('Spotify authorization is unavailable in the synthetic preview.');
      };
    }
  }, { once: true });

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

    if (path === 'listenbrainz/1/validate-token') {
      return response(JSON.stringify({ valid: true, user_name: 'qa-listener' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === 'listenbrainz/1/user/qa-listener/listens') {
      return response(JSON.stringify({ payload: { listens: [
        {
          listened_at: 1784203200,
          recording_msid: '11111111-2222-4333-8444-555555555555',
          track_metadata: { artist_name: 'QA Artist One', track_name: 'Synthetic ListenBrainz Track', release_name: 'Synthetic Session' },
        },
        {
          listened_at: 1784201400,
          recording_msid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          track_metadata: { artist_name: 'QA Artist Two', track_name: 'Another Synthetic Track', release_name: 'Synthetic Session' },
        },
      ] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
      const value = loadData()[key];
      if (value === undefined) return response('Not found', { status: 404 });
      return response(JSON.stringify(clone(value)), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    if (window.LiveVaultListenBrainz) {
      const saveConnection = window.LiveVaultListenBrainz.saveConnection;
      window.LiveVaultListenBrainz.saveConnection = (value, storage) => {
        if (!String(value?.token || '').startsWith('qa-synthetic-')) {
          throw new Error('Use a synthetic QA token in the preview; real provider credentials are not accepted.');
        }
        return saveConnection(value, storage);
      };
    }
    const banner = document.createElement('aside');
    banner.dataset.testid = 'qa-banner';
    banner.className = 'qa-banner';
    banner.innerHTML = `QA PREVIEW · SYNTHETIC DATA <small>${window.__LIVEVAULT_QA_BUILD_ID__ || 'local'}</small> <label class="qa-state-control">State <select aria-label="Synthetic preview state" data-testid="qa-state"><option value="populated">Populated</option><option value="empty">Empty</option><option value="loading">Slow loading</option><option value="error">Load error</option></select></label> <button type="button" data-testid="qa-reset">Reset QA Data</button>`;
    document.body.prepend(banner);
    const stateControl = banner.querySelector('[data-testid="qa-state"]');
    stateControl.value = loadJson(PROFILE_KEY, 'populated');
    stateControl.addEventListener('change', () => {
      saveJson(PROFILE_KEY, stateControl.value);
      resetQaData();
      location.reload();
    });
    banner.querySelector('button').addEventListener('click', () => {
      resetQaData();
      location.reload();
    });
  });

  saveData(loadData());
  seedPdfEntries();
  if (window.__LIVEVAULT_QA_LIVE_RELOAD__ === true && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
        const scriptUrl = new URL(script, location.href);
        if (scriptUrl.origin === location.origin && scriptUrl.pathname.endsWith('/service-worker.js')) {
          registration.unregister();
        }
      }
    }).catch(() => {});
    if ('caches' in window) {
      caches.keys().then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('concert-tracker-qa-'))
        .map((key) => caches.delete(key)))).catch(() => {});
    }
  }
})();
