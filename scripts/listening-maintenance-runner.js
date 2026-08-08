'use strict';

const enrichment = require('./listening-enrichment-engine');

const DEFAULT_MAX_STEPS = 25;
const HARD_MAX_STEPS = 100;
const CHECKPOINT_KIND = 'livevault-listening-maintenance-checkpoint';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function checkpointState(value = null, now = new Date().toISOString()) {
  if (!validDate(now)) throw new Error('Invalid listening maintenance time.');
  if (value == null) {
    return {
      kind: CHECKPOINT_KIND,
      schemaVersion: 1,
      startedAt: now,
      updatedAt: now,
      completedStepKeys: [],
      haltReason: null,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== CHECKPOINT_KIND || value.schemaVersion !== 1
    || !validDate(value.startedAt) || !validDate(value.updatedAt)
    || (value.haltReason != null && typeof value.haltReason !== 'string')
    || !Array.isArray(value.completedStepKeys)
    || value.completedStepKeys.length > 100000
    || !value.completedStepKeys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 512)) {
    throw new Error('Invalid listening maintenance checkpoint.');
  }
  return clone(value);
}

function stepKey(step) {
  return `${step.provider}:${step.operation}:${step.trackKey}`;
}

function boundedMaxSteps(value) {
  const numeric = Number(value == null ? DEFAULT_MAX_STEPS : value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > HARD_MAX_STEPS) {
    throw new Error(`maxSteps must be an integer from 1 to ${HARD_MAX_STEPS}.`);
  }
  return numeric;
}

function identityDocument(value = null) {
  if (value == null) return { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
  enrichment.identityRecords(value);
  return clone(value);
}

function spotifyMetadataDocument(value = null) {
  if (value == null) return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== 'livevault-spotify-listening-metadata' || value.schemaVersion !== 1
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('Invalid Spotify metadata document.');
  }
  return clone(value);
}

function providerForStep(providers, step) {
  const provider = providers?.[step.provider];
  const operation = provider?.[step.operation];
  if (typeof operation !== 'function') throw new Error(`Missing provider adapter for ${step.provider}.${step.operation}.`);
  return operation;
}

async function reserveProviderCall(usage, provider) {
  if (!usage || typeof usage.reserve !== 'function') throw new Error('Listening maintenance requires an explicit usage gate.');
  const result = await usage.reserve(provider);
  if (result === false) return false;
  return true;
}

function outcomeForStep(step, payload, item) {
  if (step.provider === 'spotify') {
    return enrichment.spotifyOutcome({
      requestedTrackId: step.input.spotifyTrackId,
      trustedSpotifyArtistId: item.trustedSpotifyArtistId || null,
      payload: payload?.data,
    });
  }
  if (step.provider === 'musicbrainz') {
    return enrichment.musicbrainzIsrcOutcome({
      payload: payload?.data,
      trustedMusicbrainzArtistMbid: step.input.trustedMusicbrainzArtistMbid,
    });
  }
  if (step.provider === 'listenbrainz') {
    return enrichment.listenbrainzOutcome({
      payload: payload?.data,
      artistName: step.input.artistName,
      recordingName: step.input.recordingName,
      trustedMusicbrainzArtistMbid: step.input.trustedMusicbrainzArtistMbid,
    });
  }
  throw new Error('Unknown maintenance provider.');
}

function providerFailureOutcome(result) {
  if (!result || typeof result !== 'object') return { status: 'error', reason: 'provider_adapter_failure' };
  if (result.kind === 'retry') {
    return {
      status: 'retry',
      reason: typeof result.reason === 'string' ? result.reason : 'provider_retry',
      nextEligibleCheckAt: result.nextEligibleCheckAt,
    };
  }
  if (result.kind === 'no_match') return { status: 'no_match', reason: result.reason || 'provider_no_match' };
  if (result.kind === 'needs_review') return { status: 'needs_review', reason: result.reason || 'provider_needs_review' };
  return { status: 'error', reason: typeof result.reason === 'string' ? result.reason : 'provider_error' };
}

function itemByKey(inventory, trackKey) {
  return (inventory?.items || []).find((item) => item.trackKey === trackKey) || null;
}

