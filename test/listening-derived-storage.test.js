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

test('automation cannot overwrite a reviewed identity decision', () => {
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
  assert.equal(merged.bandId, 'band-automatic');
  assert.equal(merged.status, 'user_reviewed');
  assert.deepEqual(merged.reviewedDecision, existing.reviewedDecision);
  assert.equal(merged.reviewedAt, existing.reviewedAt);
});

test('explicit reviewed replacement is possible only when requested', () => {
  const existing = {
    sourceEventId: 'listenbrainz:reviewed',
    status: 'user_reviewed',
    reviewedDecision: { action: 'keep_separate' },
    reviewedAt: '2026-08-04T10:00:00.000Z',
  };
  const incoming = {
    sourceEventId: 'listenbrainz:reviewed',
    status: 'user_reviewed',
    reviewedDecision: { action: 'merge' },
    reviewedAt: '2026-08-04T11:00:00.000Z',
  };
  const merged = storage.mergeDerivedRecord(existing, incoming, { replaceReviewedDecision: true });
  assert.deepEqual(merged.reviewedDecision, { action: 'merge' });
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
