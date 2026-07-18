'use strict';
const timeout = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
async function main() {
  const endpoint = process.env.CF_WORKER_ENDPOINT; const token = process.env.CF_WORKER_READ_TOKEN; const app = (process.env.PRODUCTION_APP_URL || 'https://mstpln.github.io/concert-tracker-mobile/').replace(/\/$/, '');
  if (!endpoint || !token) throw new Error('Production smoke requires configured secrets.');
  for (const file of ['', '/manifest.json', '/version.js', '/service-worker.js']) { const res = await timeout(`${app}${file}`); if (!res.ok) throw new Error(`Public shell check failed: ${file || '/'}`); }
  const [version, worker] = await Promise.all([timeout(`${app}/version.js`).then((r) => r.text()), timeout(`${app}/service-worker.js`).then((r) => r.text())]); const appVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1]; const cacheVersion = worker.match(/CACHE_NAME_LITERAL = '([^']+)'/)?.[1]; if (!appVersion || appVersion !== cacheVersion) throw new Error('Production version/cache mismatch');
  const smoke = await timeout(`${endpoint.replace(/\/$/, '')}/qa-smoke`, { headers: { Authorization: `Bearer ${token}` } }); const result = await smoke.json(); if (!smoke.ok || !result?.ok || !result.files) throw new Error('Sanitized production smoke failed');
  console.log(`Production smoke passed: ${appVersion}; bands ${result.files['bands.json']?.count}, concerts ${result.files['concerts.json']?.count}, news ${result.files['news.json']?.count}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