function applyStepResult({ step, result, inventory, identities, metadata, now }) {
  const item = itemByKey(inventory, step.trackKey);
  if (!item) throw new Error('Planned maintenance step lost its inventory work item.');
  const existingIdentity = identities.records[step.trackKey];
  const outcome = result?.kind === 'ok' ? outcomeForStep(step, result, item) : providerFailureOutcome(result);

  if (step.provider === 'spotify' && outcome.status === 'metadata') {
    const existingMetadata = metadata.records[item.spotifyTrackId];
    const nextMetadata = enrichment.spotifyMetadataRecord(existingMetadata, item, outcome, now);
    if (!nextMetadata) throw new Error('Spotify metadata result failed persistence validation.');
    metadata.records[item.spotifyTrackId] = nextMetadata;
  }

  identities.records[step.trackKey] = enrichment.mergeIdentityRecord(existingIdentity, item, step.provider, outcome, now);
  identities.updatedAt = now;
  if (step.provider === 'spotify' && outcome.status === 'metadata') metadata.updatedAt = now;
  return outcome;
}

async function runMaintenanceBatch({
  inventory,
  trackIdentities = null,
  spotifyMetadata = null,
  checkpoint = null,
  providers,
  usage,
  preflight,
  persist,
  maxSteps = DEFAULT_MAX_STEPS,
  now = new Date().toISOString(),
} = {}) {
  if (!inventory || !Array.isArray(inventory.items)) throw new Error('Invalid listening inventory.');
  if (typeof preflight !== 'function') throw new Error('Listening maintenance requires a persistence preflight.');
  if (typeof persist !== 'function') throw new Error('Listening maintenance requires a persistence callback.');
  const limit = boundedMaxSteps(maxSteps);
  const identities = identityDocument(trackIdentities);
  const metadata = spotifyMetadataDocument(spotifyMetadata);
  const state = checkpointState(checkpoint, now);
  const completed = new Set(state.completedStepKeys);
  const summary = { attempted: 0, persisted: 0, halted: false, haltReason: null };

  const initialPlan = enrichment.planEnrichment({ inventory, trackIdentities: identities, now });
  if (initialPlan.steps.length) {
    await preflight({
      trackIdentities: clone(identities),
      spotifyMetadata: clone(metadata),
      checkpoint: clone(state),
      plan: enrichment.safePlanSummary(initialPlan),
    });
  }

  while (summary.attempted < limit) {
    const plan = enrichment.planEnrichment({ inventory, trackIdentities: identities, now });
    const next = plan.steps[0] || null;
    if (!next) break;
    const key = stepKey(next);
    const operation = providerForStep(providers, next);

    if (!(await reserveProviderCall(usage, next.provider))) {
      summary.halted = true;
      summary.haltReason = `usage_blocked:${next.provider}`;
      break;
    }

    summary.attempted += 1;
    let result;
    try {
      result = await operation(clone(next.input));
    } catch (error) {
      result = { kind: 'error', reason: 'provider_adapter_exception' };
    }

    const outcome = applyStepResult({ step: next, result, inventory, identities, metadata, now });
    completed.add(key);
    state.completedStepKeys = [...completed].sort();
    state.updatedAt = now;
    state.haltReason = null;

    await persist({
      trackIdentities: clone(identities),
      spotifyMetadata: clone(metadata),
      checkpoint: clone(state),
      lastStep: clone(next),
      lastOutcome: clone(outcome),
    });
    summary.persisted += 1;

    if (outcome.status === 'retry' || outcome.status === 'error' || outcome.status === 'needs_review') {
      summary.halted = true;
      summary.haltReason = `${next.provider}:${outcome.status}`;
      break;
    }
  }

  if (!summary.halted && summary.attempted >= limit) {
    summary.halted = true;
    summary.haltReason = 'batch_limit';
  }
  state.haltReason = summary.haltReason;
  state.updatedAt = now;

  return {
    summary,
    checkpoint: state,
    trackIdentities: identities,
    spotifyMetadata: metadata,
    plan: enrichment.safePlanSummary(enrichment.planEnrichment({ inventory, trackIdentities: identities, now })),
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  HARD_MAX_STEPS,
  CHECKPOINT_KIND,
  validDate,
  checkpointState,
  stepKey,
  boundedMaxSteps,
  identityDocument,
  spotifyMetadataDocument,
  reserveProviderCall,
  applyStepResult,
  runMaintenanceBatch,
};
