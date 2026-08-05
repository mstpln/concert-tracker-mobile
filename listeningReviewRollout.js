'use strict';

(function attachListeningReviewRollout(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningReviewRollout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_PAGE_SIZE = 500;
  const REVIEW_PAGE_SIZE = 50;
  const MAX_REVIEW_ITEMS = 100;
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
      components.push({
        reviewId: [...eventIds].sort()[0],
        sourceEventIds: [...eventIds].sort(),
        candidatePairs: pairs.sort(compareCandidates).map((candidate) => ({
          pairKey: candidate.pairKey,
          leftSourceEventId: eventId(candidate.left),
          rightSourceEventId: eventId(candidate.right),
          evidence: clone(candidate.evidence),
        })),
      });
    }
    return components.sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  }

  function reviewCandidateUpdates(assignment = {}, contracts = root?.BandmarkrListeningIdentityContracts) {
    if (!contracts?.canonicalEnvelope) throw new Error('Listening identity contracts are unavailable.');
    return reviewComponents(assignment.review || []).map((component) => {
      const probableOnly = component.candidatePairs.every((pair) => pair.evidence?.outcome === 'probable_duplicate');
      return {
        ...contracts.canonicalEnvelope({
          sourceEventId: component.reviewId,
          canonicalListenId: component.reviewId,
          dedupeStatus: probableOnly ? 'probable_duplicate' : 'ambiguous',
          dedupeMethod: 'manual_review_component',
          dedupeEvidenceTier: Math.min(...component.candidatePairs.map((pair) => pair.evidence?.tier || 99)),
        }),
        sourceEventId: component.reviewId,
        recordType: 'review_component',
        sourceEventIds: component.sourceEventIds,
        candidatePairs: component.candidatePairs,
      };
    });
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
    if (!storage?.putCanonicalBatch) throw new Error('Derived listening storage is unavailable.');
    const assignment = plan.assignment || assignOneToOne(plan.candidates || []);
    const updates = [...canonicalUpdates(assignment, options.contracts), ...reviewCandidateUpdates(assignment, options.contracts)];
    const chunks = batches(updates, options.batchSize);
    for (const batch of chunks) await storage.putCanonicalBatch(batch);
    return { assignment, written: updates.length, batches: chunks.length };
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

  async function sourceEventsByIds(ids = [], options = {}) {
    const uniqueIds = [...new Set(ids.map(clean).filter(Boolean))].slice(0, MAX_REVIEW_ITEMS * 4);
    if (!uniqueIds.length) return {};
    if (options.sourceReader) return options.sourceReader(uniqueIds);
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const db = await (migration?.openSourceDb?.() || Promise.reject(new Error('Source listening storage is unavailable.')));
    try {
      const store = db.transaction(migration.SOURCE_STORE, 'readonly').objectStore(migration.SOURCE_STORE);
      const entries = await Promise.all(uniqueIds.map((id) => new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve([id, request.result || null]);
        request.onerror = () => reject(request.error || new Error('Could not read local listening context.'));
      })));
      return Object.fromEntries(entries);
    } finally { db.close(); }
  }

  async function reviewQueue(options = {}) {
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    if (!storage?.listCanonical) throw new Error('Derived listening storage is unavailable.');
    const canonical = await pagedRecords(storage.listCanonical, {
      pageSize: options.pageSize || REVIEW_PAGE_SIZE,
      maxItems: options.maxItems,
    });
    const records = canonical.filter((record) => record.recordType === 'review_component'
      && ['probable_duplicate', 'ambiguous'].includes(record.status)
      && Array.isArray(record.candidatePairs) && record.candidatePairs.length
      && !record.reviewedDecision);
    const context = await sourceEventsByIds(records.flatMap((record) => record.sourceEventIds || []), options);
    return records.map((record) => ({
      kind: 'duplicate_component',
      sourceEventId: record.sourceEventId,
      status: record.status,
      record,
      candidatePairs: record.candidatePairs.map((pair) => ({
        ...pair,
        left: clone(context[pair.leftSourceEventId] || null),
        right: clone(context[pair.rightSourceEventId] || null),
      })),
    })).slice(0, bounded(options.maxItems, MAX_REVIEW_ITEMS, 1000));
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
    const current = item.record || await storage.getCanonical(item.sourceEventId);
    if (!current) throw new Error('Listening review item no longer exists.');
    const decision = reviewedDecision(action, details, options.now || new Date());
    if (action === 'merge') {
      const pair = (current.candidatePairs || []).find((candidate) => candidate.pairKey === details.pairKey);
      if (!pair) throw new Error('Choose one displayed candidate pair.');
      const target = [pair.leftSourceEventId, pair.rightSourceEventId].sort()[0];
      const duplicate = [pair.leftSourceEventId, pair.rightSourceEventId].sort()[1];
      await storage.putCanonical({
        sourceEventId: duplicate,
        canonicalListenId: target,
        duplicateOf: target,
        dedupeVersion: current.dedupeVersion || 1,
        status: 'user_reviewed',
        reviewedDecision: decision,
        reviewedAt: decision.decidedAt,
      }, { replaceReviewedDecision: true });
    }
    return storage.putCanonical({
      ...current,
      canonicalListenId: current.sourceEventId,
      duplicateOf: null,
      status: 'user_reviewed',
      reviewedDecision: decision,
      reviewedAt: decision.decidedAt,
    }, { replaceReviewedDecision: true });
  }

  async function rolloutStatus(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const storage = options.storage || root?.BandmarkrListeningDerivedStorage;
    const checkpoint = (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.load?.()
      || migration?.defaultCheckpoint?.() || null;
    const summary = storage?.storageSummary ? await storage.storageSummary() : { identityCount: 0, canonicalCount: 0 };
    const queue = await reviewQueue({ ...options, storage, maxItems: options.maxReviewItems || MAX_REVIEW_ITEMS });
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
    if (done && options.clearCheckpoint !== false) (options.checkpoints || migration?.checkpointStore?.(options.localStorage))?.clear?.();
    return { version, identity, canonical, done };
  }

  return {
    MAX_PAGE_SIZE, REVIEW_PAGE_SIZE, MAX_REVIEW_ITEMS, REVIEW_ACTIONS,
    stablePairKey, representativeFor, generateCandidates, assignOneToOne,
    canonicalUpdates, reviewComponents, reviewCandidateUpdates, safeAudit,
    batches, persistCandidatePlan, pagedRecords, sourceEventsByIds, reviewQueue,
    reviewedDecision, applyReview, rolloutStatus, rollbackDerivedVersion,
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
        : processed
          ? `Local preparation paused after ${processed.toLocaleString()}${total ? ` of ${total.toLocaleString()}` : ''} listens. It can resume safely.`
          : 'No private listening migration has been run on this device.';
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
          statusNode.textContent = action === 'defer'
            ? 'This group will remain available the next time you open the review area.'
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
