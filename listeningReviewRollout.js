'use strict';

(function attachListeningReviewRollout(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningReviewRollout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_PAGE_SIZE = 500;
  const REVIEW_PAGE_SIZE = 50;
  const MAX_REVIEW_ITEMS = 100;
  const REVIEW_DB_NAME = 'bandmarkr-listening-review-v1';
  const REVIEW_DB_VERSION = 1;
  const REVIEW_STORE = 'duplicate-review-groups';
  const REVIEW_ACTIONS = Object.freeze(['merge', 'keep_separate', 'defer']);

  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const bounded = (value, fallback, max = MAX_PAGE_SIZE) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
  };
  const eventId = (event) => clean(event?.sourceEventId || event?.stableListenId);
  const eventTime = (event) => {
    const parsed = Date.parse(event?.listenedAt || '');
    return Number.isFinite(parsed) ? parsed : null;
  };

  function requestResult(request, message) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(message));
    });
  }

  function transactionDone(tx, message) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(message));
      tx.onabort = () => reject(tx.error || new Error(message));
    });
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
      request.onblocked = () => reject(new Error('Close other Bandmarkr tabs and retry the review storage upgrade.'));
    });
  }

  function normalizeReviewGroup(group = {}) {
    const reviewId = clean(group.reviewId);
    const sourceEventIds = [...new Set((group.sourceEventIds || []).map(clean).filter(Boolean))].sort();
    const candidatePairs = (group.candidatePairs || []).map((pair) => ({
      pairKey: clean(pair.pairKey),
      leftSourceEventId: clean(pair.leftSourceEventId),
      rightSourceEventId: clean(pair.rightSourceEventId),
      evidence: clone(pair.evidence || null),
    })).filter((pair) => pair.pairKey && pair.leftSourceEventId && pair.rightSourceEventId);
    if (!reviewId || sourceEventIds.length < 2 || !candidatePairs.length) throw new Error('Listening review groups require stable candidate relationships.');
    return {
      ...clone(group),
      reviewId,
      reviewVersion: Number.isInteger(group.reviewVersion) && group.reviewVersion > 0 ? group.reviewVersion : 1,
      sourceEventIds,
      candidatePairs,
      status: clean(group.status) || 'pending',
      reviewedDecision: clone(group.reviewedDecision || null),
      reviewedAt: clean(group.reviewedAt),
    };
  }

  const reviewStorage = {
    async putGroups(groups = []) {
      if (!Array.isArray(groups) || groups.length > MAX_PAGE_SIZE) throw new Error(`Listening review batches are limited to ${MAX_PAGE_SIZE} groups.`);
      const normalized = groups.map(normalizeReviewGroup);
      const db = await openReviewDb();
      try {
        const tx = db.transaction(REVIEW_STORE, 'readwrite');
        const store = tx.objectStore(REVIEW_STORE);
        for (const group of normalized) {
          const existing = await requestResult(store.get(group.reviewId), 'Could not read local listening review group.');
          if (existing?.reviewedDecision) continue;
          store.put(group);
        }
        await transactionDone(tx, 'Could not save local listening review groups.');
        return { written: normalized.length };
      } finally { db.close(); }
    },
    async getGroup(reviewId) {
      const key = clean(reviewId);
      if (!key) return null;
      const db = await openReviewDb();
      try {
        return clone(await requestResult(db.transaction(REVIEW_STORE, 'readonly').objectStore(REVIEW_STORE).get(key), 'Could not read local listening review group.') || null);
      } finally { db.close(); }
    },
    async listGroups(options = {}) {
      const limit = bounded(options.limit, REVIEW_PAGE_SIZE);
      const afterReviewId = clean(options.afterReviewId);
      const db = await openReviewDb();
      try {
        const store = db.transaction(REVIEW_STORE, 'readonly').objectStore(REVIEW_STORE);
        const range = afterReviewId ? root.IDBKeyRange.lowerBound(afterReviewId, true) : undefined;
        const items = (await requestResult(store.getAll(range, limit), 'Could not list local listening review groups.'))
          .map(clone).sort((a, b) => a.reviewId.localeCompare(b.reviewId));
        return { items, nextAfterReviewId: items.length === limit ? items.at(-1).reviewId : null };
      } finally { db.close(); }
    },
    async putDecision(reviewId, decision) {
      const current = await this.getGroup(reviewId);
      if (!current) throw new Error('Listening review group no longer exists.');
      const updated = { ...current, status: 'user_reviewed', reviewedDecision: clone(decision), reviewedAt: decision.decidedAt };
      const db = await openReviewDb();
      try {
        const tx = db.transaction(REVIEW_STORE, 'readwrite');
        tx.objectStore(REVIEW_STORE).put(updated);
        await transactionDone(tx, 'Could not save local listening review decision.');
        return clone(updated);
      } finally { db.close(); }
    },
    async deleteVersion(version, options = {}) {
      const limit = bounded(options.limit, MAX_PAGE_SIZE);
      const db = await openReviewDb();
      let removed = 0;
      let hasMore = false;
      try {
        const tx = db.transaction(REVIEW_STORE, 'readwrite');
        const index = tx.objectStore(REVIEW_STORE).index('reviewVersion');
        await new Promise((resolve, reject) => {
          const request = index.openCursor(root.IDBKeyRange.only(Number(version) || 1));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            if (removed >= limit) { hasMore = true; return resolve(); }
            cursor.delete();
            removed += 1;
            cursor.continue();
          };
          request.onerror = () => reject(request.error || new Error('Could not roll back local listening review groups.'));
        });
        await transactionDone(tx, 'Could not roll back local listening review groups.');
        return { removed, hasMore };
      } finally { db.close(); }
    },
  };

  function stablePairKey(left, right) {
    return [eventId(left), eventId(right)].sort().join('|');
  }

  function representativeFor(left, right) {
    const ids = [eventId(left), eventId(right)].filter(Boolean).sort();
    if (ids.length !== 2) throw new Error('Candidate events require stable source identifiers.');
    return ids[0];
  }

  function compareCandidates(left, right) {
    const leftTier = Number.isInteger(left?.evidence?.tier) ? left.evidence.tier : 99;
    const rightTier = Number.isInteger(right?.evidence?.tier) ? right.evidence.tier : 99;
    return leftTier - rightTier || String(left?.pairKey || '').localeCompare(String(right?.pairKey || ''));
  }

  function generateCandidates(events = [], options = {}) {
    const contracts = options.contracts || root?.BandmarkrListeningIdentityContracts;
    if (!contracts?.matchingEvidence) throw new Error('Listening identity contracts are unavailable.');
    const toleranceMs = Number.isFinite(options.toleranceMs)
      ? Math.max(0, Number(options.toleranceMs))
      : Number(contracts.TIMESTAMP_TOLERANCE_MS) || 1000;
    const sorted = events
      .map((event) => ({ event, at: eventTime(event), id: eventId(event) }))
      .filter((entry) => entry.at !== null && entry.id)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const candidates = [];
    let comparedPairs = 0;
    let windowStart = 0;
    for (let rightIndex = 0; rightIndex < sorted.length; rightIndex += 1) {
      const right = sorted[rightIndex];
      while (windowStart < rightIndex && right.at - sorted[windowStart].at > toleranceMs) windowStart += 1;
      for (let leftIndex = windowStart; leftIndex < rightIndex; leftIndex += 1) {
        const left = sorted[leftIndex];
        if (left.event.source && right.event.source && left.event.source === right.event.source && left.id !== right.id) continue;
        comparedPairs += 1;
        const evidence = contracts.matchingEvidence(left.event, right.event);
        if (!evidence?.tier || evidence.outcome === 'unique') continue;
        candidates.push({ pairKey: stablePairKey(left.event, right.event), left: clone(left.event), right: clone(right.event), evidence: clone(evidence), representativeId: representativeFor(left.event, right.event) });
      }
    }
    return { candidates: candidates.sort(compareCandidates), comparedPairs, indexedEvents: sorted.length };
  }

  function assignOneToOne(candidates = []) {
    const assigned = new Set();
    const automatic = [];
    const review = [];
    const rejectedByConflict = [];
    const ordered = [...candidates].sort(compareCandidates);
    for (const candidate of ordered.filter((item) => item.evidence?.automatic)) {
      const leftId = eventId(candidate.left);
      const rightId = eventId(candidate.right);
      if (!leftId || !rightId) continue;
      if (assigned.has(leftId) || assigned.has(rightId)) rejectedByConflict.push(candidate);
      else { assigned.add(leftId); assigned.add(rightId); automatic.push(candidate); }
    }
    for (const candidate of ordered.filter((item) => !item.evidence?.automatic)) {
      const leftId = eventId(candidate.left);
      const rightId = eventId(candidate.right);
      if (!leftId || !rightId) continue;
      if (assigned.has(leftId) || assigned.has(rightId)) rejectedByConflict.push(candidate);
      else review.push(candidate);
    }
    return { automatic, review, rejectedByConflict };
  }

  function canonicalUpdates(assignment = {}, contracts = root?.BandmarkrListeningIdentityContracts) {
    if (!contracts?.canonicalEnvelope) throw new Error('Listening identity contracts are unavailable.');
    const updates = [];
    for (const candidate of assignment.automatic || []) {
      const canonicalListenId = candidate.representativeId || representativeFor(candidate.left, candidate.right);
      for (const event of [candidate.left, candidate.right]) {
        const sourceEventId = eventId(event);
        updates.push({
          ...contracts.canonicalEnvelope({ ...event, sourceEventId, canonicalListenId, duplicateOf: sourceEventId === canonicalListenId ? null : canonicalListenId, dedupeStatus: sourceEventId === canonicalListenId ? 'unique' : 'exact_duplicate', dedupeMethod: candidate.evidence.method, dedupeEvidenceTier: candidate.evidence.tier }),
          sourceEventId,
        });
      }
    }
    return updates.sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  }

  function reviewComponents(candidates = []) {
    const remaining = [...candidates].sort(compareCandidates);
    const components = [];
    while (remaining.length) {
      const seed = remaining.shift();
      const eventIds = new Set([eventId(seed.left), eventId(seed.right)]);
      const pairs = [seed];
      let added;
      do {
        added = false;
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const candidate = remaining[index];
          const ids = [eventId(candidate.left), eventId(candidate.right)];
          if (ids.some((id) => eventIds.has(id))) {
            pairs.push(candidate);
            ids.forEach((id) => eventIds.add(id));
            remaining.splice(index, 1);
            added = true;
          }
        }
      } while (added);
      const sortedIds = [...eventIds].sort();
      components.push({
        reviewId: `duplicate-group:${sortedIds.join('|')}`,
        reviewVersion: 1,
        sourceEventIds: sortedIds,
        status: pairs.every((pair) => pair.evidence?.outcome === 'probable_duplicate') ? 'probable_duplicate' : 'ambiguous',
        candidatePairs: pairs.sort(compareCandidates).map((candidate) => ({ pairKey: candidate.pairKey, leftSourceEventId: eventId(candidate.left), rightSourceEventId: eventId(candidate.right), evidence: clone(candidate.evidence) })),
      });
    }
    return components.sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  }

  const reviewCandidateUpdates = (assignment = {}) => reviewComponents(assignment.review || []);

  function safeAudit(plan = {}, options = {}) {
    const assignment = plan.assignment || assignOneToOne(plan.candidates || []);
    const byTier = { level1: 0, level2: 0, level3: 0, level4: 0, level5: 0, level6: 0 };
    for (const candidate of plan.candidates || []) {
      const tier = candidate?.evidence?.tier;
      if (Number.isInteger(tier) && byTier[`level${tier}`] !== undefined) byTier[`level${tier}`] += 1;
    }
    return {
      schemaVersion: 1,
      sourceEventCount: Number(options.sourceCount) || 0,
      indexedEventCount: Number(plan.indexedEvents) || 0,
      comparedPairCount: Number(plan.comparedPairs) || 0,
      candidateCount: (plan.candidates || []).length,
      candidatesByTier: byTier,
      automaticAssignmentCount: assignment.automatic.length,
      reviewCandidateCount: assignment.review.length,
      reviewComponentCount: reviewComponents(assignment.review).length,
      conflictRejectedCount: assignment.rejectedByConflict.length,
      automaticCanonicalRecordCount: canonicalUpdates(assignment, options.contracts).length,
    };
  }

  function batches(items, size = MAX_PAGE_SIZE) {
    const limit = bounded(size, MAX_PAGE_SIZE);
    const output = [];
    for (let index = 0; index < items.length; index += limit) output.push(items.slice(index, index + limit));
    return output;
  }

  async function persistCandidatePlan(plan = {}, options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const reviews = options.reviewStorage || reviewStorage;
    if (!storage?.putCanonicalBatch || !reviews?.putGroups) throw new Error('Listening derived or review storage is unavailable.');
    const assignment = plan.assignment || assignOneToOne(plan.candidates || []);
    const canonical = canonicalUpdates(assignment, options.contracts);
    const groups = reviewCandidateUpdates(assignment);
    const canonicalBatches = batches(canonical, options.batchSize);
    const reviewBatches = batches(groups, options.batchSize);
    for (const batch of canonicalBatches) await storage.putCanonicalBatch(batch);
    for (const batch of reviewBatches) await reviews.putGroups(batch);
    return { assignment, canonicalWritten: canonical.length, reviewGroupsWritten: groups.length, batches: canonicalBatches.length + reviewBatches.length };
  }

  async function sourceEventsByIds(ids = [], options = {}) {
    const uniqueIds = [...new Set(ids.map(clean).filter(Boolean))].slice(0, MAX_REVIEW_ITEMS * 4);
    if (!uniqueIds.length) return {};
    if (options.sourceReader) return options.sourceReader(uniqueIds);
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const db = await (migration?.openSourceDb?.() || Promise.reject(new Error('Source listening storage is unavailable.')));
    try {
      const store = db.transaction(migration.SOURCE_STORE, 'readonly').objectStore(migration.SOURCE_STORE);
      const entries = await Promise.all(uniqueIds.map((id) => requestResult(store.get(id), 'Could not read local listening context.').then((record) => [id, record || null])));
      return Object.fromEntries(entries);
    } finally { db.close(); }
  }

  async function reviewQueue(options = {}) {
    const reviews = options.reviewStorage || reviewStorage;
    if (!reviews?.listGroups) throw new Error('Listening review storage is unavailable.');
    const maxItems = bounded(options.maxItems, MAX_REVIEW_ITEMS, 1000);
    const records = [];
    let afterReviewId = null;
    do {
      const page = await reviews.listGroups({ limit: options.pageSize || REVIEW_PAGE_SIZE, afterReviewId });
      records.push(...(page.items || []).filter((record) => ['probable_duplicate', 'ambiguous'].includes(record.status) && !record.reviewedDecision));
      afterReviewId = records.length >= maxItems ? null : clean(page.nextAfterReviewId);
    } while (afterReviewId);
    const selected = records.slice(0, maxItems);
    const context = await sourceEventsByIds(selected.flatMap((record) => record.sourceEventIds || []), options);
    return selected.map((record) => ({
      kind: 'duplicate_component',
      reviewId: record.reviewId,
      status: record.status,
      record,
      candidatePairs: record.candidatePairs.map((pair) => ({ ...pair, left: clone(context[pair.leftSourceEventId] || null), right: clone(context[pair.rightSourceEventId] || null) })),
    }));
  }

  function reviewedDecision(action, details = {}, now = new Date()) {
    if (!REVIEW_ACTIONS.includes(action)) throw new Error('Unsupported listening review action.');
    return { action, ...clone(details), decidedAt: now.toISOString(), owner: 'user' };
  }

  async function applyReview(item, action, details = {}, options = {}) {
    if (!REVIEW_ACTIONS.includes(action)) throw new Error('Unsupported listening review action.');
    if (action === 'defer') return clone(item?.record || null);
    if (item?.kind !== 'duplicate_component') throw new Error('Unknown listening review item.');
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const reviews = options.reviewStorage || reviewStorage;
    const current = item.record || await reviews.getGroup(item.reviewId);
    if (!current) throw new Error('Listening review group no longer exists.');
    const decision = reviewedDecision(action, details, options.now || new Date());
    if (action === 'merge') {
      const pair = (current.candidatePairs || []).find((candidate) => candidate.pairKey === details.pairKey);
      if (!pair) throw new Error('Choose one displayed candidate pair.');
      const target = [pair.leftSourceEventId, pair.rightSourceEventId].sort()[0];
      const duplicate = [pair.leftSourceEventId, pair.rightSourceEventId].sort()[1];
      const existing = await storage.getCanonical(duplicate);
      if (!existing) throw new Error('Canonical source record no longer exists.');
      await storage.putCanonical({ ...existing, canonicalListenId: target, duplicateOf: target, status: 'user_reviewed', reviewedDecision: decision, reviewedAt: decision.decidedAt }, { replaceReviewedDecision: true });
    }
    return reviews.putDecision(current.reviewId, decision);
  }

  async function rolloutStatus(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const checkpoint = (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.load?.() || migration?.defaultCheckpoint?.() || null;
    const summary = storage?.storageSummary ? await storage.storageSummary() : { identityCount: 0, canonicalCount: 0 };
    const queue = await reviewQueue({ ...options, storage, maxItems: options.maxReviewItems || MAX_REVIEW_ITEMS });
    return { checkpoint: clone(checkpoint), identityCount: Number(summary.identityCount) || 0, canonicalCount: Number(summary.canonicalCount) || 0, reviewCount: queue.length, complete: checkpoint?.status === 'complete' && checkpoint?.integrityStatus === 'passed' };
  }

  async function rollbackDerivedVersion(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const reviews = options.reviewStorage || reviewStorage;
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const version = Number(options.version || migration?.MIGRATION_VERSION || 1);
    const limit = bounded(options.limit, MAX_PAGE_SIZE);
    const identity = await storage.deleteIdentityVersion(version, { limit });
    const canonical = await storage.deleteDedupeVersion(version, { limit });
    const review = reviews?.deleteVersion ? await reviews.deleteVersion(version, { limit }) : { removed: 0, hasMore: false };
    const done = !identity.hasMore && !canonical.hasMore && !review.hasMore;
    if (done && options.clearCheckpoint !== false) (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.clear?.();
    return { version, identity, canonical, review, done };
  }

  return {
    MAX_PAGE_SIZE, REVIEW_PAGE_SIZE, MAX_REVIEW_ITEMS, REVIEW_DB_NAME, REVIEW_STORE, REVIEW_ACTIONS,
    reviewStorage, stablePairKey, representativeFor, generateCandidates, assignOneToOne,
    canonicalUpdates, reviewComponents, reviewCandidateUpdates, safeAudit, batches,
    persistCandidatePlan, sourceEventsByIds, reviewQueue, reviewedDecision, applyReview,
    rolloutStatus, rollbackDerivedVersion,
  };
});

