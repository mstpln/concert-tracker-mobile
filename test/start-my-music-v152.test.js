'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const aligned = fs.readFileSync(path.join(root, 'alignedUiV143.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

 test('v152 presents the stable myconcerts root as MyMusic with the approved equalizer icon', () => {
  assert.match(aligned, /TAB_BRAND_HTML\.myconcerts = '<span class="brand-blue">MY<\/span>MUSIC'/);
  assert.match(aligned, /TAB_TITLES\.myconcerts = 'My Music'/);
  assert.match(aligned, /M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5/);
  assert.match(aligned, /node\.textContent = 'Music'/);
  assert.match(app, /const TAB_SCREENS = \{ concerts: 'screen-concerts', myconcerts: 'screen-myconcerts'/);
});

test('v152 preserves shared active-tab behavior rather than adding Music-specific selected styling', () => {
  assert.match(app, /function setActiveBottomTab\(tab\)/);
  assert.match(app, /button\.classList\.toggle\('active', active\)/);
  assert.doesNotMatch(aligned, /classList\.add\('active'\)/);
});

test('v152 inserts Next concert immediately before the existing countdown using the exact Upcoming divider hook', () => {
  assert.match(aligned, /nextLabel\.className = 'section-label section-label-v143-upcoming section-label-v152-next'/);
  assert.match(aligned, /nextLabel\.textContent = 'Next concert'/);
  assert.match(aligned, /countdown\.before\(nextLabel\)/);
});
