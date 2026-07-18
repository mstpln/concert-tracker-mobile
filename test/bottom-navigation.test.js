'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'icons.js'), 'utf8');

function tabLabels() {
  return ['myconcerts', 'concerts', 'mybands', 'news'].map((tab) => {
    const match = index.match(new RegExp(`<button class="tabitem(?: active)?" data-tab="${tab}">([\\s\\S]*?)<\\/button>`));
    return { tab, label: match[1].replace(/<[^>]+>/g, '').trim() };
  });
}

test('bottom navigation uses concise visible labels without changing internal tab identifiers', () => {
  assert.deepEqual(tabLabels(), [
    { tab: 'myconcerts', label: 'Concerts' },
    { tab: 'concerts', label: 'Dates' },
    { tab: 'mybands', label: 'Bands' },
    { tab: 'news', label: 'Alerts' },
  ]);
  assert.match(app, /const TAB_SCREENS = \{ concerts: 'screen-concerts', myconcerts: 'screen-myconcerts', mybands: 'screen-mybands', news: 'screen-news' \};/);
});

test('Dates uses the calendar only in bottom navigation while ConcertDates retains its header icon', () => {
  assert.match(icons, /calendarPlain:/);
  assert.match(app, /const TAB_NAV_ICONS = \{ concerts: 'calendarPlain', myconcerts: 'ticketStub', mybands: 'users', news: 'bell' \};/);
  assert.match(app, /const TAB_HEADER_ICONS = \{ concerts: 'music', myconcerts: 'ticketStub', mybands: 'users', news: 'bell' \};/);
  assert.match(app, /btn\.querySelector\('\.tab-icon'\)\.innerHTML = icon\(TAB_NAV_ICONS\[btn\.dataset\.tab\] \|\| 'music'\)/);
  assert.match(app, /el\('header-icon'\)\.innerHTML = icon\(TAB_HEADER_ICONS\[tab\] \|\| 'music'\)/);
  assert.match(app, /concerts: '<span class="brand-blue">CONCERT<\/span>DATES'/);
  assert.match(app, /myconcerts: '<span class="brand-blue">MY<\/span>CONCERTS'/);
});
