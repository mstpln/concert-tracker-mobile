'use strict';

const fs = require('node:fs');
const worker = require('./lib/workerClient');
const { cleanupReleaseFeed } = require('./lib/releaseFeedPolicy');

const PRODUCTION_CONFIRMATION = 'CLEAN_LEGACY_RELEASE_FEED';

async function main({ env = process.env, fsImpl = fs, workerClient = worker, log = console.log } = {}) {
  if (env.RELEASE_FEED_CLEANUP_CONFIRM !== PRODUCTION_CONFIRMATION) {
    throw new Error(`Release feed cleanup requires RELEASE_FEED_CLEANUP_CONFIRM=${PRODUCTION_CONFIRMATION}.`);
  }

  const backupPath = env.RELEASE_FEED_BACKUP_PATH;
  let summary = null;
  await workerClient.writeJsonReconciled('news.json', (latest) => {
    const snapshot = Array.isArray(latest) ? latest : [];
    if (backupPath) fsImpl.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'w' });
    const result = cleanupReleaseFeed(snapshot);
    summary = result.summary;
    return result.kept;
  });

  log(`Release feed cleanup: ${summary.before} -> ${summary.after}; removed ${summary.removed}.`);
  log(`Removed by category: ${JSON.stringify(summary.removedByCategory)}`);
  log(`Removed by lifecycle stage: ${JSON.stringify(summary.removedByStage)}`);
  return summary;
}

if (require.main === module) main().catch((error) => {
  console.error('Release feed cleanup failed:', error.message);
  process.exitCode = 1;
});

module.exports = { PRODUCTION_CONFIRMATION, main };
