'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'icons.js'), 'utf8');
const discover = fs.readFileSync(path.join(root, 'discoverV170.js'), 'utf8');

function tabLabels() {
  return ['myconcerts', 'concerts', 'mybands', 'stats', 'news'].map((tab) => {
    const match = index.match(new RegExp(`<button class="tabitem(?: active)?" data-tab="${tab}">([\\s\\S]*?)<\\/button>`));
    return { tab, label: match[1].replace(/<[^>]+>/g, '').trim() };
  });
}

test('bottom navigation uses concise visible labels without changing internal tab identifiers', () => {
  assert.deepEqual(tabLabels(), [
    { tab: 'myconcerts', label: 'Concerts' },
    { tab: 'concerts', label: 'Discover' },
    { tab: 'mybands', label: 'Bands' },
    { tab: 'stats', label: 'Stats' },
    { tab: 'news', label: 'Alerts' },
  ]);
  assert.match(app, /stats: 'screen-stats'/);
});

test('Discover replaces the Dates presentation while preserving the stable concerts tab', () => {
  assert.match(icons, /globe:/);
  assert.match(app, /const TAB_NAV_ICONS = \{ concerts: 'calendarPlain', myconcerts: 'ticketStub', mybands: 'users', stats: 'statsBars', news: 'bell' \};/);
  assert.match(app, /const TAB_HEADER_ICONS = \{ concerts: 'music', myconcerts: 'ticketStub', mybands: 'users', stats: 'statsBars', news: 'bell' \};/);
  assert.match(discover, /TAB_NAV_ICONS\.concerts = 'globe'/);
  assert.match(discover, /TAB_HEADER_ICONS\.concerts = 'globe'/);
  assert.match(discover, /TAB_TITLES\.concerts = 'Discover'/);
  assert.match(discover, /TAB_BRAND_HTML\.concerts = '<span class="brand-blue">DISCOVER<\/span>CONCERTS'/);
  assert.match(discover, /TAB_BRAND_HTML\.mybands = 'MY<span class="brand-blue">BANDS<\/span>'/);
});
