'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../listeningIdentityContracts.js');
const rollout = require('../listeningReviewRollout.js');

function event(id, source, at, extra = {}) {
  return { stableListenId: id, source, listenedAt: at, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track', ...extra };
}

test('assigns trusted exact matches one-to-one and preserves all uncertain alternatives', () => {
  const events = [
    event('a', 'spotify_import', '2026-01-01T00:00:00.000Z', { recordingMbid: 'rec-1' }),
    event('b', 'listenbrainz', '2026-01-01T00:00:00.500Z', { recordingMbid: 'rec-1' }),
    event('c', 'listenbrainz', '2026-01-01T00:00:00.700Z', { recordingMbid: 'rec-1' }),
    event('d', 'spotify_import', '2026-01-02T00:00:00.000Z', { releaseMbid: 'rel-1', listenedDurationMs: 200000 }),
    event('e', 'listenbrainz', '2026-01-02T00:00:00.500Z', { releaseMbid: 'rel-1', listenedDurationMs: 200500 }),
    event('f', 'listenbrainz', '2026-01-02T00:00:00.700Z', { releaseMbid: 'rel-1', listenedDurationMs: 200700 }),
  ];
  const plan = rollout.generateCandidates(events, { contracts });
  const assignment = rollout.assignOneToOne(plan.candidates);
  assert.equal(assignment.automatic.length, 1);
  assert.equal(assignment.review.length, 2);
  const components = rollout.reviewComponents(assignment.review);
  assert.equal(components.length, 1);
  assert.equal(components[0].candidatePairs.length, 2);
  assert.deepEqual(components[0].sourceEventIds, ['d', 'e', 'f']);
  assert.match(components[0].reviewId, /^duplicate-group:/);
  assert.equal(components[0].sourceEventIds.includes(components[0].reviewId), false);
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
  assert.equal(serialized.includes('Synthetic Artist'), false);
  assert.equal(serialized.includes('Synthetic Track'), false);
  assert.equal(serialized.includes('track-1'), false);
});

test('candidate persistence keeps review groups outside canonical storage', async () => {
  const plan = rollout.generateCandidates([
    event('a', 'spotify_import', '2026-01-02T00:00:00.000Z', { releaseMbid: 'rel-1', listenedDurationMs: 200000 }),
    event('b', 'listenbrainz', '2026-01-02T00:00:00.500Z', { releaseMbid: 'rel-1', listenedDurationMs: 200500 }),
    event('c', 'listenbrainz', '2026-01-02T00:00:00.700Z', { releaseMbid: 'rel-1', listenedDurationMs: 200700 }),
  ], { contracts });
  const canonicalWrites = [];
  const reviewWrites = [];
  const storage = { async putCanonicalBatch(records) { canonicalWrites.push(structuredClone(records)); } };
  const reviewStorage = { async putGroups(records) { reviewWrites.push(structuredClone(records)); } };
  const result = await rollout.persistCandidatePlan(plan, { storage, reviewStorage, contracts, batchSize: 2 });
  assert.equal(result.canonicalWritten, 0);
  assert.equal(result.reviewGroupsWritten, 1);
  assert.equal(canonicalWrites.length, 0);
  assert.equal(reviewWrites.flat()[0].candidatePairs.length, 2);
  assert.deepEqual(reviewWrites.flat()[0].sourceEventIds, ['a', 'b', 'c']);
});

test('review queue uses only isolated groups and includes local source context', async () => {
  const record = {
    reviewId: 'duplicate-group:a|b', status: 'probable_duplicate',
    sourceEventIds: ['a', 'b'],
    candidatePairs: [{ pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b', evidence: { tier: 4 } }],
  };
  const reviewStorage = { async listGroups() { return { items: [record], nextAfterReviewId: null }; } };
  const sourceReader = async () => ({
    a: event('a', 'spotify_import', '2026-01-01T00:00:00Z', { artistCreditName: 'Artist A', recordingTitle: 'Track A' }),
    b: event('b', 'listenbrainz', '2026-01-01T00:00:00.500Z', { artistCreditName: 'Artist A', recordingTitle: 'Track A' }),
  });
  const queue = await rollout.reviewQueue({ reviewStorage, sourceReader });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, 'duplicate_component');
  assert.equal(queue[0].candidatePairs[0].left.artistCreditName, 'Artist A');
});

test('merging one pair keeps the unresolved alternative pending', async () => {
  const canonical = new Map([
    ['a', { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null, status: 'unique' }],
    ['b', { sourceEventId: 'b', canonicalListenId: 'b', duplicateOf: null, status: 'unique' }],
    ['c', { sourceEventId: 'c', canonicalListenId: 'c', duplicateOf: null, status: 'unique' }],
  ]);
  let savedGroup;
  const record = {
    reviewId: 'duplicate-group:a|b|c', status: 'probable_duplicate', reviewVersion: 1,
    sourceEventIds: ['a', 'b', 'c'], pairDecisions: [],
    candidatePairs: [
      { pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b', evidence: { outcome: 'probable_duplicate' } },
      { pairKey: 'b|c', leftSourceEventId: 'b', rightSourceEventId: 'c', evidence: { outcome: 'probable_duplicate' } },
    ],
  };
  const storage = {
    async getCanonical(id) { return structuredClone(canonical.get(id)); },
    async putCanonical(value) { canonical.set(value.sourceEventId, structuredClone(value)); return value; },
  };
  const reviewStorage = {
    async getGroup() { return structuredClone(savedGroup || record); },
    async replaceGroup(group) { savedGroup = structuredClone(group); return group; },
    async putDecision() { throw new Error('group must remain pending'); },
  };
  await rollout.applyReview({ kind: 'duplicate_component', reviewId: record.reviewId, record }, 'merge', { pairKey: 'a|b' }, { storage, reviewStorage, now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(canonical.get('b').duplicateOf, 'a');
  assert.deepEqual(canonical.get('c'), { sourceEventId: 'c', canonicalListenId: 'c', duplicateOf: null, status: 'unique' });
  assert.equal(savedGroup.reviewedDecision, null);
  assert.equal(savedGroup.candidatePairs.length, 1);
  assert.equal(savedGroup.candidatePairs[0].pairKey, 'a|c');
  assert.equal(savedGroup.pairDecisions.length, 1);
});

test('final pair merge closes the group only after every alternative is decided', async () => {
  const canonical = new Map([
    ['a', { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null, status: 'unique' }],
    ['c', { sourceEventId: 'c', canonicalListenId: 'c', duplicateOf: null, status: 'unique' }],
  ]);
  let finalDecision;
  const record = {
    reviewId: 'duplicate-group:a|b|c', status: 'probable_duplicate', reviewVersion: 1,
    sourceEventIds: ['a', 'c'], pairDecisions: [{ action: 'merge', pairKey: 'a|b' }],
    candidatePairs: [{ pairKey: 'a|c', leftSourceEventId: 'a', rightSourceEventId: 'c', evidence: { outcome: 'probable_duplicate' } }],
  };
  const storage = {
    async getCanonical(id) { return structuredClone(canonical.get(id)); },
    async putCanonical(value) { canonical.set(value.sourceEventId, structuredClone(value)); return value; },
  };
  const reviewStorage = {
    async putDecision(id, decision) { finalDecision = { id, decision }; return { ...record, status: 'user_reviewed', reviewedDecision: decision }; },
  };
  await rollout.applyReview({ kind: 'duplicate_component', reviewId: record.reviewId, record }, 'merge', { pairKey: 'a|c' }, { storage, reviewStorage, now: new Date('2026-01-01T00:00:01Z') });
  assert.equal(canonical.get('c').duplicateOf, 'a');
  assert.equal(finalDecision.id, record.reviewId);
  assert.equal(finalDecision.decision.completedPairReview, true);
});

test('keep separate changes no canonical source record', async () => {
  let canonicalWrites = 0;
  let decisionWrites = 0;
  const record = { reviewId: 'duplicate-group:a|b', status: 'probable_duplicate', sourceEventIds: ['a', 'b'], candidatePairs: [{ pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b' }] };
  const storage = { async putCanonical() { canonicalWrites += 1; } };
  const reviewStorage = { async putDecision() { decisionWrites += 1; return { ...record, status: 'user_reviewed' }; } };
  await rollout.applyReview({ kind: 'duplicate_component', reviewId: record.reviewId, record }, 'keep_separate', {}, { storage, reviewStorage });
  assert.equal(canonicalWrites, 0);
  assert.equal(decisionWrites, 1);
});

test('rollback retains groups with user decisions', async () => {
  const result = await rollout.rollbackDerivedVersion({
    version: 1,
    storage: {
      async deleteIdentityVersion() { return { removed: 0, hasMore: false }; },
      async deleteDedupeVersion() { return { removed: 0, hasMore: false }; },
    },
    reviewStorage: { async deleteVersion() { return { removed: 1, retained: 2, hasMore: false }; } },
    checkpoints: { clear() {} },
  });
  assert.equal(result.done, true);
  assert.equal(result.review.retained, 2);
});

test('decide later writes nothing', async () => {
  let writes = 0;
  const storage = { async putCanonical() { writes += 1; } };
  const reviewStorage = { async putDecision() { writes += 1; } };
  const item = { kind: 'duplicate_component', record: { reviewId: 'duplicate-group:a|b' } };
  await rollout.applyReview(item, 'defer', {}, { storage, reviewStorage });
  assert.equal(writes, 0);
});
