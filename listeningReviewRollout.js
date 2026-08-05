'use strict';

(function attachListeningReviewRollout(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningReviewRollout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_PAGE_SIZE = 500;
  const REVIEW_PAGE_SIZE = 50;
  const MAX_REVIEW_ITEMS = 100;
  const REVIEW_ACTIONS = Object.freeze(['merge', 'keep_separate', 'assign_band', 'reject_band', 'defer']);

  function clean(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function bounded(value, fallback, max = MAX_PAGE_SIZE) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, max);
  }

  function timestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
  }

  function eventId(event) {
    return clean(event?.sourceEventId || event?.stableListenId);
  }

  function stablePairKey(left, right) {
    return [eventId(left), eventId(right)].sort().join('|');
  }

  function representativeFor(left, right) {
    const leftId = eventId(left);
    const rightId = eventId(right);
    if (!leftId || !rightId) throw new Error('Candidate events require stable source identifiers.');
    return leftId.localeCompare(rightId) <= 0 ? leftId : rightId;
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
      .map((event) => ({ event, at: timestamp(event?.listenedAt), id: eventId(event) }))
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
        if (left.event.source && right.event.source && left.event.source === right.event.source
          && left.id !== right.id) continue;
        comparedPairs += 1;
        const evidence = contracts.matchingEvidence(left.event, right.event);
        if (!evidence?.tier || evidence.outcome === 'unique') continue;
        candidates.push({
          pairKey: stablePairKey(left.event, right.event),
          left: clone(left.event),
          right: clone(right.event),
          evidence: clone(evidence),
          representativeId: representativeFor(left.event, right.event),
        });
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
      else {
        assigned.add(leftId);
        assigned.add(rightId);
        automatic.push(candidate);
      }
    }
    for (const candidate of ordered.filter((item) => !item.evidence?.automatic)) {
      const leftId = eventId(candidate.left);
      const rightId = eventId(candidate.right);
      if (!leftId || !rightId) continue;
      if (assigned.has(leftId) || assigned.has(rightId)) rejectedByConflict.push(candidate);
      else {
        assigned.add(leftId);
        assigned.add(rightId);
        review.push(candidate);
      }
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
          ...contracts.canonicalEnvelope({
            ...event,
            sourceEventId,
            canonicalListenId,
            duplicateOf: sourceEventId === canonicalListenId ? null : canonicalListenId,
            dedupeStatus: sourceEventId === canonicalListenId ? 'unique' : 'exact_duplicate',
            dedupeMethod: candidate.evidence.method,
            dedupeEvidenceTier: candidate.evidence.tier,
          }),
          sourceEventId,
        });
      }
    }
    return updates.sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  }

  function reviewCandidateUpdates(assignment = {}, contracts = root?.BandmarkrListeningIdentityContracts) {
    if (!contracts?.canonicalEnvelope) throw new Error('Listening identity contracts are unavailable.');
    return (assignment.review || []).map((candidate) => {
      const representativeId = candidate.representativeId || representativeFor(candidate.left, candidate.right);
      const event = eventId(candidate.left) === representativeId ? candidate.right : candidate.left;
      const sourceEventId = eventId(event);
      return {
        ...contracts.canonicalEnvelope({
          ...event,
          sourceEventId,
          canonicalListenId: sourceEventId,
          duplicateOf: representativeId,
          dedupeStatus: candidate.evidence.outcome === 'probable_duplicate' ? 'probable_duplicate' : 'ambiguous',
          dedupeMethod: candidate.evidence.method,
          dedupeEvidenceTier: candidate.evidence.tier,
        }),
        sourceEventId,
      };
    }).sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  }

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
      conflictRejectedCount: assignment.rejectedByConflict.length,
      automaticCanonicalRecordCount: canonicalUpdates(assignment, options.contracts).length,
      pendingReviewRecordCount: reviewCandidateUpdates(assignment, options.contracts).length,
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
    if (!storage?.putCanonicalBatch) throw new Error('Derived listening storage is unavailable.');
    const assignment = plan.assignment || assignOneToOne(plan.candidates || []);
    const updates = [...canonicalUpdates(assignment, options.contracts), ...reviewCandidateUpdates(assignment, options.contracts)];
    for (const batch of batches(updates, options.batchSize)) await storage.putCanonicalBatch(batch);
    return { assignment, written: updates.length, batches: batches(updates, options.batchSize).length };
  }

  async function pagedRecords(listFn, options = {}) {
    const limit = bounded(options.pageSize, MAX_PAGE_SIZE);
    const maxItems = bounded(options.maxItems, MAX_REVIEW_ITEMS, 1000);
    const items = [];
    let afterSourceEventId = null;
    do {
      const page = await listFn({ limit, afterSourceEventId });
      for (const item of page?.items || []) {
        items.push(item);
        if (items.length >= maxItems) break;
      }
      afterSourceEventId = items.length >= maxItems ? null : clean(page?.nextAfterSourceEventId);
    } while (afterSourceEventId);
    return items;
  }

  async function reviewQueue(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    if (!storage?.listIdentities || !storage?.listCanonical) throw new Error('Derived listening storage is unavailable.');
    const [identities, canonical] = await Promise.all([
      pagedRecords(storage.listIdentities, { pageSize: options.pageSize || REVIEW_PAGE_SIZE, maxItems: options.maxItems }),
      pagedRecords(storage.listCanonical, { pageSize: options.pageSize || REVIEW_PAGE_SIZE, maxItems: options.maxItems }),
    ]);
    const identityItems = identities
      .filter((record) => ['unresolved', 'ambiguous', 'unmatched'].includes(record.status) && !record.reviewedDecision)
      .map((record) => ({ kind: 'identity', sourceEventId: record.sourceEventId, status: record.status, record }));
    const duplicateItems = canonical
      .filter((record) => ['probable_duplicate', 'ambiguous'].includes(record.status) && !record.reviewedDecision)
      .map((record) => ({ kind: 'duplicate', sourceEventId: record.sourceEventId, status: record.status, record }));
    return [...identityItems, ...duplicateItems]
      .sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId))
      .slice(0, bounded(options.maxItems, MAX_REVIEW_ITEMS, 1000));
  }

  function reviewedDecision(action, details = {}, now = new Date()) {
    if (!REVIEW_ACTIONS.includes(action)) throw new Error('Unsupported listening review action.');
    return { action, ...clone(details), decidedAt: now.toISOString(), owner: 'user' };
  }

  async function applyReview(item, action, details = {}, options = {}) {
    if (!REVIEW_ACTIONS.includes(action)) throw new Error('Unsupported listening review action.');
    if (action === 'defer') return clone(item?.record || null);
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const decision = reviewedDecision(action, details, options.now || new Date());
    if (item?.kind === 'identity') {
      const current = item.record || await storage.getIdentity(item.sourceEventId);
      if (!current) throw new Error('Listening identity review item no longer exists.');
      const bandId = action === 'assign_band' ? clean(details.bandId) : current.bandId;
      if (action === 'assign_band' && !bandId) throw new Error('A stable band ID is required.');
      return storage.putIdentity({
        ...current,
        bandId,
        status: 'user_reviewed',
        reviewedDecision: decision,
        reviewedAt: decision.decidedAt,
      }, { replaceReviewedDecision: true });
    }
    if (item?.kind === 'duplicate') {
      const current = item.record || await storage.getCanonical(item.sourceEventId);
      if (!current) throw new Error('Listening duplicate review item no longer exists.');
      const merge = action === 'merge';
      const target = merge ? clean(details.canonicalListenId || current.duplicateOf) : current.sourceEventId;
      if (merge && !target) throw new Error('A canonical listen target is required.');
      return storage.putCanonical({
        ...current,
        canonicalListenId: target,
        duplicateOf: merge ? target : null,
        status: 'user_reviewed',
        reviewedDecision: decision,
        reviewedAt: decision.decidedAt,
      }, { replaceReviewedDecision: true });
    }
    throw new Error('Unknown listening review item.');
  }

  async function rolloutStatus(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const checkpoint = (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.load?.()
      || migration?.defaultCheckpoint?.() || null;
    const summary = storage?.storageSummary ? await storage.storageSummary() : { identityCount: 0, canonicalCount: 0 };
    const queue = await reviewQueue({ storage, maxItems: options.maxReviewItems || MAX_REVIEW_ITEMS });
    return {
      checkpoint: clone(checkpoint),
      identityCount: Number(summary.identityCount) || 0,
      canonicalCount: Number(summary.canonicalCount) || 0,
      reviewCount: queue.length,
      complete: checkpoint?.status === 'complete' && checkpoint?.integrityStatus === 'passed',
    };
  }

  async function rollbackDerivedVersion(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const version = Number(options.version || migration?.MIGRATION_VERSION || 1);
    const limit = bounded(options.limit, MAX_PAGE_SIZE);
    const identity = await storage.deleteIdentityVersion(version, { limit });
    const canonical = await storage.deleteDedupeVersion(version, { limit });
    const done = !identity.hasMore && !canonical.hasMore;
    if (done && options.clearCheckpoint !== false) {
      (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.clear?.();
    }
    return { version, identity, canonical, done };
  }

  return {
    MAX_PAGE_SIZE,
    REVIEW_PAGE_SIZE,
    MAX_REVIEW_ITEMS,
    REVIEW_ACTIONS,
    stablePairKey,
    representativeFor,
    generateCandidates,
    assignOneToOne,
    canonicalUpdates,
    reviewCandidateUpdates,
    safeAudit,
    batches,
    persistCandidatePlan,
    pagedRecords,
    reviewQueue,
    reviewedDecision,
    applyReview,
    rolloutStatus,
    rollbackDerivedVersion,
  };
});

