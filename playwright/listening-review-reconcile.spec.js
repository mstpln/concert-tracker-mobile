const { test, expect } = require('@playwright/test');

function group(reviewId, options = {}) {
  const suffix = reviewId.replace(/[^a-z0-9]/gi, '-');
  return {
    reviewId,
    reviewVersion: 1,
    sourceEventIds: [`${suffix}-a`, `${suffix}-b`],
    status: 'ambiguous',
    candidatePairs: [{
      leftSourceEventId: `${suffix}-a`,
      rightSourceEventId: `${suffix}-b`,
      evidence: { tier: 6, outcome: 'ambiguous' },
    }],
    pairDecisions: options.pairDecisions || [],
    reviewedDecision: options.reviewedDecision || null,
    reviewedAt: options.reviewedDecision ? '2026-01-01T00:00:00.000Z' : null,
  };
}

test('v92 repeated preparation removes obsolete undecided review groups and preserves user decisions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const makeGroup = (reviewId, options = {}) => {
      const suffix = reviewId.replace(/[^a-z0-9]/gi, '-');
      return {
        reviewId,
        reviewVersion: 1,
        sourceEventIds: [`${suffix}-a`, `${suffix}-b`],
        status: 'ambiguous',
        candidatePairs: [{
          leftSourceEventId: `${suffix}-a`,
          rightSourceEventId: `${suffix}-b`,
          evidence: { tier: 6, outcome: 'ambiguous' },
        }],
        pairDecisions: options.pairDecisions || [],
        reviewedDecision: options.reviewedDecision || null,
        reviewedAt: options.reviewedDecision ? '2026-01-01T00:00:00.000Z' : null,
      };
    };
    const current = makeGroup('duplicate-group:current');
    const stale = makeGroup('duplicate-group:stale');
    const partial = makeGroup('duplicate-group:partial', { pairDecisions: [{ action: 'merge' }] });
    const completed = makeGroup('duplicate-group:completed', { reviewedDecision: { action: 'keep_separate' } });
    await BandmarkrListeningReviewRollout.reviewStorage.putGroups([current, stale, partial, completed]);
    const reconciliation = await BandmarkrListeningReviewReconcile.reconcileToPlan([current], { limit: 2 });
    const all = [];
    let afterReviewId = null;
    do {
      const pageResult = await BandmarkrListeningReviewRollout.reviewStorage.listGroups({ limit: 50, afterReviewId });
      all.push(...pageResult.items);
      afterReviewId = pageResult.nextAfterReviewId;
    } while (afterReviewId);
    return { reconciliation, ids: all.map((item) => item.reviewId).sort() };
  });
  expect(result.reconciliation.pages).toBeGreaterThanOrEqual(2);
  expect(result.reconciliation.removed).toBe(1);
  expect(result.ids).toEqual([
    'duplicate-group:completed',
    'duplicate-group:current',
    'duplicate-group:partial',
  ]);
});
