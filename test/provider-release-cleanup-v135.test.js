'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../scripts/lib/config');
const { planLifecycleAlerts } = require('../scripts/lib/releaseAlertPlan');

test('v135 retires structured release monitoring and lifecycle alert creation', () => {
  assert.equal(config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled, false);
  const release = { canonicalReleaseId: 'release-1', lifecycleEligible: true, title: 'Future Album', type: 'Album', releaseDate: '2026-08-16', lifecycle: {} };
  const plan = planLifecycleAlerts({ band: { id: 'band-1', name: 'Band' }, releases: [release], alerts: [], today: '2026-08-16T12:00:00.000Z' });
  assert.deepEqual(plan.alertsToCreate, []);
  assert.deepEqual(plan.lifecycleUpdates, []);
  assert.equal(plan.skipped[0].reason, 'release_monitoring_retired');
});

test('v135 shell removes release alert compatibility script and loads cleanup UI', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  assert.doesNotMatch(index, /releaseAlertsV122\.js/);
  assert.match(index, /providerReleaseCleanupV135\.js/);
  assert.doesNotMatch(worker, /releaseAlertsV122\.js/);
  assert.match(worker, /providerReleaseCleanupV135\.js/);
});

test('v135 cleanup override preserves listening and removes Releases tabs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'providerReleaseCleanupV135.js'), 'utf8');
  assert.match(source, /\['listening', 'Listening'\]/);
  assert.match(source, /\['data', 'Data'\]/);
  assert.doesNotMatch(source, /\['news', 'Releases'\]/);
  assert.match(source, /No new concerts found in the last 90 days/);
});
