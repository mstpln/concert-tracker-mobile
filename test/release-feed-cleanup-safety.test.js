'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cleanup = require('../scripts/cleanupReleaseFeed');

test('legacy release cleanup refuses production mutation without the explicit confirmation phrase', async () => {
  let writes = 0;
  await assert.rejects(() => cleanup.main({
    env: {},
    workerClient: { async writeJsonReconciled() { writes += 1; } },
    log: () => {},
  }), /CLEAN_LEGACY_RELEASE_FEED/);
  assert.equal(writes, 0);
});

test('legacy release cleanup refuses production mutation without a rollback path', async () => {
  let writes = 0;
  await assert.rejects(() => cleanup.main({
    env: { RELEASE_FEED_CLEANUP_CONFIRM: cleanup.PRODUCTION_CONFIRMATION },
    workerClient: { async writeJsonReconciled() { writes += 1; } },
    log: () => {},
  }), /RELEASE_FEED_BACKUP_PATH/);
  assert.equal(writes, 0);
});

test('legacy release cleanup refuses malformed or missing release feed state', async () => {
  let backups = 0;
  await assert.rejects(() => cleanup.main({
    env: { RELEASE_FEED_CLEANUP_CONFIRM: cleanup.PRODUCTION_CONFIRMATION, RELEASE_FEED_BACKUP_PATH: 'synthetic-backup.json' },
    workerClient: {
      async writeJsonReconciled(_filename, mutator) {
        return mutator(undefined);
      },
    },
    fsImpl: { writeFileSync() { backups += 1; } },
    log: () => {},
  }), /news\.json to contain an array/);
  assert.equal(backups, 0);
});

test('legacy release cleanup uses latest-state input and creates rollback data before returning the mutation', async () => {
  const latest = [
    { id: 'keep', category: 'album', spotifyReleaseId: 'abc123', spotifyUrl: 'https://open.spotify.com/album/abc123', releaseType: 'Album' },
    { id: 'remove', category: 'news', sourceUrl: 'https://example.com/article' },
  ];
  let written = null;
  let backup = null;
  const summary = await cleanup.main({
    env: { RELEASE_FEED_CLEANUP_CONFIRM: cleanup.PRODUCTION_CONFIRMATION, RELEASE_FEED_BACKUP_PATH: 'synthetic-backup.json' },
    workerClient: {
      async writeJsonReconciled(filename, mutator) {
        assert.equal(filename, 'news.json');
        written = mutator(latest);
        assert.ok(backup, 'rollback snapshot must exist before the reconciled write proceeds');
        return written;
      },
    },
    fsImpl: { writeFileSync(_path, value, options) { backup = value; assert.equal(options.flag, 'w'); } },
    log: () => {},
  });
  assert.equal(summary.before, 2);
  assert.equal(summary.after, 1);
  assert.deepEqual(written.map((item) => item.id), ['keep']);
  assert.deepEqual(JSON.parse(backup).map((item) => item.id), ['keep', 'remove']);
});

test('release cleanup workflow exposes the same explicit confirmation input', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-feed-cleanup.yml'), 'utf8');
  assert.match(source, /confirm:/);
  assert.match(source, /CLEAN_LEGACY_RELEASE_FEED/);
  assert.match(source, /RELEASE_FEED_CLEANUP_CONFIRM:\s*\$\{\{ inputs\.confirm \}\}/);
  assert.match(source, /RELEASE_FEED_BACKUP_PATH:/);
});
