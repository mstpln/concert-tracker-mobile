'use strict';

const { randomUUID } = require('node:crypto');
const { createWorkerClient } = require('./workerClient');

const LEASE_FIELD = 'schedulerLease';
const LEASE_SCHEMA_VERSION = 1;
const DEFAULT_LEASE_MS = 6 * 60 * 60 * 1000;

function validDateMs(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function leaseValidation(value) {
  if (value == null) return { valid: true, lease: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, lease: null };
  if (value.schemaVersion !== LEASE_SCHEMA_VERSION) return { valid: false, lease: null };
  if (typeof value.leaseId !== 'string' || !value.leaseId.trim()) return { valid: false, lease: null };
  if (typeof value.owner !== 'string' || !value.owner.trim()) return { valid: false, lease: null };
  const acquiredAt = validDateMs(value.acquiredAt);
  const expiresAt = validDateMs(value.expiresAt);
  if (acquiredAt == null || expiresAt == null || expiresAt <= acquiredAt) return { valid: false, lease: null };
  return { valid: true, lease: value };
}

function schedulerLeaseStateError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertUsageRoot(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw schedulerLeaseStateError('Scheduler lease requires apiUsage.json to contain an object.', 'SCHEDULER_LEASE_STATE_INVALID');
  }
  const checked = leaseValidation(state[LEASE_FIELD]);
  if (!checked.valid) {
    throw schedulerLeaseStateError('Persisted scheduler lease state is malformed; refusing to start provider work.', 'SCHEDULER_LEASE_STATE_INVALID');
  }
  return checked.lease;
}

function leaseIsActive(lease, nowMs = Date.now()) {
  return !!lease && validDateMs(lease.expiresAt) > Number(nowMs);
}

async function acquireSchedulerLease({
  owner,
  leaseMs = DEFAULT_LEASE_MS,
  now = () => Date.now(),
  leaseId = randomUUID(),
  client = createWorkerClient(),
} = {}) {
  const normalizedOwner = String(owner || '').trim();
  if (!normalizedOwner) throw new Error('Scheduler lease owner is required.');
  if (!Number.isFinite(Number(leaseMs)) || Number(leaseMs) <= 0) throw new Error('Scheduler lease duration must be positive.');
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw new Error('Scheduler lease clock returned an invalid time.');

  const state = await client.readJson('apiUsage.json', {});
  const priorLease = assertUsageRoot(state);
  if (leaseIsActive(priorLease, nowMs)) {
    throw schedulerLeaseStateError(
      `Another provider scheduler is already active (${priorLease.owner}) until ${priorLease.expiresAt}.`,
      'SCHEDULER_LEASE_BUSY'
    );
  }

  const acquiredAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + Number(leaseMs)).toISOString();
  const next = {
    ...state,
    [LEASE_FIELD]: {
      ...(priorLease || {}),
      schemaVersion: LEASE_SCHEMA_VERSION,
      leaseId,
      owner: normalizedOwner,
      acquiredAt,
      expiresAt,
    },
  };

  try {
    await client.writeJsonStrict('apiUsage.json', next);
  } catch (error) {
    if (error?.code === 'ETAG_CONFLICT' || Number(error?.status) === 412) {
      throw schedulerLeaseStateError('Scheduler lease changed while this run was starting; no provider work was started.', 'SCHEDULER_LEASE_BUSY');
    }
    throw error;
  }

  return { leaseId, owner: normalizedOwner, acquiredAt, expiresAt, client };
}

async function releaseSchedulerLease(handle, { maxConflictRetries = 1 } = {}) {
  if (!handle?.leaseId || !handle?.client) return false;
  for (let attempt = 0; attempt <= maxConflictRetries; attempt += 1) {
    const state = await handle.client.readJson('apiUsage.json', {});
    const lease = assertUsageRoot(state);
    if (!lease) return false;
    if (lease.leaseId !== handle.leaseId) {
      throw schedulerLeaseStateError('Scheduler lease ownership changed before release; refusing to clear another run\'s lease.', 'SCHEDULER_LEASE_LOST');
    }
    const next = { ...state };
    delete next[LEASE_FIELD];
    try {
      await handle.client.writeJsonStrict('apiUsage.json', next);
      return true;
    } catch (error) {
      if ((error?.code === 'ETAG_CONFLICT' || Number(error?.status) === 412) && attempt < maxConflictRetries) continue;
      throw error;
    }
  }
  return false;
}

async function withSchedulerLease(options, operation) {
  if (typeof operation !== 'function') throw new Error('Scheduler lease operation is required.');
  const handle = await acquireSchedulerLease(options);
  let operationError = null;
  try {
    return await operation(handle);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await releaseSchedulerLease(handle);
    } catch (releaseError) {
      if (!operationError) throw releaseError;
      operationError.schedulerLeaseReleaseError = releaseError;
    }
  }
}

module.exports = {
  LEASE_FIELD,
  LEASE_SCHEMA_VERSION,
  DEFAULT_LEASE_MS,
  validDateMs,
  leaseValidation,
  leaseIsActive,
  acquireSchedulerLease,
  releaseSchedulerLease,
  withSchedulerLease,
};
