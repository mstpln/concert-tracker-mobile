'use strict';

// v166 indexed venue-metadata lookup.
// findVenueRecord itself is deliberately conservative and remains authoritative;
// this layer only reduces its input from the full venue document to records
// whose primary name or reviewed alias has the same normalized name. A record
// with a different normalized name cannot satisfy VenueMetadataModelV158's
// recordMatches contract, so this is a performance index rather than a new
// matching rule.
(function installVenueMetadataLookupPerformanceV166(root) {
  if (root.__LIVEVAULT_VENUE_METADATA_LOOKUP_PERFORMANCE_V166__) return;
  root.__LIVEVAULT_VENUE_METADATA_LOOKUP_PERFORMANCE_V166__ = true;

  const model = root.VenueMetadataModelV158;
  const prior = root.VenueMetadataV158;
  if (!model || !prior || typeof prior.getRecords !== 'function' || typeof prior.metadataFor !== 'function') return;

  let index = null;
  let indexBuilds = 0;

  function ensureIndex() {
    if (index) return index;
    const records = prior.getRecords();
    const byName = new Map();
    for (const record of records) {
      const names = new Set([
        model.normalizeIdentityText(record?.name),
        ...(Array.isArray(record?.identityAliases)
          ? record.identityAliases.map((alias) => model.normalizeIdentityText(alias?.name))
          : []),
      ].filter(Boolean));
      for (const name of names) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(record);
      }
    }
    index = byName;
    indexBuilds += 1;
    return index;
  }

  function metadataFor(value) {
    const targetName = model.normalizeIdentityText(value?.venue ?? value?.name);
    if (!targetName) return null;
    const candidates = ensureIndex().get(targetName) || [];
    return model.findVenueRecord(value, candidates);
  }

  function setRecords(records) {
    const result = prior.setRecords(records);
    index = null;
    return result;
  }

  root.VenueMetadataV158 = Object.freeze({
    ...prior,
    metadataFor,
    setRecords,
  });

  root.LiveVaultVenueMetadataLookupPerformanceV166 = Object.freeze({
    metadataFor,
    getMetrics: () => ({ indexBuilds }),
    invalidate() { index = null; },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
