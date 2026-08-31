'use strict';

const CanonicalIdentity = require('../../canonicalIdentityV174');
const Base = require('./canonicalMigrationV176');

const USER_FIELDS = new Set(CanonicalIdentity.USER_OWNED_FIELDS || []);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || '').trim();
}

function normalizedText(value) {
  return text(value).toLocaleLowerCase().replace(/\s+/g, ' ');
}

function stable(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
    for (const alias of Array.isArray(record?.[legacyField]) ? record[legacyField] : []) add(alias, owner);
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

function resolvedIds(ids, mapping) {
  return uniqueStable((ids || []).map((id) => mapping[text(id)] || text(id)).filter(Boolean));
}

function decisionMembers(decision, field = 'ids') {
  return uniqueStable((Array.isArray(decision?.[field]) ? decision[field] : []).map(text).filter(Boolean));
}

function setsOverlap(left, right) {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function pairKey(left, right) {
  return [text(left), text(right)].sort().join('\u001f');
}

function resolvedDistinctPairs(decisions, field, mapping) {
  const pairs = new Set();
  for (const decision of Base.normalizeDecisions(decisions)[field] || []) {
    const ids = resolvedIds(decisionMembers(decision), mapping);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.add(pairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

function crossDecisionBlockers(venues, concerts, decisions) {
  const blockers = [];
  const venueAliases = legacyAliasState(venues, 'venueId', 'legacyVenueIds');
  const concertAliases = legacyAliasState(concerts, 'id', 'legacyConcertIds');
  const normalized = Base.normalizeDecisions(decisions);

  for (const [kind, field, mapping] of [
    ['venue', 'venueMerges', venueAliases.mapping],
    ['concert', 'concertMerges', concertAliases.mapping],
  ]) {
    const merges = normalized[field] || [];
    for (let i = 0; i < merges.length; i += 1) {
      const leftMembers = resolvedIds(decisionMembers(merges[i]), mapping);
      const leftCanonical = text(merges[i]?.canonicalId);
      for (let j = i + 1; j < merges.length; j += 1) {
        const rightMembers = resolvedIds(decisionMembers(merges[j]), mapping);
        const rightCanonical = text(merges[j]?.canonicalId);
        if (!setsOverlap(leftMembers, rightMembers)) continue;
        if (leftCanonical && rightCanonical && leftCanonical !== rightCanonical) {
          blockers.push({
            kind,
            reason: 'conflicting_overlapping_merge_decisions',
            decisionIndexes: [i, j],
            canonicalIds: [leftCanonical, rightCanonical],
          });
        }
      }
    }
  }

  const venueDistinct = resolvedDistinctPairs(decisions, 'venueDistinct', venueAliases.mapping);
  for (const decision of normalized.venueMerges || []) {
    const ids = resolvedIds(decisionMembers(decision), venueAliases.mapping);
    const conflict = ids.some((left, index) => ids.slice(index + 1).some((right) => venueDistinct.has(pairKey(left, right))));
    if (conflict) blockers.push({ kind: 'venue', reason: 'merge_conflicts_with_legacy_distinct', ids });
  }

  const concertDistinct = resolvedDistinctPairs(decisions, 'concertDistinct', concertAliases.mapping);
  for (const decision of normalized.concertMerges || []) {
    const ids = resolvedIds(decisionMembers(decision), concertAliases.mapping);
    const conflict = ids.some((left, index) => ids.slice(index + 1).some((right) => concertDistinct.has(pairKey(left, right))));
    if (conflict) blockers.push({ kind: 'concert', reason: 'merge_conflicts_with_legacy_distinct', ids });
  }

  return uniqueStable(blockers);
}

function userRichScore(record) {
  let score = 0;
  if (record?.manuallyAdded === true) score += 100;
  if (record?.attending === true || record?.attended === true) score += 80;
  if (record?.lineupRole === 'support') score += 10;
  for (const field of USER_FIELDS) if (meaningful(record?.[field])) score += 3;
  return score;
}

function sourceOrderSurvivor(sourceConcerts, ids) {
  const idSet = new Set(ids.map(text));
  let best = null;
  let bestScore = -Infinity;
  for (const record of sourceConcerts || []) {
    if (!idSet.has(text(record?.id))) continue;
    const score = userRichScore(record);
    if (best === null || score > bestScore) {
      best = record;
      bestScore = score;
    }
  }
  return text(best?.id);
}

function hasExplicitConcertDecision(decisions, ids) {
  const idSet = new Set(ids.map(text));
  return (Base.normalizeDecisions(decisions).concertMerges || []).some((decision) =>
    decisionMembers(decision).some((id) => idSet.has(id)));
}

function withSourceOrderSurvivors(venues, concerts, decisions) {
  const initial = Base.planMigration(venues, concerts, decisions);
  const additions = [];
  for (const item of initial.mergeManifest || []) {
    if (item?.kind !== 'concert_merge') continue;
    const ids = uniqueStable([item.winnerId, ...(Array.isArray(item.mergedAway) ? item.mergedAway : [])].map(text).filter(Boolean));
    if (ids.length < 2 || hasExplicitConcertDecision(decisions, ids)) continue;
    const survivor = sourceOrderSurvivor(concerts, ids);
    if (survivor && survivor !== item.winnerId) {
      additions.push({
        ids,
        canonicalId: survivor,
        reason: 'automatic_source_order_tie_safety',
      });
    }
  }
  if (!additions.length) return { plan: initial, effectiveDecisions: decisions };
  const normalized = Base.normalizeDecisions(decisions);
  const effectiveDecisions = {
    ...clone(decisions || {}),
    ...normalized,
    concertMerges: [...normalized.concertMerges, ...additions],
  };
  return { plan: Base.planMigration(venues, concerts, effectiveDecisions), effectiveDecisions };
}

function providerNamespace(record) {
  return normalizedText(record?.providerNamespace || record?.sourceProvider || record?.providerSource || record?.provider || record?.namespace);
}

function providerEventId(record) {
  return text(record?.providerEventId || record?.eventId || record?.listingId);
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
    relatedEventIds: uniqueStable((Array.isArray(record?.providerRelatedEventIds) ? record.providerRelatedEventIds : []).map(text).filter(Boolean)),
    source: text(record?.providerSource || record?.sourceProvider || record?.sourceUrl || record?.articleUrl) || null,
  };
}

function observationCompatible(existing, incoming) {
  const keys = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  for (const key of keys) {
    if (key === 'observedAt') continue;
    const left = existing?.[key];
    const right = incoming?.[key];
    if (!meaningful(left) || !meaningful(right)) continue;
    if (stable(left) !== stable(right)) return false;
  }
  return true;
}

function enrichObservation(existing, incoming) {
  const result = clone(existing || {});
  for (const [key, value] of Object.entries(incoming || {})) {
    if (!meaningful(result[key]) && value !== undefined && value !== null) result[key] = clone(value);
  }
  return result;
}

function mergeObservations(values) {
  const output = [];
  for (const raw of values || []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const incoming = clone(raw);
    const key = providerObservationKey(incoming);
    if (!key) {
      if (!output.some((item) => stable(item) === stable(incoming))) output.push(incoming);
      continue;
    }
    const matchIndex = output.findIndex((item) => providerObservationKey(item) === key && observationCompatible(item, incoming));
    if (matchIndex >= 0) {
      output[matchIndex] = enrichObservation(output[matchIndex], incoming);
      continue;
    }
    if (!output.some((item) => stable(item) === stable(incoming))) output.push(incoming);
  }
  return output;
}

function finalizeProviderEvidence(sourceConcerts, outputConcerts, mapping) {
  const sourcesByTarget = new Map();
  for (const source of sourceConcerts || []) {
    const sourceId = text(source?.id);
    const targetId = text(mapping?.[sourceId] || sourceId);
    if (!targetId) continue;
    if (!sourcesByTarget.has(targetId)) sourcesByTarget.set(targetId, []);
    sourcesByTarget.get(targetId).push(source);
  }
  return (outputConcerts || []).map((record) => {
    const next = clone(record);
    const sources = sourcesByTarget.get(text(record?.id)) || [];
    const observations = [
      ...(Array.isArray(next.providerObservations) ? next.providerObservations : []),
      ...sources.flatMap((source) => Array.isArray(source?.providerObservations) ? source.providerObservations : []),
      ...sources.map(providerObservationFromRecord).filter(Boolean),
    ];
    const mergedObservations = mergeObservations(observations);
    if (mergedObservations.length) next.providerObservations = mergedObservations;
    const related = uniqueStable([
      ...(Array.isArray(next.providerRelatedEventIds) ? next.providerRelatedEventIds : []),
      ...sources.flatMap((source) => Array.isArray(source?.providerRelatedEventIds) ? source.providerRelatedEventIds : []),
    ].map(text).filter(Boolean));
    if (related.length) next.providerRelatedEventIds = related;
    return next;
  });
}

function refreshDerivedPlan(plan, sourceConcerts, decisions) {
  const after = Base.audit(plan.venues, plan.concerts, decisions);
  plan.outputHashes = {
    venues: Base.sha256(plan.venues),
    concerts: Base.sha256(plan.concerts),
  };
  plan.sourceHashes = {
    ...plan.sourceHashes,
    decisions: Base.sha256(Base.normalizeDecisions(decisions)),
  };
  plan.unresolvedIdentity = {
    venues: clone(after.unresolvedVenueCandidates),
    concerts: clone(after.unresolvedConcertCandidates),
  };
  plan.invariants = {
    protected: Base.protectedInvariant(sourceConcerts, plan.concerts, plan.legacyConcertMap),
    orphans: Base.orphanChecks(plan.venues, plan.concerts, plan.legacyVenueMap, plan.legacyConcertMap),
    invalidEvents: clone(after.invalidEvents),
  };
  plan.after = {
    counts: clone(after.counts),
    metrics: clone(after.metrics),
    protected: clone(after.protected),
  };
  return plan;
}

function planMigration(venues, concerts, decisions = {}) {
  const blockers = crossDecisionBlockers(venues, concerts, decisions);
  const { plan } = withSourceOrderSurvivors(venues, concerts, decisions);
  plan.concerts = finalizeProviderEvidence(concerts, plan.concerts, plan.legacyConcertMap);
  plan.blocked = uniqueStable([...(plan.blocked || []), ...blockers]);
  return refreshDerivedPlan(plan, concerts, decisions);
}

module.exports = Object.freeze({
  ...Base,
  planMigration,
});
