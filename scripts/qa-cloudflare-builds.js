'use strict';

const fs = require('node:fs');

function assert(condition, message) {
  if (!condition) throw new Error(`Cloudflare Builds validation failed: ${message}`);
}

const configText = fs.readFileSync('wrangler.jsonc', 'utf8');
const config = JSON.parse(configText);
assert(config.name === 'concert-tracker-api', 'Worker name must match the existing production Worker');
assert(config.main === './workerV158.js', 'Worker entry point must include the reviewed v158 venue metadata wrapper');
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date), 'compatibility_date must be explicit');
assert(config.workers_dev === true, 'workers.dev route must remain enabled');
assert(config.preview_urls === true, 'preview URLs must remain enabled for safe branch builds');
assert(Array.isArray(config.r2_buckets) && config.r2_buckets.length === 1, 'exactly one R2 binding is expected');
assert(config.r2_buckets[0].binding === 'BUCKET', 'R2 binding name must remain BUCKET');
assert(config.r2_buckets[0].bucket_name === 'concert-tracker-data', 'R2 bucket must remain concert-tracker-data');
assert(!configText.match(/BROWSER_TOKEN|AUTOMATION_TOKEN|READ_ONLY_TOKEN|API_TOKEN/), 'runtime secrets must not be committed');

const worker = fs.readFileSync('worker.js', 'utf8');
assert(worker.includes("const MUSICBRAINZ_RELEASE_CONTEXT_PATH = '/musicbrainz/release-context'"), 'reviewed MusicBrainz context route must live in the watched Worker');
assert(worker.includes("upstream.searchParams.set('inc','release-groups')"), 'MusicBrainz lookup must request release-group context from an exact release');
assert(worker.includes("'User-Agent':MUSICBRAINZ_USER_AGENT"), 'MusicBrainz requests must carry the reviewed meaningful User-Agent');
assert(worker.includes("if(role!=='browser')return response('Forbidden',{status:403})"), 'MusicBrainz context route must remain browser-role only');
assert(worker.includes('MUSICBRAINZ_TIMEOUT_MS = 10000'), 'MusicBrainz provider request must remain timeout-bounded');

const venueWorker = fs.readFileSync('workerV158.js', 'utf8');
assert(venueWorker.includes("import baseWorker from './worker.js'"), 'venue wrapper must delegate existing Worker routes');
assert(venueWorker.includes("const VENUE_FILE = 'venues.json'"), 'venue wrapper must expose only the reviewed venue document');
assert(venueWorker.includes("if (role !== 'data-maintenance') return response('Forbidden', { status: 403 })"), 'venue metadata writes must remain data-maintenance only');
assert(!/TAVILY_API_KEY|GROQ_API_KEY/.test(venueWorker), 'venue Worker wrapper must not embed provider secrets');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert(packageJson.scripts['qa:cloudflare-builds'] === 'node scripts/qa-cloudflare-builds.js', 'package script must run the Cloudflare Builds guard');
assert(packageJson.scripts['qa:all'].includes('qa:cloudflare-builds'), 'full QA must include the Cloudflare Builds guard');

console.log('Cloudflare Builds configuration checks passed');
