'use strict';

// Manually dispatched, bounded historical enrichment for actual past setlists.
// It never discovers concerts or invokes any provider other than setlist.fm.
const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const { setlistInsightsEligible, processSetlistInsights, confirmedMbid } = require('./research');
const { needsInsightCompletion } = require('./lib/setlistInsights');

function requestedMaximum(value) { const n = Number.parseInt(value, 10); return Math.min(10, Math.max(1, Number.isFinite(n) ? n : 5)); }
function requestedForce(value) { return value === true || value === 'true'; }

async function runSetlistInsightsBackfill({ maxConcerts = process.env.MAX_CONCERTS, forceRecalculate = process.env.FORCE_RECALCULATE, readConcerts = worker.readJson, readBands = worker.readJson, loadUsage = UsageTracker.load, processInsights = processSetlistInsights, now = new Date(), log = console.log } = {}) {
  const usage = await loadUsage(); const concerts = await readConcerts('concerts.json', []); const bands = await readBands('bands.json', []); const byId = new Map(bands.map((band) => [band.id, band]));
  const force = requestedForce(forceRecalculate); const limit = requestedMaximum(maxConcerts);
  const eligible = concerts.filter((concert) => setlistInsightsEligible(concert, byId.get(concert.bandId), now, { force })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const selected = eligible.slice(0, limit); let result;
  try {
    result = await processInsights({ concerts, bands, usage, enabled: true, force, onlyConcertIds: new Set(selected.map((concert) => concert.id)), now, log });
    const current = result.concerts || concerts; const remaining = current.filter((concert) => { const band = byId.get(concert.bandId); return confirmedMbid(band) && needsInsightCompletion(concert, band.musicbrainz.mbid, undefined, now); }).length;
    usage.state.lastSetlistInsightsBackfill = { mode: 'setlist-insights-backfill', status: 'ok', eligible: eligible.length, selected: selected.length, processed: result.diagnostics.processed, ready: result.diagnostics.ready, insufficient: result.diagnostics.insufficient, errors: result.diagnostics.errors, insightsGenerated: result.diagnostics.generated, remaining, setlistfmCalls: usage.state.setlistfm.callsThisRun, finishedAt: new Date().toISOString() };
    await usage.save();
    log(`Live-performance insight backfill: eligible ${eligible.length}, selected ${selected.length}, processed ${result.diagnostics.processed}, ready ${result.diagnostics.ready}, insufficient ${result.diagnostics.insufficient}, errors ${result.diagnostics.errors}, insights generated ${result.diagnostics.generated}, remaining ${remaining}.`);
    return result;
  } catch (error) {
    usage.state.lastSetlistInsightsBackfill = { mode: 'setlist-insights-backfill', status: 'error', eligible: eligible.length, selected: selected.length, setlistfmCalls: usage.state.setlistfm.callsThisRun, error: error.message, finishedAt: new Date().toISOString() };
    await usage.save(); throw error;
  }
}

if (require.main === module) runSetlistInsightsBackfill().catch((error) => { console.error('Setlist insight backfill failed:', error.message); process.exitCode = 1; });
module.exports = { runSetlistInsightsBackfill, requestedMaximum, requestedForce };
