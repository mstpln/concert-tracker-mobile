'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('.github/workflows/listening-maintenance-dry-run.yml', 'utf8');

test('listening maintenance workflow remains manual, main-only and synthetic-only', () => {
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /RUN_SYNTHETIC_DRY_RUN/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /contents: read/);
  assert.match(source, /node scripts\/listening-maintenance-dry-run\.js/);
  assert.doesNotMatch(source, /schedule:/);
  assert.doesNotMatch(source, /secrets\./);
  assert.doesNotMatch(source, /CF_WORKER_/);
  assert.doesNotMatch(source, /SPOTIFY_CLIENT_/);
  assert.doesNotMatch(source, /LISTENBRAINZ_TOKEN/);
});
