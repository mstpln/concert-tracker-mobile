'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EuropeScope = require('../europeScopeV160');
const Scheduler = require('../scripts/venueMetadataResearchRun');

const ROOT = path.resolve(__dirname, '..');

test('BANDMARKR EU means the app Europe scope, not political EU membership', () => {
  const european = [
    'Sweden', 'SE', 'Bulgaria', 'BG', 'Cyprus', 'CY', 'Malta', 'MT',
    'Czech Republic', 'CZ', 'Norway', 'NO', 'Iceland', 'IS',
    'United Kingdom', 'UK', 'Great Britain', 'GB', 'England',
    'Switzerland', 'CH', 'Turkey', 'TR', 'Serbia', 'RS',
  ];
  for (const country of european) {
    assert.equal(EuropeScope.isEuropeCountry(country), true, `${country} should be in BANDMARKR Europe`);
    assert.equal(Scheduler.isEuCountry(country), true, `scheduler should share Europe scope for ${country}`);
  }

  const outsideScope = [
    'USA', 'US', 'Canada', 'CA', 'Australia', 'AU', 'Japan', 'JP', 'Israel',
    'Albania', 'Georgia', 'Russia', 'Ukraine', '', null,
  ];
  for (const country of outsideScope) {
    assert.equal(EuropeScope.isEuropeCountry(country), false, `${country} should be outside BANDMARKR Europe`);
    assert.equal(Scheduler.isEuCountry(country), false, `scheduler should reject ${country}`);
  }
});

test('browser shell replaces the legacy dataLib Europe helper with the canonical scope', () => {
  const source = fs.readFileSync(path.join(ROOT, 'europeScopeV160.js'), 'utf8');
  const context = {
    dlIsEuropeCountry: () => false,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'europeScopeV160.js' });

  assert.equal(context.dlIsEuropeCountry('Norway'), true);
  assert.equal(context.dlIsEuropeCountry('Great Britain'), true);
  assert.equal(context.dlIsEuropeCountry('Bulgaria'), true);
  assert.equal(context.dlIsEuropeCountry('USA'), false);
  assert.equal(context.dlIsEuropeCountry('Albania'), false);
});

test('shared Europe scope is loaded after dataLib and cached by the service worker', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const dataLibIndex = html.indexOf('<script src="dataLib.js"></script>');
  const europeIndex = html.indexOf('<script src="europeScopeV160.js"></script>');

  assert.ok(dataLibIndex >= 0);
  assert.ok(europeIndex > dataLibIndex);
  assert.match(serviceWorker, /'\.\/europeScopeV160\.js'/);
});
