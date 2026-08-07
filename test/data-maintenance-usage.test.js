'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const usage = require('../scripts/lib/dataMaintenanceUsage');

test('old apiUsage state gains additive aggregate-only maintenance diagnostics', () => {
  const state = { spotify: { callsToday: 7 }, futureRoot: { keep: true } };
  const tracker = { state };
  usage.extendUsageTracker(tracker);
  tracker.recordDataMaintenanceInventory();
  tracker.recordDataMaintenanceAttempt('spotify');
  tracker.recordDataMaintenanceCompleted('spotify');
  tracker.recordDataMaintenanceStop('rate_limited');
  tracker.finishDataMaintenanceRun({ mode: 'inventory', scannedEvents: 100, uniqueTracks: 20, ignoredPrivateValue: 'never copy this' });

  assert.equal(state.spotify.callsToday, 7);
  assert.deepEqual(state.futureRoot, { keep: true });
  assert.equal(state.dataMaintenance.inventoryRuns, 1);
  assert.equal(state.dataMaintenance.providerAttempts.spotify, 1);
  assert.equal(state.dataMaintenance.completed.spotify, 1);
  assert.equal(state.dataMaintenance.stops.rate_limited, 1);
  assert.equal(state.dataMaintenance.lastRun.mode, 'inventory');
  assert.equal(state.dataMaintenance.lastRun.uniqueTracks, 20);
  assert.equal('ignoredPrivateValue' in state.dataMaintenance.lastRun, false);
});

test('maintenance diagnostics reject unknown providers and unbounded stop reasons', () => {
  const state = {};
  assert.throws(() => usage.recordProviderAttempt(state, 'other'), /Unknown/);
  assert.throws(() => usage.recordStop(state, 'x'.repeat(65)), /bounded/);
});
