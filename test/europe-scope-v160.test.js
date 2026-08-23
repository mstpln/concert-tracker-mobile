'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EuropeScope = require('../europeScopeV160');
const Scheduler = require('../scripts/venueMetadataResearchRun');

const ROOT = path.resolve(__dirname, '..');

test('BANDMARKR EU means the full Europe product scope, not political EU membership', () => {
  const european = [
    'Sweden', 'Norway', 'Iceland', 'United Kingdom', 'Great Britain', 'England', 'Scotland',
    'Switzerland', 'Turkey', 'Türkiye', 'Serbia', 'Albania', 'Andorra', 'Armenia',
    'Azerbaijan', 'Belarus', 'Bosnia and Herzegovina', 'Bulgaria', 'Cyprus', 'Georgia',
    'Kosovo', 'Liechtenstein', 'Malta', 'Moldova', 'Monaco', 'Montenegro',
    'North Macedonia', 'Russia', 'San Marino', 'Ukraine', 'Vatican City',
    'SE', 'NO', 'IS', 'GB', 'CH', 'TR', 'RS', 'AL', 'BA', 'BG', 'CY', 'GE', 'MD', 'UA',
  ];
  for (const country of european) {
    assert.equal(EuropeScope.isEuropeCountry(country), true, `${country} should be Europe`);
    assert.equal(Scheduler.isEuCountry(country), true, `scheduler should share Europe scope for ${country}`);
  }

  for (const country of ['USA', 'US', 'Canada', 'CA', 'Australia', 'AU', 'Japan', 'JP', 'Israel', '', null]) {
    assert.equal(EuropeScope.isEuropeCountry(country), false, `${country} should not be Europe`);
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
  assert.equal(context.dlIsEuropeCountry('Ukraine'), true);
  assert.equal(context.dlIsEuropeCountry('USA'), false);
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
