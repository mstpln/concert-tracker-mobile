'use strict';

const { randomUUID } = require('node:crypto');
const { createWorkerClient } = require('./workerClient');

const LEASE_FIELD = 'schedulerLease';
const LEASE_SCHEMA_VERSION = 1;
const RUN_MARKERS_FIELD = 'schedulerRunMarkers';
const RUN_MARKER_SCHEMA_VERSION = 1;
const DEFAULT_LEASE_MS = 6 * 60 * 60 * 1000;
const MAX_LEASE_MS = DEFAULT_LEASE_MS;
const MAX_SCHEDULE_DELAY_MS = 36 * 60 * 60 * 1000;
const SCHEDULE_POLICIES = Object.freeze({
  'structured-research': Object.freeze({ weekdaysUtc: Object.freeze([1, 3, 5]), hourUtc: 7, minuteUtc: 47 }),
  'focused-tavily-concert': Object.freeze({ monthDaysUtc: Object.freeze([1, 15]), hourUtc: 2, minuteUtc: 0 }),
  'venue-metadata-research': Object.freeze({ monthDaysUtc: Object.freeze([1, 15]), hourUtc: 2, minuteUtc: 0 }),
});

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
  const durationMs = acquiredAt == null || expiresAt == null ? null : expiresAt - acquiredAt;
  if (durationMs == null || durationMs <= 0 || durationMs > MAX_LEASE_MS) return { valid: false, lease: null };
  return { valid: true, lease: value };
}

function runMarkersValidation(value) {
  if (value == null) return { valid: true, markers: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, markers: {} };
  for (const marker of Object.values(value)) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return { valid: false, markers: {} };
    if (marker.schemaVersion !== RUN_MARKER_SCHEMA_VERSION) return { valid: false, markers: {} };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(marker.periodKey || ''))) return { valid: false, markers: {} };
    if (validDateMs(marker.completedAt) == null) return { valid: false, markers: {} };
  }
  return { valid: true, markers: value };
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
  const markers = runMarkersValidation(state[RUN_MARKERS_FIELD]);
  if (!markers.valid) {
    throw schedulerLeaseStateError('Persisted scheduler run-marker state is malformed; refusing to start provider work.', 'SCHEDULER_RUN_MARKER_STATE_INVALID');
  }
  return checked.lease;
}

function schedulerRunMarkers(state) {
  assertUsageRoot(state);
  return runMarkersValidation(state[RUN_MARKERS_FIELD]).markers;
}

function policyMatchesDate(policy, date) {
  if (policy.weekdaysUtc && !policy.weekdaysUtc.includes(date.getUTCDay())) return false;
  if (policy.monthDaysUtc && !policy.monthDaysUtc.includes(date.getUTCDate())) return false;
  return true;
}

