'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const icons = fs.readFileSync(path.join(__dirname, '..', 'icons.js'), 'utf8');

test('Stage 1 renders the four preparation rows only through the upcoming card path', () => {
  assert.match(app, /isPast \? mcLinksRowHtml\(c, true\) : concertPrepGroupHtml\(c\)/);
  const order = ['Playlist', 'Weather forecast', 'Predicted setlist', 'Checklist'];
  let at = 0; for (const label of order) { const next = app.indexOf(`'${label}'`, at); assert.ok(next >= at); at = next + 1; }
});
test('Stage 1 uses the Spotify and local preparation icons, not music for Playlist', () => {
  assert.match(app, /\['playlist', 'spotify', 'Playlist'/); assert.doesNotMatch(app, /\['playlist', 'music', 'Playlist'/);
  assert.match(icons, /weather:/); assert.match(icons, /checklist:/);
});
test('past and upcoming playlist UI share the Spotify icon helper', () => {
  assert.match(app, /field: 'playlistUrl', iconName: 'spotify', label: 'Playlist'/);
  assert.match(app, /\['playlist', 'spotify', 'Playlist'/);
  assert.doesNotMatch(app, /field: 'playlistUrl', iconName: 'music', label: 'Playlist'/);
});
test('Stage 1 preserves manual playlistUrl and stores only additive checklist data', () => {
  assert.match(app, /c\.playlistUrl/); assert.match(app, /c\.prepChecklist = \{ ticketReady: false, travelPlanned: false, timesChecked: false, venueRulesChecked: false, playlistReady: false/);
  assert.match(app, /PREP_CHECKLIST = \[/); assert.doesNotMatch(app, /custom checklist/i);
});
test('Stage 1 rows are accessible, independently expandable, preserve transient open state, and do not add providers', () => {
  assert.match(app, /aria-expanded="\$\{isOpen\}"/); assert.match(app, /aria-controls=/); assert.match(app, /group\.querySelectorAll\('\.concert-prep-panel'\)/); assert.match(app, /prepOpenPanels/);
  assert.match(app, /ev\.stopPropagation\(\)/); assert.doesNotMatch(app, /open-meteo|pkce|authorization code/i);
});
test('checklist clicks and labels cannot open a band profile, while ordinary card clicks still can', () => {
  const navigationHandler = app.slice(app.indexOf("container.querySelectorAll('.row-card[data-band-id]')"), app.indexOf('// Playlist/Photos/Setlist row'));
  assert.match(navigationHandler, /ev\.target\.closest\('\.concert-prep-group'\)/);
  assert.match(navigationHandler, /openProfile\(row\.dataset\.bandId\)/);
  assert.match(app, /querySelectorAll\('\.concert-prep-group'\)[\s\S]*?group\.addEventListener\('click', \(ev\) => ev\.stopPropagation\(\)\)/);
  assert.match(app, /querySelectorAll\('\[data-prep-key\]'\)[\s\S]*?input\.addEventListener\('click', \(ev\) => ev\.stopPropagation\(\)\)/);
});
test('checklist changes still persist the clicked value and retain rollback behavior', () => {
  assert.match(app, /\[input\.dataset\.prepKey\]: input\.checked/);
  assert.match(app, /dlWriteJsonFile\(remote, 'concerts\.json', concerts\); refresh\(\)/);
  assert.match(app, /c\.prepChecklist = previous; input\.checked = !input\.checked/);
});
test('Stage 1 placeholder copy is exact and prediction remains renderer-only', () => {
  assert.match(app, /Available 10 days before the concert/); assert.match(app, /Prediction not available/); assert.match(app, /Prediction is being prepared/); assert.match(app, /Not enough recent setlists yet/);
  assert.match(app, /Create a playlist from the Playlist section\./);
});
