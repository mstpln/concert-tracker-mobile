'use strict';
// Replaces fsstore.js from the Chrome extension build. Instead of a
// FileSystemDirectoryHandle picked from local disk, this build talks to a
// small Cloudflare Worker (backed by an R2 bucket) over plain HTTPS. The
// Worker URL + a bearer token are the only "connection" info, entered once
// in onboarding and persisted in localStorage — no OS-level permission
// re-grant dance like the desktop extension's directory picker has.
//
// This file is loaded AFTER dataLib.js in index.html and intentionally
// redefines dlReadJsonFile/dlWriteJsonFile (both declared with `function`,
// so the later definition wins in a classic, non-module <script> load) so
// dataLib.js itself can stay byte-for-byte identical to the Chrome
// extension's copy — only the storage transport changes, not the shared
// business logic (dlBandActivity, dlNearestPerBand, etc.).

const RS_CONN_KEY = 'concertTrackerRemoteConnection';
const RS_SETTINGS_KEY = 'concertTrackerSettings';
const RS_DOCUMENT_STATE = new Map();

function rsClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function rsReconcileCallerData(target, value) {
  if (Array.isArray(target) && Array.isArray(value)) {
    target.splice(0, target.length, ...rsClone(value));
    return target;
  }
  if (target && value && typeof target === 'object' && typeof value === 'object' && !Array.isArray(target) && !Array.isArray(value)) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, rsClone(value));
    return target;
  }
  return value;
}

function rsGetConnection() {
  try {
    const raw = localStorage.getItem(RS_CONN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function rsSaveConnection(conn) {
  localStorage.setItem(RS_CONN_KEY, JSON.stringify(conn));
}

function rsClearConnection() {
  localStorage.removeItem(RS_CONN_KEY);
  RS_DOCUMENT_STATE.clear();
}

function rsDocumentUrl(remote, filename) {
  return `${remote.endpoint.replace(/\/$/, '')}/${filename}`;
}

async function rsReadDocument(remote, filename, fallback) {
  const res = await fetch(rsDocumentUrl(remote, filename), {
    headers: { Authorization: `Bearer ${remote.token}` },
  });
  if (res.status === 404) {
    RS_DOCUMENT_STATE.set(filename, { etag: null, missing: true, value: rsClone(fallback) });
    return fallback;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const value = text.trim() ? JSON.parse(text) : fallback;
  RS_DOCUMENT_STATE.set(filename, { etag: res.headers.get('ETag'), missing: false, value: rsClone(value) });
  return value;
}

// Overrides dataLib.js's filesystem-based versions. `remote` is
// { endpoint, token } instead of a FileSystemDirectoryHandle.
async function dlReadJsonFile(remote, filename, fallback) {
  try {
    return await rsReadDocument(remote, filename, fallback);
  } catch (e) {
    console.error(`dlReadJsonFile(${filename}) failed`, e);
    throw e;
  }
}

async function rsWriteAttempt(remote, filename, data, state) {
  const headers = {
    Authorization: `Bearer ${remote.token}`,
    'Content-Type': 'application/json',
  };
  if (state?.missing) headers['If-None-Match'] = '*';
  else if (state?.etag) headers['If-Match'] = state.etag;

  return fetch(rsDocumentUrl(remote, filename), {
    method: 'PUT',
    headers,
    body: JSON.stringify(data, null, 2),
  });
}

async function dlWriteJsonFile(remote, filename, data) {
  let state = RS_DOCUMENT_STATE.get(filename);
  if (!state || (!state.etag && !state.missing)) {
    await rsReadDocument(remote, filename, undefined);
    state = RS_DOCUMENT_STATE.get(filename);
  }

  let intended = rsClone(data);
  let res = await rsWriteAttempt(remote, filename, intended, state);
  if (res.status === 412) {
    const base = rsClone(state?.value);
    const latest = await rsReadDocument(remote, filename, undefined);
    const latestState = RS_DOCUMENT_STATE.get(filename);
    intended = LiveVaultConflictMerge.merge(base, intended, latest);
    res = await rsWriteAttempt(remote, filename, intended, latestState);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status} saving ${filename}${detail ? `: ${detail}` : ''}`);
  }
  RS_DOCUMENT_STATE.set(filename, {
    etag: res.headers.get('ETag'),
    missing: false,
    value: rsClone(intended),
  });
  return rsReconcileCallerData(data, intended);
}

// Minimal chrome.storage.local-shaped shim backed by localStorage, so the
// rest of the app (copied from the extension's popup.js) can keep calling
// chrome.storage.local.get/set/remove exactly as before.
window.chrome = window.chrome || {};
window.chrome.storage = {
  local: {
    async get(keys) {
      const all = JSON.parse(localStorage.getItem(RS_SETTINGS_KEY) || '{}');
      if (keys === undefined) return all;
      if (typeof keys === 'string') return { [keys]: all[keys] };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) out[k] = all[k];
        return out;
      }
      // object form: { key: defaultValue, ... }
      const out = {};
      for (const k of Object.keys(keys)) out[k] = k in all ? all[k] : keys[k];
      return out;
    },
    async set(obj) {
      const all = JSON.parse(localStorage.getItem(RS_SETTINGS_KEY) || '{}');
      Object.assign(all, obj);
      localStorage.setItem(RS_SETTINGS_KEY, JSON.stringify(all));
    },
    async remove(keys) {
      const all = JSON.parse(localStorage.getItem(RS_SETTINGS_KEY) || '{}');
      for (const k of Array.isArray(keys) ? keys : [keys]) delete all[k];
      localStorage.setItem(RS_SETTINGS_KEY, JSON.stringify(all));
    },
  },
};
