'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const feedback = require('../interactionFeedbackV129.js');

const css = fs.readFileSync(path.join(__dirname, '..', 'stateFeedbackV129.css'), 'utf8');
const integration = fs.readFileSync(path.join(__dirname, '..', 'stateFeedbackIntegrationV129.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');

test('v130 separates Past Concerts while trusting existing renderer ownership', () => {
  assert.match(css, /#screen-myconcerts \.section-label-gap-lg/);
  assert.match(css, /#screen-myconcerts \.section-label-gap-lg::before/);
  assert.match(css, /#screen-myconcerts \.row-card-mc\.is-past \{ background: #1d2124; \}/);
  assert.doesNotMatch(integration, /renderMyConcertsScreen|innerHTML|classList\.toggle\('is-past'/);
});

test('v130 countdown uses the approved two-tone show-day yellow family', () => {
  assert.match(css, /--countdown-yellow:\s*#f2c230/);
  assert.match(css, /--countdown-yellow-light:\s*#f7d968/);
  assert.match(css, /#countdown-ring-outer \{ stroke: var\(--countdown-yellow\); \}/);
  assert.match(css, /#countdown-ring-inner \{ stroke: var\(--countdown-yellow-light\); \}/);
});

test('v130 processing feedback is part of the app shell and controller suppresses duplicate keys', () => {
  assert.match(html, /id="interaction-progress"/);
  assert.match(html, /interactionFeedbackV129\.js/);
  assert.match(html, /stateFeedbackIntegrationV129\.js/);
  const first = feedback.begin({ key: 'save:test', delayMs: 1000 });
  assert.ok(first);
  assert.equal(feedback.begin({ key: 'save:test', delayMs: 1000 }), null);
  assert.equal(feedback.isPending('save:test'), true);
  assert.equal(feedback.end(first), true);
  assert.equal(feedback.isPending('save:test'), false);
});

test('v130 processing controller keeps overlapping operations independent', () => {
  const first = feedback.begin({ key: 'one', delayMs: 1000 });
  const second = feedback.begin({ key: 'two', delayMs: 1000 });
  assert.equal(feedback.snapshot().pending, 2);
  feedback.end(first);
  assert.equal(feedback.snapshot().pending, 1);
  assert.equal(feedback.isPending('two'), true);
  feedback.end(second);
  assert.equal(feedback.snapshot().pending, 0);
});

test('v130 processing line has no layout height, uses app blue and reduced motion is static', () => {
  assert.match(css, /\.interaction-progress \{[\s\S]*flex: 0 0 0;[\s\S]*height: 0;/);
  assert.match(css, /background: var\(--accent\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;[\s\S]*transform: translateX\(0\)/);
  assert.match(serviceWorker, /'\.\/interactionFeedbackV129\.js'/);
  assert.match(serviceWorker, /'\.\/stateFeedbackIntegrationV129\.js'/);
  assert.match(serviceWorker, /'\.\/stateFeedbackV129\.css'/);
});

test('v130 feedback follows user-initiated async lifetime and rendered DOM settlement', () => {
  assert.match(integration, /function installFetchTracking/);
  assert.match(integration, /function installIndexedDbTracking/);
  assert.match(integration, /IDBDatabase\?\.prototype/);
  assert.match(integration, /transaction\.addEventListener\('complete', finish/);
  assert.match(integration, /transaction\.addEventListener\('abort', finish/);
  assert.doesNotMatch(integration, /transaction\.addEventListener\('error', finish/);
  assert.match(integration, /context\.inFlight \+= 1/);
  assert.match(integration, /function trackPromise\(context, work\)/);
  assert.match(integration, /Promise\.resolve\(work\)\.finally/);
  assert.match(integration, /new root\.MutationObserver/);
  assert.match(integration, /root\.requestAnimationFrame\(\(\) => root\.requestAnimationFrame\(settle\)\)/);
  assert.match(integration, /installFetchTracking\(\);\s*installIndexedDbTracking\(\);\s*installUserActionFeedback\(\);/);
  assert.doesNotMatch(integration, /setTimeout\(finish,\s*180\)/);
});

test('v130 duplicate suppression uses stable control data so repeated labels remain independent', () => {
  assert.match(integration, /feedback\.isPending\(key\)/);
  assert.match(integration, /event\.stopImmediatePropagation\(\)/);
  assert.match(integration, /function ownDataKey\(actionable\)/);
  assert.match(integration, /if \(ownData\) return `data:\$\{ownData\}`/);
  assert.match(integration, /\.clickable/);
});
