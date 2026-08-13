'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../scripts/spotify-album-artwork-scheduler');
const productionSafety = require('../scripts/spotify-artwork-backfill-production');

function authorizedEnv() {
  return { LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM: scheduler.SCHEDULE_AUTHORIZATION, CF_WORKER_ENDPOINT: 'https://worker.example.test',
    CF_WORKER_BROWSER_TOKEN: 'synthetic-browser-token', SPOTIFY_CLIENT_ID: 'synthetic-client-id', SPOTIFY_CLIENT_SECRET: 'synthetic-client-secret' };
}
async function immediateLease(options, operation) { assert.equal(options.owner, scheduler.LEASE_OWNER); return operation({ leaseId: 'synthetic-lease' }); }

test('DAB8 uses the agreed four-hour five-group five-second scheduled envelope', () => {
  const options = scheduler.parseArgs(['--execute-scheduled']);
  assert.equal(options.intervalHours, 4); assert.equal(options.cap, 5); assert.equal(options.delayMs, 5000);
  assert.equal(options.market, 'SE'); assert.equal(scheduler.MAX_TRACK_LOOKUPS_24H, 30);
});

test('DAB8 rejects faster cadence, larger cap, weaker pacing and alternate state path', () => {
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--cap', '6']), /between 1 and 5/);
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--delay-ms', '4999']), /at least 5000/);
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--interval-hours', '3']), /at least 4 hours/);
  assert.throws(() => scheduler.parseArgs(['--execute-scheduled', '--state', 'other.json']), /Unknown argument/);
});

test('DAB8 due gate is exact at four hours', () => {
  const state = { schemaVersion: 1, lastAttemptAt: '2026-08-13T06:00:00.000Z' };
  assert.equal(scheduler.scheduleDecision(state, { now: '2026-08-13T09:59:59.999Z' }).due, false);
  assert.equal(scheduler.scheduleDecision(state, { now: '2026-08-13T10:00:00.000Z' }).due, true);
});

test('DAB8 rolling budget counts only reservations inside the preceding 24 hours', () => {
  const state = { schemaVersion: 1, providerReservations: [
    { at: '2026-08-12T09:59:59.000Z', maxLookups: 5 }, { at: '2026-08-12T10:00:01.000Z', maxLookups: 5 },
    { at: '2026-08-13T06:00:00.000Z', maxLookups: 4 }] };
  assert.deepEqual(scheduler.remainingTrackBudget(state, '2026-08-13T10:00:00.000Z'), {
    reservations: [{ at: '2026-08-12T10:00:01.000Z', maxLookups: 5 }, { at: '2026-08-13T06:00:00.000Z', maxLookups: 4 }], reserved: 9, remaining: 21 });
});

test('DAB8 unchanged caught-up manifest skips lease, full history and Spotify', async () => {
  let leases = 0; let runs = 0; let fingerprints = 0; const states = [];
  const result = await scheduler.runScheduledCli({ argv: ['--execute-scheduled'], env: authorizedEnv(),
    now: () => '2026-08-13T10:00:00.000Z', log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1, lastAttemptAt: '2026-08-13T06:00:00.000Z', lastPlanHadUnresolved: false,
      lastManifestFingerprint: 'sha256:same', futureField: { preserved: true } }),
    writeStateImpl: async (_path, state) => states.push(state), readManifestFingerprintImpl: async () => { fingerprints += 1; return 'sha256:same'; },
    withLeaseImpl: async () => { leases += 1; }, runAlbumArtworkCliImpl: async () => { runs += 1; } });
  assert.equal(result.status, 'idle_unchanged'); assert.equal(result.spotifyTrackLookups, 0); assert.equal(result.fullHistoryRead, false);
  assert.equal(fingerprints, 1); assert.equal(leases, 0); assert.equal(runs, 0); assert.equal(states[0].futureField.preserved, true);
});