(function installListeningReviewSettings(root) {
  if (!root || typeof root.document === 'undefined') return;
  if (typeof artistIdentityReviewHtml !== 'function' || typeof wireArtistIdentityReview !== 'function') return;
  const originalHtml = artistIdentityReviewHtml;
  const originalWire = wireArtistIdentityReview;
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const eventSummary = (event) => {
    if (!event) return '<span class="settings-hint">Local source details unavailable</span>';
    const when = Number.isFinite(Date.parse(event.listenedAt || '')) ? new Date(event.listenedAt).toLocaleString() : 'Unknown time';
    return `<strong>${escapeHtml(event.artistCreditName || 'Unknown artist')} — ${escapeHtml(event.recordingTitle || 'Unknown track')}</strong><span class="settings-hint">${escapeHtml(when)} · ${escapeHtml(event.source || 'unknown source')}</span>`;
  };
  artistIdentityReviewHtml = function listeningReviewHtml() {
    return `${originalHtml()}<div id="listening-review-maintenance" class="settings-card listening-review-card" aria-live="polite"><p class="section-label" style="margin-top:0">Listening data review</p><p class="settings-hint" data-listening-review-status>Checking local derived listening data…</p><div data-listening-review-items></div></div>`;
  };
  wireArtistIdentityReview = function wireListeningReview() {
    originalWire();
    const container = document.getElementById('listening-review-maintenance');
    if (!container) return;
    const statusNode = container.querySelector('[data-listening-review-status]');
    const itemsNode = container.querySelector('[data-listening-review-items]');
    const api = root.BandmarkrListeningReviewRollout;
    api.rolloutStatus().then(async (status) => {
      const processed = Number(status.checkpoint?.processedEvents) || 0;
      const total = Number(status.checkpoint?.sourceEventCountAfter || status.checkpoint?.sourceEventCountBefore) || 0;
      statusNode.textContent = status.complete
        ? `Local preparation complete: ${processed.toLocaleString()} listens checked. ${status.reviewCount.toLocaleString()} group${status.reviewCount === 1 ? '' : 's'} need review.`
        : processed ? `Local preparation paused after ${processed.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} listens. It can resume safely.` : 'No private listening migration has been run on this device.';
      const queue = await api.reviewQueue({ maxItems: 20 });
      if (!queue.length) {
        itemsNode.innerHTML = '<p class="settings-hint" style="margin:8px 0 0">There are no uncertain listening matches to review.</p>';
        return;
      }
      itemsNode.innerHTML = queue.map((item, index) => `<div class="listening-review-item" data-listening-review-index="${index}"><div class="listening-review-context"><strong>Possible duplicate listen${item.candidatePairs.length === 1 ? '' : 's'}</strong><p class="settings-hint">Compare the local source records below. Nothing is sent anywhere.</p>${item.candidatePairs.map((pair) => `<div class="listening-review-pair" data-listening-pair="${escapeHtml(pair.pairKey)}"><div>${eventSummary(pair.left)}</div><div>${eventSummary(pair.right)}</div><button type="button" class="btn-primary" data-listening-review-action="merge" data-listening-pair-key="${escapeHtml(pair.pairKey)}">These are the same listen</button></div>`).join('')}</div><div class="listening-review-actions"><button type="button" class="btn-secondary" data-listening-review-action="defer">Decide later</button><button type="button" class="btn-secondary" data-listening-review-action="keep_separate">Keep all separate</button></div></div>`).join('');
      itemsNode.querySelectorAll('[data-listening-review-action]').forEach((button) => button.addEventListener('click', async () => {
        const row = button.closest('[data-listening-review-index]');
        const item = queue[Number(row?.dataset.listeningReviewIndex)];
        button.disabled = true;
        try {
          const action = button.dataset.listeningReviewAction;
          await api.applyReview(item, action, { pairKey: button.dataset.listeningPairKey || null });
          row.remove();
          statusNode.textContent = action === 'defer' ? 'This group will remain available the next time you open the review area.' : 'Review decision saved locally. Source listening records were not changed.';
        } catch (_) {
          statusNode.textContent = 'The decision could not be saved. Nothing was changed.';
          button.disabled = false;
        }
      }));
    }).catch(() => {
      statusNode.textContent = 'Local listening review is unavailable on this device. No data was changed.';
      itemsNode.innerHTML = '';
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
