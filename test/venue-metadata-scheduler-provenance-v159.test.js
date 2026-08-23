'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const Scheduler = require('../scripts/venueMetadataResearchRun');

test('scheduled enrichment preserves existing source evidence while adding new evidence', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const existing = {
    ...seed,
    researchStatus: 'partial',
    sources: ['https://existing.example/facts'],
    schemaVersion: 1,
  };
  const record = Scheduler.buildResearchedRecord({
    seed,
    existing,
    extracted: {
      maxCapacity: 5000,
      officialUrl: 'https://official.example/',
      address: 'Street 1, Lund, Sweden',
      description: 'A synthetic arena used only for testing.',
      sourceUrls: ['https://official.example/facts'],
      identityConflict: false,
    },
    searchResults: [{ title: 'Facts', url: 'https://official.example/facts', content: 'Synthetic venue facts.' }],
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.deepEqual(record.sources, ['https://existing.example/facts', 'https://official.example/facts']);
  assert.equal(record.researchStatus, 'complete');
});

test('source merge deduplicates and enforces the venue schema maximum', () => {
  const existing = Array.from({ length: 16 }, (_, index) => `https://source${index}.example/facts`);
  const merged = Scheduler.mergeSourceUrls(existing, [existing[0], 'https://new.example/facts']);
  assert.equal(merged.length, 16);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged.includes('https://new.example/facts'), false);
});
