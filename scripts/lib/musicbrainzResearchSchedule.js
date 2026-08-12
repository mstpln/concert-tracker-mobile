'use strict';

// Pure task planner for MusicBrainz work inside the recurring structured
// research run. The workflow itself also serves Ticketmaster/Spotify, so it
// keeps its existing cadence; MusicBrainz work is selected only when a stored
// task is actually due. Bootstrap/incomplete work comes first, then the
// oldest retained refreshes. Selection favors bands with no task selected
// yet before spending a second slot on the same band.

const TRUSTED_STATUSES = new Set(['confirmed', 'manual_confirmed', 'auto_confirmed']);
const DAY = 86400000;

function validTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confirmedMbid(band) {
  const mb = band?.musicbrainz;
  return !!(mb?.mbid && TRUSTED_STATUSES.has(mb.status));
}

function taskKey(bandId, kind) {
  return `${bandId}:${kind}`;
}

function metadataTask(band, nowMs, refreshDays) {
  const metadata = band.musicbrainz?.metadata || {};
  const lastSuccess = validTime(metadata.lastSuccessfulAt);
  const nextEligible = validTime(metadata.nextEligibleCheckAt);
  const hasMetadata = typeof metadata.artistName === 'string' && metadata.artistName.trim().length > 0;

  if (!hasMetadata) {
    if (nextEligible != null && nextEligible > nowMs) return null;
    return {
      key: taskKey(band.id, 'metadata'), bandId: band.id, kind: 'metadata',
      priority: 0, dueAt: nextEligible ?? validTime(metadata.lastAttemptedAt) ?? 0,
      reason: metadata.errorCategory ? 'metadata_retry_due' : 'metadata_bootstrap',
    };
  }

  if (nextEligible != null) {
    if (nextEligible > nowMs) return null;
    return {
      key: taskKey(band.id, 'metadata'), bandId: band.id, kind: 'metadata',
      priority: metadata.errorCategory ? 0 : 1, dueAt: nextEligible,
      reason: metadata.errorCategory ? 'metadata_retry_due' : 'metadata_retained_due',
    };
  }

  const refreshMs = Math.max(0, Number(refreshDays) || 0) * DAY;
  const dueAt = lastSuccess == null ? 0 : lastSuccess + refreshMs;
  if (dueAt > nowMs) return null;
  return {
    key: taskKey(band.id, 'metadata'), bandId: band.id, kind: 'metadata',
    priority: lastSuccess == null ? 0 : 1, dueAt,
    reason: lastSuccess == null ? 'metadata_bootstrap' : 'metadata_retained_due',
  };
}

function releaseTask(band, nowMs, releaseMonitoringEnabled, refreshDays) {
  if (!releaseMonitoringEnabled) return null;
  const baseline = band.structuredResearch?.releases?.musicbrainz || {};
  const status = baseline.status || 'not_started';
  const nextEligible = validTime(baseline.nextEligibleCheckAt);
  const lastSuccess = validTime(baseline.lastSuccessfulAt);
  const lastAttempt = validTime(baseline.lastAttemptedAt);
  const unfinished = status !== 'complete' || !!baseline.continuation;

  if (nextEligible != null && nextEligible > nowMs) return null;

  let dueAt = nextEligible;
  if (dueAt == null && unfinished) dueAt = lastAttempt ?? lastSuccess ?? 0;
  if (dueAt == null) {
    const refreshMs = Math.max(0, Number(refreshDays) || 0) * DAY;
    dueAt = lastSuccess == null ? 0 : lastSuccess + refreshMs;
  }
  if (dueAt > nowMs) return null;

  return {
    key: taskKey(band.id, 'release'), bandId: band.id, kind: 'release',
    priority: unfinished ? 0 : 1,
    dueAt,
    reason: unfinished ? (status === 'not_started' ? 'release_bootstrap' : 'release_continuation_or_retry') : 'release_retained_due',
  };
}

function compareTasks(a, b, selectedPerBand = new Map()) {
  return a.priority - b.priority
    || (selectedPerBand.get(a.bandId) || 0) - (selectedPerBand.get(b.bandId) || 0)
    || a.dueAt - b.dueAt
    || String(a.bandId).localeCompare(String(b.bandId))
    || a.kind.localeCompare(b.kind);
}

function planMusicbrainzResearch(bands, {
  now = new Date().toISOString(),
  perRunCap = 5,
  callsAlreadyUsed = 0,
  metadataRefreshDays = 90,
  releaseRefreshDays = 7,
  releaseMonitoringEnabled = true,
} = {}) {
  const nowMs = validTime(now) ?? Date.now();
  const remaining = Math.max(0, Math.floor(Number(perRunCap) || 0) - Math.max(0, Math.floor(Number(callsAlreadyUsed) || 0)));
  const due = [];

  for (const band of bands || []) {
    if (!confirmedMbid(band) || !band?.id) continue;
    const metadata = metadataTask(band, nowMs, metadataRefreshDays);
    if (metadata) due.push(metadata);
    const release = releaseTask(band, nowMs, releaseMonitoringEnabled, releaseRefreshDays);
    if (release) due.push(release);
  }

  const remainingTasks = [...due];
  const selected = [];
  const selectedPerBand = new Map();
  while (selected.length < remaining && remainingTasks.length) {
    remainingTasks.sort((a, b) => compareTasks(a, b, selectedPerBand));
    const next = remainingTasks.shift();
    selected.push(next);
    selectedPerBand.set(next.bandId, (selectedPerBand.get(next.bandId) || 0) + 1);
  }

  return {
    selected,
    selectedKeys: new Set(selected.map((task) => task.key)),
    dueCount: due.length,
    remainingCapacity: remaining,
  };
}

module.exports = { TRUSTED_STATUSES, confirmedMbid, taskKey, metadataTask, releaseTask, planMusicbrainzResearch };
