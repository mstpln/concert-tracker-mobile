'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');

test('My Concerts feature cards gain inset outlines without changing their box dimensions', () => {
  assert.match(css, /\.stats-teaser-card \{\n  box-shadow: inset 0 0 0 1px var\(--border\); border-radius: 10px;/);
  assert.match(css, /\.countdown-card \{\n  display: flex; box-shadow: inset 0 0 0 1px var\(--border\); border-radius: 10px;/);
  assert.match(css, /\.countdown-ring-wrap::before, \.countdown-ring-wrap::after \{[\s\S]*box-shadow: 0 0 0 1px var\(--border\);/);
});

test('countdown text is 20px and both card types use their focused preparation-group detail path', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(css, /#countdown-ring-day \{ fill: #ffffff; font-size: 20px; font-weight: 700; font-family: inherit; \}/);
  assert.match(css, /\.concert-prep-group \{ margin-top: 8px; border-top: 1px solid var\(--border\); \}/);
  assert.ok(app.includes('      ${isPast ? pastConcertDetailsGroupHtml(c) : concertPrepGroupHtml(c)}'));
});

test('My Concerts summary wrapper keeps equal outer gaps while preserving the card-to-card gap', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

  assert.match(app, /let html = '<div class="myconcerts-summary">';[\s\S]*?if \(past\.length > 0\) html \+= statsTeaserHtml[\s\S]*?html \+= countdownCardHtml\(upcoming\[0\] \|\| null\);[\s\S]*?html \+= '<\/div>';/);
  assert.match(css, /\.myconcerts-summary \{[\s\S]*?--myconcerts-summary-outer-gap: 64px;[\s\S]*?margin-top: calc\(var\(--myconcerts-summary-outer-gap\) - 12px\);[\s\S]*?margin-bottom: var\(--myconcerts-summary-outer-gap\);[\s\S]*?\}/);
  assert.match(css, /\.myconcerts-summary \.countdown-card \{ margin-bottom: 0; \}/);
  assert.match(css, /\.stats-teaser-card \{[\s\S]*?background: var\(--header-bg\); margin-bottom: 16px; overflow: hidden;/);
});
