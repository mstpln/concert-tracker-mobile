'use strict';

const enrichment = require('./listening-enrichment-engine');

const DEFAULT_MAX_STEPS = 25;
const HARD_MAX_STEPS = 100;
const DEFAULT_BULK_ITEM_ERROR_LIMIT = 3;
const MAX_DOCUMENT_RECORDS = 100000;
const CHECKPOINT_KIND = 'livevault-listening-maintenance-checkpoint';
const PROVIDERS = new Set(['spotify', 'musicbrainz', 'listenbrainz']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function itemErrorCountState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('itemErrorCounts must be an object.');
  const counts = {};
  for (const [provider, count] of Object.entries(value)) {
    if (!PROVIDERS.has(provider) || !Number.isInteger(count) || count < 0 || count > MAX_DOCUMENT_RECORDS) {
      throw new Error('itemErrorCounts contains an invalid provider count.');
    }
    counts[provider] = count;
  }
  return counts;
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
      itemErrorCounts: {},
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== CHECKPOINT_KIND || value.schemaVersion !== 1
    || !validDate(value.startedAt) || !validDate(value.updatedAt)
    || (value.haltReason != null && typeof value.haltReason !== 'string')
    || !Array.isArray(value.completedStepKeys)
    || value.completedStepKeys.length > MAX_DOCUMENT_RECORDS
    || !value.completedStepKeys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 512)) {
    throw new Error('Invalid listening maintenance checkpoint.');
  }
  const state = clone(value);
  state.itemErrorCounts = itemErrorCountState(value.itemErrorCounts || {});
  return state;
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

function boundedItemErrorLimit(value) {
  const numeric = Number(value == null ? 0 : value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > HARD_MAX_STEPS) {
    throw new Error(`maxItemErrorsPerProvider must be an integer from 0 to ${HARD_MAX_STEPS}.`);
  }
  return numeric;
}

function identityDocument(value = null) {
  if (value == null) return { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== 'livevault-track-identities' || value.schemaVersion !== 1
    || (value.updatedAt != null && !validDate(value.updatedAt))
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)
    || Object.keys(value.records).length > MAX_DOCUMENT_RECORDS) {
    throw new Error('Invalid track identity document.');
  }
  enrichment.identityRecords(value);
  return clone(value);
}

function spotifyMetadataDocument(value = null) {
  if (value == null) return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.kind !== 'livevault-spotify-listening-metadata' || value.schemaVersion !== 1
    || (value.updatedAt != null && !validDate(value.updatedAt))
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)
    || Object.keys(value.records).length > MAX_DOCUMENT_RECORDS) {
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
  return (await usage.reserve(provider)) === true;
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
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'error', reason: 'provider_adapter_failure' };
  if (result.kind === 'retry') {
    return {
      status: 'retry',
      reason: typeof result.reason === 'string' ? result.reason : 'provider_retry',
      nextEligibleCheckAt: result.nextEligibleCheckAt,
    };
  }
  if (result.kind === 'no_match') return { status: 'no_match', reason: typeof result.reason === 'string' ? result.reason : 'provider_no_match' };
  if (result.kind === 'needs_review') return { status: 'needs_review', reason: typeof result.reason === 'string' ? result.reason : 'provider_needs_review' };
  return { status: 'error', reason: typeof result.reason === 'string' ? result.reason : 'provider_error' };
}

function safeProviderReason(result, fallback = 'provider_error') {
  return typeof result?.reason === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(result.reason)
    ? result.reason
    : fallback;
}

function providerErrorScope(result) {
  if (!result || result.kind !== 'error') return null;
  const reason = safeProviderReason(result);
  return reason.startsWith('invalid_') ? 'item' : 'provider';
}

function providerWideHalt(result, provider) {
  if (!result || result.kind !== 'halt') return null;
  const reason = safeProviderReason(result, 'provider_halt');
  return reason.startsWith(`${provider}:`) ? reason : `${provider}:${reason}`;
}

