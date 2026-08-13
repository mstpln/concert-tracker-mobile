'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const albumRunner = require('./spotify-album-artwork-production');
const sourceReader = require('./spotify-artwork-backfill-source');
const productionSafety = require('./spotify-artwork-backfill-production');
const schedulerLease = require('./lib/schedulerLease');

const SCHEDULE_SCHEMA_VERSION = 1;
const DEFAULT_INTERVAL_HOURS = 4;
const MIN_INTERVAL_HOURS = DEFAULT_INTERVAL_HOURS;
const DEFAULT_CAP = 5;
const MAX_SCHEDULED_CAP = DEFAULT_CAP;
const DEFAULT_DELAY_MS = 5000;
const MAX_TRACK_LOOKUPS_24H = 30;
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MARKET = albumRunner.DEFAULT_MARKET;
const DEFAULT_STATE_PATH = '.livevault-maintenance/spotify-album-artwork-schedule.json';
const SCHEDULE_AUTHORIZATION = 'I_AUTHORIZE_SCHEDULED_PRIVATE_LISTENING_READS_LIVE_SPOTIFY_CALLS_PROVIDER_USAGE_AND_METADATA_WRITES';
const LEASE_OWNER = 'spotify-album-artwork-scheduler';

function safeString(value) {
  return String(value || '').trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    executeScheduled: false,
    intervalHours: DEFAULT_INTERVAL_HOURS,
    cap: DEFAULT_CAP,
    delayMs: DEFAULT_DELAY_MS,
    market: DEFAULT_MARKET,
    statePath: DEFAULT_STATE_PATH,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--execute-scheduled') options.executeScheduled = true;
    else if (arg === '--interval-hours') { options.intervalHours = parsePositiveInteger(next, 0); index += 1; }
    else if (arg === '--cap') { options.cap = parsePositiveInteger(next, 0); index += 1; }
    else if (arg === '--delay-ms') { options.delayMs = parsePositiveInteger(next, 0); index += 1; }
    else if (arg === '--market') { options.market = safeString(next).toUpperCase(); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.intervalHours || options.intervalHours < MIN_INTERVAL_HOURS) {
      throw new Error(`Scheduled artwork interval must be a whole number of at least ${MIN_INTERVAL_HOURS} hours.`);
    }
    if (!options.cap || options.cap > MAX_SCHEDULED_CAP) {
      throw new Error(`Scheduled artwork cap must be between 1 and ${MAX_SCHEDULED_CAP}.`);
    }
    if (!options.delayMs || options.delayMs < DEFAULT_DELAY_MS) {
      throw new Error(`Scheduled artwork pacing must be at least ${DEFAULT_DELAY_MS} ms.`);
    }
    if (!/^[A-Z]{2}$/.test(options.market)) throw new Error('Spotify market must be a two-letter country code.');
  }

  return options;
}

function usageText() {
  return [
    'Trusted-local Spotify album artwork scheduler gate',
    '',
    'This command is intended to be woken by a trusted local scheduler. It does not install or activate a scheduler.',
    `Default and minimum due interval: ${DEFAULT_INTERVAL_HOURS} hours. Scheduled album-group ceiling: ${MAX_SCHEDULED_CAP}.`,
    `Rolling provider ceiling: ${MAX_TRACK_LOOKUPS_24H} Spotify track lookups per 24 hours. Minimum pacing: ${DEFAULT_DELAY_MS} ms.`,
    `The due marker is fixed at ${DEFAULT_STATE_PATH}.`,
    '',
    'Production execution remains separately authorized:',
    '  node scripts/spotify-album-artwork-scheduler.js --execute-scheduled',
  ].join('\n');
}

function assertPrivateStatePath(value = DEFAULT_STATE_PATH) {
  if (safeString(value) !== DEFAULT_STATE_PATH) {
    throw new Error(`Scheduled artwork state path is fixed at ${DEFAULT_STATE_PATH}.`);
  }
  const maintenanceRoot = path.resolve('.livevault-maintenance');
  const statePath = path.resolve(DEFAULT_STATE_PATH);
  if (statePath === maintenanceRoot || !statePath.startsWith(`${maintenanceRoot}${path.sep}`)) {
    throw new Error('Scheduled artwork state must stay inside the ignored .livevault-maintenance directory.');
  }
  return statePath;
}

