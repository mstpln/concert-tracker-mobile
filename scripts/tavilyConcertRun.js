'use strict';

const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const reporting = require('./lib/automationReporting');
const policy = require('./lib/tavilyConcertPolicy');
const geocode = require('./lib/geocode');
const { slugify, todayIso } = require('./lib/util');
const { fetchTourDatesViaTavily } = require('./research');
const CanonicalIdentity = require('../canonicalIdentityV174');
const CanonicalIngestion = require('./lib/canonicalConcertIngestionV175');
const LineupRole = require('../lineupRoleV155');

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

function attachResearchGeocode(candidate) {
  if (!candidate || candidate.distanceKm == null) return candidate;
  const cached = geocode.cachedForCity(candidate.city, candidate.country);
  return cached ? { ...candidate, ...cached } : candidate;
}

function finalFocusedConcertPayload(concerts) {
  return LineupRole.initializeConcerts(concerts);
}

function focusedEvaluationSucceeded(usage, threw = false) {
  return !threw
    && usage?._lastTavilyOutcome === 'success'
    && ['success', 'not_run'].includes(usage?._lastGroqOutcome);
}

function reconcileFocusedCandidates(concerts, candidates, venues, now = new Date().toISOString()) {
  const venueIndex = CanonicalIdentity.buildVenueIndex(Array.isArray(venues) ? venues : []);
  let records = Array.isArray(concerts) ? JSON.parse(JSON.stringify(concerts)) : [];
  const results = [];
  const counts = { added: 0, merged: 0, lifecycle: 0, held: 0, unchanged: 0 };

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const applied = CanonicalIngestion.ingestCandidate(records, candidate, { venueIndex, now });
    records = applied.records;
    results.push(applied.result);
    if (applied.result.action === 'hold_for_review') counts.held += 1;
    else if (!applied.changed) counts.unchanged += 1;
    else if (applied.result.action === 'add') counts.added += 1;
    else if (applied.result.action === 'merge_observation') counts.merged += 1;
    else if (applied.result.action === 'lifecycle_continuation') counts.lifecycle += 1;
  }

  return { records, results, counts };
}

async function main() {
  console.log('Live Vault focused Tavily concert research starting...');
  const [bands, storedConcerts, usage] = await Promise.all([
    worker.readJson('bands.json', []),
    worker.readJson('concerts.json', []),
    UsageTracker.load(),
  ]);
  reporting.installUsageReporting(usage);
  sharedUsage = usage;
  geocode.seedFromConcerts(storedConcerts);
  const due = policy.dueBands(bands, storedConcerts, Date.now());
  const observations = [];
  const routingUpdates = [];
  let attempted = 0;
  let observed = 0;
  let failedEvaluations = 0;

  for (const item of due) {
    if (!usage.canCallTavily() || !usage.canCallGroq(900)) break;
    const band = item.band;
    attempted += 1;
    usage.recordStructured('tavilyByReason', item.eligibility.reason);
    const remembered = new Set(band.structuredResearch?.routing?.groqFingerprints || []);
    let rememberedNext = remembered;
    let candidates = [];
    let searchThrew = false;
    usage._lastTavilyOutcome = 'pending';
    usage._lastGroqOutcome = 'not_run';
    try {
      candidates = await fetchTourDatesViaTavily(band, usage, {
        allowGroq: true,
        seenFingerprints: remembered,
        onFingerprints: (fingerprints) => { rememberedNext = new Set([...remembered, ...fingerprints]); },
      });
    } catch (error) {
      searchThrew = true;
      usage.note(`Focused Tavily concert search failed for "${band.name}": ${error.message}`);
      reporting.recordProblem(usage, 'webConcertSearch', error, 'Web concert search', 'attention');
    }

    const upcomingCandidates = candidates
      .filter((candidate) => candidate.date && candidate.date >= todayIso())
      .map(attachResearchGeocode);
    observed += upcomingCandidates.length;
    observations.push(...upcomingCandidates);

    const checkedAt = new Date().toISOString();
    const evaluated = focusedEvaluationSucceeded(usage, searchThrew);
    if (!evaluated) failedEvaluations += 1;
    routingUpdates.push({
      id: band.id,
      routing: evaluated ? {
        lastTavilyTourAt: checkedAt,
        lastTavilyTourReason: item.eligibility.reason,
        groqFingerprints: [...rememberedNext].slice(-100),
        tavilyConcert: policy.nextState(band, storedConcerts, upcomingCandidates.length, checkedAt),
        lastTavilyTourFailureAt: null,
        lastTavilyTourFailureReason: null,
      } : {
        groqFingerprints: [...rememberedNext].slice(-100),
        lastTavilyTourFailureAt: checkedAt,
        lastTavilyTourFailureReason: 'provider_evaluation_failed',
      },
    });
  }

  let reconciliationCounts = { added: 0, merged: 0, lifecycle: 0, held: 0, unchanged: 0 };
  if (observations.length) {
    const latestVenues = await worker.readJson('venues.json', []);
    await worker.writeJsonReconciled('concerts.json', (latestConcerts) => {
      const reconciled = reconcileFocusedCandidates(latestConcerts, observations, latestVenues);
      reconciliationCounts = reconciled.counts;
      return finalFocusedConcertPayload(reconciled.records);
    });
  }

  if (routingUpdates.length) {
    await worker.writeJsonReconciled('bands.json', (latestBands) => applyRoutingUpdates(latestBands, routingUpdates));
  }

  const changed = reconciliationCounts.added + reconciliationCounts.merged + reconciliationCounts.lifecycle;
  reporting.recordActivity(usage, 'webConcertSearch', { result: { workCount: attempted, changeCount: changed } });
  usage.finishRun({
    mode: 'tavily-concert-only',
    bandsDue: due.length,
    bandsAttempted: attempted,
    failedEvaluations,
    concertCandidatesObserved: observed,
    concertsAdded: reconciliationCounts.added,
    concertObservationsMerged: reconciliationCounts.merged,
    lifecycleContinuations: reconciliationCounts.lifecycle,
    candidatesHeldForReview: reconciliationCounts.held,
    unchangedCandidateReplays: reconciliationCounts.unchanged,
    status: 'ok',
  });
  await usage.save();
  console.log(`Focused Tavily run complete. Due: ${due.length}, attempted: ${attempted}, failed evaluations: ${failedEvaluations}, candidates observed: ${observed}, added: ${reconciliationCounts.added}, merged: ${reconciliationCounts.merged}, lifecycle: ${reconciliationCounts.lifecycle}, held: ${reconciliationCounts.held}, unchanged: ${reconciliationCounts.unchanged}.`);
}

if (require.main === module) main().catch(async (error) => {
  console.error('Focused Tavily concert run failed:', error.message);
  try {
    const usage = sharedUsage || await UsageTracker.load();
    reporting.installUsageReporting(usage);
    usage.finishRun({ mode: 'tavily-concert-only', status: 'error', error: error.message });
    await usage.save();
  } catch (saveError) {
    console.error('Additionally failed to save Tavily error state:', saveError.message);
  }
  process.exitCode = 1;
});

module.exports = { uniqueConcert, applyRoutingUpdates, attachResearchGeocode, finalFocusedConcertPayload, focusedEvaluationSucceeded, reconcileFocusedCandidates, main };
