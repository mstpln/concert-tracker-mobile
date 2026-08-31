'use strict';

const crypto = require('node:crypto');
const CanonicalIdentity = require('../../canonicalIdentityV174');

const USER_FIELDS = new Set(CanonicalIdentity.USER_OWNED_FIELDS || []);
const SAFE_MERGE_ARRAY_FIELDS = new Set([
  'legacyVenueIds', 'legacyConcertIds', 'identityAliases', 'historicalNames', 'locationHistory',
  'providerIdentities', 'subLocations', 'providerObservations', 'providerOffers', 'alternateProviderOffers',
  'sources', 'sourceHistory', 'lifecycleHistory', 'dateHistory', 'mergeHistory',
]);
const PROVIDER_PRESENTATION_FIELDS = new Set([
  'provider', 'providerSource', 'providerNamespace', 'providerEventId', 'providerVenueId', 'providerAttractionId',
  'providerOfferType', 'ticketUrl', 'sourceUrl', 'time', 'title', 'status', 'lifecycleStatus',
]);
const IDENTITY_FIELDS = new Set(['id', 'venueId', 'canonicalVenueId', 'legacyVenueIds', 'legacyConcertIds']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  const input = typeof value === 'string' ? value : stable(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function meaningful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function uniqueStable(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const key = stable(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clone(value));
  }
  return output;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function idValue(record, type) {
  return String(type === 'venue' ? record?.venueId : record?.id || '').trim();
}

function userRichScore(record) {
  let score = 0;
  if (record?.manuallyAdded === true) score += 100;
  if (record?.attending === true || record?.attended === true) score += 80;
  if (record?.lineupRole === 'support') score += 10;
  for (const field of USER_FIELDS) if (meaningful(record?.[field])) score += 3;
  return score;
}

function chooseCanonical(records, type, preferredId) {
  const preferred = String(preferredId || '').trim();
  if (preferred) {
    const match = records.find((record) => idValue(record, type) === preferred);
    if (match) return match;
  }
  return [...records].sort((a, b) => {
    if (type === 'concert') {
      const rich = userRichScore(b) - userRichScore(a);
      if (rich) return rich;
    }
    return idValue(a, type).localeCompare(idValue(b, type));
  })[0];
}

function mergeArrayField(records, field) {
  return uniqueStable(records.flatMap((record) => asArray(record?.[field])));
}

function unknownConflicts(records, type) {
  const keys = new Set(records.flatMap((record) => Object.keys(record || {})));
  const conflicts = [];
  for (const key of keys) {
    if (USER_FIELDS.has(key) || SAFE_MERGE_ARRAY_FIELDS.has(key) || PROVIDER_PRESENTATION_FIELDS.has(key) || IDENTITY_FIELDS.has(key)) continue;
    if (type === 'concert' && ['bandId', 'bandName', 'date', 'venue', 'city', 'country', 'venueAddress', 'roomOrStage'].includes(key)) continue;
    if (type === 'venue' && ['name', 'currentName', 'city', 'country', 'address', 'currentLocation'].includes(key)) continue;
    const values = records.map((record) => record?.[key]).filter(meaningful);
    const unique = [...new Set(values.map(stable))];
    if (unique.length > 1) conflicts.push(key);
  }
  return conflicts;
}

function copyMissingFields(target, records) {
  for (const record of records) {
    for (const [key, value] of Object.entries(record || {})) {
      if (!meaningful(target[key]) && meaningful(value)) target[key] = clone(value);
    }
  }
  return target;
}

function mergeVenueRecords(records, preferredId) {
  const winner = chooseCanonical(records, 'venue', preferredId);
  if (!winner) return { blocked: true, reason: 'venue_group_empty' };
  const conflictingUnknownFields = unknownConflicts(records, 'venue');
  if (conflictingUnknownFields.length) return { blocked: true, reason: 'unknown_field_conflict', fields: conflictingUnknownFields };
  const merged = copyMissingFields(clone(winner), records);
  const winnerId = String(winner.venueId || '').trim();
  const mergedAway = records.map((record) => String(record.venueId || '').trim()).filter((id) => id && id !== winnerId);
  merged.legacyVenueIds = uniqueStable([
    ...asArray(winner.legacyVenueIds),
    ...records.flatMap((record) => asArray(record.legacyVenueIds)),
    ...mergedAway,
  ]).map(String);
  for (const field of SAFE_MERGE_ARRAY_FIELDS) {
    if (field === 'legacyConcertIds') continue;
    const value = mergeArrayField(records, field);
    if (value.length) merged[field] = value;
  }
  merged.venueId = winnerId;
  return { blocked: false, record: merged, winnerId, mergedAway };
}

function providerStrength(record) {
  const provider = String(record?.providerNamespace || record?.providerSource || record?.provider || '').toLowerCase();
  const offer = String(record?.providerOfferType || '').toLowerCase();
  const verified = record?.providerVerified === true || record?.verified === true || String(record?.providerConfidence || '').toLowerCase() === 'verified';
  if (provider.includes('ticketmaster') && verified && (!offer || offer === 'standard')) return 4;
  if (provider.includes('ticketmaster') && verified) return 3;
  if (verified) return 2;
  return 1;
}

function mergeConcertRecords(records, preferredId) {
  const userConflicts = CanonicalIdentity.userOwnedConflicts(records);
  if (userConflicts.length) return { blocked: true, reason: 'user_owned_conflict', fields: userConflicts };
  const conflictingUnknownFields = unknownConflicts(records, 'concert');
  if (conflictingUnknownFields.length) return { blocked: true, reason: 'unknown_field_conflict', fields: conflictingUnknownFields };
  const winner = chooseCanonical(records, 'concert', preferredId);
  if (!winner) return { blocked: true, reason: 'concert_group_empty' };
  const merged = copyMissingFields(clone(winner), records);
  const winnerId = String(winner.id || '').trim();
  const mergedAway = records.map((record) => String(record.id || '').trim()).filter((id) => id && id !== winnerId);
  merged.legacyConcertIds = uniqueStable([
    ...asArray(winner.legacyConcertIds),
    ...records.flatMap((record) => asArray(record.legacyConcertIds)),
    ...mergedAway,
  ]).map(String);
  for (const field of SAFE_MERGE_ARRAY_FIELDS) {
    if (field === 'legacyVenueIds') continue;
    const value = mergeArrayField(records, field);
    if (value.length) merged[field] = value;
  }
  const providerWinner = [...records].sort((a, b) => providerStrength(b) - providerStrength(a))[0];
  if (providerWinner) {
    for (const field of PROVIDER_PRESENTATION_FIELDS) {
      if (meaningful(providerWinner[field])) merged[field] = clone(providerWinner[field]);
    }
  }
  for (const field of USER_FIELDS) {
    const value = records.map((record) => record?.[field]).find(meaningful);
    if (meaningful(value)) merged[field] = clone(value);
  }
  merged.id = winnerId;
  return { blocked: false, record: merged, winnerId, mergedAway };
}

function normalizeDecisions(decisions) {
  const source = decisions && typeof decisions === 'object' ? decisions : {};
  return {
    venueMerges: asArray(source.venueMerges),
    venueDistinct: asArray(source.venueDistinct),
    concertMerges: asArray(source.concertMerges),
    concertDistinct: asArray(source.concertDistinct),
    festivalEditions: asArray(source.festivalEditions),
  };
}

function applyVenueDecisions(venues, decisions) {
  let output = clone(venues || []);
  const mapping = {};
  const manifest = [];
  const blocked = [];
  for (const decision of normalizeDecisions(decisions).venueMerges) {
    const ids = uniqueStable(asArray(decision?.ids).map(String).filter(Boolean));
    if (ids.length < 2) continue;
    const members = output.filter((record) => ids.includes(String(record?.venueId || '')));
    if (members.length !== ids.length) {
      blocked.push({ kind: 'venue', reason: 'decision_member_missing', ids });
      continue;
    }
    const result = mergeVenueRecords(members, decision?.canonicalId);
    if (result.blocked) {
      blocked.push({ kind: 'venue', ids, ...result });
      continue;
    }
    output = output.filter((record) => !ids.includes(String(record?.venueId || '')));
    output.push(result.record);
    for (const id of ids) mapping[id] = result.winnerId;
    manifest.push({ kind: 'venue_merge', winnerId: result.winnerId, mergedAway: result.mergedAway, reason: decision?.reason || 'research_decision', evidence: clone(decision?.evidence || []) });
  }
  output.sort((a, b) => String(a?.venueId || '').localeCompare(String(b?.venueId || '')));
  return { records: output, mapping, manifest, blocked };
}

function mapConcertVenues(concerts, venueMapping, venues) {
  const venueIndex = CanonicalIdentity.buildVenueIndex(venues || []);
  return (concerts || []).map((record) => {
    const next = clone(record);
    const explicit = String(next.canonicalVenueId || next.venueId || '').trim();
    if (explicit && venueMapping[explicit]) next.canonicalVenueId = venueMapping[explicit];
    const resolved = CanonicalIdentity.resolveCanonicalVenue(next, venueIndex);
    if (resolved.kind === 'same' && resolved.canonicalVenueId) next.canonicalVenueId = resolved.canonicalVenueId;
    if (resolved.roomOrStage && !next.roomOrStage) next.roomOrStage = clone(resolved.roomOrStage);
    return next;
  });
}

function explicitDistinctPairSet(decisions) {
  const set = new Set();
  for (const decision of normalizeDecisions(decisions).concertDistinct) {
    const ids = asArray(decision?.ids).map(String).filter(Boolean).sort();
    if (ids.length === 2) set.add(ids.join('\u001f'));
  }
  return set;
}

function applyFestivalDecisions(concerts, decisions) {
  const output = clone(concerts || []);
  const byId = new Map(output.map((record) => [String(record?.id || ''), record]));
  for (const decision of normalizeDecisions(decisions).festivalEditions) {
    const ids = uniqueStable(asArray(decision?.concertIds).map(String).filter(Boolean));
    if (!ids.length) continue;
    const festivalId = String(decision?.id || '').trim();
    const year = String(decision?.year || '').trim();
    if (!festivalId || !/^\d{4}$/.test(year)) continue;
    for (const id of ids) {
      const record = byId.get(id);
      if (!record) continue;
      record.festivalEditionId = festivalId;
      record.festivalEdition = {
        ...(record.festivalEdition && typeof record.festivalEdition === 'object' ? record.festivalEdition : {}),
        id: festivalId,
        name: decision?.name || record?.festivalName || null,
        year,
        status: 'confirmed',
        primaryCanonicalVenueId: decision?.primaryCanonicalVenueId || null,
      };
    }
  }
  return output;
}

function reconcileConcerts(concerts, venues, decisions) {
  const venueIndex = CanonicalIdentity.buildVenueIndex(venues || []);
  const groups = new Map();
  const unresolved = [];
  const distinctPairs = explicitDistinctPairSet(decisions);
  for (const record of concerts || []) {
    const identity = CanonicalIdentity.canonicalConcertIdentity(record, venueIndex);
    if (identity.kind !== 'same') {
      unresolved.push({ record: clone(record), reason: identity.reason });
      continue;
    }
    if (!groups.has(identity.key)) groups.set(identity.key, []);
    groups.get(identity.key).push(record);
  }
  const preferred = new Map();
  for (const decision of normalizeDecisions(decisions).concertMerges) {
    for (const id of asArray(decision?.ids)) preferred.set(String(id), String(decision?.canonicalId || ''));
  }
  const output = [];
  const mapping = {};
  const manifest = [];
  const blocked = [];
  for (const [key, members] of groups) {
    if (members.length === 1) {
      output.push(clone(members[0]));
      mapping[String(members[0]?.id || '')] = String(members[0]?.id || '');
      continue;
    }
    const memberIds = members.map((record) => String(record?.id || '')).filter(Boolean);
    const hasDistinct = memberIds.some((left, index) => memberIds.slice(index + 1).some((right) => distinctPairs.has([left, right].sort().join('\u001f'))));
    if (hasDistinct) {
      output.push(...members.map(clone));
      blocked.push({ kind: 'concert', reason: 'explicit_distinct_conflicts_with_canonical_identity', key, ids: memberIds });
      continue;
    }
    const preferredId = memberIds.map((id) => preferred.get(id)).find(Boolean);
    const result = mergeConcertRecords(members, preferredId);
    if (result.blocked) {
      output.push(...members.map(clone));
      blocked.push({ kind: 'concert', key, ids: memberIds, ...result });
      continue;
    }
    output.push(result.record);
    for (const id of memberIds) mapping[id] = result.winnerId;
    manifest.push({ kind: 'concert_merge', key, winnerId: result.winnerId, mergedAway: result.mergedAway, reason: 'canonical_band_venue_date' });
  }
  output.push(...unresolved.map((item) => item.record));
  output.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  return { records: output, mapping, manifest, blocked, unresolved: unresolved.map((item) => ({ id: item.record?.id || null, reason: item.reason })) };
}

function protectedSnapshot(concerts) {
  const rows = [];
  for (const record of concerts || []) {
    const protectedValues = {};
    for (const field of USER_FIELDS) if (record?.[field] !== undefined) protectedValues[field] = clone(record[field]);
    if (record?.attending === true || record?.attended === true || Object.keys(protectedValues).some((field) => meaningful(protectedValues[field]))) {
      rows.push({ id: record?.id || null, date: record?.date || null, fields: protectedValues });
    }
  }
  return { count: rows.length, sha256: sha256(rows), rows };
}

function metricSnapshot(venues, concerts) {
  const events = CanonicalIdentity.EventModelV174.groupConcertPerformances(concerts || []);
  const ticketTotal = (concerts || []).reduce((sum, record) => {
    const value = Number(record?.ticketPrice);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    venueCount: (venues || []).length,
    concertCount: (concerts || []).length,
    eventCount: events.length,
    festivalEventCount: events.filter((event) => event.relationship === 'festival').length,
    attendedCount: (concerts || []).filter((record) => record?.attending === true || record?.attended === true).length,
    ticketTotal,
  };
}

function audit(venues, concerts, decisions = {}) {
  const venueIndex = CanonicalIdentity.buildVenueIndex(venues || []);
  const concertGroups = new Map();
  const unresolvedConcerts = [];
  for (const record of concerts || []) {
    const identity = CanonicalIdentity.canonicalConcertIdentity(record, venueIndex);
    if (identity.kind !== 'same') {
      unresolvedConcerts.push({ id: record?.id || null, reason: identity.reason });
      continue;
    }
    if (!concertGroups.has(identity.key)) concertGroups.set(identity.key, []);
    concertGroups.get(identity.key).push(record);
  }
  const concertCandidates = [...concertGroups.entries()].filter(([, records]) => records.length > 1).map(([key, records]) => ({
    key,
    reason: 'canonical_band_venue_date',
    ids: records.map((record) => record?.id || null),
    userConflicts: CanonicalIdentity.userOwnedConflicts(records),
  }));
  const variantOwners = new Map();
  for (const venue of venues || []) {
    for (const variant of CanonicalIdentity.VenueModelV174.identityVariants(venue)) {
      const name = String(variant?.name || '').trim().toLowerCase();
      const provider = String(variant?.provider || '').trim().toLowerCase();
      const providerVenueId = String(variant?.providerVenueId || '').trim();
      const key = provider && providerVenueId ? `provider:${provider}:${providerVenueId}` : name ? `name:${name}` : '';
      if (!key) continue;
      if (!variantOwners.has(key)) variantOwners.set(key, new Set());
      variantOwners.get(key).add(String(venue?.venueId || ''));
    }
  }
  const venueCandidates = [...variantOwners.entries()].filter(([, ids]) => ids.size > 1).map(([key, ids]) => ({
    key,
    reason: key.startsWith('provider:') ? 'shared_provider_identity' : 'shared_identity_name_requires_research',
    ids: [...ids].sort(),
  }));
  const eventGroups = CanonicalIdentity.EventModelV174.groupConcertPerformances(concerts || []);
  return {
    schemaVersion: 1,
    sourceHashes: { venues: sha256(venues || []), concerts: sha256(concerts || []), decisions: sha256(normalizeDecisions(decisions)) },
    counts: { venues: (venues || []).length, concerts: (concerts || []).length, events: eventGroups.length },
    venueCandidates,
    concertCandidates,
    unresolvedConcerts,
    invalidEvents: eventGroups.filter((event) => !event.validation?.valid).map((event) => ({ key: event.key, relationship: event.relationship, reasons: event.validation?.reasons || [], ids: event.records.map((record) => record?.id || null) })),
    protected: protectedSnapshot(concerts || []),
    metrics: metricSnapshot(venues || [], concerts || []),
  };
}

function planMigration(venues, concerts, decisions = {}) {
  const before = audit(venues, concerts, decisions);
  const venueStep = applyVenueDecisions(venues || [], decisions);
  let mappedConcerts = mapConcertVenues(concerts || [], venueStep.mapping, venueStep.records);
  mappedConcerts = applyFestivalDecisions(mappedConcerts, decisions);
  const concertStep = reconcileConcerts(mappedConcerts, venueStep.records, decisions);
  const after = audit(venueStep.records, concertStep.records, decisions);
  return {
    schemaVersion: 1,
    sourceHashes: before.sourceHashes,
    outputHashes: { venues: sha256(venueStep.records), concerts: sha256(concertStep.records) },
    venues: venueStep.records,
    concerts: concertStep.records,
    legacyVenueMap: venueStep.mapping,
    legacyConcertMap: concertStep.mapping,
    mergeManifest: [...venueStep.manifest, ...concertStep.manifest],
    blocked: [...venueStep.blocked, ...concertStep.blocked],
    unresolved: concertStep.unresolved,
    before: { counts: before.counts, metrics: before.metrics, protected: before.protected },
    after: { counts: after.counts, metrics: after.metrics, protected: after.protected },
  };
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan_missing'] };
  if (plan.before?.protected?.sha256 !== plan.after?.protected?.sha256) errors.push('protected_fields_changed');
  const attendedBefore = plan.before?.metrics?.attendedCount;
  const attendedAfter = plan.after?.metrics?.attendedCount;
  if (attendedBefore !== attendedAfter) errors.push('attended_count_changed');
  for (const item of plan.blocked || []) errors.push(`blocked:${item.kind}:${item.reason}`);
  return { valid: errors.length === 0, errors };
}

module.exports = Object.freeze({
  sha256,
  audit,
  planMigration,
  validatePlan,
  mergeVenueRecords,
  mergeConcertRecords,
  protectedSnapshot,
  metricSnapshot,
  normalizeDecisions,
});
