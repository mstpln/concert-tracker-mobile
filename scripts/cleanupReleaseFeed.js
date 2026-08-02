'use strict';

const fs = require('node:fs');
const worker = require('./lib/workerClient');
const { cleanupReleaseFeed } = require('./lib/releaseFeedPolicy');

async function main() {
  const current = await worker.readJson('news.json', []);
  const backupPath = process.env.RELEASE_FEED_BACKUP_PATH;
  if (backupPath) fs.writeFileSync(backupPath, JSON.stringify(current, null, 2) + '\n', { flag: 'wx' });

  const result = cleanupReleaseFeed(current);
  console.log(`Release feed cleanup: ${result.summary.before} -> ${result.summary.after}; removed ${result.summary.removed}.`);
  console.log(`Removed by category: ${JSON.stringify(result.summary.removedByCategory)}`);
  console.log(`Removed by lifecycle stage: ${JSON.stringify(result.summary.removedByStage)}`);
  if (result.summary.removed > 0) await worker.writeJson('news.json', result.kept);
  return result.summary;
}

if (require.main === module) main().catch((error) => {
  console.error('Release feed cleanup failed:', error.message);
  process.exitCode = 1;
});

module.exports = { main };
