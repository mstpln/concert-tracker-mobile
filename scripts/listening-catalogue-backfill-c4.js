'use strict';

const resolver = require('./listening-catalogue-resolver');
const acquisition = require('./listening-catalogue-acquisition');
const enrichment = require('./listening-enrichment-engine');
const inventoryLib = require('./listening-inventory');

const MAX_LISTENBRAINZ_BATCH = 100;
const LISTENBRAINZ_EXECUTION_ITEMS = 1;
const MAX_PROVIDER_OPERATIONS = 50000;
const PROVIDERS = Object.freeze(['musicbrainz', 'listenbrainz']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function identityDocument(value = null) {
  if (value == null) return { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== 'livevault-track-identities' || value.schemaVersion !== 1
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('Invalid C4 track identity document.');
  }
  enrichment.identityRecords(value);
  return clone(value);
}

function buildC4Plan({ bands = [], events = [], spotifyMetadata = null, trackIdentities = null } = {}) {
  const evidence = resolver.buildCatalogueEvidence({ bands, events, spotifyMetadata, trackIdentities });
  const artistGroups = new Map();
  let catalogueEligibleTracks = 0;
  let heldTracks = 0;
  let artistUntrustedTracks = 0;

  for (const item of evidence.items) {
    if (item.routingHoldReason) heldTracks += 1;
    if (!['B', 'C'].includes(item.evidenceTier)) {
      if (item.evidenceTier === 'E' && !item.routingHoldReason && !inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid)) {
        artistUntrustedTracks += 1;
      }
      continue;
    }
    const artistMbid = inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid);
    if (!artistMbid || item.routingHoldReason) continue;
    catalogueEligibleTracks += 1;
    if (!artistGroups.has(artistMbid)) artistGroups.set(artistMbid, []);
    artistGroups.get(artistMbid).push(item.trackKey);
  }

  return {
    schemaVersion: 1,
    evidence,
    artistGroups: [...artistGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([artistMbid, trackKeys]) => ({ artistMbid, trackCount: trackKeys.length, trackKeys: [...trackKeys].sort() })),
    counts: {
      totalItems: evidence.items.length,
      tierA: Number(evidence.tierCounts.A) || 0,
      tierB: Number(evidence.tierCounts.B) || 0,
      tierC: Number(evidence.tierCounts.C) || 0,
      tierE: Number(evidence.tierCounts.E) || 0,
      catalogueEligibleTracks,
      catalogueArtists: artistGroups.size,
      heldTracks,
      artistUntrustedTracks,
    },
  };
}

function safePlanSummary(plan) {
  const counts = plan?.counts || {};
  return {
    totalItems: Number(counts.totalItems) || 0,
    tierA: Number(counts.tierA) || 0,
    tierB: Number(counts.tierB) || 0,
    tierC: Number(counts.tierC) || 0,
    tierE: Number(counts.tierE) || 0,
    catalogueEligibleTracks: Number(counts.catalogueEligibleTracks) || 0,
    catalogueArtists: Number(counts.catalogueArtists) || 0,
    heldTracks: Number(counts.heldTracks) || 0,
    artistUntrustedTracks: Number(counts.artistUntrustedTracks) || 0,
    spotifyCoreCallsPlanned: 0,
  };
}

function currentLocalResults(plan, catalogueCache) {
  return resolver.resolveCatalogueEvidence({ evidence: plan.evidence, catalogueCache });
}

function applyLocalResolutions({ plan, localResults, trackIdentities = null, now = new Date().toISOString() } = {}) {
  if (!plan?.evidence) throw new Error('C4 local resolution requires current evidence.');
  resolver.validateLocalResults(localResults);
  const identities = identityDocument(trackIdentities);
  const itemByKey = new Map(plan.evidence.items.map((item) => [item.trackKey, item]));
  let resolved = 0;

  for (const result of localResults.results) {
    if (result.status !== 'resolved') continue;
    const item = itemByKey.get(result.trackKey);
    if (!item || !['B', 'C'].includes(item.evidenceTier) || item.routingHoldReason) {
      throw new Error('C4 refused a local result outside the current catalogue evidence boundary.');
    }
    const recordingMbid = inventoryLib.validMbid(result.musicbrainzRecordingMbid);
    const artistMbid = inventoryLib.validMbid(result.musicbrainzArtistMbid);
    if (!recordingMbid || artistMbid !== inventoryLib.validMbid(item.trustedMusicbrainzArtistMbid)) {
      throw new Error('C4 local result conflicts with trusted artist identity.');
    }
    const next = enrichment.mergeIdentityRecord(
      identities.records[item.trackKey],
      item,
      'musicbrainz',
      {
        status: 'resolved',
        reason: result.reason,
        recordingMbid,
        artistMbids: [artistMbid],
      },
      now,
    );
    identities.records[item.trackKey] = next;
    identities.updatedAt = now;
    resolved += 1;
  }
  return { trackIdentities: identities, resolved };
}

