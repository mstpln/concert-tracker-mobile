'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

function duplicateGroups(concerts) {
  const records = ticketmasterRecords(concerts);
  const used = new Set();
  const groups = [];
  for (let i = 0; i < records.length; i += 1) {
    if (used.has(records[i].id)) continue;
    const group = [records[i]];
    for (let j = i + 1; j < records.length; j += 1) {
      if (used.has(records[j].id)) continue;
      const match = Integrity.physicalPerformanceMatch(records[i], records[j]);
      if (!match.match) continue;
      const firstKind = records[i].providerOfferType || Integrity.offerKind(records[i].providerEventName);
      const secondKind = records[j].providerOfferType || Integrity.offerKind(records[j].providerEventName);
      if (firstKind !== 'alternate_offer' && secondKind !== 'alternate_offer') continue;
      group.push(records[j]);
      used.add(records[j].id);
    }
    if (group.length > 1) {
      used.add(records[i].id);
      groups.push(group);
    }
  }
  return groups;
}

function chooseCanonical(group) {
  const standard = group.find((record) => (record.providerOfferType || Integrity.offerKind(record.providerEventName)) !== 'alternate_offer');
  return standard || group[0];
}

function userOwnedFieldNames(record) {
  return Integrity.USER_OWNED_FIELDS.filter((field) => {
    const value = record?.[field];
    if (value == null || value === false || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

function unknownFieldNames(record) {
  return Object.keys(record || {}).filter((field) => !KNOWN_CONCERT_FIELDS.has(field)).sort();
}

function cleanupSafety(record) {
  return userOwnedFieldNames(record).length || unknownFieldNames(record).length
    ? 'manual_review_required'
    : 'automatic_candidate';
}

function providerEvidence(record) {
  return {
    sourceProvider: record?.sourceProvider || null,
    providerEventId: record?.providerEventId || null,
    providerAttractionId: record?.providerAttractionId || null,
    providerVenueId: record?.providerVenueId || null,
    providerEventName: record?.providerEventName || null,
    providerEventStatus: record?.providerEventStatus || null,
    providerSource: record?.providerSource || null,
    providerOfferType: record?.providerOfferType || Integrity.offerKind(record?.providerEventName),
    ticketUrl: record?.ticketUrl || null,
  };
}

function auditConcerts(concerts, bands = []) {
  if (!Array.isArray(concerts)) throw new Error('concerts input must be a JSON array');
  if (!Array.isArray(bands)) throw new Error('bands input must be a JSON array');
  const bandsById = bandMap(bands);
  const issues = [];

  for (const record of ticketmasterRecords(concerts)) {
    const band = bandsById.get(record.bandId);
    const wrongArtist = Integrity.wrongArtistReason(record, band);
    if (wrongArtist) {
      const safety = cleanupSafety(record);
      issues.push({
        type: wrongArtist === 'provider_attraction_conflict' ? 'wrong_artist' : 'identity_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: wrongArtist,
        evidence: providerEvidence(record),
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
        evidence: providerEvidence(record),
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
        evidence: providerEvidence(record),
        safety: 'manual_review_required',
        automaticRemediationSafe: false,
        proposedMutation: { action: 'manual_lifecycle_review', retainConcertId: record.id },
      });
    }
    if (!['headliner', 'support'].includes(record.lineupRole)) {
      issues.push({ type: 'lineup_role_review', concertId: record.id, bandId: record.bandId, reason: 'missing_or_invalid_lineup_role', safety: 'manual_review_required' });
    }
  }

  for (const group of duplicateGroups(concerts)) {
    const canonical = chooseCanonical(group);
    const removed = group.filter((record) => record !== canonical);
    const standardCount = group.filter((record) => (record.providerOfferType || Integrity.offerKind(record.providerEventName)) !== 'alternate_offer').length;
    const automaticRemediationSafe = standardCount === 1 && removed.every((record) => cleanupSafety(record) === 'automatic_candidate');
    const alternateProviderOffers = Integrity.mergeOfferLists(
      ...group.map((record) => [Integrity.providerOfferEvidence(record), ...(record.alternateProviderOffers || [])])
    ).filter((offer) => offer && offer.providerEventId !== canonical.providerEventId);
    const members = group.map((record) => ({
      concertId: record.id,
      evidence: providerEvidence(record),
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
      retainedEvidence: providerEvidence(canonical),
      alternateProviderOffers,
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
  chooseCanonical,
  cleanupSafety,
  providerEvidence,
  userOwnedFieldNames,
  unknownFieldNames,
};
