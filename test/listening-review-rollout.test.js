'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../listeningIdentityContracts.js');
const rollout = require('../listeningReviewRollout.js');

function event(id, source, at, extra = {}) {
  return { stableListenId: id, source, listenedAt: at, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track', ...extra };
}

test('assigns trusted exact matches one-to-one and leaves probable matches for review', () => {
  const events = [
    event('a', 'spotify_import', '2026-01-01T00:00:00.000Z', { recordingMbid: 'rec-1' }),
    event('b', 'listenbrainz', '2026-01-01T00:00:00.500Z', { recordingMbid: 'rec-1' }),
    event('c', 'listenbrainz', '2026-01-01T00:00:00.700Z', { recordingMbid: 'rec-1' }),
    event('d', 'spotify_import', '2026-01-02T00:00:00.000Z', { releaseMbid: 'rel-1', listenedDurationMs: 200000 }),
    event('e', 'listenbrainz', '2026-01-02T00:00:00.500Z', { releaseMbid: 'rel-1', listenedDurationMs: 200500 }),
  ];
  const plan = rollout.generateCandidates(events, { contracts });
  const assignment = rollout.assignOneToOne(plan.candidates);
  assert.equal(assignment.automatic.length, 1);
  assert.equal(assignment.rejectedByConflict.length, 1);
  assert.equal(assignment.review.length, 1);
  assert.equal(assignment.review[0].evidence.tier, 4);
  assert.equal(rollout.canonicalUpdates(assignment, contracts).length, 2);
  assert.equal(rollout.reviewCandidateUpdates(assignment, contracts).length, 1);
});

test('archive-shaped synthetic validation stays bounded instead of comparing all pairs', () => {
  const events = Array.from({ length: 250001 }, (_, index) => event(`event-${String(index).padStart(6, '0')}`, index % 2 ? 'listenbrainz' : 'spotify_import', new Date(Date.UTC(2020, 0, 1) + index * 60000).toISOString(), { spotifyTrackId: `track-${index}` }));
  const plan = rollout.generateCandidates(events, { contracts });
  assert.equal(plan.indexedEvents, 250001);
  assert.ok(plan.comparedPairs < 10);
  assert.equal(plan.candidates.length, 0);
});

test('aggregate audit excludes listening content', () => {
  const plan = rollout.generateCandidates([
    event('left', 'spotify_import', '2026-01-01T00:00:00.000Z', { spotifyTrackId: 'track-1' }),
    event('right', 'listenbrainz', '2026-01-01T00:00:00.500Z', { spotifyTrackId: 'track-1' }),
  ], { contracts });
  const audit = rollout.safeAudit({ ...plan, assignment: rollout.assignOneToOne(plan.candidates) }, { sourceCount: 2, contracts });
  const serialized = JSON.stringify(audit);
  assert.equal(audit.automaticAssignmentCount, 1);
  assert.equal(audit.automaticCanonicalRecordCount, 2);
  assert.equal(serialized.includes('Synthetic Artist'), false);
  assert.equal(serialized.includes('Synthetic Track'), false);
  assert.equal(serialized.includes('track-1'), false);
});

test('candidate persistence writes bounded canonical and review batches only', async () => {
  const plan = rollout.generateCandidates([
    event('a', 'spotify_import', '2026-01-01T00:00:00.000Z', { spotifyTrackId: 'track-1' }),
    event('b', 'listenbrainz', '2026-01-01T00:00:00.500Z', { spotifyTrackId: 'track-1' }),
    event('c', 'spotify_import', '2026-01-02T00:00:00.000Z', { releaseMbid: 'rel-1', listenedDurationMs: 200000 }),
    event('d', 'listenbrainz', '2026-01-02T00:00:00.500Z', { releaseMbid: 'rel-1', listenedDurationMs: 200500 }),
  ], { contracts });
  const writes = [];
  const storage = { async putCanonicalBatch(records) { writes.push(structuredClone(records)); } };
  const result = await rollout.persistCandidatePlan(plan, { storage, contracts, batchSize: 2 });
  assert.equal(result.written, 3);
  assert.equal(result.batches, 2);
  assert.deepEqual(writes.map((batch) => batch.length), [2, 1]);
  assert.ok(writes.flat().some((record) => record.status === 'probable_duplicate'));
  assert.ok(writes.every((batch) => batch.length <= 2));
});

test('review queue includes unresolved identity and probable duplicate records', async () => {
  const storage = {
    async listIdentities() { return { items: [{ sourceEventId: 'identity-1', status: 'unresolved' }], nextAfterSourceEventId: null }; },
    async listCanonical() { return { items: [{ sourceEventId: 'listen-2', status: 'probable_duplicate', duplicateOf: 'listen-1' }], nextAfterSourceEventId: null }; },
  };
  const queue = await rollout.reviewQueue({ storage });
  assert.deepEqual(queue.map((item) => item.kind), ['identity', 'duplicate']);
});

test('review decisions are user-owned and stored without changing source records', async () => {
  let saved;
  const item = { kind: 'duplicate', sourceEventId: 'right', record: { sourceEventId: 'right', canonicalListenId: 'right', duplicateOf: 'left', status: 'probable_duplicate' } };
  const source = structuredClone(item.record);
  const storage = { async putCanonical(record) { saved = record; return record; } };
  await rollout.applyReview(item, 'keep_separate', {}, { storage, now: new Date('2026-01-01T00:00:00Z') });
  assert.deepEqual(item.record, source);
  assert.equal(saved.canonicalListenId, 'right');
  assert.equal(saved.duplicateOf, null);
  assert.equal(saved.status, 'user_reviewed');
  assert.equal(saved.reviewedDecision.owner, 'user');
});

test('decide later is session-only and writes no reviewed decision', async () => {
  let writes = 0;
  const item = { kind: 'duplicate', sourceEventId: 'right', record: { sourceEventId: 'right', status: 'probable_duplicate' } };
  const storage = { async putCanonical() { writes += 1; } };
  const result = await rollout.applyReview(item, 'defer', {}, { storage });
  assert.equal(writes, 0);
  assert.deepEqual(result, item.record);
  assert.notEqual(result, item.record);
});
