'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../listeningDerivedStorage.js');

test('identity records are additive and preserve unknown future fields', () => {
  const source = {
    sourceEventId: 'listenbrainz:1',
    identityVersion: 1,
    bandId: 'band-1',
    spotifyArtistId: 'spotify-artist',
    reviewedDecision: null,
    unknownFutureField: { retained: true },
  };
  const normalized = storage.normalizeIdentity(source);
  assert.equal(normalized.sourceEventId, 'listenbrainz:1');
  assert.equal(normalized.identityVersion, 1);
  assert.equal(normalized.bandId, 'band-1');
  assert.equal(normalized.spotifyArtistId, 'spotify-artist');
  assert.deepEqual(normalized.unknownFutureField, { retained: true });
  assert.equal(normalized.status, 'unresolved');
  assert.equal(normalized.updatedAt, null);
});

test('canonical records default to their own source event without deleting evidence', () => {
  const normalized = storage.normalizeCanonical({
    sourceEventId: 'spotify:1',
    dedupeVersion: 1,
    evidence: { tier: 1, method: 'provider_id' },
  });
  assert.equal(normalized.sourceEventId, 'spotify:1');
  assert.equal(normalized.canonicalListenId, 'spotify:1');
  assert.equal(normalized.duplicateOf, null);
  assert.equal(normalized.status, 'unique');
  assert.deepEqual(normalized.evidence, { tier: 1, method: 'provider_id' });
});

test('invalid versions fail safely to the current initial contract version', () => {
  assert.equal(storage.normalizeIdentity({ sourceEventId: 'one', identityVersion: 0 }).identityVersion, 1);
  assert.equal(storage.normalizeCanonical({ sourceEventId: 'two', dedupeVersion: -1 }).dedupeVersion, 1);
});

test('automation cannot overwrite a reviewed band assignment', () => {
  const existing = {
    sourceEventId: 'listenbrainz:reviewed',
    identityVersion: 1,
    status: 'user_reviewed',
    bandId: 'band-approved',
    reviewedDecision: { action: 'assign_band', bandId: 'band-approved' },
    reviewedAt: '2026-08-04T10:00:00.000Z',
  };
  const incoming = {
    sourceEventId: 'listenbrainz:reviewed',
    identityVersion: 2,
    status: 'matched',
    bandId: 'band-automatic',
    reviewedDecision: null,
    reviewedAt: null,
  };
  const merged = storage.mergeDerivedRecord(existing, incoming);
  assert.equal(merged.bandId, 'band-approved');
  assert.equal(merged.identityVersion, 2);
  assert.equal(merged.status, 'user_reviewed');
  assert.deepEqual(merged.reviewedDecision, existing.reviewedDecision);
  assert.equal(merged.reviewedAt, existing.reviewedAt);
});

test('automation cannot overwrite a reviewed keep-separate decision', () => {
  const existing = {
    sourceEventId: 'listenbrainz:separate',
    status: 'user_reviewed',
    canonicalListenId: 'listenbrainz:separate',
    duplicateOf: null,
    reviewedDecision: { action: 'keep_separate' },
  };
  const incoming = {
    sourceEventId: 'listenbrainz:separate',
    status: 'duplicate',
    canonicalListenId: 'spotify:other',
    duplicateOf: 'spotify:other',
  };
  const merged = storage.mergeDerivedRecord(existing, incoming);
  assert.equal(merged.canonicalListenId, 'listenbrainz:separate');
  assert.equal(merged.duplicateOf, null);
  assert.equal(merged.status, 'user_reviewed');
});

test('unknown reviewed actions protect all user-owned relationship fields', () => {
  const existing = {
    sourceEventId: 'listenbrainz:future-review',
    status: 'user_reviewed',
    bandId: 'band-human',
    canonicalListenId: 'listenbrainz:future-review',
    duplicateOf: null,
    reviewedDecision: { action: 'future_manual_action' },
  };
  const incoming = {
    sourceEventId: 'listenbrainz:future-review',
    status: 'duplicate',
    bandId: 'band-automatic',
    canonicalListenId: 'spotify:other',
    duplicateOf: 'spotify:other',
  };
  const merged = storage.mergeDerivedRecord(existing, incoming);
  assert.equal(merged.bandId, 'band-human');
  assert.equal(merged.canonicalListenId, 'listenbrainz:future-review');
  assert.equal(merged.duplicateOf, null);
});

