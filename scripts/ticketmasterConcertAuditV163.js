'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const Integrity = require('./lib/ticketmasterConcertIntegrityV163');

const KNOWN_CONCERT_FIELDS = new Set([
  'id', 'bandId', 'bandName', 'venue', 'city', 'country', 'date', 'time', 'distanceKm', 'venueAddress',
  'latitude', 'longitude', 'articleUrl', 'ticketUrl', 'ticketRetailerVerified', 'isNew', 'foundAt',
  'sourceProvider', 'providerEventId', 'providerAttractionId', 'providerVenueId', 'providerEventName',
  'providerEventStatus', 'providerSource', 'providerOfferType', 'alternateProviderOffers', 'artistMatchMethod',
  'attending', 'attended', 'rating', 'notes', 'ticketPrice', 'ticketQuantity', 'freeTicket', 'freeTickets',
  'ownedTickets', 'tickets', 'playlistUrl', 'photoUrl', 'photos', 'eventGroupId', 'lineupRole', 'setlist',
  'setlistCheckedAt', 'predictedSetlist', 'setlistInsights', 'performanceInsights', 'prepChecklist',
  'concertDay', 'playlistProgress', 'userLinks', 'manuallyAdded',
]);

function usage() {
  return 'Usage: node scripts/ticketmasterConcertAuditV163.js --concerts <concerts.json> [--bands <bands.json>] [--output <audit.json>]';
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function bandMap(bands) {
  return new Map((Array.isArray(bands) ? bands : []).filter((band) => band?.id).map((band) => [band.id, band]));
}

function sortedRecords(records) {
  return [...records].sort((a, b) => Integrity.recordSortKey(a).localeCompare(Integrity.recordSortKey(b)));
}

function ticketmasterRecords(concerts) {
  return sortedRecords((Array.isArray(concerts) ? concerts : []).filter((concert) => concert?.sourceProvider === 'ticketmaster'));
}

function alternateReferenceKey(record, providerEventId = record?.providerEventId) {
  return [record?.bandId, record?.date, String(providerEventId || '').trim()].map((value) => String(value || '')).join('|');
}

function referencedAlternateEventIds(records) {
  const referenced = new Set();
  for (const record of records) {
    for (const offer of Array.isArray(record?.alternateProviderOffers) ? record.alternateProviderOffers : []) {
      const providerEventId = String(offer?.providerEventId || '').trim();
      if (providerEventId) referenced.add(alternateReferenceKey(record, providerEventId));
    }
  }
  return referenced;
}

// Pre-v163 evidence is scoped to band/date and URL path. Absence of evidence
// remains unknown rather than being assumed to mean a standard listing.
function offerClassification(record, referencedEventIds = new Set()) {
  const explicit = record?.providerOfferType;
  const eventNameAlternate = Integrity.alternateOfferVocabularyMatch(record?.providerEventName);
  const ticketUrlAlternate = Integrity.alternateOfferVocabularyMatch(record?.ticketUrl, { source: 'url' });
  const referencedAsAlternate = referencedEventIds.has(alternateReferenceKey(record));
  const positiveReasons = [
    eventNameAlternate && 'provider_event_name_package_pattern',
    ticketUrlAlternate && 'legacy_ticket_url_package_pattern',
    referencedAsAlternate && 'referenced_by_alternate_provider_offers',
  ].filter(Boolean);

  if (explicit === 'alternate_offer') return { kind: 'alternate_offer', reason: 'explicit_provider_offer_type', positiveReasons };
  if (explicit === 'standard' && positiveReasons.length) {
    return { kind: 'ambiguous', reason: 'conflicting_provider_offer_evidence', positiveReasons };
  }
  if (explicit === 'standard') return { kind: 'standard', reason: 'explicit_provider_offer_type', positiveReasons };
  if (positiveReasons.length) return { kind: 'alternate_offer', reason: positiveReasons[0], positiveReasons };
  return { kind: 'unknown', reason: 'no_positive_alternate_offer_evidence', positiveReasons };
}

// Cleanup requires exact provider venue identity or a complete matching legacy
// address. Venue-name similarity alone is deliberately review-only.
function cleanupPhysicalRelationship(first, second) {
  if (!first || !second || first.bandId !== second.bandId || first.date !== second.date) {
    return { kind: 'distinct', reason: 'band_or_date' };
  }
  const attractionA = String(first.providerAttractionId || '').trim();
  const attractionB = String(second.providerAttractionId || '').trim();
  if (!attractionA || !attractionB) return { kind: 'ambiguous', reason: 'attraction_missing' };
  if (attractionA !== attractionB) return { kind: 'ambiguous', reason: 'attraction_conflict' };
  if (Integrity.isUnknownVenueName(first.venue) || Integrity.isUnknownVenueName(second.venue)) {
    return { kind: 'ambiguous', reason: 'unknown_venue' };
  }

  const venueIdA = String(first.providerVenueId || '').trim();
  const venueIdB = String(second.providerVenueId || '').trim();
  let locationReason;
  if (venueIdA && venueIdB) {
    if (venueIdA !== venueIdB) return { kind: 'distinct', reason: 'provider_venue_conflict' };
    locationReason = 'provider_venue_id';
  } else {
    const addressA = Integrity.normalize(first.venueAddress);
    const addressB = Integrity.normalize(second.venueAddress);
    if (!addressA || !addressB) return { kind: 'ambiguous', reason: 'location_incomplete' };
    if (addressA !== addressB) return { kind: 'distinct', reason: 'address_conflict' };
    locationReason = 'exact_address';
  }

  const timing = Integrity.performanceTimeRelationship(first, second);
  if (timing.kind !== 'same') return timing;
  return { kind: 'same', reason: locationReason };
}

// Discovery groups are direct pairs, never transitive connected components.
function physicalPerformanceGroups(concerts) {
  const records = ticketmasterRecords(concerts);
  const groups = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      if (cleanupPhysicalRelationship(records[i], records[j]).kind === 'same') groups.push([records[i], records[j]]);
    }
  }
  return groups;
}

