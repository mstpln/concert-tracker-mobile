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
  let usageSaveAttempted = false;
  const saveUsage = async () => {
    usageSaveAttempted = true;
    await usage.save();
  };
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
    if (result.fatalError) {
      const providerError = new Error(result.fatalError);
      usage.finishMusicbrainzRun({ status: 'error', identityUpdates, error: providerError.message });
      try { await saveUsage(); } catch (saveError) { log(`Additionally failed to save MusicBrainz error usage: ${saveError.message}`); }
      throw providerError;
    }
    usage.finishMusicbrainzRun({ status: 'ok', identityUpdates });
    await saveUsage();
    log(`MusicBrainz-only backfill complete: ${usage.state.musicbrainz.callsThisRun} request(s), ${identityUpdates} identity update(s).`);
    return result;
  } catch (error) {
    if (usage && !usageSaveAttempted) {
      usage.finishMusicbrainzRun({ status: 'error', identityUpdates, error: error.message });
      try { await saveUsage(); } catch (saveError) { log(`Additionally failed to save MusicBrainz error usage: ${saveError.message}`); }
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