function parseIso(value) {
  const text = safeString(value);
  if (!text) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function normalizeReservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scheduled artwork provider reservation is malformed.');
  }
  const at = parseIso(value.at);
  const maxLookups = Number(value.maxLookups);
  if (!at || !Number.isSafeInteger(maxLookups) || maxLookups < 1 || maxLookups > MAX_SCHEDULED_CAP) {
    throw new Error('Scheduled artwork provider reservation is invalid.');
  }
  return { ...value, at, maxLookups };
}

function validateState(value) {
  if (value == null) return { schemaVersion: SCHEDULE_SCHEMA_VERSION };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scheduled artwork state is malformed.');
  }
  if (Number(value.schemaVersion) !== SCHEDULE_SCHEMA_VERSION) {
    throw new Error('Scheduled artwork state schema is unsupported.');
  }

  const normalized = { ...value, schemaVersion: SCHEDULE_SCHEMA_VERSION };
  for (const field of ['lastAttemptAt', 'lastCompletedAt']) {
    if (value[field] == null) continue;
    const parsed = parseIso(value[field]);
    if (!parsed) throw new Error(`Scheduled artwork state has invalid ${field}.`);
    normalized[field] = parsed;
  }
  if (value.lastOutcome != null && !['completed', 'failed'].includes(value.lastOutcome)) {
    throw new Error('Scheduled artwork state has invalid lastOutcome.');
  }
  if (value.lastPlanHadUnresolved != null && typeof value.lastPlanHadUnresolved !== 'boolean') {
    throw new Error('Scheduled artwork state has invalid lastPlanHadUnresolved.');
  }
  if (value.lastManifestFingerprint != null && !safeString(value.lastManifestFingerprint)) {
    throw new Error('Scheduled artwork state has invalid lastManifestFingerprint.');
  }
  if (value.providerReservations != null) {
    if (!Array.isArray(value.providerReservations)) throw new Error('Scheduled artwork provider reservations are malformed.');
    normalized.providerReservations = value.providerReservations.map(normalizeReservation);
  }
  return normalized;
}

async function readState(statePath, { readFile = fs.readFile } = {}) {
  try {
    const text = await readFile(statePath, 'utf8');
    return validateState(JSON.parse(text));
  } catch (error) {
    if (error?.code === 'ENOENT') return validateState(null);
    if (error instanceof SyntaxError) throw new Error('Scheduled artwork state is not valid JSON.');
    throw error;
  }
}

async function writeState(statePath, value, {
  mkdir = fs.mkdir,
  writeFile = fs.writeFile,
  rename = fs.rename,
  unlink = fs.unlink,
} = {}) {
  const normalized = validateState(value);
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, statePath);
  } catch (error) {
    try { await unlink(temporaryPath); } catch (_) {}
    throw error;
  }
  return normalized;
}

function dueAt(state, intervalHours) {
  const lastAttempt = parseIso(state?.lastAttemptAt);
  if (!lastAttempt) return null;
  return new Date(Date.parse(lastAttempt) + intervalHours * 60 * 60 * 1000).toISOString();
}

function scheduleDecision(state, { now = new Date().toISOString(), intervalHours = DEFAULT_INTERVAL_HOURS } = {}) {
  const normalized = validateState(state);
  if (!Number.isSafeInteger(intervalHours) || intervalHours < MIN_INTERVAL_HOURS) {
    throw new Error(`Scheduled artwork interval must be a whole number of at least ${MIN_INTERVAL_HOURS} hours.`);
  }
  const nowIso = parseIso(now);
  if (!nowIso) throw new Error('Scheduled artwork clock is invalid.');
  const nextDueAt = dueAt(normalized, intervalHours);
  return {
    due: !nextDueAt || Date.parse(nowIso) >= Date.parse(nextDueAt),
    now: nowIso,
    nextDueAt,
  };
}

function activeReservations(state, nowIso) {
  const normalized = validateState(state);
  const nowTime = Date.parse(parseIso(nowIso));
  if (!Number.isFinite(nowTime)) throw new Error('Scheduled artwork clock is invalid.');
  const cutoff = nowTime - ROLLING_WINDOW_MS;
  return (normalized.providerReservations || []).filter((item) => Date.parse(item.at) > cutoff && Date.parse(item.at) <= nowTime);
}

function remainingTrackBudget(state, nowIso) {
  const reservations = activeReservations(state, nowIso);
  const reserved = reservations.reduce((sum, item) => sum + item.maxLookups, 0);
  return { reservations, reserved, remaining: Math.max(0, MAX_TRACK_LOOKUPS_24H - reserved) };
}

function maintenanceEligible(state) {
  return state?.lastPlanHadUnresolved === false && Boolean(safeString(state?.lastManifestFingerprint));
}