function duplicateGroups(concerts) {
  const records = ticketmasterRecords(concerts);
  const referenced = referencedAlternateEventIds(records);
  return physicalPerformanceGroups(records).filter((group) => (
    group.some((record) => ['alternate_offer', 'ambiguous'].includes(offerClassification(record, referenced).kind))
  ));
}

function chooseCanonical(group, referencedEventIds = new Set()) {
  const ordered = sortedRecords(group);
  const standards = ordered.filter((record) => offerClassification(record, referencedEventIds).kind === 'standard');
  if (standards.length === 1) return standards[0];
  if (standards.length > 1) return null;
  const unknown = ordered.filter((record) => offerClassification(record, referencedEventIds).kind === 'unknown');
  return unknown.length === 1 ? unknown[0] : null;
}

function userOwnedFieldNames(record) {
  return Integrity.userOwnedFieldNames(record);
}

function unknownFieldNames(record) {
  return Object.keys(record || {}).filter((field) => !KNOWN_CONCERT_FIELDS.has(field)).sort();
}

function cleanupSafety(record) {
  return userOwnedFieldNames(record).length || unknownFieldNames(record).length
    ? 'manual_review_required'
    : 'automatic_candidate';
}

function validStableId(record) {
  return typeof record?.id === 'string' && record.id.trim().length > 0;
}

function validLineupRole(record) {
  return ['headliner', 'support'].includes(record?.lineupRole);
}

