'use strict';

(function attachDiscoverModelV170(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultDiscoverModelV170 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const KIND = 'bandmarkr-discover-recommendations';
  const SCHEMA_VERSION = 1;
  const MAX_VISIBLE_PER_GROUP = 10;
  const MAX_UNRESOLVED_PER_GROUP = 20;
  const MAX_GROUPS = 30;
  const MAX_SEEDS = 10;
  const FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
  const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function normalizeMbid(value) { const text = String(value || '').trim().toLowerCase(); return MBID_RE.test(text) ? text : null; }
  function cleanText(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
  function validIso(value, nullable = false) {
    if (nullable && value == null) return true;
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }
  function emptyState(now = null) {
    return { kind: KIND, schemaVersion: SCHEMA_VERSION, updatedAt: now, lastSuccessfulRefreshAt: null, groups: [], decisions: {} };
  }
  function trustedBandMbid(band) {
    const identity = band?.musicbrainz;
    if (!identity || !['auto_confirmed', 'manual_confirmed'].includes(identity.status)) return null;
    return normalizeMbid(identity.mbid);
  }
  function normalizeTags(tags) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(tags) ? tags : []) {
      const label = cleanText(typeof raw === 'string' ? raw : raw?.tag || raw?.name);
      if (!label) continue;
      const key = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length === 2) break;
    }
    return out;
  }
  function candidateFrom(value, now = new Date().toISOString()) {
    const artistMbid = normalizeMbid(value?.artistMbid || value?.mbid || value?.artist_mbid);
    const name = cleanText(value?.name || value?.artistName || value?.artist_name);
    if (!artistMbid || !name) return null;
    const score = Number(value?.similarityScore ?? value?.score ?? value?.similarity ?? 0);
    const begin = Number(value?.beginYear ?? value?.begin_year);
    return {
      ...(value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {}),
      artistMbid,
      name,
      similarityScore: Number.isFinite(score) ? score : 0,
      tags: normalizeTags(value?.tags),
      area: cleanText(value?.area || value?.country) || null,
      beginYear: Number.isInteger(begin) && begin >= 1000 && begin <= 9999 ? begin : null,
      discoveredAt: validIso(value?.discoveredAt) ? value.discoveredAt : now,
    };
  }
  function decisionIsValid(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && ['dismissed', 'added'].includes(value.status)
      && validIso(value.decidedAt)
      && (value.addedBandId == null || typeof value.addedBandId === 'string');
  }
  function validateState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== KIND || value.schemaVersion !== SCHEMA_VERSION) return false;
    if (!validIso(value.updatedAt, true) || !validIso(value.lastSuccessfulRefreshAt, true)) return false;
    if (!Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) return false;
    if (!value.decisions || typeof value.decisions !== 'object' || Array.isArray(value.decisions) || Object.keys(value.decisions).length > 10000) return false;
    for (const [key, decision] of Object.entries(value.decisions)) if (normalizeMbid(key) !== key.toLowerCase() || !decisionIsValid(decision)) return false;
    const candidates = new Set();
    const seeds = new Set();
    for (const group of value.groups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return false;
      const seedMbid = normalizeMbid(group.seedMbid);
      if (!seedMbid || seeds.has(seedMbid) || !cleanText(group.seedName) || !validIso(group.createdAt)) return false;
      if (group.seedBandId != null && typeof group.seedBandId !== 'string') return false;
      if (!Array.isArray(group.candidates) || group.candidates.length > MAX_UNRESOLVED_PER_GROUP) return false;
      seeds.add(seedMbid);
      for (const candidate of group.candidates) {
        const normalized = candidateFrom(candidate, candidate?.discoveredAt);
        if (!normalized || normalized.artistMbid !== String(candidate.artistMbid || '').toLowerCase() || candidates.has(normalized.artistMbid)) return false;
        if (value.decisions[normalized.artistMbid]) return false;
        candidates.add(normalized.artistMbid);
      }
    }
    return true;
  }
  function visibleGroups(state, followedBands = []) {
    const followed = new Set((followedBands || []).map(trustedBandMbid).filter(Boolean));
    return (state?.groups || []).map((group) => ({
      ...group,
      candidates: (group.candidates || []).filter((candidate) => !followed.has(normalizeMbid(candidate.artistMbid)) && !state?.decisions?.[normalizeMbid(candidate.artistMbid)]).slice(0, MAX_VISIBLE_PER_GROUP),
    })).filter((group) => group.candidates.length > 0);
  }
  function selectSeeds(activity, bands) {
    const bandById = new Map((bands || []).map((band) => [String(band?.id || ''), band]));
    return Object.values(activity?.records || {})
      .map((record) => {
        const band = bandById.get(String(record?.bandId || ''));
        const bucket = record?.buckets?.fourteenDays;
        return { band, count: Number(bucket?.listenCount) || 0, recencyRank: Number(bucket?.recencyRank) || Number.MAX_SAFE_INTEGER };
      })
      .filter((row) => row.band && row.count > 0 && trustedBandMbid(row.band))
      .sort((a, b) => b.count - a.count || a.recencyRank - b.recencyRank || String(a.band.id).localeCompare(String(b.band.id)))
      .slice(0, MAX_SEEDS)
      .map((row) => ({ seedBandId: String(row.band.id), seedMbid: trustedBandMbid(row.band), seedName: cleanText(row.band.name), listenCount: row.count, recencyRank: row.recencyRank }));
  }
  function followedMbidSet(bands) { return new Set((bands || []).map(trustedBandMbid).filter(Boolean)); }
  function admitRefresh(state, seedResults, bands, now = new Date().toISOString()) {
    const next = clone(validateState(state) ? state : emptyState(null));
    const followed = followedMbidSet(bands);
    const unresolved = new Set(next.groups.flatMap((group) => group.candidates.map((candidate) => normalizeMbid(candidate.artistMbid))).filter(Boolean));
    const decided = new Set(Object.keys(next.decisions || {}).map(normalizeMbid).filter(Boolean));
    const existingSeed = new Map(next.groups.map((group) => [normalizeMbid(group.seedMbid), group]));
    const bestNew = new Map();
    for (let seedIndex = 0; seedIndex < (seedResults || []).length; seedIndex += 1) {
      const result = seedResults[seedIndex] || {};
      const seedMbid = normalizeMbid(result.seedMbid);
      if (!seedMbid) continue;
      for (let candidateIndex = 0; candidateIndex < (result.candidates || []).length; candidateIndex += 1) {
        const candidate = candidateFrom(result.candidates[candidateIndex], now);
        if (!candidate || candidate.artistMbid === seedMbid || followed.has(candidate.artistMbid) || decided.has(candidate.artistMbid) || unresolved.has(candidate.artistMbid)) continue;
        const prior = bestNew.get(candidate.artistMbid);
        const relation = { seedMbid, seedBandId: result.seedBandId == null ? null : String(result.seedBandId), seedName: cleanText(result.seedName), candidate, seedIndex, candidateIndex };
        if (!prior || candidate.similarityScore > prior.candidate.similarityScore || (candidate.similarityScore === prior.candidate.similarityScore && (seedIndex < prior.seedIndex || (seedIndex === prior.seedIndex && candidateIndex < prior.candidateIndex)))) bestNew.set(candidate.artistMbid, relation);
      }
    }
    const groupedAdmissions = new Map();
    for (const relation of [...bestNew.values()].sort((a, b) => a.seedIndex - b.seedIndex || a.candidateIndex - b.candidateIndex || a.candidate.artistMbid.localeCompare(b.candidate.artistMbid))) {
      if (!groupedAdmissions.has(relation.seedMbid)) groupedAdmissions.set(relation.seedMbid, []);
      groupedAdmissions.get(relation.seedMbid).push(relation);
    }
    for (const result of seedResults || []) {
      const seedMbid = normalizeMbid(result?.seedMbid);
      const admissions = groupedAdmissions.get(seedMbid) || [];
      if (!seedMbid || !admissions.length) continue;
      let group = existingSeed.get(seedMbid);
      if (!group) {
        if (next.groups.length >= MAX_GROUPS) continue;
        group = { seedBandId: result.seedBandId == null ? null : String(result.seedBandId), seedMbid, seedName: cleanText(result.seedName), createdAt: now, candidates: [] };
        next.groups.push(group);
        existingSeed.set(seedMbid, group);
      }
      for (const relation of admissions) {
        if (group.candidates.length >= MAX_UNRESOLVED_PER_GROUP) break;
        if (unresolved.has(relation.candidate.artistMbid) || decided.has(relation.candidate.artistMbid) || followed.has(relation.candidate.artistMbid)) continue;
        group.candidates.push(relation.candidate);
        unresolved.add(relation.candidate.artistMbid);
      }
    }
    next.groups = next.groups.filter((group) => group.candidates.length > 0).slice(0, MAX_GROUPS);
    next.updatedAt = now;
    next.lastSuccessfulRefreshAt = now;
    return next;
  }
  function resolveCandidate(state, artistMbid, status, { now = new Date().toISOString(), addedBandId = null } = {}) {
    const mbid = normalizeMbid(artistMbid);
    if (!mbid || !['dismissed', 'added'].includes(status)) throw new Error('Invalid Discover decision');
    const next = clone(validateState(state) ? state : emptyState(null));
    next.decisions = next.decisions || {};
    next.decisions[mbid] = { ...(next.decisions[mbid] || {}), status, decidedAt: now, addedBandId: status === 'added' ? (addedBandId || next.decisions[mbid]?.addedBandId || null) : null };
    next.groups = next.groups.map((group) => ({ ...group, candidates: group.candidates.filter((candidate) => normalizeMbid(candidate.artistMbid) !== mbid) })).filter((group) => group.candidates.length > 0);
    next.updatedAt = now;
    return next;
  }
  function spotifySearchUrl(name) { return `https://open.spotify.com/search/${encodeURIComponent(cleanText(name))}`; }
  function isStale(state, now = Date.now()) {
    const prior = Date.parse(state?.lastSuccessfulRefreshAt || '');
    return !Number.isFinite(prior) || Number(now) - prior >= FRESHNESS_MS;
  }

  return Object.freeze({ KIND, SCHEMA_VERSION, MAX_VISIBLE_PER_GROUP, MAX_UNRESOLVED_PER_GROUP, MAX_GROUPS, MAX_SEEDS, FRESHNESS_MS, normalizeMbid, normalizeTags, emptyState, validateState, trustedBandMbid, candidateFrom, visibleGroups, selectSeeds, admitRefresh, resolveCandidate, spotifySearchUrl, isStale });
});
