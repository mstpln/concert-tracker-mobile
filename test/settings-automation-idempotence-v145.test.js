'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../settingsAutomationReportingV145');

test('album coverage rendering is idempotent so the Settings observer cannot retrigger itself forever', () => {
  const detail = { textContent:'' };
  let html = '';
  let htmlWrites = 0;
  const value = {
    className:'',
    get innerHTML() { return html; },
    set innerHTML(next) { htmlWrites += 1; html = next; },
  };
  const fill = { className:'', style:{ width:'' } };
  const attributes = new Map();
  const progress = {
    querySelector(selector) { return selector === 'span' ? fill : null; },
    setAttribute(name, next) { attributes.set(name, String(next)); },
  };
  const metric = {
    querySelector(selector) {
      if (selector === '.settings-v123-row-head div p') return detail;
      if (selector === '.settings-v123-metric-value') return value;
      if (selector === '.settings-v123-progress') return progress;
      return null;
    },
  };
  const screen = {
    querySelector(selector) { return selector === '[data-v123-metric="Album artwork"]' ? metric : null; },
  };
  const bands = [{ id:'band-a', name:'Artist A' }];
  const events = [{ localBandId:'band-a', releaseTitle:'Album A', spotifyTrackId:'track-a' }];
  const metadata = { recordForTrack(){ return { artworkUrl:'https://example.invalid/a.jpg' }; } };

  assert.equal(settings.applyAlbumCoverage(screen, bands, events, metadata), true);
  assert.equal(settings.applyAlbumCoverage(screen, bands, events, metadata), true);
  assert.equal(htmlWrites, 1);
  assert.equal(html, '<i></i>100%');
  assert.equal(detail.textContent, '1 of 1 listened albums');
  assert.equal(attributes.get('aria-valuenow'), '100');
});
