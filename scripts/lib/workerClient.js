'use strict';
// Thin GET/PUT wrapper around the Cloudflare Worker. The default export keeps
// the existing research-automation credential contract; maintenance code may
// create a separate client with its own least-privilege token environment.

const config = require('./config');
const conflictMerge = require('../../conflictMerge');
const networkPolicy = require('./networkPolicy');

networkPolicy.install(globalThis);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function reconcileCallerData(target, value) {
  if (Array.isArray(target) && Array.isArray(value)) {
    target.splice(0, target.length, ...clone(value));
    return target;
  }
  if (target && value && typeof target === 'object' && typeof value === 'object' && !Array.isArray(target) && !Array.isArray(value)) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, clone(value));
    return target;
  }
  return value;
}

function getEnvOrThrow(name, env = process.env) {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function createWorkerClient({ endpointEnv = config.WORKER.endpointEnv, tokenEnv = config.WORKER.tokenEnv, env = process.env, fetchImpl = fetch } = {}) {
  const documentState = new Map();
  const endpoint = () => getEnvOrThrow(endpointEnv, env).replace(/\/+$/, '');
  const token = () => getEnvOrThrow(tokenEnv, env);

  async function readJson(filename, fallback) {
    const res = await fetchImpl(`${endpoint()}/${filename}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (res.status === 404) {
      documentState.set(filename, { etag: null, missing: true, value: clone(fallback) });
      return fallback;
    }
    if (!res.ok) throw new Error(`GET ${filename} failed: ${res.status} ${await res.text()}`);
    const text = await res.text();
    const value = text.trim() ? JSON.parse(text) : fallback;
    documentState.set(filename, { etag: res.headers.get('ETag'), missing: false, value: clone(value) });
    return value;
  }

  async function putJson(filename, data, state) {
    const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
    if (state?.missing) headers['If-None-Match'] = '*';
    else if (state?.etag) headers['If-Match'] = state.etag;
    return fetchImpl(`${endpoint()}/${filename}`, { method: 'PUT', headers, body: JSON.stringify(data, null, 2) });
  }

  async function writeJson(filename, data) {
    let state = documentState.get(filename);
    if (!state) {
      await readJson(filename, undefined);
      state = documentState.get(filename);
    }
    // The state cached by the latest GET may already contain a user-reviewed
    // nested provider decision made after automation started. Preserve those
    // whole objects before the first PUT so a stale generated payload cannot
    // erase them even when no ETag conflict occurs.
    let intended = conflictMerge.preserveReviewedDecisions(state?.value, clone(data));
    let res = await putJson(filename, intended, state);
    if (res.status === 412) {
      const base = clone(state?.value);
      const latest = await readJson(filename, undefined);
      const latestState = documentState.get(filename);
      intended = conflictMerge.merge(base, intended, latest);
      res = await putJson(filename, intended, latestState);
    }
    if (!res.ok) throw new Error(`PUT ${filename} failed: ${res.status} ${await res.text()}`);
    documentState.set(filename, { etag: res.headers.get('ETag'), missing: false, value: clone(intended) });
    return reconcileCallerData(data, intended);
  }

  async function writeJsonStrict(filename, data) {
    let state = documentState.get(filename);
    if (!state) {
      await readJson(filename, undefined);
      state = documentState.get(filename);
    }
    const intended = clone(data);
    const res = await putJson(filename, intended, state);
    if (res.status === 412) {
      await readJson(filename, undefined);
      const error = new Error(`PUT ${filename} conflict: document changed after validation`);
      error.code = 'ETAG_CONFLICT';
      error.status = 412;
      throw error;
    }
    if (!res.ok) throw new Error(`PUT ${filename} failed: ${res.status} ${await res.text()}`);
    documentState.set(filename, { etag: res.headers.get('ETag'), missing: false, value: clone(intended) });
    return reconcileCallerData(data, intended);
  }

  function resetDocumentState() { documentState.clear(); }
  return { readJson, writeJson, writeJsonStrict, resetDocumentState };
}

const defaultClient = createWorkerClient();
module.exports = { ...defaultClient, createWorkerClient, getEnvOrThrow };