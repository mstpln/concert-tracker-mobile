'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const remoteStore = fs.readFileSync('remoteStore.js', 'utf8');
const reviewUi = fs.readFileSync('listeningSpotifyIdentityReviewUi.js', 'utf8');

test('Spotify identity decisions use a conditional write that never conflict-merges stale review data', () => {
  assert.match(remoteStore, /async function dlWriteJsonFileIfCurrent\(/);
  const helper = remoteStore.slice(
    remoteStore.indexOf('async function dlWriteJsonFileIfCurrent('),
    remoteStore.indexOf('async function dlWriteJsonFile(', remoteStore.indexOf('async function dlWriteJsonFileIfCurrent(')),
  );
  assert.match(helper, /res\.status === 412/);
  assert.match(helper, /changed\. Review the latest data before saving again/);
  assert.doesNotMatch(helper, /LiveVaultConflictMerge\.merge/);
  assert.match(reviewUi, /await dlWriteJsonFileIfCurrent\(remote, 'bands\.json', result\.bands\)/);
  assert.doesNotMatch(reviewUi, /await dlWriteJsonFile\(remote, 'bands\.json', result\.bands\)/);
});
