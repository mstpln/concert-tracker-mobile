'use strict';

const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const policy = require('./lib/tavilyConcertPolicy');
const { slugify, todayIso } = require('./lib/util');
const { fetchTourDatesViaTavily, reconcileConcertCandidate } = require('./research');

let sharedUsage = null;

function uniqueConcert(candidate, existing) {
  const base = candidate.id || `${candidate.bandId}-${candidate.date}-${slugify(candidate.city || candidate.venue)}`;
  const ids = new Set(existing.map((concert) => concert.id));
  if (!ids.has(base)) return { ...candidate, id: base };
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return { ...candidate, id: `${base}-${suffix}` };
}

function applyRoutingUpdates(latestBands, updates) {
  const byId = new Map(updates.map((update) => [update.id, update.routing]));
  return latestBands.map((band) => {
    const routing = byId.get(band.id);
    if (!routing) return band;
    return {
      ...band,
      structuredResearch: {
        ...(band.structuredResearch || {}),
        routing: { ...(band.structuredResearch?.routing || {}), ...routing },
      },
    };
  });
}

async function main() {
  console.log('Live Vault focused Tavily concert research starting...');
  const [bands, storedConcerts, usage] = await Promise.all([
    worker.readJson('bands.json', []),
    worker.readJson('concerts.json', []),
    UsageTracker.load(),
  ]);
  sharedUsage = usage;
  const due = policy.dueBands(bands, storedConcerts, Date.now());
  const additions = [];
  const routingUpdates = [];
  let attempted = 0;
  let observed = 0;
  let duplicates = 0;

  for (const item of due) {
    if (!usage.canCallTavily() || !usage.canCallGroq(900)) break;
    const band = item.band;
    attempted += 1;
    usage.recordStructured('tavilyByReason', item.eligibility.reason);
    const remembered = new Set(band.structuredResearch?.routing?.groqFingerprints || []);
    let rememberedNext = remembered;
    let candidates = [];
    try {
      candidates = await fetchTourDatesViaTavily(band, usage, {
        allowGroq: true,
        seenFingerprints: remembered,
        onFingerprints: (fingerprints) => { rememberedNext = new Set([...remembered, ...fingerprints]); },
      });
    } catch (error) {
      usage.note(`Focused Tavily concert search failed for "${band.name}": ${error.message}`);
    }

    const upcomingCandidates = candidates.filter((candidate) => candidate.date && candidate.date >= todayIso());
    observed += upcomingCandidates.length;
    for (const candidate of upcomingCandidates) {
      const reconciliation = reconcileConcertCandidate(storedConcerts, additions, candidate);
      if (reconciliation.action !== 'add') {
        duplicates += 1;
        continue;
      }
      additions.push(uniqueConcert(candidate, [...storedConcerts, ...additions]));
    }

    const checkedAt = new Date().toISOString();
    routingUpdates.push({
      id: band.id,
      routing: {
        lastTavilyTourAt: checkedAt,
        lastTavilyTourReason: item.eligibility.reason,
        groqFingerprints: [...rememberedNext].slice(-100),
        tavilyConcert: policy.nextState(band, [...storedConcerts, ...additions], upcomingCandidates.length, checkedAt),
      },
    });
  }

  if (additions.length) {
    const latestConcerts = await worker.readJson('concerts.json', []);
    const merged = [...latestConcerts];
    for (const candidate of additions) {
      const reconciliation = reconcileConcertCandidate(merged, [], candidate);
      if (reconciliation.action === 'add') merged.push(uniqueConcert(candidate, merged));
    }
    await worker.writeJson('concerts.json', merged);
  }

  if (routingUpdates.length) {
    const latestBands = await worker.readJson('bands.json', []);
    await worker.writeJson('bands.json', applyRoutingUpdates(latestBands, routingUpdates));
  }

  usage.finishRun({
    mode: 'tavily-concert-only',
    bandsDue: due.length,
    bandsAttempted: attempted,
    concertCandidatesObserved: observed,
    concertsAdded: additions.length,
    candidateDuplicatesSkipped: duplicates,
    status: 'ok',
  });
  await usage.save();
  console.log(`Focused Tavily run complete. Due: ${due.length}, attempted: ${attempted}, candidates observed: ${observed}, additions prepared: ${additions.length}, duplicates skipped: ${duplicates}.`);
}

if (require.main === module) main().catch(async (error) => {
  console.error('Focused Tavily concert run failed:', error.message);
  try {
    const usage = sharedUsage || await UsageTracker.load();
    usage.finishRun({ mode: 'tavily-concert-only', status: 'error', error: error.message });
    await usage.save();
  } catch (saveError) {
    console.error('Additionally failed to save Tavily error state:', saveError.message);
  }
  process.exitCode = 1;
});

module.exports = { uniqueConcert, applyRoutingUpdates, main };