function groupCleanupSafety(canonical, removed, band = null) {
  const reasons = [];
  const protectedFields = new Set();
  const unknownFields = new Set();
  if (!validStableId(canonical)) reasons.push('canonical_stable_id_missing');
  if (!String(canonical?.providerEventId || '').trim()) reasons.push('primary_provider_provenance_incomplete');
  if (Integrity.wrongArtistReason(canonical, band)) reasons.push('identity_not_proven');
  if (Integrity.isUnsafeEventStatus(canonical?.providerEventStatus)) reasons.push('unsafe_lifecycle_state');
  if (!validLineupRole(canonical)) {
    reasons.push('missing_or_invalid_lineup_role');
    protectedFields.add('lineupRole');
  }

  for (const record of removed) {
    if (!validStableId(record)) reasons.push('removed_stable_id_missing');
    if (!String(record?.providerEventId || '').trim()) reasons.push('alternate_offer_provenance_incomplete');
    if (Integrity.wrongArtistReason(record, band)) reasons.push('identity_not_proven');
    if (Integrity.isUnsafeEventStatus(record?.providerEventStatus)) reasons.push('unsafe_lifecycle_state');
    if (!validLineupRole(record)) {
      reasons.push('missing_or_invalid_lineup_role');
      protectedFields.add('lineupRole');
    }
    const roleConflict = validLineupRole(canonical) && validLineupRole(record) && canonical.lineupRole !== record.lineupRole;
    if (roleConflict) {
      reasons.push('conflicting_lineup_role');
      protectedFields.add('lineupRole');
    }

    for (const field of userOwnedFieldNames(record)) {
      if (field === 'lineupRole' && roleConflict) continue;
      if (Integrity.meaningfulUserOwnedValue(field, canonical?.[field])
        && isDeepStrictEqual(canonical[field], record[field])) continue;
      reasons.push('user_owned_state_not_preserved');
      protectedFields.add(field);
    }
    for (const field of unknownFieldNames(record)) {
      reasons.push('unknown_future_state_requires_review');
      unknownFields.add(field);
    }
  }

  return {
    safety: reasons.length ? 'manual_review_required' : 'automatic_candidate',
    reasons: [...new Set(reasons)].sort(),
    protectedFields: [...protectedFields].sort(),
    unknownFields: [...unknownFields].sort(),
  };
}

function providerEvidence(record, classification = null) {
  const classified = classification || offerClassification(record);
  return {
    sourceProvider: record?.sourceProvider || null,
    providerEventId: record?.providerEventId || null,
    providerAttractionId: record?.providerAttractionId || null,
    providerVenueId: record?.providerVenueId || null,
    providerEventName: record?.providerEventName || null,
    providerEventStatus: record?.providerEventStatus || null,
    providerSource: record?.providerSource || null,
    providerOfferType: ['standard', 'alternate_offer'].includes(record?.providerOfferType)
      ? record.providerOfferType
      : (classified.kind === 'alternate_offer' ? 'alternate_offer' : null),
    offerClassificationReason: classified.reason,
    ticketUrl: record?.ticketUrl || null,
  };
}

function memberEvidence(record, classification) {
  return {
    concertId: record.id || null,
    evidence: providerEvidence(record, classification),
    offerClassification: classification,
    userOwnedFields: userOwnedFieldNames(record),
    unknownFields: unknownFieldNames(record),
  };
}

function alternateEvidence(records, classifications, canonical) {
  return Integrity.mergeOfferLists(
    canonical?.alternateProviderOffers,
    ...records.map((record) => {
      const evidence = Integrity.providerOfferEvidence(record);
      const classification = classifications.get(record);
      const classified = evidence ? {
        ...evidence,
        providerOfferType: 'alternate_offer',
        offerClassificationReason: classification.reason,
      } : null;
      return [classified, ...(Array.isArray(record.alternateProviderOffers) ? record.alternateProviderOffers : [])];
    })
  ).filter((offer) => offer && offer.providerEventId !== canonical?.providerEventId);
}

function issueSortKey(issue) {
  return [issue.type, issue.bandId, issue.date, issue.concertId, issue.canonicalConcertId, ...(issue.memberConcertIds || [])]
    .map((value) => String(value || '')).join('|');
}

