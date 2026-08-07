'use strict';

const fs = require('node:fs');

function assert(condition, message) {
  if (!condition) throw new Error(`Cloudflare Builds validation failed: ${message}`);
}

const configText = fs.readFileSync('wrangler.jsonc', 'utf8');
const config = JSON.parse(configText);
assert(config.name === 'concert-tracker-api', 'Worker name must match the existing production Worker');
assert(config.main === './workerV104.js', 'Worker entry point must use the reviewed v104 wrapper');
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date), 'compatibility_date must be explicit');
assert(config.workers_dev === true, 'workers.dev route must remain enabled');
assert(config.preview_urls === true, 'preview URLs must remain enabled for safe branch builds');
assert(Array.isArray(config.r2_buckets) && config.r2_buckets.length === 1, 'exactly one R2 binding is expected');
assert(config.r2_buckets[0].binding === 'BUCKET', 'R2 binding name must remain BUCKET');
assert(config.r2_buckets[0].bucket_name === 'concert-tracker-data', 'R2 bucket must remain concert-tracker-data');
assert(!configText.match(/BROWSER_TOKEN|AUTOMATION_TOKEN|READ_ONLY_TOKEN|API_TOKEN/), 'runtime secrets must not be committed');

const wrapper = fs.readFileSync('workerV104.js', 'utf8');
assert(wrapper.includes("import baseWorker from './worker.js'"), 'v104 wrapper must delegate existing Worker behavior');
assert(wrapper.includes("const ROUTE = '/musicbrainz/release-context'"), 'v104 wrapper must expose only the reviewed MusicBrainz context route');
assert(wrapper.includes("env.BROWSER_TOKEN") && !wrapper.includes('env.AUTOMATION_TOKEN'), 'MusicBrainz context route must remain browser-role only');
assert(wrapper.includes("upstream.searchParams.set('inc', 'release-groups')"), 'MusicBrainz lookup must request release-group context from an exact release');
assert(wrapper.includes("'User-Agent': USER_AGENT"), 'MusicBrainz requests must carry the reviewed meaningful User-Agent');
assert(!/BUCKET\.(?:put|delete)\s*\(/.test(wrapper), 'MusicBrainz context wrapper must not write R2 data');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert(packageJson.scripts['qa:cloudflare-builds'] === 'node scripts/qa-cloudflare-builds.js', 'package script must run the Cloudflare Builds guard');
assert(packageJson.scripts['qa:all'].includes('qa:cloudflare-builds'), 'full QA must include the Cloudflare Builds guard');

console.log('Cloudflare Builds configuration checks passed');
