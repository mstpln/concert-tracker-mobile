'use strict';

(function attachListeningIncrementalVault(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultListeningIncrementalVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MANIFEST_PATH = 'listening/manifest.json';
  const PREFIX = 'listening/listenbrainz/';
  const PAYLOAD_KIND = 'livevault-listening-incremental';
  const SCHEMA_VERSION = 1;

  function connection() {
    return typeof root?.rsGetConnection === 'function' ? root.rsGetConnection() : null;
  }

  function urlFor(remote, path) {
    return `${String(remote.endpoint || '').replace(/\/$/, '')}/${path}`;
  }

  async function digestHex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function gzipText(text) {
    const stream = new Blob([text], { type: 'application/json' }).stream().pipeThrough(new root.CompressionStream('gzip'));
    return new Response(stream).blob();
  }

  async function gunzipText(blob) {
    const stream = blob.stream().pipeThrough(new root.DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function remoteGet(path) {
    const remote = connection();
    if (!remote) throw new Error('Connect Live Vault to Cloudflare first.');
    const response = await root.fetch(urlFor(remote, path), {
      headers: { Authorization: `Bearer ${remote.token}` },
    });
    if (response.status === 404) return { missing: true, response: null, etag: null };
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}.`);
    return { missing: false, response, etag: response.headers.get('ETag') };
  }

  async function remotePut(path, body, contentType, state = {}) {
    const remote = connection();
    if (!remote) throw new Error('Connect Live Vault to Cloudflare first.');
    const headers = { Authorization: `Bearer ${remote.token}`, 'Content-Type': contentType };
    if (state.createOnly) headers['If-None-Match'] = '*';
    else if (state.etag) headers['If-Match'] = state.etag;
    return root.fetch(urlFor(remote, path), { method: 'PUT', headers, body });
  }

  async function readManifest() {
    const result = await remoteGet(MANIFEST_PATH);
    if (result.missing) throw new Error('The listening vault manifest is missing.');
    let manifest;
    try { manifest = await result.response.json(); }
    catch (_) { throw new Error('The remote listening manifest is invalid.'); }
    if (!manifest || manifest.kind !== 'livevault-listening-vault' || manifest.schemaVersion !== 1 || !manifest.archive) {
      throw new Error('The remote listening manifest is not supported.');
    }
    return { manifest, etag: result.etag };
  }

  function monthKey(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Listening event has an invalid date.');
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function buildPayload(month, events) {
    const clean = (events || []).map((event) => root.LiveVaultSpotifyHistory?.sanitizeEvent?.(event)).filter(Boolean);
    clean.sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    if (!clean.length) throw new Error('No valid ListenBrainz events are available to store.');
    return {
      kind: PAYLOAD_KIND,
      schemaVersion: SCHEMA_VERSION,
      source: 'listenbrainz',
      month,
      summary: {
        eventCount: clean.length,
        firstListenedAt: clean[0].listenedAt,
        lastListenedAt: clean.at(-1).listenedAt,
      },
      events: clean,
    };
  }

  async function storeIncrementalEvents(events) {
    if (!root?.crypto?.subtle || !root?.CompressionStream) {
      throw new Error('This browser cannot create verified listening updates.');
    }
    const groups = new Map();
    for (const raw of events || []) {
      const event = root.LiveVaultSpotifyHistory?.sanitizeEvent?.(raw);
      if (!event || event.source !== 'listenbrainz') continue;
      const month = monthKey(event.listenedAt);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(event);
    }
    if (!groups.size) return { stored: 0, objects: [] };

    const current = await readManifest();
    const existing = Array.isArray(current.manifest.incrementals) ? current.manifest.incrementals : [];
    const additions = [];
    for (const [month, monthEvents] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const payload = buildPayload(month, monthEvents);
      const text = JSON.stringify(payload);
      const sha256 = await digestHex(text);
      const path = `${PREFIX}${month}/${sha256}.json.gz`;
      if (!existing.some((item) => item?.sha256 === sha256)) {
        const compressed = await gzipText(text);
        const write = await remotePut(path, compressed, 'application/gzip', { createOnly: true });
        if (!write.ok && write.status !== 412) {
          throw new Error(`Cloudflare could not store the ${month} listening update (HTTP ${write.status}).`);
        }
        additions.push({
          source: 'listenbrainz', month, path, sha256, contentEncoding: 'gzip',
          eventCount: payload.summary.eventCount,
          firstListenedAt: payload.summary.firstListenedAt,
          lastListenedAt: payload.summary.lastListenedAt,
        });
      }
    }
    if (!additions.length) return { stored: 0, objects: [] };

    const manifest = {
      ...current.manifest,
      updatedAt: new Date().toISOString(),
      incrementals: [...existing, ...additions].sort((a, b) =>
        String(a.firstListenedAt).localeCompare(String(b.firstListenedAt)) || String(a.sha256).localeCompare(String(b.sha256))
      ),
    };
    const write = await remotePut(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'application/json', { etag: current.etag });
    if (!write.ok) {
      if (write.status === 412) throw new Error('The remote listening vault changed. Refresh and sync again.');
      throw new Error(`Cloudflare could not update the listening manifest (HTTP ${write.status}).`);
    }
    return { stored: additions.reduce((sum, item) => sum + item.eventCount, 0), objects: additions };
  }

  async function restoreIncrementals() {
    if (!root?.DecompressionStream) return { added: 0, skipped: 0 };
    const current = await readManifest();
    const objects = Array.isArray(current.manifest.incrementals) ? current.manifest.incrementals : [];
    let added = 0;
    let skipped = 0;
    for (const item of objects) {
      if (!item?.path || !item?.sha256) continue;
      const result = await remoteGet(item.path);
      if (result.missing) throw new Error(`Listening update ${item.path} is missing.`);
      const text = await gunzipText(await result.response.blob());
      const sha256 = await digestHex(text);
      if (sha256 !== item.sha256) throw new Error(`Listening update ${item.path} failed its integrity check.`);
      let payload;
      try { payload = JSON.parse(text); }
      catch (_) { throw new Error(`Listening update ${item.path} is invalid.`); }
      if (payload?.kind !== PAYLOAD_KIND || payload?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.events)) {
        throw new Error(`Listening update ${item.path} is not supported.`);
      }
      const merged = await root.LiveVaultSpotifyHistory.mergeEvents(payload.events, { source: 'listenbrainz' });
      added += merged.added || 0;
      skipped += merged.skipped || 0;
    }
    if (added) await root.LiveVaultSpotifyHistory.applyToApp();
    return { added, skipped };
  }

  function install() {
    const vault = root?.LiveVaultListeningVault;
    if (!vault) return false;
    vault.storeIncrementalEvents = storeIncrementalEvents;
    vault.restoreIncrementals = restoreIncrementals;
    return true;
  }

  function bootstrap() {
    install();
    if (root.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true) return;
    root.setTimeout?.(async () => {
      try { await restoreIncrementals(); } catch (_) { /* Normal app use and manual sync remain available. */ }
    }, 2500);
  }

  return { MANIFEST_PATH, PREFIX, PAYLOAD_KIND, SCHEMA_VERSION, monthKey, buildPayload, storeIncrementalEvents, restoreIncrementals, install, bootstrap };
});

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => window.LiveVaultListeningIncrementalVault.bootstrap(), { once: true });
}
