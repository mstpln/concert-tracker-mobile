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

  function invalidateCaches() {
    index = null;
    if (typeof root.LiveVaultVenueNavigationPerformanceV166?.invalidate === 'function') {
      root.LiveVaultVenueNavigationPerformanceV166.invalidate();
    }
    if (typeof root.LiveVaultVenueNavigationRenderPerformanceV166?.invalidate === 'function') {
      root.LiveVaultVenueNavigationRenderPerformanceV166.invalidate();
    }
  }

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
    invalidateCaches();
    return result;
  }

  root.VenueMetadataV158 = Object.freeze({
    ...prior,
    metadataFor,
    setRecords,
  });

  // v158's refresh wrapper closes over its original local setRecords function,
  // so replacing VenueMetadataV158.setRecords alone cannot observe a normal app
  // Refresh. Clear the v166 indexes before delegating so the v158 loader can
  // replace venueRecords and any rendering during that load rebuilds from the
  // freshly loaded document rather than an earlier indexed snapshot.
  const previousLoadDataAndShowApp = root.loadDataAndShowApp;
  if (typeof previousLoadDataAndShowApp === 'function') {
    root.loadDataAndShowApp = async function loadDataAndShowAppVenueMetadataLookupV166(...args) {
      invalidateCaches();
      return previousLoadDataAndShowApp.apply(this, args);
    };
  }

  root.LiveVaultVenueMetadataLookupPerformanceV166 = Object.freeze({
    metadataFor,
    getMetrics: () => ({ indexBuilds }),
    invalidate: invalidateCaches,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
