'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const Scheduler = require('../scripts/venueMetadataResearchRun');

test('scheduled venue research requires a non-empty valid manual backfill', () => {
  assert.equal(Scheduler.venueBackfillReady([]), false);
  assert.equal(Scheduler.venueBackfillReady(null), false);
  assert.equal(Scheduler.venueBackfillReady([{ venueId: 'bad' }]), false);

  const seed = VenueMetadata.createVenueSeed({ venue: 'Synthetic Arena', city: 'Lund', country: 'Sweden' });
  assert.ok(seed);
  assert.equal(Scheduler.venueBackfillReady([seed]), true);
});
