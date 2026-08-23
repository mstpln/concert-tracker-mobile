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

test('new facts are ignored when Groq does not identify a retained supporting source', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const record = Scheduler.buildResearchedRecord({
    seed,
    existing: { ...seed, researchStatus: 'partial', sources: ['https://existing.example/facts'], schemaVersion: 1 },
    extracted: {
      maxCapacity: 5000,
      officialUrl: 'https://official.example/',
      address: 'Street 1, Lund, Sweden',
      description: 'A synthetic arena used only for testing.',
      sourceUrls: [],
      identityConflict: false,
    },
    searchResults: [{ title: 'Facts', url: 'https://official.example/facts', content: 'Synthetic venue facts.' }],
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.equal(record.maxCapacity, undefined);
  assert.equal(record.officialUrl, undefined);
  assert.equal(record.address, undefined);
  assert.equal(record.description, undefined);
  assert.equal(record.researchStatus, 'partial');
});

test('existing manual capacity is never replaced by conflicting scheduled evidence', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const existing = {
    ...seed,
    maxCapacity: 6000,
    researchStatus: 'partial',
    sources: ['https://manual.example/facts'],
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
  assert.equal(record.maxCapacity, 6000);
  assert.equal(record.researchStatus, 'review_needed');
});

test('latest concurrent incomplete metadata wins and conflicts become review-needed', () => {
  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  const latest = {
    ...seed,
    maxCapacity: 7000,
    description: 'Latest manually reviewed description.',
    researchStatus: 'partial',
    sources: ['https://latest.example/facts'],
    schemaVersion: 1,
  };
  const staleUpdate = {
    ...seed,
    maxCapacity: 5000,
    description: 'Older scheduled description.',
    officialUrl: 'https://official.example/',
    researchStatus: 'partial',
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: ['https://scheduled.example/facts'],
    schemaVersion: 1,
  };
  const merged = Scheduler.mergeUpdateIntoLatest(latest, staleUpdate);
  assert.equal(merged.maxCapacity, 7000);
  assert.equal(merged.description, 'Latest manually reviewed description.');
  assert.equal(merged.officialUrl, 'https://official.example/');
  assert.equal(merged.researchStatus, 'review_needed');
  assert.deepEqual(merged.sources, ['https://latest.example/facts', 'https://scheduled.example/facts']);
});

test('source merge deduplicates and enforces the venue schema maximum', () => {
  const existing = Array.from({ length: 16 }, (_, index) => `https://source${index}.example/facts`);
  const merged = Scheduler.mergeSourceUrls(existing, [existing[0], 'https://new.example/facts']);
  assert.equal(merged.length, 16);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged.includes('https://new.example/facts'), false);
});
