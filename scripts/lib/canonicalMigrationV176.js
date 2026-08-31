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
  'provider', 'providerSource', 'providerNamespace', 'sourceProvider', 'providerEventId', 'providerVenueId',
  'providerAttractionId', 'providerOfferType', 'ticketUrl', 'articleUrl', 'sourceUrl', 'time', 'distanceKm',
  'title', 'providerEventName', 'providerEventStatus', 'status', 'lifecycleStatus', 'artistMatchMethod',
  'ticketRetailerVerified', 'providerVerified', 'verified', 'providerConfidence', 'foundAt', 'isNew',
]);
const IDENTITY_FIELDS = new Set(['id', 'venueId', 'canonicalVenueId', 'legacyVenueIds', 'legacyConcertIds']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hasOwn(record, key) {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
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

function sha256Bytes(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
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

function present(record, field) {
  if (!hasOwn(record, field)) return false;
  const value = record[field];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function text(value) {
  return String(value || '').trim();
}

function normalizedText(value) {
  return text(value).toLocaleLowerCase().replace(/\s+/g, ' ');
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

function legacyAliasState(records, idField, legacyField) {
  const owners = new Map();
  const add = (alias, owner) => {
    const key = text(alias);
    const ownerId = text(owner);
    if (!key || !ownerId) return;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(ownerId);
  };
  for (const record of records || []) {
    const owner = text(record?.[idField]);
    if (!owner) continue;
    add(owner, owner);
    for (const alias of asArray(record?.[legacyField])) add(alias, owner);
  }
  const mapping = {};
  const collisions = [];
  for (const [alias, ownerSet] of owners) {
    const ownerIds = [...ownerSet].sort();
    if (ownerIds.length === 1) mapping[alias] = ownerIds[0];
    else collisions.push({ alias, ownerIds });
  }
  return { mapping, collisions };
}

function unknownConflicts(records, type) {
  const keys = new Set(records.flatMap((record) => Object.keys(record || {})));
  const conflicts = [];
  for (const key of keys) {
    if (USER_FIELDS.has(key) || SAFE_MERGE_ARRAY_FIELDS.has(key) || PROVIDER_PRESENTATION_FIELDS.has(key) || IDENTITY_FIELDS.has(key)) continue;
    if (type === 'concert' && ['bandId', 'bandName', 'date', 'venue', 'city', 'country', 'venueAddress', 'roomOrStage'].includes(key)) continue;
    if (type === 'venue' && ['name', 'currentName', 'city', 'country', 'address', 'currentLocation'].includes(key)) continue;
    const values = records.filter((record) => present(record, key)).map((record) => record[key]);
    const unique = [...new Set(values.map(stable))];
    if (unique.length > 1) conflicts.push(key);
  }
  return conflicts;
}

function copyMissingFields(target, records) {
  for (const record of records) {
    for (const [key, value] of Object.entries(record || {})) {
      if (!hasOwn(target, key) && value !== undefined) target[key] = clone(value);
    }
  }
  return target;
}

function venueLocation(record) {
  const explicit = record?.currentLocation && typeof record.currentLocation === 'object' && !Array.isArray(record.currentLocation)
    ? record.currentLocation : {};
  return {
    city: text(explicit.city ?? record?.city),
    country: text(explicit.country ?? record?.country),
    address: clone(explicit.address ?? explicit.venueAddress ?? record?.address ?? null),
  };
}

function venueLocationKey(record) {
  const location = venueLocation(record);
  return stable({
    city: normalizedText(location.city),
    country: normalizedText(location.country),
    address: typeof location.address === 'string' ? normalizedText(location.address) : location.address,
  });
}

function preserveMergedVenueHistory(merged, records, winner) {
  const winnerId = text(winner?.venueId);
  const winnerName = normalizedText(winner?.currentName || winner?.name);
  const winnerLocation = venueLocationKey(winner);
  const historicalNames = mergeArrayField(records, 'historicalNames');
  const locationHistory = mergeArrayField(records, 'locationHistory');
  for (const record of records) {
    if (record === winner || text(record?.venueId) === winnerId) continue;
    const location = venueLocation(record);
    const names = [record?.currentName, record?.name].map(text).filter(Boolean);
    for (const name of names) {
      if (normalizedText(name) === winnerName) continue;
      historicalNames.push({
        name,
        city: location.city,
        country: location.country,
        address: clone(location.address),
        legacyVenueId: text(record?.venueId) || null,
      });
    }
    if (venueLocationKey(record) !== winnerLocation && (location.city || location.country || meaningful(location.address))) {
      locationHistory.push({
        name: text(record?.currentName || record?.name) || null,
        city: location.city,
        country: location.country,
        address: clone(location.address),
        legacyVenueId: text(record?.venueId) || null,
      });
    }
  }
  const mergedNames = uniqueStable(historicalNames);
  const mergedLocations = uniqueStable(locationHistory);
  if (mergedNames.length) merged.historicalNames = mergedNames;
  if (mergedLocations.length) merged.locationHistory = mergedLocations;
  return merged;
}

function mergeVenueRecords(records, preferredId) {
  const winner = chooseCanonical(records, 'venue', preferredId);
  if (!winner) return { blocked: true, reason: 'venue_group_empty' };
  const conflictingUnknownFields = unknownConflicts(records, 'venue');
  if (conflictingUnknownFields.length) return { blocked: true, reason: 'unknown_field_conflict', fields: conflictingUnknownFields };
  const merged = copyMissingFields(clone(winner), records);
  const winnerId = String(winner.venueId || '').trim();
  if (!winnerId) return { blocked: true, reason: 'canonical_venue_id_missing' };
  const mergedAway = records.map((record) => String(record.venueId || '').trim()).filter((id) => id && id !== winnerId);
  merged.legacyVenueIds = uniqueStable([
    ...asArray(winner.legacyVenueIds),
    ...records.flatMap((record) => asArray(record.legacyVenueIds)),
    ...mergedAway,
  ]).map(String);
  for (const field of SAFE_MERGE_ARRAY_FIELDS) {
    if (field === 'legacyConcertIds' || field === 'legacyVenueIds' || field === 'historicalNames' || field === 'locationHistory') continue;
    const value = mergeArrayField(records, field);
    if (value.length) merged[field] = value;
  }
  preserveMergedVenueHistory(merged, records, winner);
  merged.venueId = winnerId;
  return { blocked: false, record: merged, winnerId, mergedAway };
}

function providerNamespace(record) {
  return normalizedText(record?.providerNamespace || record?.sourceProvider || record?.providerSource || record?.provider || record?.namespace);
}

function providerEventId(record) {
  return text(record?.providerEventId || record?.eventId || record?.listingId);
}

function providerStrength(record) {
  const provider = providerNamespace(record);
  const offer = normalizedText(record?.providerOfferType);
  const verified = record?.ticketRetailerVerified === true
    || record?.providerVerified === true
    || record?.verified === true
    || normalizedText(record?.providerConfidence) === 'verified';
  if (provider === 'ticketmaster' && verified && (!offer || offer === 'standard')) return 4;
  if (provider === 'ticketmaster' && verified) return 3;
  if (verified) return 2;
  return 1;
}

function providerObservationKey(record) {
  const provider = providerNamespace(record);
  const eventId = providerEventId(record);
  return provider && eventId ? `${provider}\u001f${eventId}` : '';
}

function providerObservationFromRecord(record) {
  const provider = providerNamespace(record);
  const eventId = providerEventId(record);
  const providerVenueId = text(record?.providerVenueId);
  const providerAttractionId = text(record?.providerAttractionId);
  if (!provider || ['manual', 'unknown'].includes(provider)) return null;
  if (!eventId && !providerVenueId && !providerAttractionId) return null;
  return {
    provider,
    providerEventId: eventId || null,
    providerVenueId: providerVenueId || null,
    providerAttractionId: providerAttractionId || null,
    eventName: text(record?.providerEventName || record?.title) || null,
    venue: text(record?.venue) || null,
    city: text(record?.city) || null,
    country: text(record?.country) || null,
    address: clone(record?.venueAddress ?? null),
    roomOrStage: clone(record?.roomOrStage ?? null),
    date: text(record?.date) || null,
    time: text(record?.time) || null,
    ticketUrl: text(record?.ticketUrl) || null,
    articleUrl: text(record?.articleUrl || record?.sourceUrl) || null,
    offerType: text(record?.providerOfferType) || null,
    status: text(record?.providerEventStatus || record?.lifecycleStatus || record?.status) || null,
    source: text(record?.providerSource || record?.sourceProvider || record?.sourceUrl || record?.articleUrl) || null,
  };
}

function mergeProviderEvidence(records) {
  const output = mergeArrayField(records, 'providerObservations');
  const keys = new Set(output.map(providerObservationKey).filter(Boolean));
  for (const record of records) {
    const observation = providerObservationFromRecord(record);
    if (!observation) continue;
    const key = providerObservationKey(observation);
    if (key && keys.has(key)) continue;
    output.push(observation);
    if (key) keys.add(key);
  }
  return uniqueStable(output);
}

function preferredUserValue(records, field) {
  const meaningfulValues = records.filter((record) => meaningful(record?.[field])).map((record) => record[field]);
  if (field === 'lineupRole' && meaningfulValues.some((value) => String(value) === 'support')) return 'support';
  if (meaningfulValues.length) return clone(meaningfulValues[0]);
  const explicit = records.find((record) => present(record, field));
  return explicit ? clone(explicit[field]) : undefined;
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
  if (!winnerId) return { blocked: true, reason: 'canonical_concert_id_missing' };
  const mergedAway = records.map((record) => String(record.id || '').trim()).filter((id) => id && id !== winnerId);
  merged.legacyConcertIds = uniqueStable([
    ...asArray(winner.legacyConcertIds),
    ...records.flatMap((record) => asArray(record.legacyConcertIds)),
    ...mergedAway,
  ]).map(String);
  for (const field of SAFE_MERGE_ARRAY_FIELDS) {
    if (field === 'legacyVenueIds' || field === 'legacyConcertIds' || field === 'providerObservations') continue;
    const value = mergeArrayField(records, field);
    if (value.length) merged[field] = value;
  }
  const providerEvidence = mergeProviderEvidence(records);
  if (providerEvidence.length) merged.providerObservations = providerEvidence;
  const providerWinner = [...records].sort((a, b) => {
    const strength = providerStrength(b) - providerStrength(a);
    if (strength) return strength;
    if (a === winner) return -1;
    if (b === winner) return 1;
    return text(a?.id).localeCompare(text(b?.id));
  })[0];
  if (providerWinner) {
    for (const field of PROVIDER_PRESENTATION_FIELDS) {
      if (present(providerWinner, field)) merged[field] = clone(providerWinner[field]);
    }
  }
  for (const field of USER_FIELDS) {
    const value = preferredUserValue(records, field);
    if (value !== undefined) merged[field] = value;
  }
  merged.id = winnerId;
  return { blocked: false, record: merged, winnerId, mergedAway };
}

function normalizeDecisions(decisions) {
  const source = decisions && typeof decisions === 'object' ? decisions : {};
  return {
    venueMerges: asArray(source.venueMerges),
    venueDistinct: asArray(source.venueDistinct),
    venueAdditions: asArray(source.venueAdditions),
    venueCorrections: asArray(source.venueCorrections),
    concertMerges: asArray(source.concertMerges),
    concertDistinct: asArray(source.concertDistinct),
    concertVenueAssignments: asArray(source.concertVenueAssignments),
    festivalEditions: asArray(source.festivalEditions),
  };
}

function applyVenueAdditions(venues, decisions) {
  const source = clone(venues || []);
  const byId = new Map(source.map((record) => [text(record?.venueId), record]).filter(([id]) => id));
  const aliases = legacyAliasState(source, 'venueId', 'legacyVenueIds');
  const ambiguousAliases = new Set(aliases.collisions.map((item) => item.alias));
  const additions = normalizeDecisions(decisions).venueAdditions;
  const requestedById = new Map();
  const conflictingIds = new Set();
  const blocked = [];
  const manifest = [];
  for (const decision of additions) {
    const record = decision?.venue && typeof decision.venue === 'object' && !Array.isArray(decision.venue) ? decision.venue : null;
    const venueId = text(record?.venueId);
    if (!venueId) continue;
    if (requestedById.has(venueId) && stable(requestedById.get(venueId)) !== stable(record)) conflictingIds.add(venueId);
    else requestedById.set(venueId, record);
  }
  for (const venueId of conflictingIds) blocked.push({ kind: 'venue', reason: 'conflicting_venue_additions', venueId });
  const applied = new Set();
  for (const decision of additions) {
    const record = decision?.venue && typeof decision.venue === 'object' && !Array.isArray(decision.venue) ? clone(decision.venue) : null;
    const venueId = text(record?.venueId);
    const evidence = asArray(decision?.evidence).filter(meaningful);
    if (conflictingIds.has(venueId) || applied.has(venueId)) continue;
    if (!record || !CanonicalIdentity.VenueModelV174?.recordIsValid?.(record) || !text(decision?.reason) || !evidence.length) {
      blocked.push({ kind: 'venue', reason: 'venue_addition_invalid', venueId: venueId || null });
      continue;
    }
    if (ambiguousAliases.has(venueId) || (!byId.has(venueId) && aliases.mapping[venueId])) {
      blocked.push({ kind: 'venue', reason: 'venue_addition_id_collides_with_legacy', venueId });
      continue;
    }
    const existing = byId.get(venueId);
    if (existing) {
      const conflicts = Object.keys(record).filter((field) => stable(existing[field]) !== stable(record[field]));
      if (conflicts.length) blocked.push({ kind: 'venue', reason: 'venue_addition_conflicts_with_existing', venueId, fields: conflicts });
      applied.add(venueId);
      continue;
    }
    source.push(record);
    byId.set(venueId, record);
    applied.add(venueId);
    manifest.push({
      kind: 'venue_addition',
      venueId,
      reason: decision.reason,
      evidence: clone(evidence),
    });
  }
  return { records: source, manifest, blocked };
}

function applyVenueCorrections(venues, decisions) {
  const source = clone(venues || []);
  const byId = new Map(source.map((record) => [text(record?.venueId), record]).filter(([id]) => id));
  const aliases = legacyAliasState(source, 'venueId', 'legacyVenueIds');
  const ambiguous = new Set(aliases.collisions.map((item) => item.alias));
  const forbidden = new Set(['venueId', 'legacyVenueIds', '__proto__', 'prototype', 'constructor', ...USER_FIELDS]);
  const blocked = [];
  const manifest = [];
  const corrections = normalizeDecisions(decisions).venueCorrections;
  const requestedValues = new Map();
  const conflictingIds = new Set();
  for (const decision of corrections) {
    const requestedId = text(decision?.venueId);
    const set = decision?.set && typeof decision.set === 'object' && !Array.isArray(decision.set) ? decision.set : {};
    const clear = asArray(decision?.clear).map(text).filter(Boolean);
    for (const field of uniqueStable([...Object.keys(set), ...clear])) {
      const key = `${requestedId}\u001f${field}`;
      const requestedValue = hasOwn(set, field) ? stable({ set: set[field] }) : stable({ clear: true });
      if (requestedValues.has(key) && requestedValues.get(key) !== requestedValue) conflictingIds.add(requestedId);
      else requestedValues.set(key, requestedValue);
    }
  }
  for (const venueId of conflictingIds) blocked.push({ kind: 'venue', reason: 'conflicting_venue_corrections', venueId });
  for (const decision of corrections) {
    const requestedId = text(decision?.venueId);
    const set = decision?.set && typeof decision.set === 'object' && !Array.isArray(decision.set) ? decision.set : {};
    const clear = uniqueStable(asArray(decision?.clear).map(text).filter(Boolean));
    const fields = uniqueStable([...Object.keys(set), ...clear]);
    if (conflictingIds.has(requestedId)) continue;
    if (!requestedId || !fields.length) {
      blocked.push({ kind: 'venue', reason: 'venue_correction_invalid', venueId: requestedId || null });
      continue;
    }
    const forbiddenFields = fields.filter((field) => forbidden.has(field));
    if (forbiddenFields.length || clear.some((field) => hasOwn(set, field))) {
      blocked.push({ kind: 'venue', reason: 'venue_correction_fields_invalid', venueId: requestedId, fields: forbiddenFields.length ? forbiddenFields : clear.filter((field) => hasOwn(set, field)) });
      continue;
    }
    if (ambiguous.has(requestedId)) {
      blocked.push({ kind: 'venue', reason: 'venue_correction_member_ambiguous', venueId: requestedId });
      continue;
    }
    const record = byId.get(requestedId);
    if (!record) {
      // A correction for a merged-away exact ID has already been consumed on a
      // second pass. Its legacy alias remains proof that the decision member existed.
      if (aliases.mapping[requestedId]) continue;
      blocked.push({ kind: 'venue', reason: 'venue_correction_member_missing', venueId: requestedId });
      continue;
    }
    const changes = [];
    for (const [field, value] of Object.entries(set)) {
      if (stable(record[field]) === stable(value)) continue;
      changes.push({ field, before: clone(record[field]), after: clone(value) });
      record[field] = clone(value);
    }
    for (const field of clear) {
      if (!hasOwn(record, field)) continue;
      changes.push({ field, before: clone(record[field]), cleared: true });
      delete record[field];
    }
    if (changes.length) manifest.push({
      kind: 'venue_correction',
      venueId: requestedId,
      changes,
      reason: decision?.reason || 'research_decision',
      evidence: clone(decision?.evidence || []),
    });
  }
  return { records: source, manifest, blocked };
}

function applyConcertVenueAssignments(concerts, venues, venueMapping, decisions) {
  const source = clone(concerts || []);
  const concertAliases = legacyAliasState(source, 'id', 'legacyConcertIds');
  const ambiguousConcertIds = new Set(concertAliases.collisions.map((item) => item.alias));
  const venueAliases = legacyAliasState(venues || [], 'venueId', 'legacyVenueIds');
  const venueIds = new Set((venues || []).map((record) => text(record?.venueId)).filter(Boolean));
  const requested = new Map();
  const prepared = [];
  const blocked = [];
  const invalidConcertIds = new Set();
  for (const decision of normalizeDecisions(decisions).concertVenueAssignments) {
    const sourceIds = uniqueStable(asArray(decision?.concertIds).map(text).filter(Boolean));
    const ambiguous = sourceIds.filter((id) => ambiguousConcertIds.has(id));
    const resolvedIds = uniqueStable(sourceIds.map((id) => concertAliases.mapping[id] || id));
    const missing = resolvedIds.filter((id) => !concertAliases.mapping[id]);
    const requestedVenueId = text(decision?.canonicalVenueId);
    const canonicalVenueId = text(venueMapping?.[requestedVenueId] || venueAliases.mapping[requestedVenueId] || requestedVenueId);
    if (!sourceIds.length || !requestedVenueId || ambiguous.length || missing.length || !venueIds.has(canonicalVenueId)) {
      blocked.push({
        kind: 'concert',
        reason: ambiguous.length ? 'venue_assignment_member_ambiguous' : missing.length ? 'venue_assignment_member_missing' : !venueIds.has(canonicalVenueId) ? 'venue_assignment_target_missing' : 'venue_assignment_invalid',
        concertIds: sourceIds,
        canonicalVenueId: requestedVenueId || null,
        ambiguous,
        missing,
      });
      for (const id of resolvedIds) invalidConcertIds.add(id);
      continue;
    }
    for (const id of resolvedIds) {
      const prior = requested.get(id);
      if (prior && prior !== canonicalVenueId) {
        blocked.push({ kind: 'concert', reason: 'conflicting_venue_assignments', concertId: id, canonicalVenueIds: [prior, canonicalVenueId].sort() });
        invalidConcertIds.add(id);
      } else requested.set(id, canonicalVenueId);
    }
    prepared.push({ ids: resolvedIds, canonicalVenueId, decision });
  }
  const byId = new Map(source.map((record) => [text(record?.id), record]).filter(([id]) => id));
  const manifest = [];
  for (const entry of prepared) {
    for (const id of entry.ids) {
      if (invalidConcertIds.has(id)) continue;
      const record = byId.get(id);
      if (!record || text(record.canonicalVenueId) === entry.canonicalVenueId) continue;
      const previousCanonicalVenueId = text(record.canonicalVenueId) || null;
      record.canonicalVenueId = entry.canonicalVenueId;
      manifest.push({
        kind: 'concert_venue_assignment',
        concertId: id,
        canonicalVenueId: entry.canonicalVenueId,
        previousCanonicalVenueId,
        reason: entry.decision?.reason || 'research_decision',
        evidence: clone(entry.decision?.evidence || []),
      });
    }
  }
  return { records: source, manifest, blocked };
}

function pairKey(left, right) {
  return [String(left || ''), String(right || '')].sort().join('\u001f');
}

function decisionPairSet(decisions, field) {
  const set = new Set();
  for (const decision of normalizeDecisions(decisions)[field] || []) {
    const ids = uniqueStable(asArray(decision?.ids).map(String).filter(Boolean));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) set.add(pairKey(ids[i], ids[j]));
    }
  }
  return set;
}

function allPairsMatch(ids, predicate) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (!predicate(ids[i], ids[j])) return false;
    }
  }
  return ids.length > 1;
}

