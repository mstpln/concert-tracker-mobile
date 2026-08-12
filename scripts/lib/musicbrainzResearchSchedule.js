'use strict';

// Pure task planner for MusicBrainz work inside the recurring structured
// research run. The workflow itself also serves Ticketmaster/Spotify, so it
// keeps its existing cadence; MusicBrainz work is selected only when a stored
// task is actually due. Bootstrap/incomplete work comes first, then the
// oldest retained refreshes. Selection favors bands with no task selected
// yet before spending a second slot on the same band, and equal-age work
// favors the band with the oldest overall MusicBrainz activity so fairness
// carries across separate workflow runs without another durable cursor.

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

function bandActivityAt(band) {
  const metadata = band?.musicbrainz?.metadata || {};
  const release = band?.structuredResearch?.releases?.musicbrainz || {};
  const values = [
    metadata.lastAttemptedAt,
    metadata.lastSuccessfulAt,
    release.lastAttemptedAt,
    release.lastSuccessfulAt,
  ].map(validTime).filter((value) => value != null);
  return values.length ? Math.max(...values) : 0;
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
  const refreshMs = Math.max(0, Number(refreshDays) || 0) * DAY;

  let dueAt;
  if (unfinished) {
    if (nextEligible != null && nextEligible > nowMs) return null;
    dueAt = nextEligible ?? lastAttempt ?? lastSuccess ?? 0;
  } else {
    const retainedDueAt = lastSuccess == null ? 0 : lastSuccess + refreshMs;
    // Older scheduled builds persisted a three-day marker for both providers.
    // A complete MusicBrainz baseline must still respect DAB5's retained
    // interval, while a later explicit marker remains a valid deferral.
    dueAt = nextEligible == null ? retainedDueAt : Math.max(retainedDueAt, nextEligible);
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
    || (a.bandActivityAt || 0) - (b.bandActivityAt || 0)
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
  const nowMs = validTime(now);
  const cap = Number(perRunCap);
  const used = Number(callsAlreadyUsed);
  const capacityValid = Number.isFinite(cap) && cap >= 0 && Number.isFinite(used) && used >= 0;
  const remaining = capacityValid ? Math.max(0, Math.floor(cap) - Math.floor(used)) : 0;
  const due = [];

  if (nowMs == null) {
    return { selected: [], selectedKeys: new Set(), dueCount: 0, remainingCapacity: 0 };
  }

  for (const band of bands || []) {
    if (!confirmedMbid(band) || !band?.id) continue;
    const activity = bandActivityAt(band);
    const metadata = metadataTask(band, nowMs, metadataRefreshDays);
    if (metadata) due.push({ ...metadata, bandActivityAt: activity });
    const release = releaseTask(band, nowMs, releaseMonitoringEnabled, releaseRefreshDays);
    if (release) due.push({ ...release, bandActivityAt: activity });
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

module.exports = { TRUSTED_STATUSES, confirmedMbid, taskKey, bandActivityAt, metadataTask, releaseTask, planMusicbrainzResearch };
