'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const Scheduler = require('../scripts/venueMetadataResearchRun');

test('scheduled research cannot clear an existing review-needed status', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const existing = {
    ...seed,
    researchStatus: 'review_needed',
    sources: ['https://existing.example/facts'],
    schemaVersion: 1,
  };
  const researched = Scheduler.buildResearchedRecord({
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
  assert.equal(researched.researchStatus, 'review_needed');

  const latest = { ...existing, maxCapacity: 5000 };
  const merged = Scheduler.mergeUpdateIntoLatest(latest, { ...researched, researchStatus: 'complete' });
  assert.equal(merged.researchStatus, 'review_needed');
});

test('provider failure also preserves existing review-needed status', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const existing = { ...seed, researchStatus: 'review_needed', sources: [], schemaVersion: 1 };
  const failed = Scheduler.temporaryFailureRecord(seed, existing, '2026-08-23T12:00:00.000Z');
  assert.equal(failed.researchStatus, 'review_needed');
});
