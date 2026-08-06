'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const workflowDir = path.join('.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
const workflows = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(`Workflow validation failed: ${message}`);
}

for (const file of workflowFiles) {
  const source = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  const document = YAML.parse(source);
  assert(document && typeof document === 'object', `${file} must parse to an object`);
  workflows.set(file, { source, document });
  console.log(`workflow YAML valid: ${file}`);
}

function getWorkflow(name) {
  const workflow = workflows.get(name);
  assert(workflow, `missing ${name}`);
  return workflow;
}

const pr = getWorkflow('pr-qa.yml');
assert(pr.source.includes('pull_request:'), 'PR QA must run for pull requests');
assert(pr.source.includes('contents: read'), 'PR QA must use read-only repository permissions');
assert(pr.source.includes('cancel-in-progress: true'), 'PR QA must cancel superseded runs');
assert(pr.source.includes('Unit and safety checks'), 'PR QA must include unit and safety checks');
assert(pr.source.includes('Desktop Chromium QA'), 'PR QA must include desktop Chromium');
assert(pr.source.includes('Mobile Chromium QA'), 'PR QA must include mobile Chromium');
assert(pr.source.includes('npm run qa:safety'), 'PR QA must run the data safety guard');
assert(!pr.source.includes('pull_request_target'), 'PR QA must not use pull_request_target');
assert(!pr.source.includes('secrets.'), 'PR QA must not consume repository secrets');

const pwa = getWorkflow('full-pwa-qa.yml');
assert(pwa.source.includes('workflow_dispatch:'), 'Full PWA QA must remain manual');
assert(pwa.source.includes('contents: read'), 'Full PWA QA must use read-only repository permissions');
assert(pwa.source.includes('npm run qa:pwa'), 'Full PWA QA must run the dedicated PWA test');
assert(!pwa.source.includes('pull_request:'), 'Full PWA QA must not run for pull requests');
assert(!pwa.source.includes('schedule:'), 'Full PWA QA must not run on a schedule');
assert(!pwa.source.includes('secrets.'), 'Full PWA QA must not consume repository secrets');

const smoke = getWorkflow('production-smoke.yml');
assert(smoke.source.includes('workflow_dispatch:'), 'Production smoke must remain manual');
assert(smoke.source.includes('contents: read'), 'Production smoke must use read-only repository permissions');
assert(smoke.source.includes('CF_WORKER_READ_TOKEN'), 'Production smoke must use the read-only token');
assert(!smoke.source.includes('pull_request:'), 'Production smoke must not run for pull requests');
assert(!smoke.source.includes('schedule:'), 'Production smoke must not run on a schedule');

const scheduleGuard = "vars.LIVEVAULT_RESEARCH_SCHEDULES_ENABLED";
const structured = getWorkflow('research.yml');
assert(structured.source.includes("cron: '0 1 * * 1,3,5'"), 'structured research must define the Monday, Wednesday and Friday cadence');
assert(!structured.source.includes(scheduleGuard), 'structured scheduled execution must be enabled after rollout verification');
assert(structured.source.includes('preloadStructuredRun.js'), 'structured research must load the focused provider policy');
assert(!structured.source.includes('TAVILY_API_KEY'), 'structured research must not receive Tavily credentials');
assert(!structured.source.includes('GROQ_API_KEY'), 'structured research must not receive Groq credentials');
assert(!structured.source.includes('cleanupReleaseFeed.js'), 'destructive release cleanup must not run on a schedule');
assert(!structured.source.includes('queue: max'), 'structured research must use supported concurrency fields only');

const tavily = getWorkflow('tavily-concert-research.yml');
assert(tavily.source.includes("cron: '0 2 1,15 * *'"), 'focused Tavily research must define the twice-monthly cadence');
assert(!tavily.source.includes(scheduleGuard), 'focused Tavily scheduled execution must be enabled after rollout verification');
assert(tavily.source.includes('tavilyConcertRun.js'), 'focused Tavily workflow must use the concert-only runner');
assert(!tavily.source.includes('SPOTIFY_CLIENT_ID'), 'focused Tavily workflow must not receive Spotify credentials');
assert(!tavily.source.includes('TICKETMASTER_API_KEY'), 'focused Tavily workflow must not receive Ticketmaster credentials');
assert(!tavily.source.includes('queue: max'), 'focused Tavily research must use supported concurrency fields only');

const cleanup = getWorkflow('release-feed-cleanup.yml');
assert(cleanup.source.includes('workflow_dispatch:'), 'release cleanup must remain manual');
assert(!cleanup.source.includes('schedule:'), 'release cleanup must never be scheduled');
assert(cleanup.source.includes('news-before-v77-cleanup.json'), 'release cleanup must create a rollback backup');
assert(cleanup.source.includes('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'), 'release cleanup backup action must be pinned');
assert(!cleanup.source.includes('queue: max'), 'release cleanup must use supported concurrency fields only');

const spotifyCandidates = getWorkflow('spotify-candidate-acquisition.yml');
assert(spotifyCandidates.source.includes('workflow_dispatch:'), 'Spotify candidate acquisition must remain manual');
assert(!spotifyCandidates.source.includes('schedule:'), 'Spotify candidate acquisition must never be scheduled');
assert(spotifyCandidates.source.includes('ACQUIRE_SPOTIFY_CANDIDATES'), 'Spotify candidate acquisition must require explicit confirmation');
assert(spotifyCandidates.source.includes("github.ref == 'refs/heads/main'"), 'Spotify candidate acquisition must run only from main');
assert(spotifyCandidates.source.includes('SPOTIFY_CANDIDATE_BAND_CAP'), 'Spotify candidate acquisition must pass the explicit band cap');
assert(spotifyCandidates.source.includes('contents: read'), 'Spotify candidate acquisition must use read-only repository permissions');
assert(!spotifyCandidates.source.includes('queue: max'), 'Spotify candidate acquisition must use supported concurrency fields only');

for (const workflow of [structured, tavily, cleanup, spotifyCandidates]) {
  assert(workflow.source.includes('group: live-vault-data-writes'), 'production writers must share the data-write concurrency group');
  assert(workflow.source.includes('cancel-in-progress: false'), 'production writers must not cancel an active write');
}

for (const [name, workflow] of workflows) {
  assert(!workflow.source.includes('permissions: write-all'), `${name} must not grant write-all permissions`);
}

console.log('Workflow structure and safety checks passed');