function scheduledPeriodKey(owner, nowMs = Date.now()) {
  const policy = SCHEDULE_POLICIES[String(owner || '').trim()];
  if (!policy) return null;
  const normalizedNow = Number(nowMs);
  const date = new Date(normalizedNow);
  if (!Number.isFinite(normalizedNow) || !Number.isFinite(date.getTime())) {
    throw new Error('Scheduler period clock returned an invalid time.');
  }

  for (let daysBack = 0; daysBack <= 2; daysBack += 1) {
    const candidate = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysBack,
      Number(policy.hourUtc) || 0,
      Number(policy.minuteUtc) || 0,
      0,
      0
    ));
    if (!policyMatchesDate(policy, candidate)) continue;
    const delayMs = normalizedNow - candidate.getTime();
    if (delayMs >= 0 && delayMs <= MAX_SCHEDULE_DELAY_MS) return candidate.toISOString().slice(0, 10);
  }
  return null;
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
  const normalizedLeaseId = String(leaseId || '').trim();
  if (!normalizedLeaseId) throw new Error('Scheduler lease ID is required.');
  const normalizedLeaseMs = Number(leaseMs);
  if (!Number.isSafeInteger(normalizedLeaseMs) || normalizedLeaseMs <= 0 || normalizedLeaseMs > MAX_LEASE_MS) {
    throw new Error('Scheduler lease duration must be a whole number of milliseconds between 1 and six hours.');
  }
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw new Error('Scheduler lease clock returned an invalid time.');
  let acquiredAt;
  let expiresAt;
  try {
    acquiredAt = new Date(nowMs).toISOString();
    expiresAt = new Date(nowMs + normalizedLeaseMs).toISOString();
  } catch {
    throw new Error('Scheduler lease clock returned an out-of-range time.');
  }

  const state = await client.readJson('apiUsage.json', {});
  const priorLease = assertUsageRoot(state);
  if (leaseIsActive(priorLease, nowMs)) {
    throw schedulerLeaseStateError(
      `Another provider scheduler is already active (${priorLease.owner}) until ${priorLease.expiresAt}.`,
      'SCHEDULER_LEASE_BUSY'
    );
  }

  const next = {
    ...state,
    [LEASE_FIELD]: {
      ...(priorLease || {}),
      schemaVersion: LEASE_SCHEMA_VERSION,
      leaseId: normalizedLeaseId,
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

  return { leaseId: normalizedLeaseId, owner: normalizedOwner, acquiredAt, expiresAt, client };
}

async function scheduledRunAlreadyCompleted({ owner, periodKey, client = createWorkerClient() } = {}) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedPeriodKey = String(periodKey || '').trim();
  if (!normalizedOwner || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedPeriodKey)) {
    throw new Error('Scheduled-run completion check requires an owner and YYYY-MM-DD period key.');
  }
  const state = await client.readJson('apiUsage.json', {});
  const markers = schedulerRunMarkers(state);
  return markers[normalizedOwner]?.periodKey === normalizedPeriodKey;
}

async function markScheduledRunCompleted({
  owner,
  periodKey,
  completedAt = new Date().toISOString(),
  client = createWorkerClient(),
  maxConflictRetries = 1,
} = {}) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedPeriodKey = String(periodKey || '').trim();
  const normalizedCompletedAt = String(completedAt || '').trim();
  if (!normalizedOwner || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedPeriodKey) || validDateMs(normalizedCompletedAt) == null) {
    throw new Error('Scheduled-run completion marker requires owner, YYYY-MM-DD period key and valid completion time.');
  }
  for (let attempt = 0; attempt <= maxConflictRetries; attempt += 1) {
    const state = await client.readJson('apiUsage.json', {});
    const markers = schedulerRunMarkers(state);
    const prior = markers[normalizedOwner];
    const next = {
      ...state,
      [RUN_MARKERS_FIELD]: {
        ...markers,
        [normalizedOwner]: {
          ...(prior || {}),
          schemaVersion: RUN_MARKER_SCHEMA_VERSION,
          periodKey: normalizedPeriodKey,
          completedAt: normalizedCompletedAt,
        },
      },
    };
    try {
      await client.writeJsonStrict('apiUsage.json', next);
      return true;
    } catch (error) {
      if ((error?.code === 'ETAG_CONFLICT' || Number(error?.status) === 412) && attempt < maxConflictRetries) continue;
      throw error;
    }
  }
  return false;
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
  RUN_MARKERS_FIELD,
  RUN_MARKER_SCHEMA_VERSION,
  DEFAULT_LEASE_MS,
  MAX_LEASE_MS,
  MAX_SCHEDULE_DELAY_MS,
  SCHEDULE_POLICIES,
  validDateMs,
  leaseValidation,
  runMarkersValidation,
  scheduledPeriodKey,
  scheduledRunAlreadyCompleted,
  markScheduledRunCompleted,
  leaseIsActive,
  acquireSchedulerLease,
  releaseSchedulerLease,
  withSchedulerLease,
};
