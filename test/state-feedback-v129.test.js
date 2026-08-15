'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const feedback = require('../interactionFeedbackV129.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'stateFeedbackV129.css'), 'utf8');
const concertCss = fs.readFileSync(path.join(__dirname, '..', 'concertCardsV86.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('v129 separates Past Concerts and scopes Deep Graphite to historical My Concerts cards', () => {
  assert.match(app, /myconcerts-past-divider/);
  assert.match(css, /\.myconcerts-past-divider::before/);
  assert.match(concertCss, /#screen-myconcerts \.row-card-mc\.is-past \{\s*background: #1d2124;/);
});

test('v129 countdown uses the show-day yellow family and keeps show-day yellow unchanged', () => {
  assert.match(css, /--countdown-yellow: #f2c230/);
  assert.match(css, /#countdown-ring-outer \{ stroke: var\(--countdown-yellow\); \}/);
  assert.match(css, /#countdown-ring-inner \{ stroke: var\(--countdown-yellow-light\); \}/);
  assert.match(app, /fill="#f2c230"/);
});

test('v129 processing feedback is part of the app shell and controller suppresses duplicate keys', async () => {
  assert.match(html, /id="interaction-progress"/);
  assert.match(html, /interactionFeedbackV129\.js/);
  assert.match(html, /stateFeedbackV129\.css/);
  const first = feedback.begin({ key: 'save:test', delayMs: 1000 });
  assert.ok(first);
  assert.equal(feedback.begin({ key: 'save:test', delayMs: 1000 }), null);
  assert.equal(feedback.isPending('save:test'), true);
  assert.equal(feedback.end(first), true);
  assert.equal(feedback.isPending('save:test'), false);
});

test('v129 processing controller keeps overlapping operations independent', () => {
  const first = feedback.begin({ key: 'one', delayMs: 1000 });
  const second = feedback.begin({ key: 'two', delayMs: 1000 });
  assert.equal(feedback.snapshot().pending, 2);
  feedback.end(first);
  assert.equal(feedback.snapshot().pending, 1);
  assert.equal(feedback.isPending('two'), true);
  feedback.end(second);
  assert.equal(feedback.snapshot().pending, 0);
});