function assertScheduledAuthorization(options, env) {
  if (!options.executeScheduled) {
    throw new Error('Refusing scheduled production maintenance: add --execute-scheduled only after this trusted-local schedule has been explicitly authorized.');
  }
  if (env.LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM !== SCHEDULE_AUTHORIZATION) {
    throw new Error('Refusing scheduled production maintenance: LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM does not contain the required schedule authorization value.');
  }
}

function productionEnv(env) {
  return {
    ...env,
    LIVEVAULT_BACKFILL_CONFIRM: productionSafety.PRODUCTION_EXECUTION_CONFIRMATION,
    LIVEVAULT_BACKFILL_WRITE_CONFIRM: productionSafety.PRODUCTION_WRITE_CONFIRMATION,
  };
}

function privateManifestEnvironment(env) {
  return {
    endpoint: productionSafety.normalizeEndpoint(productionSafety.requiredEnv(env, 'CF_WORKER_ENDPOINT')),
    workerToken: productionSafety.requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN'),
  };
}

function configureLeaseEnvironment(env) {
  const { endpoint, workerToken } = privateManifestEnvironment(env);
  productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_ID');
  productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_SECRET');
  productionSafety.configureUsageEnvironment(env, { endpoint, workerToken });
  return { endpoint, workerToken };
}

async function readManifestFingerprint({ endpoint, workerToken, fetchImpl = fetch } = {}) {
  const result = await sourceReader.readJson({
    endpoint,
    token: workerToken,
    pathname: 'listening/manifest.json',
    fetchImpl,
  });
  const manifest = result.value;
  if (!manifest || manifest.kind !== 'livevault-listening-vault' || Number(manifest.schemaVersion) !== 1) {
    throw new Error('Private listening manifest is missing or unsupported.');
  }
  return `sha256:${sourceReader.sha256Hex(JSON.stringify(manifest))}`;
}

function notDueSummary(decision) {
  return { mode: 'spotify-album-artwork-scheduler', status: 'not_due', nextDueAt: decision.nextDueAt };
}

