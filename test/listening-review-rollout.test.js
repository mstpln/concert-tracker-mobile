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

test('candidate persistence stores one grouped review record with every alternative', async () => {
  const plan = rollout.generateCandidates([
    event('a', 'spotify_import', '2026-01-02T00:00:00.000Z', { releaseMbid: 'rel-1', listenedDurationMs: 200000 }),
    event('b', 'listenbrainz', '2026-01-02T00:00:00.500Z', { releaseMbid: 'rel-1', listenedDurationMs: 200500 }),
    event('c', 'listenbrainz', '2026-01-02T00:00:00.700Z', { releaseMbid: 'rel-1', listenedDurationMs: 200700 }),
  ], { contracts });
  const writes = [];
  const storage = { async putCanonicalBatch(records) { writes.push(structuredClone(records)); } };
  const result = await rollout.persistCandidatePlan(plan, { storage, contracts, batchSize: 2 });
  assert.equal(result.written, 1);
  const record = writes.flat()[0];
  assert.equal(record.recordType, 'review_component');
  assert.equal(record.candidatePairs.length, 2);
  assert.deepEqual(record.sourceEventIds, ['a', 'b', 'c']);
});

test('review queue excludes baseline unresolved identities and includes local source context', async () => {
  const record = {
    sourceEventId: 'a', recordType: 'review_component', status: 'probable_duplicate',
    sourceEventIds: ['a', 'b'],
    candidatePairs: [{ pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b', evidence: { tier: 4 } }],
  };
  const storage = { async listCanonical() { return { items: [record], nextAfterSourceEventId: null }; } };
  const sourceReader = async () => ({
    a: event('a', 'spotify_import', '2026-01-01T00:00:00Z', { artistCreditName: 'Artist A', recordingTitle: 'Track A' }),
    b: event('b', 'listenbrainz', '2026-01-01T00:00:00.500Z', { artistCreditName: 'Artist A', recordingTitle: 'Track A' }),
  });
  const queue = await rollout.reviewQueue({ storage, sourceReader });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, 'duplicate_component');
  assert.equal(queue[0].candidatePairs[0].left.artistCreditName, 'Artist A');
});

test('merge requires one displayed pair and stores a protected user decision', async () => {
  const writes = [];
  const record = {
    sourceEventId: 'a', recordType: 'review_component', status: 'probable_duplicate', dedupeVersion: 1,
    candidatePairs: [{ pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b' }],
  };
  const storage = { async putCanonical(value) { writes.push(structuredClone(value)); return value; } };
  await rollout.applyReview({ kind: 'duplicate_component', sourceEventId: 'a', record }, 'merge', { pairKey: 'a|b' }, { storage, now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].sourceEventId, 'b');
  assert.equal(writes[0].duplicateOf, 'a');
  assert.equal(writes[1].reviewedDecision.owner, 'user');
});

test('decide later writes nothing', async () => {
  let writes = 0;
  const storage = { async putCanonical() { writes += 1; } };
  const item = { kind: 'duplicate_component', record: { sourceEventId: 'a' } };
  await rollout.applyReview(item, 'defer', {}, { storage });
  assert.equal(writes, 0);
});
