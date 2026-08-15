'use strict';

(function exposeConflictMerge(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LiveVaultConflictMerge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function equal(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isStableIdArray(...values) {
    const items = values.flatMap((value) => Array.isArray(value) ? value : []);
    return items.length > 0 && items.every((item) => isPlainObject(item) && (typeof item.id === 'string' || typeof item.id === 'number'));
  }

  function mergeStableIdArray(base, intended, latest) {
    const baseMap = new Map(base.map((item) => [String(item.id), item]));
    const intendedMap = new Map(intended.map((item) => [String(item.id), item]));
    const latestMap = new Map(latest.map((item) => [String(item.id), item]));
    const order = [];
    for (const item of latest) order.push(String(item.id));
    for (const item of intended) if (!order.includes(String(item.id))) order.push(String(item.id));

    const merged = [];
    for (const id of order) {
      const before = baseMap.get(id);
      const local = intendedMap.get(id);
      const remote = latestMap.get(id);

      if (before !== undefined && local === undefined) {
        if (remote !== undefined && !equal(remote, before)) merged.push(clone(remote));
        continue;
      }
      if (local === undefined) {
        if (remote !== undefined) merged.push(clone(remote));
        continue;
      }
      if (before === undefined) {
        merged.push(remote === undefined ? clone(local) : mergeValue({}, local, remote));
        continue;
      }
      merged.push(mergeValue(before, local, remote === undefined ? before : remote));
    }
    return merged;
  }

  function mergeObject(base, intended, latest) {
    const output = clone(latest) || {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(intended || {})]);
    for (const key of keys) {
      const beforeHas = Object.prototype.hasOwnProperty.call(base || {}, key);
      const localHas = Object.prototype.hasOwnProperty.call(intended || {}, key);
      const remoteHas = Object.prototype.hasOwnProperty.call(latest || {}, key);

      if (beforeHas && !localHas) {
        if (!remoteHas || equal(latest[key], base[key])) delete output[key];
        continue;
      }
      if (!localHas) continue;
      if (!beforeHas) {
        output[key] = remoteHas ? mergeValue(undefined, intended[key], latest[key]) : clone(intended[key]);
        continue;
      }
      output[key] = mergeValue(base[key], intended[key], remoteHas ? latest[key] : base[key]);
    }
    return output;
  }

  function isReviewedDecision(value) {
    return isPlainObject(value) && ['manual_confirmed', 'manual_rejected'].includes(value.status);
  }

  function preserveReviewedDecisions(current, intended, path = []) {
    const isDirectMusicbrainzProvider = path.length >= 2 && path[path.length - 2] === 'musicbrainz';
    // A newer reviewed provider decision already present in bands.json owns
    // the whole provider record, even if a stale automation payload also
    // contains an older reviewed decision. Keep top-level reviewed objects
    // recursively mergeable so additive MusicBrainz metadata can still land.
    if (isReviewedDecision(current) && (!isReviewedDecision(intended) || isDirectMusicbrainzProvider)) return clone(current);
    if (Array.isArray(current) && Array.isArray(intended) && isStableIdArray(current, intended)) {
      const currentById = new Map(current.map((item) => [String(item.id), item]));
      return intended.map((item) => {
        const prior = currentById.get(String(item.id));
        return prior === undefined ? clone(item) : preserveReviewedDecisions(prior, item, path);
      });
    }
    if (isPlainObject(current) && isPlainObject(intended)) {
      const output = clone(intended) || {};
      for (const [key, value] of Object.entries(current)) {
        if (isReviewedDecision(value) && !isReviewedDecision(intended[key])) output[key] = clone(value);
        else if (Object.prototype.hasOwnProperty.call(intended, key)) output[key] = preserveReviewedDecisions(value, intended[key], [...path, key]);
      }
      return output;
    }
    return clone(intended);
  }

  function mergeValue(base, intended, latest) {
    if (equal(intended, base)) return clone(latest);
    if (equal(latest, base)) return clone(intended);

    if (base === undefined && Array.isArray(intended) && Array.isArray(latest)) base = [];
    if (base === undefined && isPlainObject(intended) && isPlainObject(latest)) base = {};

    if (isPlainObject(base) && isPlainObject(intended) && isPlainObject(latest)) return mergeObject(base, intended, latest);
    if (Array.isArray(base) && Array.isArray(intended) && Array.isArray(latest) && isStableIdArray(base, intended, latest)) {
      return mergeStableIdArray(base, intended, latest);
    }
    return clone(intended);
  }

  return { merge: mergeValue, equal, preserveReviewedDecisions };
});
