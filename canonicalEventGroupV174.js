'use strict';

(function exposeCanonicalEventGroupV174(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanonicalEventGroupV174 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const sourceEventModel = root?.EventModelV156
    || (typeof require === 'function' ? require('./canonicalIdentityV174').EventModelV174 : null);
  if (!sourceEventModel) throw new Error('CanonicalEventGroupV174 requires the v174 event model.');

  function validateExplicitEventGroup(records) {
    const list = Array.isArray(records) ? records : [];
    if (!list.length) return { valid: false, reasons: ['eventGroupId'] };

    const ids = list.map((record) => {
      const value = record?.eventGroupId;
      const valid = typeof sourceEventModel.validGroupId === 'function'
        ? sourceEventModel.validGroupId(value)
        : typeof value === 'string' && value.trim().length > 0;
      return valid ? String(value).trim() : '';
    });

    if (ids.some((value) => !value) || new Set(ids).size !== 1) {
      return { valid: false, reasons: ['eventGroupId'] };
    }

    // An existing valid explicit relationship is user-owned authority. Venue,
    // date, provider listing and inferred festival context must not invalidate
    // it; those rules only apply when the app is deriving a relationship.
    return { valid: true, reasons: [] };
  }

  function groupConcertPerformances(concerts) {
    const groups = typeof sourceEventModel.groupConcertPerformances === 'function'
      ? sourceEventModel.groupConcertPerformances(concerts)
      : [];
    return groups.map((event) => event?.relationship === 'explicit'
      ? { ...event, validation: validateExplicitEventGroup(event.records) }
      : event);
  }

  function orderPerformances(concerts) {
    const input = [...(concerts || [])];
    const output = [...input];
    for (const event of groupConcertPerformances(input)) {
      if (event.records.length < 2 || !event.validation.valid) continue;
      if (new Set(event.records.map((record) => record?.date)).size !== 1) continue;
      const ordered = typeof sourceEventModel.stablePerformanceOrder === 'function'
        ? sourceEventModel.stablePerformanceOrder(event.records)
        : [...event.records];
      event.indexes.forEach((index, offset) => { output[index] = ordered[offset]; });
    }
    return output;
  }

  function nextEventPresentation(upcoming) {
    const first = upcoming?.[0];
    if (!first) return null;
    const firstId = String(first.id);
    const event = groupConcertPerformances(upcoming || [])
      .find((candidate) => candidate.records.some((record) => String(record?.id) === firstId));
    if (!event || event.records.length < 2 || !event.validation.valid) return first;
    if (new Set(event.records.map((record) => record?.date)).size !== 1) return first;
    return typeof sourceEventModel.presentationForEvent === 'function'
      ? sourceEventModel.presentationForEvent(event.records)
      : first;
  }

  const EventModelV174 = Object.freeze({
    ...sourceEventModel,
    validateExplicitEventGroup,
    groupConcertPerformances,
    orderPerformances,
    nextEventPresentation,
  });

  if (root) {
    root.EventModelV156 = EventModelV174;
    const identity = root.CanonicalIdentityV174;
    if (identity && typeof identity === 'object') {
      root.CanonicalIdentityV174 = Object.freeze({
        ...identity,
        EventModelV174,
        groupConcertPerformances,
      });
    }
  }

  return Object.freeze({
    EventModelV174,
    validateExplicitEventGroup,
    groupConcertPerformances,
  });
});
