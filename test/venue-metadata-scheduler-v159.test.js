'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VenueMetadata = require('../venueMetadataModelV158');
const Scheduler = require('../scripts/venueMetadataResearchRun');

function completeVenue(overrides = {}) {
  const base = {
    name: 'Royal Arena',
    city: 'Copenhagen',
    country: 'Denmark',
    address: 'Hannemanns Alle 18-20, Copenhagen, Denmark',
  };
  return {
    venueId: VenueMetadata.venueIdFor(base),
    ...base,
    maxCapacity: 16000,
    officialUrl: 'https://www.royalarena.dk/',
    description: 'A multi-purpose indoor arena in Copenhagen.',
    researchStatus: 'complete',
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: ['https://www.royalarena.dk/'],
    schemaVersion: 1,
    ...overrides,
  };
}

function concert(id, venue, city, country, date, attending = true, venueAddress = undefined) {
  return { id, venue, city, country, date, attending, ...(venueAddress ? { venueAddress } : {}) };
}

function fakeUsage({ tavily = true, groq = true } = {}) {
  return {
    structured: [],
    canCallTavily: () => tavily,
    canCallGroq: () => groq,
    recordStructured(kind, value) { this.structured.push([kind, value]); },
  };
}

test('scheduler targets attended venues only, skips complete records and prioritizes upcoming', () => {
  const concerts = [
    concert('past', 'Past Hall', 'Malmo', 'Sweden', '2025-01-01'),
    concert('upcoming', 'Future Arena', 'Stockholm', 'Sweden', '2027-02-01'),
    concert('not-attending', 'Ignored Hall', 'Gothenburg', 'Sweden', '2027-03-01', false),
    concert('complete', 'Royal Arena', 'Copenhagen', 'Denmark', '2027-04-01'),
  ];
  const targets = Scheduler.dueVenueTargets(concerts, [completeVenue()], { today: '2026-08-23', limit: 10 });
  assert.deepEqual(targets.map((row) => row.seed.name), ['Future Arena', 'Past Hall']);
});

test('scheduler only targets venues with explicit EU country evidence', () => {
  const concerts = [
    concert('se', 'Swedish Hall', 'Malmo', 'Sweden', '2027-01-01'),
    concert('dk-code', 'Danish Hall', 'Copenhagen', 'DK', '2027-01-02'),
    concert('cz-alias', 'Czech Hall', 'Prague', 'Czech Republic', '2027-01-03'),
    concert('uk', 'UK Hall', 'London', 'United Kingdom', '2027-01-04'),
    concert('no-country', 'Unknown Hall', 'Somewhere', '', '2027-01-05'),
  ];
  const targets = Scheduler.dueVenueTargets(concerts, [], { today: '2026-08-23', limit: 10 });
  assert.deepEqual(targets.map((row) => row.seed.name), ['Czech Hall', 'Danish Hall', 'Swedish Hall']);
  assert.equal(Scheduler.isEuCountry('Norway'), false);
  assert.equal(Scheduler.isEuCountry(''), false);
});

test('scheduler keeps review-needed due but behind ordinary incomplete work', () => {
  const concerts = [
    concert('a', 'Review Hall', 'Lund', 'Sweden', '2025-01-01'),
    concert('b', 'Missing Hall', 'Lund', 'Sweden', '2025-02-01'),
  ];
  const reviewSeed = VenueMetadata.createVenueSeed(concerts[0]);
  const review = { ...reviewSeed, researchStatus: 'review_needed', schemaVersion: 1 };
  const targets = Scheduler.dueVenueTargets(concerts, [review], { today: '2026-08-23', limit: 10 });
  assert.deepEqual(targets.map((row) => row.seed.name), ['Missing Hall', 'Review Hall']);
});

test('extraction can only complete a venue with evidence-backed HTTPS data', () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Royal Arena', 'Copenhagen', 'Denmark', '2027-01-01'));
  const evidence = [{ title: 'Official', url: 'https://www.royalarena.dk/facts', content: 'Capacity and venue facts.' }];
  const record = Scheduler.buildResearchedRecord({
    seed,
    existing: null,
    extracted: {
      maxCapacity: 16000,
      officialUrl: 'https://www.royalarena.dk/',
      address: 'Hannemanns Alle 18-20, Copenhagen, Denmark',
      description: 'A multi-purpose indoor arena in Copenhagen.',
      sourceUrls: ['https://www.royalarena.dk/facts', 'https://untrusted.example/fake'],
      identityConflict: false,
    },
    searchResults: evidence,
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.equal(record.researchStatus, 'complete');
  assert.deepEqual(record.sources, ['https://www.royalarena.dk/facts']);
  assert.equal(record.officialUrl, 'https://www.royalarena.dk/');
  assert.equal(VenueMetadata.isComplete(record), true);
});

test('known address conflict is preserved and fails closed for review', () => {
  const seed = VenueMetadata.createVenueSeed(concert(
    'a', 'Example Arena', 'Lund', 'Sweden', '2027-01-01', true, 'Known Street 1, Lund, Sweden',
  ));
  const record = Scheduler.buildResearchedRecord({
    seed,
    existing: null,
    extracted: {
      maxCapacity: 10000,
      officialUrl: 'https://example.test/',
      address: 'Different Street 99, Lund, Sweden',
      description: 'An arena.',
      sourceUrls: ['https://example.test/facts'],
      identityConflict: false,
    },
    searchResults: [{ title: 'Facts', url: 'https://example.test/facts', content: 'Venue evidence.' }],
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.equal(record.researchStatus, 'review_needed');
  assert.equal(record.address, 'Known Street 1, Lund, Sweden');
  assert.equal(VenueMetadata.isComplete(record), false);
});

test('identity conflict fails closed and never becomes complete', () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Example Arena', 'Lund', 'Sweden', '2027-01-01'));
  const record = Scheduler.buildResearchedRecord({
    seed,
    existing: null,
    extracted: {
      maxCapacity: 10000,
      officialUrl: 'https://example.test/',
      address: 'Street 1, Lund, Sweden',
      description: 'An arena.',
      sourceUrls: ['https://example.test/facts'],
      identityConflict: true,
    },
    searchResults: [{ title: 'Facts', url: 'https://example.test/facts', content: 'Conflicting venue evidence.' }],
    researchedAt: '2026-08-23T12:00:00.000Z',
  });
  assert.equal(record.researchStatus, 'review_needed');
  assert.equal(VenueMetadata.isComplete(record), false);
});

test('provider failure records retryable state without fabricated venue facts', async () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Missing Arena', 'Lund', 'Sweden', '2027-01-01'));
  const result = await Scheduler.processTargets({
    targets: [{ seed, existing: null }],
    usage: fakeUsage(),
    search: async () => null,
    chatJson: async () => { throw new Error('Groq must not be called without search evidence'); },
    now: () => '2026-08-23T12:00:00.000Z',
  });
  assert.equal(result.attempted, 1);
  assert.equal(result.updates[0].researchStatus, 'temporary_error');
  assert.equal(result.updates[0].maxCapacity, undefined);
  assert.equal(result.updates[0].officialUrl, undefined);
  assert.deepEqual(result.updates[0].sources, []);
});

test('successful empty search becomes unresolved rather than temporary error', async () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Unknown Arena', 'Lund', 'Sweden', '2027-01-01'));
  const result = await Scheduler.processTargets({
    targets: [{ seed, existing: null }],
    usage: fakeUsage(),
    search: async () => ({ results: [] }),
    chatJson: async () => { throw new Error('Groq must not be called without evidence'); },
    now: () => '2026-08-23T12:00:00.000Z',
  });
  assert.equal(result.updates[0].researchStatus, 'unresolved');
});

