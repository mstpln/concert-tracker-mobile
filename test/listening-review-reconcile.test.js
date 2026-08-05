'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reconcile = require('../listeningReviewReconcile.js');

test('preserves partial and completed user decisions', () => {
  assert.equal(reconcile.shouldPreserve({ reviewedDecision: { action: 'keep_separate' } }), true);
  assert.equal(reconcile.shouldPreserve({ pairDecisions: [{ action: 'merge' }] }), true);
  assert.equal(reconcile.shouldPreserve({ pairDecisions: [] }), false);
});

test('rollout wrapper reconciles before persisting the latest plan', async () => {
  const calls = [];
  const reviewStorage = {
    async reconcileToPlan(groups, options) { calls.push(['reconcile', groups.map((group) => group.reviewId), options.limit]); },
  };
  const rollout = {
    reviewStorage: {},
    assignOneToOne() { return { automatic: [], review: [{ id: 'candidate' }], rejectedByConflict: [] }; },
    reviewCandidateUpdates() { return [{ reviewId: 'current-group' }]; },
    async persistCandidatePlan(plan, options) {
      calls.push(['persist', plan.assignment.review.length, options.reviewStorage === reviewStorage]);
      return { assignment: plan.assignment };
    },
  };
  const originalRoot = global.BandmarkrListeningReviewRollout;
  global.BandmarkrListeningReviewRollout = rollout;
  try {
    assert.equal(reconcile.installRolloutWrapper(), true);
    await rollout.persistCandidatePlan({ candidates: [] }, { reviewStorage, batchSize: 123 });
    assert.deepEqual(calls, [
      ['reconcile', ['current-group'], 123],
      ['persist', 1, true],
    ]);
  } finally {
    global.BandmarkrListeningReviewRollout = originalRoot;
  }
});
