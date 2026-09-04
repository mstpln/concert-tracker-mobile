'use strict';

const fs = require('node:fs');
const worker = require('./lib/workerClient');
const { cleanupReleaseFeed } = require('./lib/releaseFeedPolicy');

const PRODUCTION_CONFIRMATION = 'CLEAN_LEGACY_RELEASE_FEED';

async function main({ env = process.env, fsImpl = fs, workerClient = worker, log = console.log } = {}) {
  if (env.RELEASE_FEED_CLEANUP_CONFIRM !== PRODUCTION_CONFIRMATION) {
    throw new Error(`Release feed cleanup requires RELEASE_FEED_CLEANUP_CONFIRM=${PRODUCTION_CONFIRMATION}.`);
  }

  let backupSnapshot = null;
  let summary = null;
  await workerClient.writeJsonReconciled('news.json', (latest) => {
    backupSnapshot = Array.isArray(latest) ? latest : [];
    const result = cleanupReleaseFeed(backupSnapshot);
    summary = result.summary;
    return result.kept;
  });

  const backupPath = env.RELEASE_FEED_BACKUP_PATH;
  if (backupPath) fsImpl.writeFileSync(backupPath, JSON.stringify(backupSnapshot, null, 2) + '\n', { flag: 'wx' });

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
