'use strict';

const EXPECTED_FILES = {
  'bands.json': 'array',
  'concerts.json': 'array',
  'news.json': 'array',
  'apiUsage.json': 'object',
};
const ALLOWED_FILE_FIELDS = new Set(['ok', 'type', 'count', 'reason']);

const timeout = (url, options = {}) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(10000),
});

function validateSanitizedSmoke(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Sanitized production smoke returned an invalid object');
  if (typeof result.ok !== 'boolean' || !result.files || typeof result.files !== 'object' || Array.isArray(result.files)) throw new Error('Sanitized production smoke returned an invalid shape');

  const keys = Object.keys(result.files).sort();
  const expectedKeys = Object.keys(EXPECTED_FILES).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error('Sanitized production smoke returned unexpected file keys');

  for (const [filename, expectedType] of Object.entries(EXPECTED_FILES)) {
    const item = result.files[filename];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Sanitized production smoke returned invalid metadata for ${filename}`);
    for (const key of Object.keys(item)) if (!ALLOWED_FILE_FIELDS.has(key)) throw new Error(`Sanitized production smoke leaked an unexpected field for ${filename}`);
    if (typeof item.ok !== 'boolean') throw new Error(`Sanitized production smoke omitted status for ${filename}`);
    if (item.ok) {
      if (item.type !== expectedType) throw new Error(`Sanitized production smoke returned the wrong type for ${filename}`);
      if (expectedType === 'array' && (!Number.isInteger(item.count) || item.count < 0)) throw new Error(`Sanitized production smoke returned an invalid count for ${filename}`);
      if (expectedType === 'object' && item.count !== null) throw new Error(`Sanitized production smoke returned an unexpected object count for ${filename}`);
      if ('reason' in item) throw new Error(`Sanitized production smoke returned a failure reason for healthy ${filename}`);
    } else if (!['missing', 'invalid'].includes(item.reason)) {
      throw new Error(`Sanitized production smoke returned an invalid failure reason for ${filename}`);
    }
  }

  return result.ok;
}

async function main() {
  const endpoint = process.env.CF_WORKER_ENDPOINT;
  const token = process.env.CF_WORKER_READ_TOKEN;
  const app = (process.env.PRODUCTION_APP_URL || 'https://mstpln.github.io/concert-tracker-mobile/').replace(/\/$/, '');
  if (!endpoint || !token) throw new Error('Production smoke requires configured secrets.');

  for (const file of ['', '/manifest.json', '/version.js', '/service-worker.js']) {
    const res = await timeout(`${app}${file}`);
    if (!res.ok) throw new Error(`Public shell check failed: ${file || '/'}`);
  }

  const [version, worker] = await Promise.all([
    timeout(`${app}/version.js`).then((response) => response.text()),
    timeout(`${app}/service-worker.js`).then((response) => response.text()),
  ]);
  const appVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
  const cacheVersion = worker.match(/CACHE_NAME_LITERAL = '([^']+)'/)?.[1];
  if (!appVersion || appVersion !== cacheVersion) throw new Error('Production version/cache mismatch');

  const smoke = await timeout(`${endpoint.replace(/\/$/, '')}/qa-smoke`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const contentType = smoke.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Sanitized production smoke did not return JSON');
  const result = await smoke.json();
  const healthy = validateSanitizedSmoke(result);
  if (!smoke.ok || !healthy) throw new Error('Sanitized production smoke failed');

  console.log(`Production smoke passed: ${appVersion}; bands ${result.files['bands.json'].count}, concerts ${result.files['concerts.json'].count}, news ${result.files['news.json'].count}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { validateSanitizedSmoke };
