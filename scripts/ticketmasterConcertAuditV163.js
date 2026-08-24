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
  'concertDay', 'playlistProgress', 'userLinks',
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

function ticketmasterRecords(concerts) {
  return (Array.isArray(concerts) ? concerts : []).filter((concert) => concert?.sourceProvider === 'ticketmaster');
}

function referencedAlternateEventIds(records) {
  const referenced = new Set();
  for (const record of records) {
    for (const offer of Array.isArray(record?.alternateProviderOffers) ? record.alternateProviderOffers : []) {
      const providerEventId = String(offer?.providerEventId || '').trim();
      if (providerEventId) referenced.add(providerEventId);
    }
  }
  return referenced;
}

// Pre-v163 records did not store providerEventName/providerOfferType. The
// audit therefore requires positive stored evidence before calling a legacy
// record an alternate offer; absence of package evidence is not "standard".
function offerClassification(record, referencedEventIds = new Set()) {
  const explicit = record?.providerOfferType;
  const eventNameAlternate = Integrity.alternateOfferVocabularyMatch(record?.providerEventName);
  const ticketUrlAlternate = Integrity.alternateOfferVocabularyMatch(record?.ticketUrl);
  const referencedAsAlternate = referencedEventIds.has(String(record?.providerEventId || '').trim());
  const positiveReasons = [
    eventNameAlternate && 'provider_event_name_package_pattern',
    ticketUrlAlternate && 'legacy_ticket_url_package_pattern',
    referencedAsAlternate && 'referenced_by_alternate_provider_offers',
  ].filter(Boolean);

  if (explicit === 'alternate_offer') {
    return { kind: 'alternate_offer', reason: 'explicit_provider_offer_type' };
  }
  if (explicit === 'standard' && positiveReasons.length) {
    return { kind: 'ambiguous', reason: 'conflicting_provider_offer_evidence', positiveReasons };
  }
  if (explicit === 'standard') return { kind: 'standard', reason: 'explicit_provider_offer_type' };
  if (positiveReasons.length) return { kind: 'alternate_offer', reason: positiveReasons[0], positiveReasons };
  return { kind: 'unknown', reason: 'no_positive_alternate_offer_evidence' };
}

function physicalPerformanceGroups(concerts) {
  const records = ticketmasterRecords(concerts);
  const used = new Set();
  const groups = [];
  for (let i = 0; i < records.length; i += 1) {
    if (used.has(i)) continue;
    const indexes = [i];
    used.add(i);
    for (let cursor = 0; cursor < indexes.length; cursor += 1) {
      for (let j = 0; j < records.length; j += 1) {
        if (used.has(j)) continue;
        if (!Integrity.physicalPerformanceMatch(records[indexes[cursor]], records[j]).match) continue;
        indexes.push(j);
        used.add(j);
      }
    }
    if (indexes.length > 1) groups.push(indexes.map((index) => records[index]));
  }
  return groups;
}

function duplicateGroups(concerts) {
  const records = ticketmasterRecords(concerts);
  const referenced = referencedAlternateEventIds(records);
  return physicalPerformanceGroups(records).filter((group) => (
    group.some((record) => offerClassification(record, referenced).kind === 'alternate_offer')
  ));
}

