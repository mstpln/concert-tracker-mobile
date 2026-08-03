'use strict';

(function attachListeningVault(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultListeningVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MANIFEST_PATH = 'listening/manifest.json';
  const ARCHIVE_PREFIX = 'listening/spotify-history/';
  const MANIFEST_KIND = 'livevault-listening-vault';
  const PAYLOAD_KIND = 'livevault-listening-history';
  const SCHEMA_VERSION = 1;

  function connection() {
    return typeof rsGetConnection === 'function' ? rsGetConnection() : null;
  }

  function documentUrl(remote, path) {
    return `${String(remote.endpoint || '').replace(/\/$/, '')}/${path}`;
  }

  async function digestHex(text) {
    if (!root?.crypto?.subtle) throw new Error('This browser cannot verify listening backups.');
    const bytes = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function buildPayload(events) {
    const clean = (events || []).map((event) => {
      const sanitized = root.LiveVaultSpotifyHistory?.sanitizeEvent?.(event);
      if (!sanitized) throw new Error('Local listening history contains an invalid event.');
      return sanitized;
    });
    clean.sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    return {
      kind: PAYLOAD_KIND,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      summary: {
        eventCount: clean.length,
        firstListenedAt: clean[0]?.listenedAt || null,
        lastListenedAt: clean.at(-1)?.listenedAt || null,
      },
      events: clean,
    };
  }

  async function gzipText(text) {
    if (!root?.CompressionStream) throw new Error('This browser cannot create compressed listening backups.');
    const stream = new Blob([text], { type: 'application/json' }).stream().pipeThrough(new root.CompressionStream('gzip'));
    return new Response(stream).blob();
  }

  async function gunzipText(blob) {
    if (!root?.DecompressionStream) throw new Error('This browser cannot restore compressed listening backups.');
    const stream = blob.stream().pipeThrough(new root.DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function remoteGet(path, fallback = null) {
    const remote = connection();
    if (!remote) throw new Error('Connect Live Vault to Cloudflare first.');
    const response = await fetch(documentUrl(remote, path), {
      headers: { Authorization: `Bearer ${remote.token}` },
    });
    if (response.status === 404) return { value: fallback, etag: null, missing: true };
    if (!response.ok) throw new Error(`Cloudflare returned HTTP ${response.status}.`);
    return { response, etag: response.headers.get('ETag'), missing: false };
  }

  async function remotePut(path, body, contentType, state = {}) {
    const remote = connection();
    if (!remote) throw new Error('Connect Live Vault to Cloudflare first.');
    const headers = {
      Authorization: `Bearer ${remote.token}`,
      'Content-Type': contentType,
    };
    if (state.createOnly) headers['If-None-Match'] = '*';
    else if (state.etag) headers['If-Match'] = state.etag;
    const response = await fetch(documentUrl(remote, path), { method: 'PUT', headers, body });
    return response;
  }

  async function readManifest() {
    const result = await remoteGet(MANIFEST_PATH, null);
    if (result.missing) return { manifest: null, etag: null, missing: true };
    let manifest;
    try { manifest = await result.response.json(); }
    catch (_) { throw new Error('The remote listening manifest is invalid.'); }
    if (!manifest || manifest.kind !== MANIFEST_KIND || manifest.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('The remote listening manifest is not supported.');
    }
    return { manifest, etag: result.etag, missing: false };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    root.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function localArchive() {
    const events = await root.LiveVaultSpotifyHistory.loadStoredEvents();
    if (!events.length) throw new Error('No local listening history is available.');
    const payload = buildPayload(events);
    const text = JSON.stringify(payload);
    const sha256 = await digestHex(text);
    const compressed = await gzipText(text);
    return { events, payload, text, sha256, compressed };
  }

  async function exportLocalBackup() {
    const archive = await localArchive();
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(archive.compressed, `live-vault-listening-backup-${date}.json.gz`);
    return { eventCount: archive.payload.summary.eventCount, sha256: archive.sha256 };
  }

  async function backupToCloudflare() {
    const archive = await localArchive();
    const archivePath = `${ARCHIVE_PREFIX}${archive.sha256}.json.gz`;

    const archiveWrite = await remotePut(archivePath, archive.compressed, 'application/gzip', { createOnly: true });
    if (!archiveWrite.ok && archiveWrite.status !== 412) {
      throw new Error(`Cloudflare could not store the listening archive (HTTP ${archiveWrite.status}).`);
    }

    const current = await readManifest();
    const manifest = {
      kind: MANIFEST_KIND,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      archive: {
        source: 'spotify_import',
        path: archivePath,
        sha256: archive.sha256,
        contentEncoding: 'gzip',
        eventCount: archive.payload.summary.eventCount,
        firstListenedAt: archive.payload.summary.firstListenedAt,
        lastListenedAt: archive.payload.summary.lastListenedAt,
      },
      previousArchive: current.manifest?.archive || null,
    };
    const manifestWrite = await remotePut(
      MANIFEST_PATH,
      JSON.stringify(manifest, null, 2),
      'application/json',
      current.missing ? { createOnly: true } : { etag: current.etag }
    );
    if (!manifestWrite.ok) {
      if (manifestWrite.status === 412) throw new Error('The remote listening vault changed. Refresh and try again.');
      throw new Error(`Cloudflare could not update the listening manifest (HTTP ${manifestWrite.status}).`);
    }
    return manifest;
  }

  async function restoreFromCloudflare() {
    const current = await readManifest();
    if (!current.manifest?.archive?.path) throw new Error('No Cloudflare listening backup exists.');
    const archiveResult = await remoteGet(current.manifest.archive.path);
    const compressed = await archiveResult.response.blob();
    const text = await gunzipText(compressed);
    const sha256 = await digestHex(text);
    if (sha256 !== current.manifest.archive.sha256) throw new Error('The remote listening backup failed its integrity check.');
    let payload;
    try { payload = JSON.parse(text); }
    catch (_) { throw new Error('The remote listening backup is invalid.'); }
    const validated = root.LiveVaultSpotifyHistory.validatePayload(payload);
    if (validated.events.length !== current.manifest.archive.eventCount) {
      throw new Error('The remote listening backup count does not match its manifest.');
    }
    await root.LiveVaultSpotifyHistory.replaceEvents(validated.events, { sourceSha256: sha256 });
    await root.LiveVaultSpotifyHistory.applyToApp();
    return {
      restored: validated.events.length,
      firstListenedAt: validated.events[0]?.listenedAt || null,
      lastListenedAt: validated.events.at(-1)?.listenedAt || null,
    };
  }

  async function status() {
    const local = await root.LiveVaultSpotifyHistory.getMeta().catch(() => null);
    let remoteStatus = null;
    try { remoteStatus = (await readManifest()).manifest; }
    catch (_) { remoteStatus = null; }
    return { local, remote: remoteStatus };
  }

  function dateLabel(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  }

  async function injectUi() {
    const wrapper = root.document?.querySelector('[data-spotify-history-import]');
    if (!wrapper || wrapper.querySelector('[data-listening-vault]')) return;
    const panel = root.document.createElement('div');
    panel.dataset.listeningVault = 'true';
    panel.innerHTML = `
      <div class="settings-divider"></div>
      <p class="settings-hint"><strong>Private Cloudflare backup</strong></p>
      <p class="settings-hint" data-vault-status aria-live="polite">Checking backup status…</p>
      <div class="show-buttons" style="margin-top:8px">
        <button type="button" class="btn-primary" data-vault-backup>Back up to Cloudflare</button>
        <button type="button" class="btn-secondary" data-vault-restore>Restore from Cloudflare</button>
        <button type="button" class="btn-secondary" data-vault-export>Download backup</button>
      </div>`;
    wrapper.querySelector('.settings-card')?.append(panel);
    const statusNode = panel.querySelector('[data-vault-status]');
    const buttons = [...panel.querySelectorAll('button')];
    const setBusy = (busy) => buttons.forEach((button) => { button.disabled = busy; });
    const refresh = async () => {
      const info = await status();
      if (info.remote?.archive) {
        statusNode.textContent = `${Number(info.remote.archive.eventCount).toLocaleString()} listens backed up · ${dateLabel(info.remote.archive.firstListenedAt)}–${dateLabel(info.remote.archive.lastListenedAt)}`;
      } else statusNode.textContent = 'No Cloudflare listening backup yet.';
    };
    panel.querySelector('[data-vault-backup]').addEventListener('click', async () => {
      setBusy(true); statusNode.textContent = 'Creating and verifying private Cloudflare backup…';
      try {
        const manifest = await backupToCloudflare();
        statusNode.textContent = `${Number(manifest.archive.eventCount).toLocaleString()} listens backed up safely.`;
      } catch (error) { statusNode.textContent = error?.message || 'Backup failed.'; }
      finally { setBusy(false); }
    });
    panel.querySelector('[data-vault-restore]').addEventListener('click', async () => {
      if (!root.confirm('Replace this device’s local listening copy with the private Cloudflare backup?')) return;
      setBusy(true); statusNode.textContent = 'Restoring and verifying private Cloudflare backup…';
      try {
        const result = await restoreFromCloudflare();
        statusNode.textContent = `${Number(result.restored).toLocaleString()} listens restored to this device.`;
      } catch (error) { statusNode.textContent = error?.message || 'Restore failed.'; }
      finally { setBusy(false); }
    });
    panel.querySelector('[data-vault-export]').addEventListener('click', async () => {
      setBusy(true); statusNode.textContent = 'Preparing local backup…';
      try {
        const result = await exportLocalBackup();
        statusNode.textContent = `${Number(result.eventCount).toLocaleString()} listens downloaded as a private backup.`;
      } catch (error) { statusNode.textContent = error?.message || 'Backup download failed.'; }
      finally { setBusy(false); }
    });
    refresh().catch(() => { statusNode.textContent = 'Cloudflare backup status is unavailable.'; });
  }

  function observeUi() {
    if (!root?.document || !root.MutationObserver) return;
    const observer = new root.MutationObserver(() => injectUi());
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
    injectUi();
  }

  async function restoreIfLocalEmpty() {
    if (root.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true) return;
    const local = await root.LiveVaultSpotifyHistory?.getMeta?.().catch(() => null);
    if (local?.eventCount) return;
    try { await restoreFromCloudflare(); } catch (_) { /* explicit restore remains available in Settings */ }
  }

  function bootstrap() {
    observeUi();
    root.setTimeout(restoreIfLocalEmpty, 1500);
  }

  return {
    MANIFEST_PATH,
    ARCHIVE_PREFIX,
    MANIFEST_KIND,
    SCHEMA_VERSION,
    buildPayload,
    digestHex,
    readManifest,
    exportLocalBackup,
    backupToCloudflare,
    restoreFromCloudflare,
    status,
    bootstrap,
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => window.LiveVaultListeningVault.bootstrap(), { once: true });
}
