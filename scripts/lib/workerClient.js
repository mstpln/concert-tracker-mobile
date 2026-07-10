'use strict';
// Thin GET/PUT wrapper around the Cloudflare Worker, used to read and
// overwrite bands.json / concerts.json / news.json / apiUsage.json. Node 18+
// on the GitHub Actions runner ships a global fetch, so no extra dependency
// is needed.

const config = require('./config');

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
  if (res.status === 404) return fallback;
  if (!res.ok) throw new Error(`GET ${filename} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  if (!text.trim()) return fallback;
  return JSON.parse(text);
}

async function writeJson(filename, data) {
  const res = await fetch(`${endpoint()}/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!res.ok) throw new Error(`PUT ${filename} failed: ${res.status} ${await res.text()}`);
}

module.exports = { readJson, writeJson };
