'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Integrity = require('./lib/ticketmasterConcertIntegrityV163');

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

function cleanupSafety(record) {
  return Integrity.hasUserOwnedData(record) ? 'manual_review_required' : 'automatic_candidate';
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
      issues.push({
        type: wrongArtist === 'provider_attraction_conflict' ? 'wrong_artist' : 'identity_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: wrongArtist,
        safety: cleanupSafety(record),
      });
    }
    if (Integrity.isUnknownVenueName(record.venue)) {
      issues.push({
        type: record.providerVenueId ? 'recoverable_venue' : 'venue_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: record.providerVenueId ? 'unknown_venue_with_provider_id' : 'unknown_venue_without_provider_id',
        safety: 'manual_review_required',
      });
    }
    if (Integrity.isUnsafeEventStatus(record.providerEventStatus)) {
      issues.push({
        type: 'lifecycle_review',
        concertId: record.id,
        bandId: record.bandId,
        reason: `provider_status_${record.providerEventStatus}`,
        safety: 'manual_review_required',
      });
    }
    if (!['headliner', 'support'].includes(record.lineupRole)) {
      issues.push({ type: 'lineup_role_review', concertId: record.id, bandId: record.bandId, reason: 'missing_or_invalid_lineup_role', safety: 'manual_review_required' });
    }
  }

  for (const group of duplicateGroups(concerts)) {
    const canonical = chooseCanonical(group);
    const members = group.map((record) => ({
      concertId: record.id,
      providerEventId: record.providerEventId || null,
      providerEventName: record.providerEventName || null,
      providerOfferType: record.providerOfferType || Integrity.offerKind(record.providerEventName),
      userOwnedData: Integrity.hasUserOwnedData(record),
    }));
    issues.push({
      type: 'package_duplicate_group',
      bandId: canonical.bandId,
      date: canonical.date,
      canonicalConcertId: canonical.id,
      memberConcertIds: group.map((record) => record.id),
      members,
      reason: 'same_physical_performance_with_alternate_ticket_offer',
      safety: group.some(Integrity.hasUserOwnedData) ? 'manual_review_required' : 'automatic_candidate',
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
    process.stdout.write(`${JSON.stringify({ ...report, issues: undefined, output: output ? path.resolve(output) : null }, null, 2)}\n`);
  }
}

module.exports = { auditConcerts, duplicateGroups, chooseCanonical, cleanupSafety };
