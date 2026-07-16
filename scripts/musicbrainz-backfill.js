'use strict';
// Manually dispatched, MusicBrainz-only backfill. This deliberately reuses
// the shared processor while leaving the weekly pipeline's feature flag off.

const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const { processMusicbrainzIdentities } = require('./research');
const config = require('./lib/config');

async function runMusicbrainzBackfill({
  readBands = worker.readJson,
  loadUsage = UsageTracker.load,
  processIdentities = processMusicbrainzIdentities,
  log = console.log,
} = {}) {
  let usage;
  let identityUpdates = 0;
  try {
    usage = await loadUsage();
    const bands = await readBands('bands.json', []);
    const result = await processIdentities({
      bands,
      usage,
      enabled: true,
      perRunCap: config.MUSICBRAINZ.perRunCap,
    });
    identityUpdates = result.updates;
    usage.finishRun({ mode: 'musicbrainz-only', status: 'success', identityUpdates });
    await usage.save();
    log(`MusicBrainz-only backfill complete: ${usage.state.musicbrainz.callsThisRun} request(s), ${identityUpdates} identity update(s).`);
    return result;
  } catch (error) {
    if (usage) {
      usage.finishRun({ mode: 'musicbrainz-only', status: 'error', identityUpdates, error: error.message });
      await usage.save();
    }
    throw error;
  }
}

if (require.main === module) {
  runMusicbrainzBackfill().catch((error) => {
    console.error('MusicBrainz-only backfill failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMusicbrainzBackfill };
