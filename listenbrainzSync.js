'use strict';

(function attachListenBrainzSync(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultListenBrainz = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const API_ROOT = 'https://api.listenbrainz.org';
  const SETTINGS_KEY = 'livevault-listenbrainz-v1';
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let settingsUiPromise = null;
  let syncPromise = null;
  let foregroundSyncObserved = false;

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function safeUuid(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text) ? text : null;
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' ? url.toString() : null;
    } catch (_) { return null; }
  }

  function resolvedUrlRelations(...values) {
    const flattened = [];
    for (const value of values) {
      if (Array.isArray(value)) flattened.push(...value);
      else if (value && typeof value === 'object') flattened.push(...Object.values(value).flat());
      else if (value != null) flattened.push(value);
    }
    const urls = [];
    for (const value of flattened) {
      const candidate = typeof value === 'string'
        ? value
        : value?.url?.resource || value?.resource || value?.target || value?.url || null;
      const safe = safeHttpsUrl(candidate);
      if (safe && !urls.includes(safe)) urls.push(safe);
      if (urls.length >= 32) break;
    }
    return urls;
  }

  function safeCaaId(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : null;
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function eventFingerprint(event) {
    const timestamp = Date.parse(event?.listenedAt || '');
    if (!Number.isFinite(timestamp)) return null;
    return `${Math.floor(timestamp / 1000)}|${normalizeText(event?.artistCreditName)}|${normalizeText(event?.recordingTitle)}`;
  }

  function durationFromListen(listen) {
    const metadata = listen?.track_metadata || {};
    const info = metadata.additional_info || {};
    const mapping = metadata.mbid_mapping || {};
    const candidates = [
      info.duration_ms,
      info.duration,
      mapping.recording_length,
      metadata.recording_length,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return Math.round(value);
    }
    return null;
  }

  function normalizeListen(listen) {
    const listenedAtSeconds = Number(listen?.listened_at);
    const metadata = listen?.track_metadata || {};
    const info = metadata.additional_info || {};
    const mapping = metadata.mbid_mapping || {};
    const artist = String(metadata.artist_name || '').trim();
    const title = String(metadata.track_name || '').trim();
    if (!Number.isFinite(listenedAtSeconds) || listenedAtSeconds <= 0 || !artist || !title) return null;

    const listenedAt = new Date(Math.floor(listenedAtSeconds) * 1000).toISOString();
    const recordingMbid = safeUuid(info.recording_mbid || mapping.recording_mbid);
    const releaseMbid = safeUuid(info.release_mbid || mapping.release_mbid);
    const releaseGroupMbid = safeUuid(info.release_group_mbid || mapping.release_group_mbid);
    const caaReleaseMbid = safeUuid(info.caa_release_mbid || mapping.caa_release_mbid);
    const artistMbids = [...new Set([
      ...(Array.isArray(info.artist_mbids) ? info.artist_mbids : []),
      ...(Array.isArray(mapping.artist_mbids) ? mapping.artist_mbids : []),
    ].map(safeUuid).filter(Boolean))];
    const urlRels = resolvedUrlRelations(info.url_rels, info.url_relations, mapping.url_rels, mapping.url_relations);
    const recordingMsid = safeUuid(listen?.recording_msid || info.recording_msid);
    const identity = recordingMsid || recordingMbid || stableHash(`${listenedAt}|${normalizeText(artist)}|${normalizeText(title)}|${normalizeText(metadata.release_name)}`);

    return {
      stableListenId: `listenbrainz:${Math.floor(listenedAtSeconds)}:${identity}`,
      listenedAt,
      listenedDurationMs: durationFromListen(listen),
      artistCreditName: artist,
      recordingTitle: title,
      releaseTitle: metadata.release_name == null ? null : String(metadata.release_name).trim() || null,
      spotifyTrackId: null,
      musicbrainzRecordingId: recordingMbid,
      musicbrainzArtistIds: artistMbids,
      musicbrainzReleaseId: releaseMbid,
      musicbrainzReleaseGroupId: releaseGroupMbid,
      listenbrainzRecordingMsid: recordingMsid,
      listenbrainzUrlRels: urlRels,
      listenbrainzCaaId: safeCaaId(info.caa_id ?? mapping.caa_id),
      listenbrainzCaaReleaseMbid: caaReleaseMbid,
      source: 'listenbrainz',
    };
  }

  function extractListens(payload) {
    const listens = payload?.payload?.listens;
    return Array.isArray(listens) ? listens : [];
  }

  function connection(storage = root?.localStorage) {
    if (!storage?.getItem) return null;
    try {
      const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
      if (!parsed?.token || !parsed?.userName) return null;
      return {
        token: String(parsed.token),
        userName: String(parsed.userName),
        lastSyncAt: parsed.lastSyncAt || null,
      };
    } catch (_) {
      return null;
    }
  }

  function saveConnection(value, storage = root?.localStorage) {
    if (!storage?.setItem) throw new Error('This browser cannot store the ListenBrainz connection.');
    const current = connection(storage);
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      token: String(value.token || current?.token || ''),
      userName: String(value.userName || current?.userName || ''),
      lastSyncAt: value.lastSyncAt || current?.lastSyncAt || null,
    }));
  }

  function clearConnection(storage = root?.localStorage) {
    storage?.removeItem?.(SETTINGS_KEY);
  }

  async function validateToken(token, fetchImpl = root?.fetch) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('Enter your ListenBrainz user token.');
    const response = await fetchImpl(`${API_ROOT}/1/validate-token`, {
      headers: { Authorization: `Token ${cleanToken}` },
    });
    if (!response.ok) throw new Error(`ListenBrainz returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (!payload?.valid || !payload?.user_name) throw new Error('The ListenBrainz token is not valid.');
    return { token: cleanToken, userName: String(payload.user_name) };
  }

  function listensUrl(userName, cursor = {}) {
    const url = new URL(`${API_ROOT}/1/user/${encodeURIComponent(userName)}/listens`);
    url.searchParams.set('count', String(PAGE_SIZE));
    if (Number.isFinite(cursor.minTs)) url.searchParams.set('min_ts', String(Math.floor(cursor.minTs)));
    if (Number.isFinite(cursor.maxTs)) url.searchParams.set('max_ts', String(Math.floor(cursor.maxTs)));
    return url.toString();
  }

  async function fetchNewListens({ userName, token, afterMs = 0, fetchImpl = root?.fetch } = {}) {
    if (!userName || !token) throw new Error('Connect ListenBrainz first.');
    const cutoffMs = Number.isFinite(Number(afterMs)) ? Number(afterMs) : 0;
    const cutoffSeconds = Math.max(0, Math.floor(cutoffMs / 1000));
    const collected = [];
    const seen = new Set();
    let cursor = { minTs: cutoffSeconds };

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await fetchImpl(listensUrl(userName, cursor), {
        headers: { Authorization: `Token ${token}` },
      });
      if (response.status === 429) {
        const wait = Number(response.headers?.get?.('X-RateLimit-Reset-In'));
        throw new Error(`ListenBrainz rate limit reached${Number.isFinite(wait) ? `; try again in ${wait} seconds` : ''}.`);
      }
      if (!response.ok) throw new Error(`ListenBrainz returned HTTP ${response.status}.`);
      const rawListens = extractListens(await response.json());
      if (!rawListens.length) break;

      let oldestSeconds = Infinity;
      for (const raw of rawListens) {
        const seconds = Number(raw?.listened_at);
        if (Number.isFinite(seconds)) oldestSeconds = Math.min(oldestSeconds, seconds);
        const event = normalizeListen(raw);
        if (!event || Date.parse(event.listenedAt) <= cutoffMs) continue;
        const fingerprint = eventFingerprint(event);
        const key = `${event.stableListenId}|${fingerprint}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(event);
      }
      if (rawListens.length < PAGE_SIZE || !Number.isFinite(oldestSeconds) || oldestSeconds <= cutoffSeconds) break;
      cursor = { maxTs: Math.floor(oldestSeconds) - 1 };
      if (page === MAX_PAGES - 1) {
        throw new Error('ListenBrainz returned more than 5,000 new listens. No partial sync was saved; reduce the backlog before retrying.');
      }
    }

    collected.sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    return collected;
  }

  async function syncNow() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const remote = connection();
      if (!remote) throw new Error('Connect ListenBrainz first.');
      if (!root?.LiveVaultSpotifyHistory || !root?.LiveVaultListeningVault) {
        throw new Error('Listening history is not ready yet.');
      }
      const meta = await root.LiveVaultSpotifyHistory.getMeta().catch(() => null);
      const afterMs = Date.parse(meta?.lastListenedAt || '') || 0;
      const incoming = await fetchNewListens({ ...remote, afterMs });
      if (!incoming.length) {
        saveConnection({ ...remote, lastSyncAt: new Date().toISOString() });
        return { added: 0, skipped: 0, eventCount: Number(meta?.eventCount) || 0 };
      }

      await root.LiveVaultListeningVault.storeIncrementalEvents(incoming);
      const merged = await root.LiveVaultSpotifyHistory.mergeEvents(incoming, { source: 'listenbrainz' });
      await root.LiveVaultSpotifyHistory.applyToApp();
      saveConnection({ ...remote, lastSyncAt: new Date().toISOString() });
      return merged;
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function dateTimeLabel(value) {
    if (!value) return 'Not synced yet';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Not synced yet';
    return new Intl.DateTimeFormat('en', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function dedupeSettingsWrappers(screen) {
    const wrappers = [...(screen?.querySelectorAll?.('[data-listenbrainz-sync]') || [])];
    const primary = wrappers.shift() || null;
    for (const duplicate of wrappers) duplicate.remove();
    return primary;
  }

  async function ensureSettingsUi() {
    let screen = root.document?.getElementById('screen-settings');
    if (!screen) return null;
    const existing = dedupeSettingsWrappers(screen);
    if (existing) return existing;

    const saved = connection();
    screen = root.document?.getElementById('screen-settings');
    if (!screen) return null;
    const existingAfterRead = dedupeSettingsWrappers(screen);
    if (existingAfterRead) return existingAfterRead;

    const historyWrapper = screen.querySelector('[data-spotify-history-import]');
    const dataExportLabel = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Data export');
    if (!historyWrapper && !dataExportLabel) return null;

    const wrapper = root.document.createElement('div');
    wrapper.dataset.listenbrainzSync = 'true';
    wrapper.innerHTML = saved ? `
      <p class="section-label">ListenBrainz sync</p>
      <div class="settings-card">
        <p class="settings-hint" style="margin-top:0">Connected as <strong data-listenbrainz-user></strong>. New listens sync when the app opens, when it returns to the foreground after six hours, and at most once every six hours while in use.</p>
        <div class="show-buttons" style="margin-top:8px">
          <button type="button" class="btn-primary" data-listenbrainz-sync-now>Sync now</button>
          <button type="button" class="btn-secondary" data-listenbrainz-disconnect>Disconnect</button>
        </div>
        <p class="settings-hint" data-listenbrainz-status aria-live="polite">Last sync: ${dateTimeLabel(saved.lastSyncAt)}</p>
      </div>` : `
      <p class="section-label">ListenBrainz sync</p>
      <div class="settings-card">
        <p class="settings-hint" style="margin-top:0">Add your private ListenBrainz user token to keep listening history current. The token stays only in this browser and is sent directly to ListenBrainz.</p>
        <label for="listenbrainz-token">ListenBrainz user token</label>
        <input id="listenbrainz-token" type="password" autocomplete="off" data-listenbrainz-token />
        <div class="show-buttons" style="margin-top:8px">
          <button type="button" class="btn-primary" data-listenbrainz-connect>Connect</button>
        </div>
        <p class="settings-hint" data-listenbrainz-status aria-live="polite">Not connected.</p>
      </div>`;

    if (historyWrapper) historyWrapper.after(wrapper);
    else dataExportLabel.before(wrapper);

    const status = wrapper.querySelector('[data-listenbrainz-status]');
    const user = wrapper.querySelector('[data-listenbrainz-user]');
    if (user && saved) user.textContent = saved.userName;

    wrapper.querySelector('[data-listenbrainz-connect]')?.addEventListener('click', async () => {
      const input = wrapper.querySelector('[data-listenbrainz-token]');
      const button = wrapper.querySelector('[data-listenbrainz-connect]');
      button.disabled = true;
      status.textContent = 'Validating with ListenBrainz…';
      try {
        const validated = await validateToken(input.value);
        saveConnection(validated);
        status.textContent = `Connected as ${validated.userName}. Starting the first sync…`;
        await syncNow();
        wrapper.remove();
        await ensureSettingsUi();
      } catch (error) {
        status.textContent = error?.message || 'ListenBrainz connection failed.';
      } finally {
        button.disabled = false;
      }
    });

    wrapper.querySelector('[data-listenbrainz-sync-now]')?.addEventListener('click', async () => {
      const button = wrapper.querySelector('[data-listenbrainz-sync-now]');
      button.disabled = true;
      status.textContent = 'Syncing new listens…';
      try {
        const result = await syncNow();
        status.textContent = result.added
          ? `${result.added.toLocaleString()} new listens added · ${result.eventCount.toLocaleString()} stored`
          : `Already up to date · Last sync: ${dateTimeLabel(connection()?.lastSyncAt)}`;
      } catch (error) {
        status.textContent = error?.message || 'ListenBrainz sync failed.';
      } finally {
        button.disabled = false;
      }
    });

    wrapper.querySelector('[data-listenbrainz-disconnect]')?.addEventListener('click', async () => {
      clearConnection();
      wrapper.remove();
      await ensureSettingsUi();
    });
    return wrapper;
  }

  function injectSettingsUi() {
    if (settingsUiPromise) return settingsUiPromise;
    settingsUiPromise = ensureSettingsUi().finally(() => { settingsUiPromise = null; });
    return settingsUiPromise;
  }

  function observeSettings() {
    if (!root.document || !root.MutationObserver) return;
    const observer = new root.MutationObserver(() => injectSettingsUi());
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    injectSettingsUi();
  }

  function isAutoSyncDue(lastSyncAt, nowMs = Date.now()) {
    const lastSync = Date.parse(lastSyncAt || '') || 0;
    return nowMs - lastSync >= AUTO_SYNC_INTERVAL_MS;
  }

  async function autoSyncIfDue({ nowMs = Date.now(), sync = syncNow } = {}) {
    if (root.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true) return false;
    const saved = connection();
    if (!saved || !isAutoSyncDue(saved.lastSyncAt, nowMs)) return false;
    try {
      await sync();
      return true;
    } catch (_) {
      return false; // Settings exposes the next manual retry.
    }
  }

  function observeForegroundSync(syncCheck = autoSyncIfDue) {
    if (foregroundSyncObserved || !root.document?.addEventListener) return false;
    root.document.addEventListener('visibilitychange', () => {
      if (root.document?.visibilityState !== 'visible') return;
      void syncCheck();
    });
    foregroundSyncObserved = true;
    return true;
  }

  function bootstrap() {
    observeSettings();
    observeForegroundSync();
    root.setTimeout?.(autoSyncIfDue, 4000);
    root.setInterval?.(autoSyncIfDue, AUTO_SYNC_INTERVAL_MS);
  }

  return {
    API_ROOT,
    SETTINGS_KEY,
    PAGE_SIZE,
    MAX_PAGES,
    AUTO_SYNC_INTERVAL_MS,
    normalizeListen,
    extractListens,
    eventFingerprint,
    fetchNewListens,
    validateToken,
    connection,
    saveConnection,
    clearConnection,
    syncNow,
    isAutoSyncDue,
    autoSyncIfDue,
    observeForegroundSync,
    dedupeSettingsWrappers,
    bootstrap,
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => window.LiveVaultListenBrainz.bootstrap(), { once: true });
}
