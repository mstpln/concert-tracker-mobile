'use strict';

(function attachSpotifyHistoryImport(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultSpotifyHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DB_NAME = 'livevault-listening-history-v1';
  const STORE_NAME = 'listens';
  const META_STORE = 'meta';
  const META_KEY = 'spotify-import';
  const MIN_DURATION_MS = 30000;
  const ALLOWED_EVENT_KEYS = Object.freeze([
    'stableListenId', 'listenedAt', 'listenedDurationMs', 'artistCreditName',
    'recordingTitle', 'releaseTitle', 'spotifyTrackId', 'source',
  ]);

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function sanitizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const listenedAt = String(raw.listenedAt || '');
    const timestamp = Date.parse(listenedAt);
    const duration = Number(raw.listenedDurationMs);
    const artist = String(raw.artistCreditName || '').trim();
    const track = String(raw.recordingTitle || '').trim();
    const album = raw.releaseTitle == null ? null : String(raw.releaseTitle).trim() || null;
    const spotifyTrackId = String(raw.spotifyTrackId || '').trim();
    const stableListenId = String(raw.stableListenId || '').trim();
    if (!Number.isFinite(timestamp) || !artist || !track || !spotifyTrackId || !stableListenId) return null;
    if (!Number.isFinite(duration) || duration < MIN_DURATION_MS) return null;
    return {
      stableListenId,
      listenedAt: new Date(timestamp).toISOString(),
      listenedDurationMs: Math.round(duration),
      artistCreditName: artist,
      recordingTitle: track,
      releaseTitle: album,
      spotifyTrackId,
      source: 'spotify_import',
    };
  }

  function validatePayload(payload) {
    if (!payload || payload.kind !== 'livevault-listening-history' || payload.schemaVersion !== 1 || !Array.isArray(payload.events)) {
      throw new Error('This is not a supported LiveVault listening-history file.');
    }
    const sanitized = [];
    let rejected = 0;
    const seen = new Set();
    for (const raw of payload.events) {
      const event = sanitizeEvent(raw);
      if (!event || seen.has(event.stableListenId)) { rejected += 1; continue; }
      seen.add(event.stableListenId);
      sanitized.push(event);
    }
    sanitized.sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    return { events: sanitized, rejected };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('This browser does not support private local history storage.'));
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'stableListenId' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open private listening storage.'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Private listening storage failed.'));
    });
  }

  async function replaceEvents(events, summary = {}) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      for (const event of events) store.put(event);
      tx.objectStore(META_STORE).put({
        key: META_KEY,
        importedAt: new Date().toISOString(),
        eventCount: events.length,
        firstListenedAt: events[0]?.listenedAt || null,
        lastListenedAt: events.at(-1)?.listenedAt || null,
        sourceSha256: summary.sourceSha256 || null,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save listening history.'));
      tx.onabort = () => reject(tx.error || new Error('Listening-history import was cancelled.'));
    });
    db.close();
  }

  async function loadEvents(bandList = []) {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const events = await requestResult(tx.objectStore(STORE_NAME).getAll());
    db.close();
    const bandByName = new Map((bandList || []).filter((band) => band?.id && band?.name).map((band) => [normalizeText(band.name), String(band.id)]));
    return events.map((event) => ({ ...event, localBandId: bandByName.get(normalizeText(event.artistCreditName)) || null }));
  }

  async function getMeta() {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const meta = await requestResult(tx.objectStore(META_STORE).get(META_KEY));
    db.close();
    return meta || null;
  }

  async function clear() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(META_STORE).delete(META_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clear listening history.'));
    });
    db.close();
  }

  async function readFileText(file) {
    if (!file) throw new Error('Choose the sanitized LiveVault history file.');
    const gzip = file.name.toLowerCase().endsWith('.gz') || file.type === 'application/gzip';
    if (!gzip) return file.text();
    if (!root.DecompressionStream) throw new Error('This browser cannot open gzip files.');
    const stream = file.stream().pipeThrough(new root.DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function importFile(file) {
    const text = await readFileText(file);
    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { throw new Error('The selected file is not valid JSON.'); }
    const { events, rejected } = validatePayload(payload);
    if (!events.length) throw new Error('No eligible listening events were found.');
    await replaceEvents(events, { sourceSha256: payload.summary?.sha256 || null });
    return { imported: events.length, rejected, firstListenedAt: events[0].listenedAt, lastListenedAt: events.at(-1).listenedAt };
  }

  async function applyToApp() {
    try {
      if (typeof bands === 'undefined' || typeof listeningEvents === 'undefined') return 0;
      const events = await loadEvents(bands);
      listeningEvents = events;
      if (typeof currentScreen !== 'undefined' && currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
      if (typeof currentScreen !== 'undefined' && currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
      if (typeof currentScreen !== 'undefined' && currentScreen === 'profile' && typeof profileTab !== 'undefined' && profileTab === 'listening' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
      if (typeof currentTab !== 'undefined' && currentTab === 'myconcerts' && typeof renderMyConcertsScreen === 'function') renderMyConcertsScreen();
      return events.length;
    } catch (_) { return 0; }
  }

  function dateLabel(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  }

  async function injectSettingsUi() {
    const screen = root.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-spotify-history-import]')) return;
    const dataExportLabel = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Data export');
    if (!dataExportLabel) return;
    const meta = await getMeta().catch(() => null);
    const wrapper = root.document.createElement('div');
    wrapper.dataset.spotifyHistoryImport = 'true';
    wrapper.innerHTML = `
      <p class="section-label">Listening history</p>
      <div class="settings-card">
        <p class="settings-hint" style="margin-top:0">Import the sanitized LiveVault Spotify history file. It stays only in this browser's private IndexedDB storage and is never uploaded.</p>
        <input type="file" data-history-file accept=".json,.gz,application/json,application/gzip" hidden />
        <div class="show-buttons" style="margin-top:8px">
          <button type="button" class="btn-primary" data-history-import>Import history</button>
          ${meta ? '<button type="button" class="btn-secondary" data-history-clear>Remove history</button>' : ''}
        </div>
        <p class="settings-hint" data-history-status aria-live="polite">${meta ? `${Number(meta.eventCount).toLocaleString()} listens stored · ${dateLabel(meta.firstListenedAt)}–${dateLabel(meta.lastListenedAt)}` : 'No private listening history imported.'}</p>
      </div>`;
    dataExportLabel.before(wrapper);
    const input = wrapper.querySelector('[data-history-file]');
    const status = wrapper.querySelector('[data-history-status]');
    wrapper.querySelector('[data-history-import]').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      status.textContent = 'Importing privately on this device…';
      try {
        const result = await importFile(file);
        await applyToApp();
        status.textContent = `${result.imported.toLocaleString()} listens imported · ${dateLabel(result.firstListenedAt)}–${dateLabel(result.lastListenedAt)}${result.rejected ? ` · ${result.rejected.toLocaleString()} rejected` : ''}`;
        if (!wrapper.querySelector('[data-history-clear]')) {
          const button = root.document.createElement('button');
          button.type = 'button'; button.className = 'btn-secondary'; button.dataset.historyClear = 'true'; button.textContent = 'Remove history';
          wrapper.querySelector('.show-buttons').append(button);
          button.addEventListener('click', clearFromUi);
        }
      } catch (error) { status.textContent = error?.message || 'Import failed.'; }
      input.value = '';
    });
    async function clearFromUi() {
      await clear();
      if (typeof listeningEvents !== 'undefined') listeningEvents = [];
      status.textContent = 'Private listening history removed from this browser.';
      wrapper.querySelector('[data-history-clear]')?.remove();
    }
    wrapper.querySelector('[data-history-clear]')?.addEventListener('click', clearFromUi);
  }

  function observeSettings() {
    if (!root.document || !root.MutationObserver) return;
    const observer = new root.MutationObserver(() => injectSettingsUi());
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    injectSettingsUi();
  }

  async function bootstrap() {
    observeSettings();
    await applyToApp();
  }

  return { ALLOWED_EVENT_KEYS, MIN_DURATION_MS, sanitizeEvent, validatePayload, importFile, loadEvents, getMeta, clear, applyToApp, bootstrap };
});

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => window.LiveVaultSpotifyHistory.bootstrap(), { once: true });
}
