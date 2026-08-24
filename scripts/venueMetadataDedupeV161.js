'use strict';

const fs = require('node:fs');
const path = require('node:path');
const VenueMetadata = require('../venueMetadataModelV158');

function usage() {
  return 'Usage: node scripts/venueMetadataDedupeV161.js --input <venues.json> [--output <cleaned.json>] [--write]';
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function summarize(before, after) {
  const statusCounts = (rows) => rows.reduce((out, row) => {
    const key = row.researchStatus || 'missing';
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  return {
    before: before.length,
    after: after.length,
    removed: before.length - after.length,
    placeholderRemoved: before.filter((row) => VenueMetadata.isPlaceholderVenueName(row?.name)).length,
    nonOfficialUrlRemoved: before.filter((row) => row?.officialUrl && !VenueMetadata.officialVenueUrl(row.officialUrl)).length,
    unresolvedTimestampRemoved: before.filter((row) => ['unresolved', 'temporary_error'].includes(row?.researchStatus) && row?.researchedAt).length,
    beforeStatus: statusCounts(before),
    afterStatus: statusCounts(after),
  };
}

function reviewNoteConfirmsCounterpart(record, counterpart) {
  const note = VenueMetadata.normalizeIdentityText(record?.reviewNote);
  const counterpartName = VenueMetadata.normalizeIdentityText(counterpart?.name);
  if (!note || !counterpartName || counterpartName.length < 4) return false;
  if (!/(confirmed duplicate|confirmed same|same physical address|same physical venue|same venue name variant|same building|same stadium|same real square)/.test(note)) return false;
  if (/not confirmed|unconfirmed|possibly|likely|relocat|moved|addresses differ|could not fully confirm/.test(note)) return false;
  return note.includes(counterpartName);
}

function pairIsExplicitlyConfirmed(a, b) {
  const leftName = VenueMetadata.normalizeIdentityText(a?.name);
  const rightName = VenueMetadata.normalizeIdentityText(b?.name);
  if (leftName && leftName === rightName) return true;
  return reviewNoteConfirmsCounterpart(a, b) || reviewNoteConfirmsCounterpart(b, a);
}

function normalizedForCleanup(records) {
  return records
    .map((record) => VenueMetadata.normalizeRecord(record))
    .filter(Boolean)
    .filter((record) => !VenueMetadata.isPlaceholderVenueName(record.name))
    .map((record) => {
      const copy = { ...record };
      if (copy.officialUrl && !VenueMetadata.officialVenueUrl(copy.officialUrl)) delete copy.officialUrl;
      if ((copy.researchStatus === 'unresolved' || copy.researchStatus === 'temporary_error'
          || !Array.isArray(copy.sources) || !copy.sources.length) && copy.researchedAt) {
        delete copy.researchedAt;
      }
      if (copy.researchStatus === 'complete' && !VenueMetadata.isComplete(copy)) copy.researchStatus = 'partial';
      return copy;
    });
}

function dedupeDocument(records) {
  if (!Array.isArray(records)) throw new Error('venues input must be a JSON array');
  const cleaned = [];
  for (const record of normalizedForCleanup(records)) {
    const index = cleaned.findIndex((candidate) => (
      VenueMetadata.recordsCanConsolidate(candidate, record)
      && pairIsExplicitlyConfirmed(candidate, record)
    ));
    if (index < 0) {
      cleaned.push(record);
      continue;
    }
    const merged = VenueMetadata.mergeDuplicateRecords(cleaned[index], record);
    if (merged) cleaned[index] = merged;
    else cleaned.push(record);
  }
  return { cleaned, report: summarize(records, cleaned) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const input = valueAfter(args, '--input');
  if (!input) {
    console.error(usage());
    process.exitCode = 2;
  } else {
    const sourcePath = path.resolve(input);
    const records = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const { cleaned, report } = dedupeDocument(records);
    const output = valueAfter(args, '--output') || path.join(path.dirname(sourcePath), 'venues.cleaned.json');
    if (args.includes('--write')) fs.writeFileSync(path.resolve(output), `${JSON.stringify(cleaned, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ...report, output: args.includes('--write') ? path.resolve(output) : null }, null, 2)}\n`);
  }
}

module.exports = { dedupeDocument, summarize, pairIsExplicitlyConfirmed, reviewNoteConfirmsCounterpart };