function mapListenBrainzBatch({ batchPlan, data } = {}) {
  if (!batchPlan || !Array.isArray(batchPlan.items) || batchPlan.items.length !== LISTENBRAINZ_EXECUTION_ITEMS) {
    throw new Error('C4 ListenBrainz execution requires exactly one planned work item.');
  }
  if (!Array.isArray(data)) throw new Error('Invalid C4 ListenBrainz batch response.');
  if (data.length !== LISTENBRAINZ_EXECUTION_ITEMS) {
    throw new Error('C4 ListenBrainz single-item response cardinality cannot be correlated safely.');
  }
  const row = data[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid C4 ListenBrainz batch response row.');
  const item = batchPlan.items[0];
  return new Map([[item.trackKey, clone(row)]]);
}

function applyListenBrainzBatch({ plan, batchPlan, data, trackIdentities = null, now = new Date().toISOString() } = {}) {
  if (!plan?.evidence) throw new Error('C4 ListenBrainz application requires current evidence.');
  const identities = identityDocument(trackIdentities);
  const mapped = mapListenBrainzBatch({ batchPlan, data });
  const evidenceByKey = new Map(plan.evidence.items.map((item) => [item.trackKey, item]));
  let resolved = 0;
  let noMatch = 0;
  let needsReview = 0;
  let error = 0;

  for (const requestItem of batchPlan.items) {
    const evidenceItem = evidenceByKey.get(requestItem.trackKey);
    if (!evidenceItem || evidenceItem.routingHoldReason || !['B', 'C'].includes(evidenceItem.evidenceTier)) {
      throw new Error('C4 ListenBrainz batch crossed the current evidence boundary.');
    }
    const row = mapped.get(requestItem.trackKey);
    if (!row) throw new Error('C4 ListenBrainz response lost a previously verified batch mapping.');
    const outcome = enrichment.listenbrainzOutcome({
      payload: row,
      artistName: requestItem.artistName,
      recordingName: requestItem.recordingName,
      trustedMusicbrainzArtistMbid: requestItem.trustedMusicbrainzArtistMbid,
    });
    identities.records[requestItem.trackKey] = enrichment.mergeIdentityRecord(
      identities.records[requestItem.trackKey],
      evidenceItem,
      'listenbrainz',
      outcome,
      now,
    );
    identities.updatedAt = now;
    if (outcome.status === 'resolved') resolved += 1;
    else if (outcome.status === 'needs_review') needsReview += 1;
    else if (outcome.status === 'error') error += 1;
    else noMatch += 1;
  }
  return { trackIdentities: identities, counts: { resolved, noMatch, needsReview, error } };
}

function buildListenBrainzBatch({ plan, catalogueCache, localResults, maxItems = MAX_LISTENBRAINZ_BATCH } = {}) {
  return resolver.planListenBrainzBatchBridge({
    evidence: plan.evidence,
    catalogueCache,
    localResults,
    maxItems: Math.min(LISTENBRAINZ_EXECUTION_ITEMS, maxItems),
  });
}

function nextCatalogueArtist({ plan, catalogueCache, nowMs = Date.now(), deferredProviders = [] } = {}) {
  if (deferredProviders.includes('musicbrainz')) return null;
  const cache = acquisition.validateDurableCatalogue(catalogueCache);
  for (const group of plan.artistGroups || []) {
    if (acquisition.artistNeedsRefresh(cache, group.artistMbid, nowMs)) return group.artistMbid;
  }
  return null;
}

function aggregateRunDiagnostics({ providerCalls = {}, localResolved = 0, listenbrainz = {}, deferredProviders = [], haltReason = null } = {}) {
  return {
    providerCalls: {
      musicbrainz: Number(providerCalls.musicbrainz) || 0,
      listenbrainz: Number(providerCalls.listenbrainz) || 0,
      spotify: 0,
    },
    localResolved: Number(localResolved) || 0,
    listenbrainz: {
      resolved: Number(listenbrainz.resolved) || 0,
      noMatch: Number(listenbrainz.noMatch) || 0,
      needsReview: Number(listenbrainz.needsReview) || 0,
      error: Number(listenbrainz.error) || 0,
    },
    deferredProviders: [...new Set((deferredProviders || []).filter((provider) => PROVIDERS.includes(provider)))].sort(),
    haltReason: typeof haltReason === 'string' ? haltReason : null,
  };
}

module.exports = {
  MAX_LISTENBRAINZ_BATCH,
  LISTENBRAINZ_EXECUTION_ITEMS,
  MAX_PROVIDER_OPERATIONS,
  PROVIDERS,
  identityDocument,
  buildC4Plan,
  safePlanSummary,
  currentLocalResults,
  applyLocalResolutions,
  mapListenBrainzBatch,
  applyListenBrainzBatch,
  buildListenBrainzBatch,
  nextCatalogueArtist,
  aggregateRunDiagnostics,
};