test('quota exhaustion performs no provider work', async () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Quota Arena', 'Lund', 'Sweden', '2027-01-01'));
  let searches = 0;
  const result = await Scheduler.processTargets({
    targets: [{ seed, existing: null }],
    usage: fakeUsage({ tavily: false }),
    search: async () => { searches += 1; return null; },
    chatJson: async () => null,
  });
  assert.equal(result.attempted, 0);
  assert.equal(searches, 0);
  assert.deepEqual(result.updates, []);
});

test('latest complete venue wins over stale scheduled update and unknown fields survive', () => {
  const complete = completeVenue({ futureField: { keep: true } });
  const stale = { ...complete, researchStatus: 'partial', maxCapacity: 9999, futureField: undefined };
  const merged = Scheduler.applyVenueUpdates([complete], [stale]);
  assert.equal(merged[0].maxCapacity, 16000);
  assert.deepEqual(merged[0].futureField, { keep: true });
  assert.equal(merged[0].researchStatus, 'complete');
  assert.equal(Scheduler.changedVenueCount([complete], merged), 0);
});

test('incomplete venue enrichment preserves stable id and unknown fields', () => {
  const existing = completeVenue({ researchStatus: 'partial', maxCapacity: undefined, futureField: 'preserve-me' });
  const update = completeVenue({ venueId: existing.venueId, maxCapacity: 16000 });
  const merged = Scheduler.applyVenueUpdates([existing], [update]);
  assert.equal(merged[0].venueId, existing.venueId);
  assert.equal(merged[0].futureField, 'preserve-me');
  assert.equal(merged[0].maxCapacity, 16000);
  assert.equal(Scheduler.changedVenueCount([existing], merged), 1);
});

test('write retries one ETag conflict against latest venue state', async () => {
  const seed = VenueMetadata.createVenueSeed(concert('a', 'Conflict Arena', 'Lund', 'Sweden', '2027-01-01'));
  const backfilled = { ...seed, researchStatus: 'partial', schemaVersion: 1 };
  const update = {
    ...backfilled,
    researchedAt: '2026-08-23T12:00:00.000Z',
    sources: [],
  };
  let reads = 0;
  let writes = 0;
  const client = {
    async readJson() {
      reads += 1;
      return reads === 1 ? [backfilled] : [{ ...backfilled, futureField: 'concurrent-state' }];
    },
    async writeJsonStrict() {
      writes += 1;
      if (writes === 1) {
        const error = new Error('conflict');
        error.code = 'ETAG_CONFLICT';
        throw error;
      }
    },
  };
  const result = await Scheduler.writeWithOneConflictRetry(client, [update]);
  assert.equal(writes, 2);
  assert.equal(reads, 2);
  assert.equal(result.changed, 1);
  assert.equal(result.venues[0].futureField, 'concurrent-state');
  assert.equal(result.venues[0].researchedAt, '2026-08-23T12:00:00.000Z');
});

test('conflict retry does not overwrite a venue completed concurrently', async () => {
  const complete = completeVenue();
  const incomplete = completeVenue({ researchStatus: 'partial', maxCapacity: undefined });
  const stale = { ...incomplete, maxCapacity: 9999 };
  let reads = 0;
  let writes = 0;
  const client = {
    async readJson() {
      reads += 1;
      return reads === 1 ? [incomplete] : [complete];
    },
    async writeJsonStrict() {
      writes += 1;
      const error = new Error('conflict');
      error.code = 'ETAG_CONFLICT';
      throw error;
    },
  };
  const result = await Scheduler.writeWithOneConflictRetry(client, [stale]);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(result.changed, 0);
  assert.equal(result.venues[0].researchStatus, 'complete');
  assert.equal(result.venues[0].maxCapacity, 16000);
});
