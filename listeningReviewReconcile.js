'use strict';

(function attachListeningReviewReconcile(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningReviewReconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const REVIEW_DB_NAME = 'bandmarkr-listening-review-v1';
  const REVIEW_DB_VERSION = 1;
  const REVIEW_STORE = 'duplicate-review-groups';
  const MAX_PAGE_SIZE = 500;

  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const bounded = (value, fallback = MAX_PAGE_SIZE) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_PAGE_SIZE) : fallback;
  };

  function shouldPreserve(group) {
    return Boolean(group?.reviewedDecision || (Array.isArray(group?.pairDecisions) && group.pairDecisions.length));
  }

  function openReviewDb(indexedDB = root?.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('This browser does not support local listening review storage.'));
      const request = indexedDB.open(REVIEW_DB_NAME, REVIEW_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(REVIEW_STORE)) {
          const store = request.result.createObjectStore(REVIEW_STORE, { keyPath: 'reviewId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('reviewVersion', 'reviewVersion', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local listening review storage.'));
      request.onblocked = () => reject(new Error('Close other Bandmarkr tabs and retry the review storage update.'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not reconcile local listening review groups.'));
      transaction.onabort = () => reject(transaction.error || new Error('Could not reconcile local listening review groups.'));
    });
  }

  async function reconcilePage(expectedReviewIds = [], options = {}) {
    const expected = new Set((expectedReviewIds || []).map(clean).filter(Boolean));
    const afterReviewId = clean(options.afterReviewId);
    const limit = bounded(options.limit);
    const indexedDB = options.indexedDB || root?.indexedDB;
    const keyRange = options.IDBKeyRange || root?.IDBKeyRange;
    const db = await openReviewDb(indexedDB);
    let visited = 0;
    let removed = 0;
    let retainedCurrent = 0;
    let retainedReviewed = 0;
    let lastReviewId = afterReviewId;
    let hasMore = false;
    try {
      const transaction = db.transaction(REVIEW_STORE, 'readwrite');
      const store = transaction.objectStore(REVIEW_STORE);
      const range = afterReviewId && keyRange ? keyRange.lowerBound(afterReviewId, true) : undefined;
      await new Promise((resolve, reject) => {
        const request = store.openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          if (visited >= limit) {
            hasMore = true;
            return resolve();
          }
          visited += 1;
          lastReviewId = clean(cursor.primaryKey) || lastReviewId;
          if (expected.has(lastReviewId)) retainedCurrent += 1;
          else if (shouldPreserve(cursor.value)) retainedReviewed += 1;
          else {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('Could not reconcile local listening review groups.'));
      });
      await transactionDone(transaction);
      return {
        visited,
        removed,
        retainedCurrent,
        retainedReviewed,
        hasMore,
        nextAfterReviewId: hasMore ? lastReviewId : null,
      };
    } finally {
      db.close();
    }
  }

  async function reconcileToPlan(groups = [], options = {}) {
    const expectedReviewIds = (groups || []).map((group) => clean(group?.reviewId)).filter(Boolean);
    let afterReviewId = null;
    const totals = { visited: 0, removed: 0, retainedCurrent: 0, retainedReviewed: 0, pages: 0 };
    do {
      const page = await reconcilePage(expectedReviewIds, {
        ...options,
        afterReviewId,
        limit: options.limit || MAX_PAGE_SIZE,
      });
      totals.visited += page.visited;
      totals.removed += page.removed;
      totals.retainedCurrent += page.retainedCurrent;
      totals.retainedReviewed += page.retainedReviewed;
      totals.pages += 1;
      afterReviewId = page.nextAfterReviewId;
    } while (afterReviewId);
    return totals;
  }

  return {
    REVIEW_DB_NAME,
    REVIEW_DB_VERSION,
    REVIEW_STORE,
    MAX_PAGE_SIZE,
    shouldPreserve,
    openReviewDb,
    reconcilePage,
    reconcileToPlan,
  };
});
