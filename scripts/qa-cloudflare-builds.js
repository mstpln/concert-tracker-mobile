'use strict';

const fs = require('node:fs');

function assert(condition, message) {
  if (!condition) throw new Error(`Cloudflare Builds validation failed: ${message}`);
}

const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
assert(config.name === 'concert-tracker-api', 'Worker name must match the existing production Worker');
assert(config.main === './worker.js', 'Worker entry point must remain worker.js');
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date), 'compatibility_date must be explicit');
assert(config.workers_dev === true, 'workers.dev route must remain enabled');
assert(config.preview_urls === true, 'preview URLs must remain enabled for safe branch builds');
assert(Array.isArray(config.r2_buckets) && config.r2_buckets.length === 1, 'exactly one R2 binding is expected');
assert(config.r2_buckets[0].binding === 'BUCKET', 'R2 binding name must remain BUCKET');
assert(config.r2_buckets[0].bucket_name === 'concert-tracker-data', 'R2 bucket must remain concert-tracker-data');
assert(!fs.readFileSync('wrangler.jsonc', 'utf8').match(/BROWSER_TOKEN|AUTOMATION_TOKEN|READ_ONLY_TOKEN|API_TOKEN/), 'runtime secrets must not be committed');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert(packageJson.scripts['qa:cloudflare-builds'] === 'node scripts/qa-cloudflare-builds.js', 'package script must run the Cloudflare Builds guard');
assert(packageJson.scripts['qa:all'].includes('qa:cloudflare-builds'), 'full QA must include the Cloudflare Builds guard');

console.log('Cloudflare Builds configuration checks passed');