function auditConcerts(concerts, bands = []) {
  if (!Array.isArray(concerts)) throw new Error('concerts input must be a JSON array');
  if (!Array.isArray(bands)) throw new Error('bands input must be a JSON array');
  const bandsById = bandMap(bands);
  const issues = [];
  const records = ticketmasterRecords(concerts);
  const referenced = referencedAlternateEventIds(records);
  const classifications = new Map(records.map((record) => [record, offerClassification(record, referenced)]));

  for (const record of records) {
    const classification = classifications.get(record);
    const wrongArtist = Integrity.wrongArtistReason(record, bandsById.get(record.bandId));
    if (wrongArtist) {
      const safety = cleanupSafety(record);
      const automaticRemediationSafe = wrongArtist === 'provider_attraction_conflict'
        && safety === 'automatic_candidate' && validStableId(record) && validLineupRole(record)
        && !Integrity.isUnsafeEventStatus(record.providerEventStatus);
      issues.push({
        type: wrongArtist === 'provider_attraction_conflict' ? 'wrong_artist' : 'identity_review',
        concertId: record.id || null,
        bandId: record.bandId || null,
        reason: wrongArtist,
        evidence: providerEvidence(record, classification),
        userOwnedFields: userOwnedFieldNames(record),
        unknownFields: unknownFieldNames(record),
        safety: automaticRemediationSafe ? 'automatic_candidate' : 'manual_review_required',
        automaticRemediationSafe,
        proposedMutation: automaticRemediationSafe
          ? { action: 'remove_wrong_artist_record', removeConcertId: record.id }
          : { action: 'manual_review', retainConcertId: record.id || null },
      });
    }
    if (Integrity.isUnknownVenueName(record.venue)) {
      issues.push({
        type: record.providerVenueId ? 'recoverable_venue' : 'venue_review',
        concertId: record.id || null,
        bandId: record.bandId || null,
        reason: record.providerVenueId ? 'unknown_venue_with_provider_id' : 'unknown_venue_without_provider_id',
        evidence: providerEvidence(record, classification),
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: record.providerVenueId ? 'recover_venue_from_trusted_evidence' : 'manual_review', retainConcertId: record.id || null },
      });
    }
    if (Integrity.isUnsafeEventStatus(record.providerEventStatus)) {
      issues.push({
        type: 'lifecycle_review', concertId: record.id || null, bandId: record.bandId || null,
        reason: `provider_status_${record.providerEventStatus}`, evidence: providerEvidence(record, classification),
        safety: 'manual_review_required', automaticRemediationSafe: false,
        proposedMutation: { action: 'manual_lifecycle_review', retainConcertId: record.id || null },
      });
    }
    if (!validLineupRole(record)) {
      issues.push({
        type: 'lineup_role_review', concertId: record.id || null, bandId: record.bandId || null,
        reason: 'missing_or_invalid_lineup_role', safety: 'manual_review_required', automaticRemediationSafe: false,
      });
    }
  }

  const suspicious = records.filter((record) => ['alternate_offer', 'ambiguous'].includes(classifications.get(record).kind));
  const assignments = new Map();
  for (const alternate of suspicious) {
    const classification = classifications.get(alternate);
    const candidates = records.filter((record) => (
      record !== alternate && record.bandId === alternate.bandId && record.date === alternate.date
      && ['standard', 'unknown'].includes(classifications.get(record).kind)
    ));
    const relationships = candidates.map((candidate) => ({ candidate, relationship: cleanupPhysicalRelationship(candidate, alternate) }));
    const direct = relationships.filter(({ relationship }) => relationship.kind === 'same');
    const ambiguous = relationships.filter(({ relationship }) => relationship.kind === 'ambiguous');
    const automaticRelationship = classification.kind === 'alternate_offer' && direct.length === 1 && ambiguous.length === 0;

    if (automaticRelationship) {
      const list = assignments.get(direct[0].candidate) || [];
      list.push(alternate);
      assignments.set(direct[0].candidate, list);
      continue;
    }

    issues.push({
      type: 'package_relationship_review',
      bandId: alternate.bandId || null,
      date: alternate.date || null,
      concertId: alternate.id || null,
      memberConcertIds: [alternate, ...candidates].map((record) => record.id || null),
      members: [memberEvidence(alternate, classification), ...candidates.map((record) => memberEvidence(record, classifications.get(record)))],
      reason: classification.kind === 'ambiguous'
        ? 'conflicting_provider_offer_evidence'
        : (relationships.length ? 'physical_performance_not_proven' : 'no_candidate_listing'),
      packageEvidenceReasons: classification.positiveReasons?.length ? classification.positiveReasons : [classification.reason],
      physicalRelationships: relationships.map(({ candidate, relationship }) => ({
        candidateConcertId: candidate.id || null, kind: relationship.kind, reason: relationship.reason,
      })),
      safety: 'manual_review_required',
      automaticRemediationSafe: false,
      proposedMutation: { action: 'manual_review', retainConcertIds: [alternate, ...candidates].map((record) => record.id || null) },
    });
  }

  for (const canonical of sortedRecords(assignments.keys())) {
    const removed = sortedRecords(assignments.get(canonical));
    const cleanup = groupCleanupSafety(canonical, removed, bandsById.get(canonical.bandId));
    const directChecks = removed.map((record) => ({ concertId: record.id || null, ...cleanupPhysicalRelationship(canonical, record) }));
    const provenance = alternateEvidence(removed, classifications, canonical);
    const provenanceIds = new Set(provenance.map((offer) => offer.providerEventId));
    const provenanceComplete = removed.every((record) => (
      String(record.providerEventId || '').trim() && provenanceIds.has(String(record.providerEventId).trim())
    ));
    if (!provenanceComplete) {
      cleanup.safety = 'manual_review_required';
      cleanup.reasons = [...new Set([...cleanup.reasons, 'alternate_offer_provenance_incomplete'])].sort();
    }
    const automaticRemediationSafe = directChecks.every((check) => check.kind === 'same')
      && cleanup.safety === 'automatic_candidate' && provenanceComplete;
    const group = [canonical, ...removed];
    issues.push({
      type: 'package_duplicate_group',
      bandId: canonical.bandId || null,
      date: canonical.date || null,
      canonicalConcertId: canonical.id || null,
      memberConcertIds: group.map((record) => record.id || null),
      members: group.map((record) => memberEvidence(record, classifications.get(record))),
      reason: 'same_physical_performance_with_alternate_ticket_offer',
      retainedEvidence: providerEvidence(canonical, classifications.get(canonical)),
      directCanonicalMatches: directChecks,
      alternateProviderOffers: provenance,
      cleanupAssessment: cleanup,
      safety: automaticRemediationSafe ? 'automatic_candidate' : 'manual_review_required',
      automaticRemediationSafe,
      proposedMutation: {
        action: automaticRemediationSafe ? 'merge_alternate_offers' : 'manual_review',
        retainConcertId: canonical.id || null,
        removeConcertIds: removed.map((record) => record.id || null),
        retainPrimaryProviderEventId: canonical.providerEventId || null,
        alternateProviderOffers: provenance,
        preservesCanonicalStableId: validStableId(canonical),
      },
    });
  }

  // Non-package listings with direct or incomplete same-show evidence remain
  // visible for review. Materially distinct performances are intentionally not
  // reported as duplicates.
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const first = records[i]; const second = records[j];
      if (first.bandId !== second.bandId || first.date !== second.date) continue;
      if (['alternate_offer', 'ambiguous'].includes(classifications.get(first).kind)
        || ['alternate_offer', 'ambiguous'].includes(classifications.get(second).kind)) continue;
      const relationship = cleanupPhysicalRelationship(first, second);
      if (relationship.kind === 'distinct') continue;
      issues.push({
        type: 'ticketmaster_listing_ambiguity',
        bandId: first.bandId || null,
        date: first.date || null,
        memberConcertIds: [first.id || null, second.id || null],
        members: [memberEvidence(first, classifications.get(first)), memberEvidence(second, classifications.get(second))],
        reason: relationship.kind === 'same'
          ? 'same_physical_performance_without_positive_package_evidence'
          : 'possible_same_performance_with_incomplete_evidence',
        physicalRelationship: relationship,
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: 'manual_review', retainConcertIds: [first.id || null, second.id || null] },
      });
    }
  }

  issues.sort((a, b) => issueSortKey(a).localeCompare(issueSortKey(b)));
  const counts = issues.reduce((summary, issue) => {
    summary[issue.type] = (summary[issue.type] || 0) + 1;
    return summary;
  }, {});
  return {
    schemaVersion: 1,
    mode: 'read_only_audit',
    totalConcerts: concerts.length,
    ticketmasterConcerts: records.length,
    issueCount: issues.length,
    counts,
    issues,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const concertsPath = valueAfter(args, '--concerts');
  if (!concertsPath) {
    console.error(usage());
    process.exitCode = 2;
  } else {
    const concerts = JSON.parse(fs.readFileSync(path.resolve(concertsPath), 'utf8'));
    const bandsPath = valueAfter(args, '--bands');
    const bands = bandsPath ? JSON.parse(fs.readFileSync(path.resolve(bandsPath), 'utf8')) : [];
    const report = auditConcerts(concerts, bands);
    const output = valueAfter(args, '--output');
    if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    const printable = output ? { ...report, issues: undefined, output: path.resolve(output) } : report;
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
  }
}

module.exports = {
  auditConcerts,
  duplicateGroups,
  physicalPerformanceGroups,
  cleanupPhysicalRelationship,
  chooseCanonical,
  cleanupSafety,
  groupCleanupSafety,
  offerClassification,
  referencedAlternateEventIds,
  providerEvidence,
  userOwnedFieldNames,
  unknownFieldNames,
};