function validateDistinctDecisions(venues, concerts, decisions) {
  const blocked = [];
  const venueState = legacyAliasState(venues, 'venueId', 'legacyVenueIds');
  const concertState = legacyAliasState(concerts, 'id', 'legacyConcertIds');
  for (const [kind, field, available] of [
    ['venue', 'venueDistinct', new Set(Object.keys(venueState.mapping))],
    ['concert', 'concertDistinct', new Set(Object.keys(concertState.mapping))],
  ]) {
    for (const decision of normalizeDecisions(decisions)[field]) {
      const ids = uniqueStable(asArray(decision?.ids).map(String).filter(Boolean));
      if (ids.length < 2) {
        blocked.push({ kind, reason: 'distinct_decision_ids_invalid', ids });
        continue;
      }
      const missing = ids.filter((id) => !available.has(id));
      if (missing.length) blocked.push({ kind, reason: 'distinct_decision_member_missing', ids, missing });
    }
  }
  return blocked;
}

function applyVenueDecisions(venues, decisions) {
  const source = clone(venues || []);
  let output = clone(source);
  const aliasState = legacyAliasState(source, 'venueId', 'legacyVenueIds');
  const mapping = { ...aliasState.mapping };
  const manifest = [];
  const blocked = [];
  const distinctPairs = decisionPairSet(decisions, 'venueDistinct');
  for (const decision of normalizeDecisions(decisions).venueMerges) {
    const ids = uniqueStable(asArray(decision?.ids).map(String).filter(Boolean));
    if (ids.length < 2) {
      blocked.push({ kind: 'venue', reason: 'decision_ids_invalid', ids });
      continue;
    }
    const requestedCanonicalId = text(decision?.canonicalId);
    if (!requestedCanonicalId || !ids.includes(requestedCanonicalId)) {
      blocked.push({ kind: 'venue', reason: 'canonical_id_not_member', ids, canonicalId: requestedCanonicalId || null });
      continue;
    }
    const contradiction = ids.some((left, index) => ids.slice(index + 1).some((right) => distinctPairs.has(pairKey(left, right))));
    if (contradiction) {
      blocked.push({ kind: 'venue', reason: 'merge_conflicts_with_explicit_distinct', ids });
      continue;
    }
    const resolvedIds = uniqueStable(ids.map((id) => mapping[id] || id));
    const resolvedCanonicalId = mapping[requestedCanonicalId] || requestedCanonicalId;
    const members = output.filter((record) => resolvedIds.includes(String(record?.venueId || '')));
    if (resolvedIds.length === 1 && members.length === 1 && text(members[0]?.venueId) === resolvedCanonicalId) continue;
    if (members.length !== resolvedIds.length || !resolvedIds.includes(resolvedCanonicalId)) {
      blocked.push({ kind: 'venue', reason: 'decision_member_missing', ids, resolvedIds });
      continue;
    }
    const result = mergeVenueRecords(members, resolvedCanonicalId);
    if (result.blocked) {
      blocked.push({ kind: 'venue', ids, ...result });
      continue;
    }
    const firstIndex = Math.min(...members.map((member) => output.indexOf(member)));
    output = output.filter((record) => !resolvedIds.includes(String(record?.venueId || '')));
    output.splice(firstIndex, 0, result.record);
    for (const [sourceId, targetId] of Object.entries(mapping)) {
      if (resolvedIds.includes(targetId)) mapping[sourceId] = result.winnerId;
    }
    for (const id of ids) mapping[id] = result.winnerId;
    manifest.push({ kind: 'venue_merge', winnerId: result.winnerId, mergedAway: result.mergedAway, reason: decision?.reason || 'research_decision', evidence: clone(decision?.evidence || []) });
  }
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

function compatibleFestivalMetadata(left, right) {
  if (!left || !right) return true;
  if (left.year !== right.year) return false;
  if (left.name && right.name && normalizedText(left.name) !== normalizedText(right.name)) return false;
  if (left.primaryCanonicalVenueId && right.primaryCanonicalVenueId && left.primaryCanonicalVenueId !== right.primaryCanonicalVenueId) return false;
  return true;
}

function applyFestivalDecisions(concerts, decisions, venueMapping = {}) {
  const output = clone(concerts || []);
  const byId = new Map(output.map((record) => [String(record?.id || ''), record]));
  const concertAliases = legacyAliasState(output, 'id', 'legacyConcertIds');
  const ambiguousAliases = new Set(concertAliases.collisions.map((item) => item.alias));
  const blocked = [];
  const prepared = [];
  const invalidIndexes = new Set();
  const invalidFestivalIds = new Set();
  const festivalMetadata = new Map();
  const festivalIndexes = new Map();
  const concertAssignments = new Map();
  const normalized = normalizeDecisions(decisions).festivalEditions;

  normalized.forEach((decision, index) => {
    const sourceIds = uniqueStable(asArray(decision?.concertIds).map(String).filter(Boolean));
    const festivalId = text(decision?.id);
    const year = text(decision?.year);
    const ambiguous = sourceIds.filter((id) => ambiguousAliases.has(id));
    const resolvedIds = uniqueStable(sourceIds.map((id) => concertAliases.mapping[id] || id));
    const missing = resolvedIds.filter((id) => !byId.has(id));
    if (!sourceIds.length || !festivalId || !/^\d{4}$/.test(year) || missing.length || ambiguous.length) {
      blocked.push({
        kind: 'festival',
        reason: ambiguous.length ? 'decision_member_ambiguous' : missing.length ? 'decision_member_missing' : 'festival_identity_invalid',
        id: festivalId || null,
        concertIds: sourceIds,
        resolvedConcertIds: resolvedIds,
        missing,
        ambiguous,
      });
      invalidIndexes.add(index);
      if (festivalId) invalidFestivalIds.add(festivalId);
      return;
    }
    const requestedPrimary = text(decision?.primaryCanonicalVenueId);
    const metadata = {
      id: festivalId,
      name: text(decision?.name) || null,
      year,
      primaryCanonicalVenueId: requestedPrimary ? String(venueMapping[requestedPrimary] || requestedPrimary) : null,
    };
    if (!festivalIndexes.has(festivalId)) festivalIndexes.set(festivalId, []);
    festivalIndexes.get(festivalId).push(index);
    const existingMetadata = festivalMetadata.get(festivalId);
    if (existingMetadata && !compatibleFestivalMetadata(existingMetadata, metadata)) {
      blocked.push({ kind: 'festival', reason: 'festival_metadata_conflict', id: festivalId });
      invalidFestivalIds.add(festivalId);
      for (const priorIndex of festivalIndexes.get(festivalId)) invalidIndexes.add(priorIndex);
      invalidIndexes.add(index);
    } else {
      festivalMetadata.set(festivalId, {
        id: festivalId,
        name: existingMetadata?.name || metadata.name,
        year,
        primaryCanonicalVenueId: existingMetadata?.primaryCanonicalVenueId || metadata.primaryCanonicalVenueId,
      });
    }
    for (const concertId of resolvedIds) {
      const prior = concertAssignments.get(concertId);
      if (prior && prior.festivalId !== festivalId) {
        blocked.push({
          kind: 'festival',
          reason: 'festival_membership_conflict',
          concertId,
          festivalIds: [prior.festivalId, festivalId].sort(),
        });
        invalidFestivalIds.add(prior.festivalId);
        invalidFestivalIds.add(festivalId);
        invalidIndexes.add(index);
        invalidIndexes.add(prior.index);
      } else if (!prior) {
        concertAssignments.set(concertId, { festivalId, index });
      }
    }
    prepared.push({ index, ids: resolvedIds, festivalId });
  });

  for (const entry of prepared) {
    if (invalidIndexes.has(entry.index) || invalidFestivalIds.has(entry.festivalId)) continue;
    const metadata = festivalMetadata.get(entry.festivalId);
    if (!metadata) continue;
    for (const id of entry.ids) {
      const record = byId.get(id);
      record.festivalEditionId = entry.festivalId;
      record.festivalEdition = {
        ...(record.festivalEdition && typeof record.festivalEdition === 'object' ? record.festivalEdition : {}),
        id: entry.festivalId,
        name: metadata.name || record?.festivalEdition?.name || record?.festivalName || null,
        year: metadata.year,
        status: 'confirmed',
        primaryCanonicalVenueId: metadata.primaryCanonicalVenueId || record?.festivalEdition?.primaryCanonicalVenueId || null,
      };
    }
  }
  return { records: output, blocked };
}

function reconcileConcerts(concerts, venues, decisions) {
  const source = clone(concerts || []);
  const venueIndex = CanonicalIdentity.buildVenueIndex(venues || []);
  const groups = new Map();
  const groupKeyById = new Map();
  const unresolved = [];
  const blocked = [];
  const distinctPairs = decisionPairSet(decisions, 'concertDistinct');
  const aliasState = legacyAliasState(source, 'id', 'legacyConcertIds');
  const mapping = { ...aliasState.mapping };
  source.forEach((record, sourceIndex) => {
    const identity = CanonicalIdentity.canonicalConcertIdentity(record, venueIndex);
    if (identity.kind !== 'same') {
      unresolved.push({ sourceIndex, record: clone(record), reason: identity.reason });
      return;
    }
    if (!groups.has(identity.key)) groups.set(identity.key, []);
    groups.get(identity.key).push({ sourceIndex, record });
    if (text(record?.id)) groupKeyById.set(text(record.id), identity.key);
  });

  const preferredByKey = new Map();
  const sourceById = new Map(source.map((record) => [text(record?.id), record]).filter(([id]) => id));
  for (const decision of normalizeDecisions(decisions).concertMerges) {
    const ids = uniqueStable(asArray(decision?.ids).map(String).filter(Boolean));
    const canonicalId = text(decision?.canonicalId);
    if (ids.length < 2) {
      blocked.push({ kind: 'concert', reason: 'decision_ids_invalid', ids });
      continue;
    }
    if (!canonicalId || !ids.includes(canonicalId)) {
      blocked.push({ kind: 'concert', reason: 'canonical_id_not_member', ids, canonicalId: canonicalId || null });
      continue;
    }
    const ambiguous = ids.filter((id) => aliasState.collisions.some((item) => item.alias === id));
    if (ambiguous.length) {
      blocked.push({ kind: 'concert', reason: 'decision_member_ambiguous', ids, ambiguous });
      continue;
    }
    const resolvedIds = uniqueStable(ids.map((id) => mapping[id] || id));
    const resolvedCanonicalId = mapping[canonicalId] || canonicalId;
    const missing = resolvedIds.filter((id) => !sourceById.has(id));
    if (missing.length || !resolvedIds.includes(resolvedCanonicalId)) {
      blocked.push({ kind: 'concert', reason: 'decision_member_missing', ids, resolvedIds, missing });
      continue;
    }
    if (resolvedIds.length === 1) continue;
    const keys = uniqueStable(resolvedIds.map((id) => groupKeyById.get(id)).filter(Boolean));
    if (keys.length !== 1 || resolvedIds.some((id) => !groupKeyById.has(id))) {
      blocked.push({ kind: 'concert', reason: 'merge_decision_not_canonical_duplicate', ids, resolvedIds });
      continue;
    }
    const key = keys[0];
    const groupIds = (groups.get(key) || []).map((member) => text(member.record?.id)).filter(Boolean).sort();
    const decisionIds = [...resolvedIds].sort();
    if (stable(groupIds) !== stable(decisionIds)) {
      blocked.push({ kind: 'concert', reason: 'merge_decision_incomplete_group', key, ids, resolvedIds, canonicalGroupIds: groupIds });
      continue;
    }
    const hasDistinct = ids.some((left, index) => ids.slice(index + 1).some((right) => distinctPairs.has(pairKey(left, right))));
    if (hasDistinct) {
      blocked.push({ kind: 'concert', reason: 'merge_conflicts_with_explicit_distinct', key, ids });
      continue;
    }
    const existing = preferredByKey.get(key);
    if (existing && existing !== resolvedCanonicalId) {
      blocked.push({ kind: 'concert', reason: 'conflicting_merge_decisions', key, ids, canonicalIds: [existing, resolvedCanonicalId].sort() });
      continue;
    }
    preferredByKey.set(key, resolvedCanonicalId);
  }

  const replacements = new Map();
  const skipped = new Set();
  const manifest = [];
  for (const [key, members] of groups) {
    if (members.length === 1) continue;
    const records = members.map((member) => member.record);
    const memberIds = records.map((record) => String(record?.id || '')).filter(Boolean);
    const hasDistinct = memberIds.some((left, index) => memberIds.slice(index + 1).some((right) => distinctPairs.has(pairKey(left, right))));
    if (hasDistinct) {
      blocked.push({ kind: 'concert', reason: 'explicit_distinct_conflicts_with_canonical_identity', key, ids: memberIds });
      continue;
    }
    const result = mergeConcertRecords(records, preferredByKey.get(key));
    if (result.blocked) {
      blocked.push({ kind: 'concert', key, ids: memberIds, ...result });
      continue;
    }
    const firstIndex = Math.min(...members.map((member) => member.sourceIndex));
    replacements.set(firstIndex, result.record);
    for (const member of members) if (member.sourceIndex !== firstIndex) skipped.add(member.sourceIndex);
    for (const [sourceId, targetId] of Object.entries(mapping)) {
      if (memberIds.includes(targetId)) mapping[sourceId] = result.winnerId;
    }
    for (const id of memberIds) mapping[id] = result.winnerId;
    manifest.push({ kind: 'concert_merge', key, winnerId: result.winnerId, mergedAway: result.mergedAway, reason: 'canonical_band_venue_date' });
  }
  const output = [];
  source.forEach((record, index) => {
    if (skipped.has(index)) return;
    output.push(replacements.has(index) ? replacements.get(index) : clone(record));
  });
  return { records: output, mapping, manifest, blocked, unresolved: unresolved.map((item) => ({ id: item.record?.id || null, reason: item.reason })) };
}

function protectedSnapshot(concerts) {
  const rows = [];
  for (const record of concerts || []) {
    const fields = {};
    for (const field of USER_FIELDS) if (present(record, field)) fields[field] = clone(record[field]);
    if (record?.attending === true || record?.attended === true || Object.keys(fields).some((field) => meaningful(fields[field]))) {
      rows.push({ id: record?.id || null, date: record?.date || null, fields });
    }
  }
  return { count: rows.length, sha256: sha256(rows), rows };
}

function protectedInvariant(sourceConcerts, outputConcerts, mapping) {
  const errors = [];
  const outputById = new Map((outputConcerts || []).map((record) => [String(record?.id || ''), record]));
  const groups = new Map();
  for (const source of sourceConcerts || []) {
    const sourceId = String(source?.id || '').trim();
    const targetId = String(mapping?.[sourceId] || sourceId).trim();
    if (!sourceId || !targetId) {
      errors.push({ reason: 'protected_mapping_missing', sourceId: sourceId || null });
      continue;
    }
    if (!groups.has(targetId)) groups.set(targetId, []);
    groups.get(targetId).push(source);
  }
  for (const [targetId, sources] of groups) {
    const target = outputById.get(targetId);
    if (!target) {
      errors.push({ reason: 'protected_target_missing', targetId });
      continue;
    }
    const conflicts = CanonicalIdentity.userOwnedConflicts(sources);
    if (conflicts.length) continue;
    const attendedDates = uniqueStable(sources.filter((record) => record?.attending === true || record?.attended === true).map((record) => record?.date).filter(Boolean));
    if (attendedDates.length === 1 && String(target?.date || '') !== String(attendedDates[0])) {
      errors.push({ reason: 'attended_historical_date_changed', targetId, expected: attendedDates[0], actual: target?.date || null });
    }
    for (const field of USER_FIELDS) {
      const expected = preferredUserValue(sources, field);
      if (expected === undefined) continue;
      if (stable(target?.[field]) !== stable(expected)) errors.push({ reason: 'protected_field_changed', targetId, field });
    }
  }
  return { valid: errors.length === 0, errors };
}

function validExplicitEventGroup(records) {
  const model = CanonicalIdentity.EventModelV174 || {};
  const values = (records || []).map((record) => {
    const value = record?.eventGroupId;
    const valid = typeof model.validGroupId === 'function'
      ? model.validGroupId(value)
      : typeof value === 'string' && value.trim().length > 0;
    return valid ? String(value).trim() : '';
  });
  return values.length > 0 && values.every(Boolean) && new Set(values).size === 1;
}

function migrationEventGroups(venues, concerts) {
  const model = CanonicalIdentity.EventModelV174 || {};
  const venueIndex = CanonicalIdentity.buildVenueIndex(venues || []);
  const groups = new Map();
  (concerts || []).forEach((concert, sourceIndex) => {
    const explicit = validExplicitEventGroup([concert]);
    const festival = explicit ? null : CanonicalIdentity.festivalEditionIdentity(concert);
    const ordinary = explicit || festival ? null : CanonicalIdentity.ordinaryEventContext(concert, venueIndex);
    const explicitId = explicit ? String(concert.eventGroupId).trim() : '';
    const key = explicit ? `group:${explicitId}`
      : festival ? `festival:${festival.key}`
        : ordinary ? `auto:${ordinary.key}`
          : `concert:${concert?.id ?? sourceIndex}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        eventGroupId: explicitId || null,
        relationship: explicit ? 'explicit' : festival ? 'festival' : ordinary ? 'automatic' : 'single',
        festivalEdition: festival || null,
        records: [],
        indexes: [],
        firstIndex: sourceIndex,
      });
    }
    const group = groups.get(key);
    group.records.push(concert);
    group.indexes.push(sourceIndex);
  });
  return [...groups.values()].map((event) => {
    let validation = { valid: true, reasons: [] };
    if (event.relationship === 'explicit') {
      if (!validExplicitEventGroup(event.records)) validation = { valid: false, reasons: ['eventGroupId'] };
      else if (typeof model.validateExplicitEventGroup === 'function') validation = model.validateExplicitEventGroup(event.records, venueIndex);
    } else if (event.relationship === 'festival') {
      const identities = event.records.map((record) => CanonicalIdentity.festivalEditionIdentity(record));
      validation = identities.every(Boolean) && new Set(identities.map((identity) => identity.key)).size === 1
        ? { valid: true, reasons: [] }
        : { valid: false, reasons: ['festivalEdition'] };
    } else if (event.relationship === 'automatic') {
      validation = typeof model.validateEventGroup === 'function'
        ? model.validateEventGroup(event.records, venueIndex)
        : { valid: true, reasons: [] };
    }
    return { ...event, validation };
  });
}

function metricSnapshot(venues, concerts) {
  const events = migrationEventGroups(venues, concerts);
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

function duplicateIds(records, field) {
  const seen = new Set();
  const duplicates = new Set();
  const missing = [];
  (records || []).forEach((record, index) => {
    const id = String(record?.[field] || '').trim();
    if (!id) {
      missing.push(index);
      return;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  return { duplicates: [...duplicates].sort(), missing };
}

function orphanChecks(venues, concerts, venueMap = {}, concertMap = {}) {
  const errors = [];
  const venueIds = new Set((venues || []).map((record) => String(record?.venueId || '').trim()).filter(Boolean));
  const concertIds = new Set((concerts || []).map((record) => String(record?.id || '').trim()).filter(Boolean));
  const venueIdState = duplicateIds(venues, 'venueId');
  const concertIdState = duplicateIds(concerts, 'id');
  const venueAliases = legacyAliasState(venues, 'venueId', 'legacyVenueIds');
  const concertAliases = legacyAliasState(concerts, 'id', 'legacyConcertIds');
  if (venueIdState.duplicates.length) errors.push({ reason: 'duplicate_venue_ids', ids: venueIdState.duplicates });
  if (venueIdState.missing.length) errors.push({ reason: 'missing_venue_ids', indexes: venueIdState.missing });
  if (concertIdState.duplicates.length) errors.push({ reason: 'duplicate_concert_ids', ids: concertIdState.duplicates });
  if (concertIdState.missing.length) errors.push({ reason: 'missing_concert_ids', indexes: concertIdState.missing });
  if (venueAliases.collisions.length) errors.push({ reason: 'duplicate_legacy_venue_id_owners', collisions: venueAliases.collisions });
  if (concertAliases.collisions.length) errors.push({ reason: 'duplicate_legacy_concert_id_owners', collisions: concertAliases.collisions });
  for (const concert of concerts || []) {
    const canonicalVenueId = String(concert?.canonicalVenueId || '').trim();
    if (canonicalVenueId && !venueIds.has(canonicalVenueId)) errors.push({ reason: 'concert_canonical_venue_orphan', concertId: concert?.id || null, canonicalVenueId });
    const festivalPrimary = String(concert?.festivalEdition?.primaryCanonicalVenueId || concert?.festivalPrimaryCanonicalVenueId || '').trim();
    if (festivalPrimary && !venueIds.has(festivalPrimary)) errors.push({ reason: 'festival_primary_venue_orphan', concertId: concert?.id || null, canonicalVenueId: festivalPrimary });
  }
  for (const [sourceId, targetId] of Object.entries(venueMap || {})) {
    if (!String(sourceId).trim() || !String(targetId).trim() || !venueIds.has(String(targetId))) errors.push({ reason: 'venue_mapping_target_orphan', sourceId, targetId });
  }
  for (const [sourceId, targetId] of Object.entries(concertMap || {})) {
    if (!String(sourceId).trim() || !String(targetId).trim() || !concertIds.has(String(targetId))) errors.push({ reason: 'concert_mapping_target_orphan', sourceId, targetId });
  }
  return { valid: errors.length === 0, errors };
}

function reverseMapping(mapping) {
  const reverse = {};
  for (const [sourceId, targetId] of Object.entries(mapping || {})) {
    if (!targetId) continue;
    if (!reverse[targetId]) reverse[targetId] = [];
    if (!reverse[targetId].includes(sourceId)) reverse[targetId].push(sourceId);
  }
  for (const ids of Object.values(reverse)) ids.sort();
  return reverse;
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
  const concertDistinct = decisionPairSet(decisions, 'concertDistinct');
  const concertCandidates = [...concertGroups.entries()].filter(([, records]) => records.length > 1).map(([key, records]) => {
    const ids = records.map((record) => String(record?.id || '')).filter(Boolean);
    const resolvedDistinct = allPairsMatch(ids, (left, right) => concertDistinct.has(pairKey(left, right)));
    return { key, reason: 'canonical_band_venue_date', ids, userConflicts: CanonicalIdentity.userOwnedConflicts(records), resolvedDistinct };
  });
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
  const venueDistinct = decisionPairSet(decisions, 'venueDistinct');
  const venueCandidates = [...variantOwners.entries()].filter(([, ids]) => ids.size > 1).map(([key, idsSet]) => {
    const ids = [...idsSet].sort();
    const resolvedDistinct = allPairsMatch(ids, (left, right) => venueDistinct.has(pairKey(left, right)));
    return { key, reason: key.startsWith('provider:') ? 'shared_provider_identity' : 'shared_identity_name_requires_research', ids, resolvedDistinct };
  });
  const eventGroups = migrationEventGroups(venues, concerts);
  return {
    schemaVersion: 1,
    sourceHashes: { venues: sha256(venues || []), concerts: sha256(concerts || []), decisions: sha256(normalizeDecisions(decisions)) },
    counts: { venues: (venues || []).length, concerts: (concerts || []).length, events: eventGroups.length },
    venueCandidates,
    unresolvedVenueCandidates: venueCandidates.filter((item) => !item.resolvedDistinct),
    concertCandidates,
    unresolvedConcertCandidates: concertCandidates.filter((item) => !item.resolvedDistinct),
    unresolvedConcerts,
    invalidEvents: eventGroups.filter((event) => !event.validation?.valid).map((event) => ({ key: event.key, relationship: event.relationship, reasons: event.validation?.reasons || [], ids: event.records.map((record) => record?.id || null) })),
    protected: protectedSnapshot(concerts || []),
    metrics: metricSnapshot(venues || [], concerts || []),
  };
}

function planMigration(venues, concerts, decisions = {}) {
  const sourceVenues = clone(venues || []);
  const sourceConcerts = clone(concerts || []);
  const before = audit(sourceVenues, sourceConcerts, decisions);
  const venueAdditionStep = applyVenueAdditions(sourceVenues, decisions);
  const decisionBlockers = validateDistinctDecisions(venueAdditionStep.records, sourceConcerts, decisions);
  const venueCorrectionStep = applyVenueCorrections(venueAdditionStep.records, decisions);
  const venueStep = applyVenueDecisions(venueCorrectionStep.records, decisions);
  const mappedConcerts = mapConcertVenues(sourceConcerts, venueStep.mapping, venueStep.records);
  const assignmentStep = applyConcertVenueAssignments(mappedConcerts, venueStep.records, venueStep.mapping, decisions);
  const festivalStep = applyFestivalDecisions(assignmentStep.records, decisions, venueStep.mapping);
  const concertStep = reconcileConcerts(festivalStep.records, venueStep.records, decisions);
  const after = audit(venueStep.records, concertStep.records, decisions);
  const protectedCheck = protectedInvariant(sourceConcerts, concertStep.records, concertStep.mapping);
  const orphans = orphanChecks(venueStep.records, concertStep.records, venueStep.mapping, concertStep.mapping);
  return {
    schemaVersion: 1,
    sourceHashes: before.sourceHashes,
    outputHashes: { venues: sha256(venueStep.records), concerts: sha256(concertStep.records) },
    venues: venueStep.records,
    concerts: concertStep.records,
    legacyVenueMap: venueStep.mapping,
    legacyConcertMap: concertStep.mapping,
    reverseVenueMap: reverseMapping(venueStep.mapping),
    reverseConcertMap: reverseMapping(concertStep.mapping),
    mergeManifest: [...venueAdditionStep.manifest, ...venueCorrectionStep.manifest, ...venueStep.manifest, ...assignmentStep.manifest, ...concertStep.manifest],
    blocked: [...decisionBlockers, ...venueAdditionStep.blocked, ...venueCorrectionStep.blocked, ...venueStep.blocked, ...assignmentStep.blocked, ...festivalStep.blocked, ...concertStep.blocked],
    unresolved: concertStep.unresolved,
    unresolvedIdentity: {
      venues: clone(after.unresolvedVenueCandidates),
      concerts: clone(after.unresolvedConcertCandidates),
    },
    invariants: { protected: protectedCheck, orphans, invalidEvents: after.invalidEvents },
    before: { counts: before.counts, metrics: before.metrics, protected: before.protected },
    after: { counts: after.counts, metrics: after.metrics, protected: after.protected },
  };
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan_missing'] };
  for (const item of plan.blocked || []) errors.push(`blocked:${item.kind}:${item.reason}`);
  if ((plan.unresolvedIdentity?.venues || []).length) errors.push('unresolved_venue_candidates');
  if ((plan.unresolvedIdentity?.concerts || []).length) errors.push('unresolved_concert_candidates');
  if (!plan.invariants?.protected?.valid) for (const item of plan.invariants?.protected?.errors || []) errors.push(`protected:${item.reason}`);
  if (!plan.invariants?.orphans?.valid) for (const item of plan.invariants?.orphans?.errors || []) errors.push(`orphan:${item.reason}`);
  if ((plan.invariants?.invalidEvents || []).length) errors.push('invalid_event_groups');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

module.exports = Object.freeze({
  sha256,
  sha256Bytes,
  audit,
  planMigration,
  validatePlan,
  mergeVenueRecords,
  mergeConcertRecords,
  protectedSnapshot,
  protectedInvariant,
  metricSnapshot,
  migrationEventGroups,
  orphanChecks,
  reverseMapping,
  normalizeDecisions,
});
