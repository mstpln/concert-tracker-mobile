'use strict';

const BUCKETS = Object.freeze(['inventory', 'listenbrainz', 'spotify', 'musicbrainz', 'weather']);

function safeCounter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

function freshDataMaintenanceUsage() {
  return {
    inventoryRuns: 0,
    providerAttempts: { listenbrainz: 0, spotify: 0, musicbrainz: 0, weather: 0 },
    completed: { listenbrainz: 0, spotify: 0, musicbrainz: 0, weather: 0 },
    stops: {},
    lastRun: null,
  };
}

function ensureDataMaintenanceUsage(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Usage state must be an object.');
  if (!state.dataMaintenance || typeof state.dataMaintenance !== 'object' || Array.isArray(state.dataMaintenance)) {
    state.dataMaintenance = freshDataMaintenanceUsage();
  }
  const usage = state.dataMaintenance;
  usage.inventoryRuns = safeCounter(usage.inventoryRuns);
  for (const name of ['providerAttempts', 'completed']) {
    if (!usage[name] || typeof usage[name] !== 'object' || Array.isArray(usage[name])) usage[name] = {};
    for (const provider of BUCKETS.filter((item) => item !== 'inventory')) usage[name][provider] = safeCounter(usage[name][provider]);
  }
  if (!usage.stops || typeof usage.stops !== 'object' || Array.isArray(usage.stops)) usage.stops = {};
  for (const [key, value] of Object.entries(usage.stops)) usage.stops[key] = safeCounter(value);
  if (!('lastRun' in usage)) usage.lastRun = null;
  return usage;
}

function recordInventory(state) {
  const usage = ensureDataMaintenanceUsage(state);
  usage.inventoryRuns += 1;
  return usage;
}

function recordProviderAttempt(state, provider) {
  if (!BUCKETS.includes(provider) || provider === 'inventory') throw new Error('Unknown data-maintenance provider.');
  const usage = ensureDataMaintenanceUsage(state);
  usage.providerAttempts[provider] += 1;
  return usage;
}

function recordCompleted(state, provider) {
  if (!BUCKETS.includes(provider) || provider === 'inventory') throw new Error('Unknown data-maintenance provider.');
  const usage = ensureDataMaintenanceUsage(state);
  usage.completed[provider] += 1;
  return usage;
}

function recordStop(state, reason) {
  const clean = String(reason || '').trim();
  if (!clean || clean.length > 64) throw new Error('A bounded stop reason is required.');
  const usage = ensureDataMaintenanceUsage(state);
  usage.stops[clean] = safeCounter(usage.stops[clean]) + 1;
  return usage;
}

function finishDataMaintenanceRun(state, summary = {}, now = new Date().toISOString()) {
  const usage = ensureDataMaintenanceUsage(state);
  const safeSummary = {};
  for (const key of ['mode', 'scannedEvents', 'eligibleEvents', 'uniqueTracks', 'alreadyComplete', 'unresolved']) {
    if (summary[key] == null) continue;
    safeSummary[key] = key === 'mode' ? String(summary[key]).slice(0, 32) : safeCounter(summary[key]);
  }
  usage.lastRun = { finishedAt: now, ...safeSummary };
  return usage.lastRun;
}

function extendUsageTracker(tracker) {
  if (!tracker?.state) throw new Error('UsageTracker instance is required.');
  ensureDataMaintenanceUsage(tracker.state);
  tracker.recordDataMaintenanceInventory = () => recordInventory(tracker.state);
  tracker.recordDataMaintenanceAttempt = (provider) => recordProviderAttempt(tracker.state, provider);
  tracker.recordDataMaintenanceCompleted = (provider) => recordCompleted(tracker.state, provider);
  tracker.recordDataMaintenanceStop = (reason) => recordStop(tracker.state, reason);
  tracker.finishDataMaintenanceRun = (summary) => finishDataMaintenanceRun(tracker.state, summary);
  return tracker;
}

module.exports = {
  BUCKETS,
  safeCounter,
  freshDataMaintenanceUsage,
  ensureDataMaintenanceUsage,
  recordInventory,
  recordProviderAttempt,
  recordCompleted,
  recordStop,
  finishDataMaintenanceRun,
  extendUsageTracker,
};