function providerErrorHaltReason(result, provider) {
  if (providerErrorScope(result) !== 'provider') return null;
  return `${provider}:provider_error:${safeProviderReason(result)}`;
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

function deferredProviderSet(value = []) {
  if (!Array.isArray(value) || !value.every((provider) => PROVIDERS.has(provider))) {
    throw new Error('deferredProviders must contain only known providers.');
  }
  return new Set(value);
}

function deferredProviderHaltReason(deferred) {
  const providers = [...deferred].sort();
  return providers.length ? `provider_deferred:${providers.join(',')}` : null;
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
  haltOnNeedsReview = true,
  haltOnRetry = true,
  haltOnItemError = true,
  deferOnProviderFailure = false,
  maxItemErrorsPerProvider = haltOnItemError ? 0 : DEFAULT_BULK_ITEM_ERROR_LIMIT,
  deferredProviders = [],
  now = new Date().toISOString(),
} = {}) {
  if (!inventory || !Array.isArray(inventory.items)) throw new Error('Invalid listening inventory.');
  if (typeof preflight !== 'function') throw new Error('Listening maintenance requires a persistence preflight.');
  if (typeof persist !== 'function') throw new Error('Listening maintenance requires a persistence callback.');
  if (typeof haltOnNeedsReview !== 'boolean') throw new Error('haltOnNeedsReview must be a boolean.');
  if (typeof haltOnRetry !== 'boolean') throw new Error('haltOnRetry must be a boolean.');
  if (typeof haltOnItemError !== 'boolean') throw new Error('haltOnItemError must be a boolean.');
  if (typeof deferOnProviderFailure !== 'boolean') throw new Error('deferOnProviderFailure must be a boolean.');
  const itemErrorLimit = boundedItemErrorLimit(maxItemErrorsPerProvider);
  const deferred = deferredProviderSet(deferredProviders);
  const limit = boundedMaxSteps(maxSteps);
  const identities = identityDocument(trackIdentities);
  const metadata = spotifyMetadataDocument(spotifyMetadata);
  const state = checkpointState(checkpoint, now);
  const errorCounts = itemErrorCountState(state.itemErrorCounts);
  const completed = new Set(state.completedStepKeys);
  const summary = { attempted: 0, persisted: 0, halted: false, haltReason: null };

  while (summary.attempted < limit) {
    const plan = enrichment.planEnrichment({ inventory, trackIdentities: identities, now });
    const next = plan.steps.find((candidate) => !deferred.has(candidate.provider)) || null;
    if (!next) {
      if (plan.steps.length && deferred.size) {
        summary.halted = true;
        summary.haltReason = deferredProviderHaltReason(deferred);
        state.haltReason = summary.haltReason;
        state.updatedAt = now;
      }
      break;
    }
    const key = stepKey(next);
    const operation = providerForStep(providers, next);

    const preflightResult = await preflight({
      trackIdentities: clone(identities),
      spotifyMetadata: clone(metadata),
      checkpoint: clone(state),
      plan: enrichment.safePlanSummary(plan),
      nextStep: clone(next),
    });
    if (preflightResult !== true) throw new Error('Listening maintenance persistence preflight was not approved.');

    if (!(await reserveProviderCall(usage, next.provider))) {
      summary.halted = true;
      summary.haltReason = `usage_blocked:${next.provider}`;
      state.haltReason = summary.haltReason;
      state.updatedAt = now;
      break;
    }

    summary.attempted += 1;
    let result;
    try {
      result = await operation(clone(next.input));
    } catch (error) {
      result = { kind: 'error', reason: 'provider_adapter_exception' };
    }

    const providerErrorHalt = providerErrorHaltReason(result, next.provider);
    const wideHalt = providerWideHalt(result, next.provider);
    const providerFailure = providerErrorHalt || wideHalt;
    if (providerFailure) {
      state.updatedAt = now;
      if (deferOnProviderFailure) {
        deferred.add(next.provider);
        state.haltReason = null;
        const persistResult = await persist({
          trackIdentities: clone(identities),
          spotifyMetadata: clone(metadata),
          checkpoint: clone(state),
          lastStep: clone(next),
          lastOutcome: { status: 'deferred', reason: providerFailure },
        });
        if (persistResult !== true) throw new Error('Listening maintenance persistence was not confirmed.');
        continue;
      }

      state.haltReason = providerFailure;
      const persistResult = await persist({
        trackIdentities: clone(identities),
        spotifyMetadata: clone(metadata),
        checkpoint: clone(state),
        lastStep: clone(next),
        lastOutcome: { status: 'halt', reason: providerFailure },
      });
      if (persistResult !== true) throw new Error('Listening maintenance persistence was not confirmed.');
      summary.halted = true;
      summary.haltReason = providerFailure;
      break;
    }

    const outcome = applyStepResult({ step: next, result, inventory, identities, metadata, now });
    completed.add(key);
    state.completedStepKeys = [...completed].sort();
    state.updatedAt = now;

    if (outcome.status === 'retry' && !haltOnRetry) deferred.add(next.provider);
    const itemScopedError = outcome.status === 'error'
      && (result?.kind === 'ok' || providerErrorScope(result) === 'item');
    if (itemScopedError) {
      errorCounts[next.provider] = (errorCounts[next.provider] || 0) + 1;
      state.itemErrorCounts = { ...errorCounts };
      if (!haltOnItemError && itemErrorLimit > 0 && errorCounts[next.provider] >= itemErrorLimit) {
        deferred.add(next.provider);
      }
    }
    const terminalOutcome = (outcome.status === 'retry' && haltOnRetry)
      || (itemScopedError && haltOnItemError)
      || (outcome.status === 'error' && !itemScopedError)
      || (outcome.status === 'needs_review' && haltOnNeedsReview);
    const remainingPlan = enrichment.planEnrichment({ inventory, trackIdentities: identities, now });
    let haltReason = terminalOutcome ? `${next.provider}:${outcome.status}` : null;
    if (!haltReason && summary.attempted >= limit && remainingPlan.steps.some((candidate) => !deferred.has(candidate.provider))) haltReason = 'batch_limit';
    state.haltReason = haltReason;

    const persistResult = await persist({
      trackIdentities: clone(identities),
      spotifyMetadata: clone(metadata),
      checkpoint: clone(state),
      lastStep: clone(next),
      lastOutcome: clone(outcome),
    });
    if (persistResult !== true) throw new Error('Listening maintenance persistence was not confirmed.');
    summary.persisted += 1;

    if (haltReason) {
      summary.halted = true;
      summary.haltReason = haltReason;
      break;
    }
  }

  state.itemErrorCounts = { ...errorCounts };
  state.haltReason = summary.haltReason;
  state.updatedAt = now;
  const finalPlan = enrichment.planEnrichment({ inventory, trackIdentities: identities, now });

  return {
    summary,
    checkpoint: state,
    trackIdentities: identities,
    spotifyMetadata: metadata,
    plan: enrichment.safePlanSummary(finalPlan),
    deferredProviders: [...deferred].sort(),
    itemErrorCounts: { ...errorCounts },
  };
}

module.exports = {
  DEFAULT_MAX_STEPS,
  HARD_MAX_STEPS,
  DEFAULT_BULK_ITEM_ERROR_LIMIT,
  MAX_DOCUMENT_RECORDS,
  CHECKPOINT_KIND,
  validDate,
  itemErrorCountState,
  checkpointState,
  stepKey,
  boundedMaxSteps,
  boundedItemErrorLimit,
  identityDocument,
  spotifyMetadataDocument,
  reserveProviderCall,
  providerFailureOutcome,
  providerErrorScope,
  providerWideHalt,
  providerErrorHaltReason,
  applyStepResult,
  deferredProviderSet,
  deferredProviderHaltReason,
  runMaintenanceBatch,
};
