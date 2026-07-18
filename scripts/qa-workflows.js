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

for (const [name, workflow] of workflows) {
  assert(!workflow.source.includes('permissions: write-all'), `${name} must not grant write-all permissions`);
}

console.log('Workflow structure and safety checks passed');
