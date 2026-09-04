'use strict';

const { spawn } = require('node:child_process');
const {
  withSchedulerLease,
  scheduledPeriodKey,
  scheduledRunAlreadyCompleted,
  markScheduledRunCompleted,
} = require('./lib/schedulerLease');

function parseArgs(argv = []) {
  const separator = argv.indexOf('--');
  if (separator !== 1 || separator === argv.length - 1) {
    throw new Error('Usage: node scripts/run-with-scheduler-lease.js <owner> -- <command> [args...]');
  }
  const owner = String(argv[0] || '').trim();
  if (!owner) throw new Error('Scheduler lease owner is required.');
  return { owner, command: argv[separator + 1], args: argv.slice(separator + 2) };
}

function runChild(command, args, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        const error = new Error(`Provider scheduler child exited from signal ${signal}.`);
        error.code = 'SCHEDULER_CHILD_SIGNAL';
        error.signal = signal;
        reject(error);
        return;
      }
      if (code !== 0) {
        const error = new Error(`Provider scheduler child exited with status ${code}.`);
        error.code = 'SCHEDULER_CHILD_FAILED';
        error.exitCode = code;
        reject(error);
        return;
      }
      resolve(0);
    });
  });
}

async function main({
  argv = process.argv.slice(2),
  withLease = withSchedulerLease,
  spawnImpl = spawn,
  env = process.env,
  now = () => Date.now(),
  alreadyCompleted = scheduledRunAlreadyCompleted,
  markCompleted = markScheduledRunCompleted,
  log = console.log,
} = {}) {
  const { owner, command, args } = parseArgs(argv);
  const periodKey = env.GITHUB_EVENT_NAME === 'schedule' ? scheduledPeriodKey(owner, now()) : null;
  return withLease({ owner }, async (handle) => {
    if (periodKey && await alreadyCompleted({ owner, periodKey, client: handle?.client })) {
      log(`Provider scheduler skipped duplicate scheduled run for ${owner} period ${periodKey}.`);
      return 0;
    }
    const result = await runChild(command, args, { spawnImpl, env });
    if (periodKey) {
      await markCompleted({ owner, periodKey, client: handle?.client, completedAt: new Date(now()).toISOString() });
    }
    return result;
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Provider scheduler stopped: ${error.message}`);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  });
}

module.exports = { parseArgs, runChild, main };
