'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('discoverV170.js', 'utf8');
const worker = fs.readFileSync('worker.js', 'utf8');
const qa = fs.readFileSync('qa/qa-bootstrap.js', 'utf8');

test('Discover Add rereads bands, uses conditional writes, preserves provider ownership and checkpoints normal enrichment', () => {
  assert.match(ui, /dlReadJsonFile\(connection, 'bands\.json', \[\]\)/);
  assert.match(ui, /dlWriteJsonFileIfCurrent\(connection, 'bands\.json', persisted\)/);
  assert.match(ui, /preparePendingArtistEnrichment/);
  assert.match(ui, /discoverRecommendation:\s*\{/);
  assert.doesNotMatch(ui, /discoverProvenance/);
  assert.match(ui, /status: 'manual_confirmed'/);
  assert.match(ui, /matchMethod: 'discover_user_add'/);
  assert.match(ui, /showAddedState\(button\)/);
  assert.match(ui, /button\.textContent = 'Added ✓'/);
  assert.match(ui, /card\.querySelector\('\[data-discover-dismiss\]'\)\?\.remove\(\)/);
});

test('Discover recommendation storage is bounded, browser-only, validated on read/write and conditional', () => {
  assert.match(worker, /DISCOVER_RECOMMENDATIONS_FILE = 'discoverRecommendations\.json'/);
  assert.match(worker, /MAX_DISCOVER_RECOMMENDATIONS_BYTES = 512 \* 1024/);
  assert.match(worker, /filename===DISCOVER_RECOMMENDATIONS_FILE&&role!=='browser'/);
  assert.match(worker, /discoverRecommendationsIsValid\(parsed\)/);
  assert.match(worker, /requiredWriteCondition\(request,env,filename\)/);
  assert.match(worker, /groups\.length>30/);
  assert.match(worker, /group\.candidates\.length>20/);
  assert.match(worker, /Object\.keys\(value\.decisions\)\.length>10000/);
});

test('synthetic QA backend supports Discover state while blocking every external provider origin', () => {
  assert.match(qa, /'discoverRecommendations\.json'/);
  assert.match(qa, /__LIVEVAULT_QA_FAKE_BACKEND__ = true/);
  assert.match(qa, /QA blocked external request/);
  assert.doesNotMatch(qa, /listenbrainz\.org|spotify\.com|musicbrainz\.org/);
});
