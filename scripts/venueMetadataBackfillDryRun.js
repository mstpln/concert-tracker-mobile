'use strict';

const fs = require('node:fs');
const path = require('node:path');
const VenueMetadata = require('../venueMetadataModelV158');

function usage() {
  return 'Usage: node scripts/venueMetadataBackfillDryRun.js --concerts <concerts.json> [--venues <venues.json>] [--all]';
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return fallback;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function buildReport(concerts, venues, { attendedOnly = true } = {}) {
  const normalizedVenues = VenueMetadata.normalizeDocument(venues);
  const targets = VenueMetadata.uniqueVenueSeeds(concerts, { attendedOnly });
  const rows = targets.map((seed) => {
    const existing = VenueMetadata.findVenueRecord(seed, normalizedVenues);
    return {
      venueId: existing?.venueId || seed.venueId,
      name: existing?.name || seed.name,
      city: existing?.city || seed.city,
      country: existing?.country || seed.country || '',
      address: existing?.address || seed.address || null,
      existingStatus: existing?.researchStatus || null,
      complete: VenueMetadata.isComplete(existing),
      researchNeeded: !VenueMetadata.isComplete(existing),
    };
  });
  return {
    mode: attendedOnly ? 'attended-only' : 'all-concert-venues',
    totalUniqueTargets: rows.length,
    alreadyComplete: rows.filter((row) => row.complete).length,
    researchNeeded: rows.filter((row) => row.researchNeeded).length,
    venues: rows,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const concertsPath = valueAfter(args, '--concerts');
  if (!concertsPath) {
    console.error(usage());
    process.exitCode = 2;
  } else {
    const concerts = readJson(concertsPath, []);
    const venues = readJson(valueAfter(args, '--venues'), []);
    if (!Array.isArray(concerts) || !Array.isArray(venues)) throw new Error('concerts and venues inputs must be JSON arrays');
    const report = buildReport(concerts, venues, { attendedOnly: !args.includes('--all') });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

module.exports = { buildReport };