(function installListeningReviewSettings(root) {
  if (!root || typeof root.document === 'undefined') return;
  if (typeof artistIdentityReviewHtml !== 'function' || typeof wireArtistIdentityReview !== 'function') return;
  const originalHtml = artistIdentityReviewHtml;
  const originalWire = wireArtistIdentityReview;
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
        ? `Local preparation complete: ${processed.toLocaleString()} listens checked. ${status.reviewCount.toLocaleString()} item${status.reviewCount === 1 ? '' : 's'} need review.`
        : processed
          ? `Local preparation paused after ${processed.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} listens. It can resume safely.`
          : 'No private listening migration has been run on this device.';
      const queue = await api.reviewQueue({ maxItems: 20 });
      if (!queue.length) {
        itemsNode.innerHTML = '<p class="settings-hint" style="margin:8px 0 0">There are no uncertain listening matches to review.</p>';
        return;
      }
      itemsNode.innerHTML = queue.map((item, index) => `<div class="listening-review-item" data-listening-review-index="${index}"><div><strong>${item.kind === 'duplicate' ? 'Possible duplicate listen' : 'Unresolved artist identity'}</strong><p class="settings-hint" style="margin:3px 0 0">Kept unresolved because the evidence is not strong enough for an automatic decision.</p></div><div class="listening-review-actions"><button type="button" class="btn-secondary" data-listening-review-action="defer">Decide later</button>${item.kind === 'duplicate' ? '<button type="button" class="btn-secondary" data-listening-review-action="keep_separate">Keep separate</button><button type="button" class="btn-primary" data-listening-review-action="merge">Same listen</button>' : '<button type="button" class="btn-secondary" data-listening-review-action="reject_band">Keep unresolved</button>'}</div></div>`).join('');
      itemsNode.querySelectorAll('[data-listening-review-action]').forEach((button) => button.addEventListener('click', async () => {
        const row = button.closest('[data-listening-review-index]');
        const item = queue[Number(row?.dataset.listeningReviewIndex)];
        button.disabled = true;
        try {
          const action = button.dataset.listeningReviewAction;
          await api.applyReview(item, action);
          row.remove();
          statusNode.textContent = action === 'defer'
            ? 'This item will remain available the next time you open the review area.'
            : 'Review decision saved locally. Source listening records were not changed.';
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