function chooseCanonical(group, referencedEventIds = new Set()) {
  const explicitStandard = group.find((record) => offerClassification(record, referencedEventIds).kind === 'standard');
  if (explicitStandard) return explicitStandard;
  const nonAlternate = group.find((record) => offerClassification(record, referencedEventIds).kind === 'unknown');
  return nonAlternate || group[0];
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

function groupCleanupSafety(canonical, removed) {
  const reasons = [];
  const protectedFields = new Set();
  const unknownFields = new Set();
  const canonicalRole = ['headliner', 'support'].includes(canonical?.lineupRole) ? canonical.lineupRole : null;

  for (const record of removed) {
    if (!String(record?.providerEventId || '').trim()) {
      reasons.push('alternate_offer_provenance_incomplete');
    }
    const removedRole = ['headliner', 'support'].includes(record?.lineupRole) ? record.lineupRole : null;
    const roleConflict = canonicalRole && removedRole && canonicalRole !== removedRole;
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
      // Unknown future state has no established merge contract, even when an
      // identical value happens to be present on the canonical record.
      reasons.push('unknown_future_state_requires_review');
      unknownFields.add(field);
    }
  }

  return {
    safety: reasons.length ? 'manual_review_required' : 'automatic_candidate',
    reasons: [...new Set(reasons)],
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

function auditConcerts(concerts, bands = []) {
  if (!Array.isArray(concerts)) throw new Error('concerts input must be a JSON array');
  if (!Array.isArray(bands)) throw new Error('bands input must be a JSON array');
  const bandsById = bandMap(bands);
  const issues = [];
  const records = ticketmasterRecords(concerts);
  const referenced = referencedAlternateEventIds(records);

  for (const record of records) {
    const classification = offerClassification(record, referenced);
    const band = bandsById.get(record.bandId);
    const wrongArtist = Integrity.wrongArtistReason(record, band);
    if (wrongArtist) {
      const safety = cleanupSafety(record);
      issues.push({
        type: wrongArtist === 'provider_attraction_conflict' ? 'wrong_artist' : 'identity_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: wrongArtist,
        evidence: providerEvidence(record, classification),
        userOwnedFields: userOwnedFieldNames(record),
        unknownFields: unknownFieldNames(record),
        safety,
        automaticRemediationSafe: safety === 'automatic_candidate' && wrongArtist === 'provider_attraction_conflict',
        proposedMutation: safety === 'automatic_candidate' && wrongArtist === 'provider_attraction_conflict'
          ? { action: 'remove_wrong_artist_record', removeConcertId: record.id }
          : { action: 'manual_review', retainConcertId: record.id },
      });
    }
    if (Integrity.isUnknownVenueName(record.venue)) {
      issues.push({
        type: record.providerVenueId ? 'recoverable_venue' : 'venue_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: record.providerVenueId ? 'unknown_venue_with_provider_id' : 'unknown_venue_without_provider_id',
        evidence: providerEvidence(record, classification),
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: record.providerVenueId ? 'recover_venue_from_trusted_evidence' : 'manual_review', retainConcertId: record.id },
      });
    }
    if (Integrity.isUnsafeEventStatus(record.providerEventStatus)) {
      issues.push({
        type: 'lifecycle_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: `provider_status_${record.providerEventStatus}`,
        evidence: providerEvidence(record, classification),
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: 'manual_lifecycle_review', retainConcertId: record.id },
      });
    }
    if (!['headliner', 'support'].includes(record.lineupRole)) {
      issues.push({ type: 'lineup_role_review', concertId: record.id, bandId: record.bandId, reason: 'missing_or_invalid_lineup_role', safety: 'manual_review_required' });
    }
  }

  for (const group of physicalPerformanceGroups(records)) {
    const classifications = new Map(group.map((record) => [record, offerClassification(record, referenced)]));
    const alternateCount = group.filter((record) => classifications.get(record).kind === 'alternate_offer').length;
    if (!alternateCount) {
      issues.push({
        type: 'ticketmaster_listing_ambiguity',
        bandId: group[0].bandId,
        date: group[0].date,
        memberConcertIds: group.map((record) => record.id),
        members: group.map((record) => ({
          concertId: record.id,
          evidence: providerEvidence(record, classifications.get(record)),
          offerClassification: classifications.get(record),
          userOwnedFields: userOwnedFieldNames(record),
          unknownFields: unknownFieldNames(record),
        })),
        reason: 'same_physical_performance_without_positive_package_evidence',
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: 'manual_review', retainConcertIds: group.map((record) => record.id) },
      });
      continue;
    }

    const canonical = chooseCanonical(group, referenced);
    const removed = group.filter((record) => record !== canonical);
    const canonicalCandidates = group.filter((record) => classifications.get(record).kind !== 'alternate_offer');
    const cleanup = groupCleanupSafety(canonical, removed);
    const automaticRemediationSafe = canonicalCandidates.length === 1
      && classifications.get(canonical).kind !== 'ambiguous'
      && cleanup.safety === 'automatic_candidate';
    const alternateProviderOffers = Integrity.mergeOfferLists(
      ...group.map((record) => {
        const evidence = Integrity.providerOfferEvidence(record);
        const classification = classifications.get(record);
        const classifiedEvidence = evidence ? {
          ...evidence,
          providerOfferType: classification.kind === 'alternate_offer' ? 'alternate_offer' : evidence.providerOfferType,
          offerClassificationReason: classification.reason,
        } : null;
        return [classifiedEvidence, ...(record.alternateProviderOffers || [])];
      })
    ).filter((offer) => offer && offer.providerEventId !== canonical.providerEventId);
    const members = group.map((record) => ({
      concertId: record.id,
      evidence: providerEvidence(record, classifications.get(record)),
      offerClassification: classifications.get(record),
      userOwnedFields: userOwnedFieldNames(record),
      unknownFields: unknownFieldNames(record),
    }));
    issues.push({
      type: 'package_duplicate_group',
      bandId: canonical.bandId,
      date: canonical.date,
      canonicalConcertId: canonical.id,
      memberConcertIds: group.map((record) => record.id),
      members,
      reason: 'same_physical_performance_with_alternate_ticket_offer',
      retainedEvidence: providerEvidence(canonical, classifications.get(canonical)),
      alternateProviderOffers,
      cleanupAssessment: cleanup,
      safety: automaticRemediationSafe ? 'automatic_candidate' : 'manual_review_required',
      automaticRemediationSafe,
      proposedMutation: {
        action: automaticRemediationSafe ? 'merge_alternate_offers' : 'manual_review',
        retainConcertId: canonical.id,
        removeConcertIds: removed.map((record) => record.id),
        retainPrimaryProviderEventId: canonical.providerEventId || null,
        alternateProviderOffers,
        preservesCanonicalStableId: true,
      },
    });
  }

  const counts = issues.reduce((summary, issue) => {
    summary[issue.type] = (summary[issue.type] || 0) + 1;
    return summary;
  }, {});
  return {
    schemaVersion: 1,
    mode: 'read_only_audit',
    totalConcerts: concerts.length,
    ticketmasterConcerts: ticketmasterRecords(concerts).length,
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
  chooseCanonical,
  cleanupSafety,
  groupCleanupSafety,
  offerClassification,
  referencedAlternateEventIds,
  providerEvidence,
  userOwnedFieldNames,
  unknownFieldNames,
};
