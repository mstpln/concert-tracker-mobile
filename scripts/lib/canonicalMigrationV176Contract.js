'use strict';

const Migration = require('./canonicalMigrationV176Final');
const CanonicalIdentity = require('../../canonicalIdentityV174');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || '').trim();
}

function uniqueStable(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clone(value));
  }
  return output;
}

function legacyAliasMapping(records, idField, legacyField) {
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
  for (const [alias, ownerSet] of owners) {
    if (ownerSet.size === 1) mapping[alias] = [...ownerSet][0];
  }
  return mapping;
}

function pairKey(left, right) {
  return [text(left), text(right)].sort().join('\u001f');
}

function distinctPairSet(decisions, field, mapping) {
  const pairs = new Set();
  for (const decision of Migration.normalizeDecisions(decisions)[field] || []) {
    const ids = [...new Set((Array.isArray(decision?.ids) ? decision.ids : [])
      .map((id) => mapping[text(id)] || text(id)).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.add(pairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

function allPairsDistinct(ids, pairs) {
  if (ids.length < 2) return false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (!pairs.has(pairKey(ids[i], ids[j]))) return false;
    }
  }
  return true;
}

function normalizeIdentityText(value) {
  const model = CanonicalIdentity.VenueModelV174 || {};
  if (typeof model.normalizeIdentityText === 'function') return model.normalizeIdentityText(value);
  return text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function exhaustiveVenueCandidates(venues, decisions) {
  const owners = new Map();
  for (const venue of venues || []) {
    for (const variant of CanonicalIdentity.VenueModelV174.identityVariants(venue)) {
      const name = normalizeIdentityText(variant?.name);
      const provider = normalizeIdentityText(variant?.provider || variant?.namespace || variant?.sourceProvider || variant?.source);
      const providerVenueId = text(variant?.providerVenueId || variant?.venueId || variant?.id);
      const key = provider && providerVenueId ? `provider:${provider}:${providerVenueId}` : name ? `name:${name}` : '';
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(text(venue?.venueId));
    }
  }
  const aliasMap = legacyAliasMapping(venues, 'venueId', 'legacyVenueIds');
  const distinct = distinctPairSet(decisions, 'venueDistinct', aliasMap);
  return [...owners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, idSet]) => {
      const ids = [...idSet].filter(Boolean).sort();
      return {
        key,
        reason: key.startsWith('provider:') ? 'shared_provider_identity' : 'shared_identity_name_requires_research',
        ids,
        resolvedDistinct: allPairsDistinct(ids, distinct),
      };
    });
}

function audit(venues, concerts, decisions = {}) {
  const report = Migration.audit(venues, concerts, decisions);
  const venueCandidates = exhaustiveVenueCandidates(venues, decisions);
  const concertAliasMap = legacyAliasMapping(concerts, 'id', 'legacyConcertIds');
  const concertDistinct = distinctPairSet(decisions, 'concertDistinct', concertAliasMap);
  const concertCandidates = (report.concertCandidates || []).map((candidate) => ({
    ...candidate,
    resolvedDistinct: allPairsDistinct(candidate.ids || [], concertDistinct),
  }));
  return {
    ...report,
    venueCandidates,
    unresolvedVenueCandidates: venueCandidates.filter((item) => !item.resolvedDistinct),
    concertCandidates,
    unresolvedConcertCandidates: concertCandidates.filter((item) => !item.resolvedDistinct),
  };
}

function remapFestivalPrimaryReferences(concerts, venueMapping) {
  return (concerts || []).map((record) => {
    const next = clone(record);
    const mapValue = (value) => {
      const id = text(value);
      return id && venueMapping?.[id] ? venueMapping[id] : value;
    };
    if (next.festivalEdition && typeof next.festivalEdition === 'object' && !Array.isArray(next.festivalEdition)) {
      next.festivalEdition.primaryCanonicalVenueId = mapValue(next.festivalEdition.primaryCanonicalVenueId);
    }
    if (next.festivalPrimaryCanonicalVenueId) next.festivalPrimaryCanonicalVenueId = mapValue(next.festivalPrimaryCanonicalVenueId);
    if (next.festivalPrimaryVenueId) next.festivalPrimaryVenueId = mapValue(next.festivalPrimaryVenueId);
    return next;
  });
}

function orphanChecks(venues, concerts, venueMap = {}, concertMap = {}) {
  const base = Migration.orphanChecks(venues, concerts, venueMap, concertMap);
  const errors = [...(base.errors || [])];
  const venueIds = new Set((venues || []).map((record) => text(record?.venueId)).filter(Boolean));
  for (const concert of concerts || []) {
    const primary = text(
      concert?.festivalEdition?.primaryCanonicalVenueId
      || concert?.festivalPrimaryCanonicalVenueId
      || concert?.festivalPrimaryVenueId,
    );
    if (primary && !venueIds.has(primary) && !errors.some((item) => item.reason === 'festival_primary_venue_orphan' && text(item.concertId) === text(concert?.id))) {
      errors.push({ reason: 'festival_primary_venue_orphan', concertId: concert?.id || null, canonicalVenueId: primary });
    }
  }
  return { valid: errors.length === 0, errors };
}

function planMigration(venues, concerts, decisions = {}) {
  const plan = Migration.planMigration(venues, concerts, decisions);
  plan.concerts = remapFestivalPrimaryReferences(plan.concerts, plan.legacyVenueMap);
  const after = audit(plan.venues, plan.concerts, decisions);
  plan.outputHashes = {
    venues: Migration.sha256(plan.venues),
    concerts: Migration.sha256(plan.concerts),
  };
  plan.unresolvedIdentity = {
    venues: clone(after.unresolvedVenueCandidates),
    concerts: clone(after.unresolvedConcertCandidates),
  };
  plan.invariants = {
    protected: Migration.protectedInvariant(concerts, plan.concerts, plan.legacyConcertMap),
    orphans: orphanChecks(plan.venues, plan.concerts, plan.legacyVenueMap, plan.legacyConcertMap),
    invalidEvents: clone(after.invalidEvents),
  };
  plan.after = {
    counts: clone(after.counts),
    metrics: clone(after.metrics),
    protected: clone(after.protected),
  };
  return plan;
}

module.exports = Object.freeze({
  ...Migration,
  audit,
  planMigration,
  orphanChecks,
});