test('explicit reviewed replacement is possible only when requested', () => {
  const existing = {
    sourceEventId: 'listenbrainz:reviewed',
    status: 'user_reviewed',
    canonicalListenId: 'listenbrainz:reviewed',
    duplicateOf: null,
    reviewedDecision: { action: 'keep_separate' },
    reviewedAt: '2026-08-04T10:00:00.000Z',
  };
  const incoming = {
    sourceEventId: 'listenbrainz:reviewed',
    status: 'user_reviewed',
    canonicalListenId: 'spotify:approved',
    duplicateOf: 'spotify:approved',
    reviewedDecision: { action: 'merge' },
    reviewedAt: '2026-08-04T11:00:00.000Z',
  };
  const merged = storage.mergeDerivedRecord(existing, incoming, { replaceReviewedDecision: true });
  assert.deepEqual(merged.reviewedDecision, { action: 'merge' });
  assert.equal(merged.canonicalListenId, 'spotify:approved');
  assert.equal(merged.duplicateOf, 'spotify:approved');
  assert.equal(merged.reviewedAt, '2026-08-04T11:00:00.000Z');
});

test('normalization does not mutate caller-owned records', () => {
  const input = {
    sourceEventId: 'spotify:immutable',
    reviewedDecision: { action: 'keep_separate' },
    unknownFutureField: ['one'],
  };
  const normalized = storage.normalizeIdentity(input);
  normalized.reviewedDecision.action = 'changed';
  normalized.unknownFutureField.push('two');
  assert.deepEqual(input.reviewedDecision, { action: 'keep_separate' });
  assert.deepEqual(input.unknownFutureField, ['one']);
});

test('derived records require a stable source-event reference', () => {
  assert.throws(() => storage.normalizeIdentity({}), /sourceEventId/);
  assert.throws(() => storage.normalizeCanonical({}), /sourceEventId/);
});

test('identity and canonical versions remain independent', () => {
  const identity = storage.normalizeIdentity({ sourceEventId: 'listen:1', identityVersion: 3 });
  const canonical = storage.normalizeCanonical({ sourceEventId: 'listen:1', dedupeVersion: 4 });
  assert.equal(identity.identityVersion, 3);
  assert.equal(Object.hasOwn(identity, 'dedupeVersion'), false);
  assert.equal(canonical.dedupeVersion, 4);
  assert.equal(Object.hasOwn(canonical, 'identityVersion'), false);
});

test('batch normalization is bounded and rejects duplicate source IDs', () => {
  assert.deepEqual(storage.normalizeBatch(storage.IDENTITY_STORE, []), []);
  assert.throws(() => storage.normalizeBatch(storage.IDENTITY_STORE, null), /must be arrays/);
  assert.throws(() => storage.normalizeBatch(storage.IDENTITY_STORE, [
    { sourceEventId: 'same' },
    { sourceEventId: 'same' },
  ]), /cannot repeat sourceEventId/);
  const oversized = Array.from({ length: storage.MAX_BATCH_SIZE + 1 }, (_, index) => ({ sourceEventId: `listen:${index}` }));
  assert.throws(() => storage.normalizeBatch(storage.IDENTITY_STORE, oversized), /limited to 500/);
});

test('read and rollback limits remain bounded for archive-scale derived data', () => {
  assert.equal(storage.MAX_BATCH_SIZE, 500);
  assert.equal(storage.MAX_READ_LIMIT, 500);
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'listeningDerivedStorage.js'), 'utf8');
  assert.match(source, /getAll\(range, limit\)/);
  assert.doesNotMatch(source, /getAll\(\)/);
  assert.match(source, /deleted >= limit/);
  assert.match(source, /hasMore/);
});

test('schema upgrade adds only the two derived stores', () => {
  const created = [];
  const indexes = [];
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore(name, options) {
      created.push([name, options]);
      return { createIndex: (indexName, keyPath, indexOptions) => indexes.push([name, indexName, keyPath, indexOptions]) };
    },
  };
  storage.upgradeSchema(db);
  assert.deepEqual(created, [
    [storage.IDENTITY_STORE, { keyPath: 'sourceEventId' }],
    [storage.CANONICAL_STORE, { keyPath: 'sourceEventId' }],
  ]);
  assert.equal(indexes.length, 4);
  assert.equal(created.some(([name]) => name === 'listens'), false);
});

test('schema upgrade is idempotent for an already upgraded database', () => {
  const db = {
    objectStoreNames: { contains: (name) => [storage.IDENTITY_STORE, storage.CANONICAL_STORE].includes(name) },
    createObjectStore() { throw new Error('must not create an existing store'); },
  };
  assert.doesNotThrow(() => storage.upgradeSchema(db));
});