test('DAB8 fresh state performs zero work', async () => {
  let runs = 0; let leases = 0;
  const result = await scheduler.runScheduledCli({ argv: ['--execute-scheduled'], env: authorizedEnv(), now: () => '2026-08-13T10:00:00.000Z', log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1, lastAttemptAt: '2026-08-13T09:00:00.000Z' }), writeStateImpl: async () => {},
    withLeaseImpl: async () => { leases += 1; }, runAlbumArtworkCliImpl: async () => { runs += 1; } });
  assert.equal(result.status, 'not_due'); assert.equal(result.nextDueAt, '2026-08-13T13:00:00.000Z'); assert.equal(leases, 0); assert.equal(runs, 0);
});

test('DAB8 busy provider lease defers without consuming the four-hour attempt', async () => {
  let writes = 0; const busy = new Error('busy'); busy.code = 'SCHEDULER_LEASE_BUSY';
  const result = await scheduler.runScheduledCli({ argv: ['--execute-scheduled'], env: authorizedEnv(), now: () => '2026-08-13T10:00:00.000Z', log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1 }), writeStateImpl: async () => { writes += 1; }, withLeaseImpl: async () => { throw busy; } });
  assert.equal(result.status, 'deferred'); assert.equal(result.reason, 'scheduler_lease_busy'); assert.equal(writes, 0);
});

test('DAB8 reserves rolling budget before provider work and reconciles to actual lookups', async () => {
  const states = []; let invocation; let clock = 0;
  const result = await scheduler.runScheduledCli({ argv: ['--execute-scheduled', '--market', 'us'], env: authorizedEnv(),
    now: () => (++clock < 3 ? '2026-08-13T10:00:00.000Z' : '2026-08-13T10:02:00.000Z'), log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1, providerReservations: [{ at: '2026-08-13T06:00:00.000Z', maxLookups: 5 }], futureField: true }),
    writeStateImpl: async (_path, state) => states.push(JSON.parse(JSON.stringify(state))), withLeaseImpl: immediateLease,
    runAlbumArtworkCliImpl: async (options) => { invocation = options; return { providerAlbumGroupsAttempted: 2, providerAlbumGroupsRemaining: 3, sourceManifestFingerprint: 'sha256:x' }; } });
  assert.equal(result.status, 'completed');
  assert.deepEqual(invocation.argv, ['--execute', '--write', '--cap', '5', '--delay-ms', '5000', '--market', 'US']);
  assert.equal(invocation.env.LIVEVAULT_BACKFILL_CONFIRM, productionSafety.PRODUCTION_EXECUTION_CONFIRMATION);
  assert.equal(states[0].providerReservations.at(-1).maxLookups, 5); assert.equal(states[1].providerReservations.at(-1).maxLookups, 2);
  assert.equal(states[1].lastPlanHadUnresolved, true); assert.equal(states[1].futureField, true);
});

test('DAB8 refuses a seventh five-lookup reservation inside a rolling day', async () => {
  const reservations = [0, 4, 8, 12, 16, 20].map((hour) => ({ at: `2026-08-12T${String(10 + hour).padStart(2, '0')}:00:00.000Z`, maxLookups: 5 }));
  // Use explicit valid ISO times spanning the preceding 24h.
  reservations.splice(4, 2, { at: '2026-08-13T02:00:00.000Z', maxLookups: 5 }, { at: '2026-08-13T06:00:00.000Z', maxLookups: 5 });
  let runs = 0;
  const result = await scheduler.runScheduledCli({ argv: ['--execute-scheduled'], env: authorizedEnv(), now: () => '2026-08-13T10:00:00.000Z', log: () => {},
    readStateImpl: async () => ({ schemaVersion: 1, providerReservations: reservations }), writeStateImpl: async () => {}, withLeaseImpl: immediateLease,
    runAlbumArtworkCliImpl: async () => { runs += 1; } });
  assert.equal(result.status, 'deferred'); assert.equal(result.reason, 'rolling_24h_track_lookup_budget'); assert.equal(runs, 0);
});