async function recordIdleMaintenance({ statePath, state, decision, fingerprint, writeStateImpl, log }) {
  const completedAt = decision.now;
  const reservations = activeReservations(state, completedAt);
  await writeStateImpl(statePath, {
    ...state,
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    lastAttemptAt: decision.now,
    lastCompletedAt: completedAt,
    lastOutcome: 'completed',
    lastPlanHadUnresolved: false,
    lastManifestFingerprint: fingerprint,
    providerReservations: reservations,
  });
  const summary = {
    mode: 'spotify-album-artwork-scheduler',
    status: 'idle_unchanged',
    completedAt,
    spotifyTrackLookups: 0,
    fullHistoryRead: false,
  };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

function replaceReservation(reservations, attemptAt, actualLookups) {
  const adjusted = [];
  let replaced = false;
  for (const reservation of reservations) {
    if (!replaced && reservation.at === attemptAt) {
      replaced = true;
      if (actualLookups > 0) adjusted.push({ ...reservation, maxLookups: actualLookups });
    } else {
      adjusted.push(reservation);
    }
  }
  return adjusted;
}

async function runScheduledCli({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => new Date().toISOString(),
  log = console.log,
  readStateImpl = readState,
  writeStateImpl = writeState,
  readManifestFingerprintImpl = readManifestFingerprint,
  runAlbumArtworkCliImpl = albumRunner.runProductionCli,
  withLeaseImpl = schedulerLease.withSchedulerLease,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(usageText());
    return { help: true };
  }
  assertScheduledAuthorization(options, env);
  const statePath = assertPrivateStatePath(options.statePath);
  const state = await readStateImpl(statePath);
  const decision = scheduleDecision(state, { now: now(), intervalHours: options.intervalHours });
  if (!decision.due) {
    const summary = notDueSummary(decision);
    log(JSON.stringify(summary, null, 2));
    return summary;
  }

  let observedFingerprint = null;
  if (maintenanceEligible(state)) {
    const privateEnv = privateManifestEnvironment(env);
    observedFingerprint = await readManifestFingerprintImpl(privateEnv);
    if (observedFingerprint === state.lastManifestFingerprint) {
      return recordIdleMaintenance({ statePath, state, decision, fingerprint: observedFingerprint, writeStateImpl, log });
    }
  }

  configureLeaseEnvironment(env);
  try {
    return await withLeaseImpl({ owner: LEASE_OWNER }, async () => {
      const currentState = await readStateImpl(statePath);
      const currentDecision = scheduleDecision(currentState, { now: now(), intervalHours: options.intervalHours });
      if (!currentDecision.due) {
        const summary = notDueSummary(currentDecision);
        log(JSON.stringify(summary, null, 2));
        return summary;
      }

      if (maintenanceEligible(currentState)) {
        const privateEnv = privateManifestEnvironment(env);
        observedFingerprint = await readManifestFingerprintImpl(privateEnv);
        if (observedFingerprint === currentState.lastManifestFingerprint) {
          return recordIdleMaintenance({
            statePath,
            state: currentState,
            decision: currentDecision,
            fingerprint: observedFingerprint,
            writeStateImpl,
            log,
          });
        }
      }

      const budget = remainingTrackBudget(currentState, currentDecision.now);
      const runCap = Math.min(options.cap, budget.remaining);
      if (runCap < 1) {
        const summary = {
          mode: 'spotify-album-artwork-scheduler',
          status: 'deferred',
          reason: 'rolling_24h_track_lookup_budget',
          reservedTrackLookups: budget.reserved,
        };
        log(JSON.stringify(summary, null, 2));
        return summary;
      }

      const attemptAt = currentDecision.now;
      const reservation = { at: attemptAt, maxLookups: runCap };
      const admittedReservations = [...budget.reservations, reservation];
      const admittedState = {
        ...currentState,
        schemaVersion: SCHEDULE_SCHEMA_VERSION,
        lastAttemptAt: attemptAt,
        providerReservations: admittedReservations,
      };
      await writeStateImpl(statePath, admittedState);

      try {
        const result = await runAlbumArtworkCliImpl({
          argv: [
            '--execute',
            '--write',
            '--cap', String(runCap),
            '--delay-ms', String(options.delayMs),
            '--market', options.market,
          ],
          env: productionEnv(env),
          log,
          withLeaseImpl: async (_leaseOptions, operation) => operation(),
        });
        const completedAt = parseIso(now());
        const actualLookups = Math.max(0, Math.min(runCap, Number(result?.providerAlbumGroupsAttempted) || 0));
        const remaining = Number(result?.providerAlbumGroupsRemaining);
        const caughtUp = Number.isSafeInteger(remaining) && remaining === 0;
        const finalState = {
          ...admittedState,
          lastCompletedAt: completedAt,
          lastOutcome: 'completed',
          lastPlanHadUnresolved: !caughtUp,
          providerReservations: replaceReservation(admittedReservations, attemptAt, actualLookups),
        };
        if (caughtUp && safeString(result?.sourceManifestFingerprint)) {
          finalState.lastManifestFingerprint = safeString(result.sourceManifestFingerprint);
        }
        await writeStateImpl(statePath, finalState);
        return { mode: 'spotify-album-artwork-scheduler', status: 'completed', completedAt, result };
      } catch (error) {
        try {
          await writeStateImpl(statePath, {
            ...admittedState,
            lastOutcome: 'failed',
          });
        } catch (stateError) {
          error.scheduleStateWriteError = stateError;
        }
        throw error;
      }
    });
  } catch (error) {
    if (error?.code === 'SCHEDULER_LEASE_BUSY') {
      const summary = { mode: 'spotify-album-artwork-scheduler', status: 'deferred', reason: 'scheduler_lease_busy' };
      log(JSON.stringify(summary, null, 2));
      return summary;
    }
    throw error;
  }
}

if (require.main === module) {
  runScheduledCli().catch((error) => {
    console.error(`Scheduled Spotify album artwork stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCHEDULE_SCHEMA_VERSION,
  DEFAULT_INTERVAL_HOURS,
  MIN_INTERVAL_HOURS,
  DEFAULT_CAP,
  MAX_SCHEDULED_CAP,
  DEFAULT_DELAY_MS,
  MAX_TRACK_LOOKUPS_24H,
  ROLLING_WINDOW_MS,
  DEFAULT_MARKET,
  DEFAULT_STATE_PATH,
  SCHEDULE_AUTHORIZATION,
  LEASE_OWNER,
  parseArgs,
  usageText,
  assertPrivateStatePath,
  parseIso,
  normalizeReservation,
  validateState,
  readState,
  writeState,
  dueAt,
  scheduleDecision,
  activeReservations,
  remainingTrackBudget,
  maintenanceEligible,
  assertScheduledAuthorization,
  productionEnv,
  privateManifestEnvironment,
  configureLeaseEnvironment,
  readManifestFingerprint,
  notDueSummary,
  recordIdleMaintenance,
  replaceReservation,
  runScheduledCli,
};
