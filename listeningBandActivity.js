'use strict';

// Privacy boundary between local listening history and server automation.
// Only stable band ids and exclusive activity-window counts leave the browser;
// artist/track names, listen ids, timestamps per listen, and provider payloads
// remain in private listening storage.
(function attachListeningBandActivity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultListeningBandActivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const PATH = 'listening/band-activity.json';
  const KIND = 'livevault-listening-band-activity';
  const SCHEMA_VERSION = 1;
  const REFRESH_MS = 6 * 60 * 60 * 1000;
  const BUCKETS = Object.freeze(['fourteenDays', 'threeMonths', 'oneYear', 'allTime']);

  function stableBandIds(bands) {
    return [...new Set((bands || []).map((band) => String(band?.id || '').trim()).filter(Boolean))].sort();
  }

  function catalogueFingerprint(bands) {
    const input = stableBandIds(bands).join('\n');
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
  }

  function subtractCalendarMonths(date, months) {
    const value = new Date(date.getTime());
    const day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
    value.setUTCDate(Math.min(day, lastDay));
    return value;
  }

  function emptyBuckets() {
    return Object.fromEntries(BUCKETS.map((bucket) => [bucket, { listenCount: 0, lastListenedAt: null }]));
  }

  function activityBucket(timestamp, now) {
    if (timestamp >= now.getTime() - 14 * 86400000) return 'fourteenDays';
    if (timestamp >= subtractCalendarMonths(now, 3).getTime()) return 'threeMonths';
    if (timestamp >= subtractCalendarMonths(now, 12).getTime()) return 'oneYear';
    return 'allTime';
  }

  function buildAggregate(events, bands, now = new Date()) {
    const generatedAt = new Date(now).toISOString();
    const records = {};
    for (const bandId of stableBandIds(bands)) records[bandId] = { bandId, buckets: emptyBuckets() };
    let mappedListenCount = 0;
    let sourceLastListenedAt = null;
    for (const event of events || []) {
      const bandId = String(event?.localBandId || '').trim();
      const timestamp = Date.parse(event?.listenedAt);
      if (!records[bandId] || !Number.isFinite(timestamp) || timestamp > Date.parse(generatedAt)) continue;
      const listenedAt = new Date(timestamp).toISOString();
      const bucket = records[bandId].buckets[activityBucket(timestamp, new Date(generatedAt))];
      bucket.listenCount += 1;
      if (!bucket.lastListenedAt || listenedAt > bucket.lastListenedAt) bucket.lastListenedAt = listenedAt;
      if (!sourceLastListenedAt || listenedAt > sourceLastListenedAt) sourceLastListenedAt = listenedAt;
      mappedListenCount += 1;
    }
    return { kind: KIND, schemaVersion: SCHEMA_VERSION, generatedAt, catalogueFingerprint: catalogueFingerprint(bands), mappedListenCount, sourceLastListenedAt, records };
  }

  function validIso(value, nullable = false) {
    if (nullable && value == null) return true;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    try { return value === new Date(value).toISOString(); } catch (_) { return false; }
  }

  function validateAggregate(value, { bands = null } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== KIND || value.schemaVersion !== SCHEMA_VERSION) return false;
    if (!validIso(value.generatedAt) || !validIso(value.sourceLastListenedAt, true) || !Number.isInteger(value.mappedListenCount) || value.mappedListenCount < 0) return false;
    if (!/^fnv1a32:[0-9a-f]{8}$/.test(value.catalogueFingerprint || '') || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return false;
    const entries = Object.entries(value.records);
    if (entries.length > 10000) return false;
    let counted = 0;
    let latest = null;
    for (const [key, record] of entries) {
      if (!key || record?.bandId !== key || !record.buckets || Object.keys(record.buckets).sort().join(',') !== [...BUCKETS].sort().join(',')) return false;
      for (const bucket of BUCKETS) {
        const row = record.buckets[bucket];
        if (!row || !Number.isInteger(row.listenCount) || row.listenCount < 0 || !validIso(row.lastListenedAt, true)) return false;
        if ((row.listenCount === 0) !== (row.lastListenedAt == null)) return false;
        if (row.lastListenedAt && row.lastListenedAt > value.generatedAt) return false;
        counted += row.listenCount;
        if (row.lastListenedAt && (!latest || row.lastListenedAt > latest)) latest = row.lastListenedAt;
      }
    }
    if (counted !== value.mappedListenCount || latest !== value.sourceLastListenedAt) return false;
    if (bands && (value.catalogueFingerprint !== catalogueFingerprint(bands) || entries.length !== stableBandIds(bands).length)) return false;
    return true;
  }

  async function publishFromBrowser(events, bands, now = new Date()) {
    if (typeof rsGetConnection !== 'function' || typeof dlReadJsonFile !== 'function' || typeof dlWriteJsonFileIfCurrent !== 'function') return { kind: 'unavailable' };
    const remote = rsGetConnection();
    if (!remote?.endpoint || !remote?.token) return { kind: 'unavailable' };
    const next = buildAggregate(events, bands, now);
    const prior = await dlReadJsonFile(remote, PATH, null);
    const priorGenerated = Date.parse(prior?.generatedAt);
    if (validateAggregate(prior, { bands }) && JSON.stringify(prior.records) === JSON.stringify(next.records) && Number.isFinite(priorGenerated) && new Date(now).getTime() - priorGenerated < REFRESH_MS) return { kind: 'unchanged' };
    await dlWriteJsonFileIfCurrent(remote, PATH, next);
    return { kind: 'updated', aggregate: next };
  }

  return { PATH, KIND, SCHEMA_VERSION, REFRESH_MS, BUCKETS, stableBandIds, catalogueFingerprint, subtractCalendarMonths, activityBucket, buildAggregate, validateAggregate, publishFromBrowser };
});
