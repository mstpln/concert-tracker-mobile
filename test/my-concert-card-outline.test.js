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

test('countdown text is 20px and the existing preparation divider remains the only divider before Playlist', () => {
  assert.match(css, /#countdown-ring-day \{ fill: #ffffff; font-size: 20px; font-weight: 700; font-family: inherit; \}/);
  assert.match(css, /\.concert-prep-group \{ margin-top: 8px; \}/);
  assert.doesNotMatch(css, /\.concert-prep-group \{ margin-top: 8px; border-top:/);
});
