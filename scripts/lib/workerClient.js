'use strict';
// Thin GET/PUT wrapper around the Cloudflare Worker, used to read and
// overwrite bands.json / concerts.json / news.json / apiUsage.json. Node 18+
// on the GitHub Actions runner ships a global fetch, so no extra dependency
// is needed.

const config = require('./config');
const conflictMerge = require('../../conflictMerge');

const documentState = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function endpoint() {
  return getEnvOrThrow(config.WORKER.endpointEnv).replace(/\/+$/, '');
}

function token() {
  return getEnvOrThrow(config.WORKER.tokenEnv);
}

async function readJson(filename, fallback) {
  const res = await fetch(`${endpoint()}/${filename}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
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
  return fetch(`${endpoint()}/${filename}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data, null, 2),
  });
}

async function writeJson(filename, data) {
  let state = documentState.get(filename);
  if (!state || (!state.etag && !state.missing)) {
    await readJson(filename, undefined);
    state = documentState.get(filename);
  }

  let intended = clone(data);
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
  return intended;
}

function resetDocumentState() {
  documentState.clear();
}

module.exports = { readJson, writeJson, resetDocumentState };
