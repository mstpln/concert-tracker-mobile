'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const albumRunner = require('./spotify-album-artwork-production');
const productionSafety = require('./spotify-artwork-backfill-production');
const schedulerLease = require('./lib/schedulerLease');

const SCHEDULE_SCHEMA_VERSION = 1;
const DEFAULT_INTERVAL_HOURS = 24;
const MIN_INTERVAL_HOURS = DEFAULT_INTERVAL_HOURS;
const DEFAULT_CAP = albumRunner.DEFAULT_CAP;
const DEFAULT_DELAY_MS = albumRunner.DEFAULT_DELAY_MS;
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
    else if (arg === '--state') { options.statePath = safeString(next); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.intervalHours || options.intervalHours < MIN_INTERVAL_HOURS) {
      throw new Error(`Scheduled artwork interval must be a whole number of at least ${MIN_INTERVAL_HOURS} hours.`);
    }
    if (!options.cap || options.cap > albumRunner.MAX_CAP) throw new Error(`Scheduled artwork cap must be between 1 and ${albumRunner.MAX_CAP}.`);
    if (!options.delayMs || options.delayMs < albumRunner.DEFAULT_DELAY_MS) {
      throw new Error(`Scheduled artwork pacing must be at least ${albumRunner.DEFAULT_DELAY_MS} ms.`);
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
    `Default and minimum due interval: ${DEFAULT_INTERVAL_HOURS} hours. Default album-group cap: ${DEFAULT_CAP}.`,
    'The due marker is private local state under .livevault-maintenance/.',
    '',
    'Production execution remains separately authorized:',
    '  node scripts/spotify-album-artwork-scheduler.js --execute-scheduled',
  ].join('\n');
}

function assertPrivateStatePath(value) {
  const maintenanceRoot = path.resolve('.livevault-maintenance');
  const statePath = path.resolve(safeString(value));
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

function configureLeaseEnvironment(env) {
  const endpoint = productionSafety.normalizeEndpoint(productionSafety.requiredEnv(env, 'CF_WORKER_ENDPOINT'));
  const workerToken = productionSafety.requiredEnv(env, 'CF_WORKER_BROWSER_TOKEN');
  productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_ID');
  productionSafety.requiredEnv(env, 'SPOTIFY_CLIENT_SECRET');
  productionSafety.configureUsageEnvironment(env, { endpoint, workerToken });
}

function notDueSummary(decision) {
  return { mode: 'spotify-album-artwork-scheduler', status: 'not_due', nextDueAt: decision.nextDueAt };
}

async function runScheduledCli({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => new Date().toISOString(),
  log = console.log,
  readStateImpl = readState,
  writeStateImpl = writeState,
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

      const attemptAt = currentDecision.now;
      await writeStateImpl(statePath, {
        ...currentState,
        schemaVersion: SCHEDULE_SCHEMA_VERSION,
        lastAttemptAt: attemptAt,
      });

      try {
        const result = await runAlbumArtworkCliImpl({
          argv: [
            '--execute',
            '--write',
            '--cap', String(options.cap),
            '--delay-ms', String(options.delayMs),
            '--market', options.market,
          ],
          env: productionEnv(env),
          log,
          withLeaseImpl: async (_leaseOptions, operation) => operation(),
        });
        const completedAt = parseIso(now());
        await writeStateImpl(statePath, {
          ...currentState,
          schemaVersion: SCHEDULE_SCHEMA_VERSION,
          lastAttemptAt: attemptAt,
          lastCompletedAt: completedAt,
          lastOutcome: 'completed',
        });
        return { mode: 'spotify-album-artwork-scheduler', status: 'completed', completedAt, result };
      } catch (error) {
        try {
          await writeStateImpl(statePath, {
            ...currentState,
            schemaVersion: SCHEDULE_SCHEMA_VERSION,
            lastAttemptAt: attemptAt,
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
  DEFAULT_DELAY_MS,
  DEFAULT_MARKET,
  DEFAULT_STATE_PATH,
  SCHEDULE_AUTHORIZATION,
  LEASE_OWNER,
  parseArgs,
  usageText,
  assertPrivateStatePath,
  parseIso,
  validateState,
  readState,
  writeState,
  dueAt,
  scheduleDecision,
  assertScheduledAuthorization,
  productionEnv,
  configureLeaseEnvironment,
  notDueSummary,
  runScheduledCli,
};
