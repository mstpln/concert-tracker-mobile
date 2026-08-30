'use strict';

// v166 indexed venue-metadata lookup, extended by v174 to index the richer
// canonical identity evidence without reintroducing full concert x venue scans.
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

  function indexedNames(record) {
    if (typeof model.identityVariants === 'function') {
      return model.identityVariants(record).map((variant) => model.normalizeIdentityText(variant?.name)).filter(Boolean);
    }
    return [
      model.normalizeIdentityText(record?.name),
      ...(Array.isArray(record?.identityAliases)
        ? record.identityAliases.map((alias) => model.normalizeIdentityText(alias?.name))
        : []),
    ].filter(Boolean);
  }

  function ensureIndex() {
    if (index) return index;
    const records = prior.getRecords();
    const byName = new Map();
    for (const record of records) {
      const names = new Set(indexedNames(record));
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
    // Build the v166 name index once so its performance instrumentation and
    // invalidation contract remain intact. v174's runtime resolver then uses
    // its own cached multi-key index for canonical IDs, legacy IDs, provider
    // IDs, historical names/locations and sub-locations.
    const byName = ensureIndex();
    if (typeof root.CanonicalIdentityRuntimeV174?.metadataFor === 'function') {
      const canonical = root.CanonicalIdentityRuntimeV174.metadataFor(value);
      if (canonical) return canonical;
    }
    const targetName = model.normalizeIdentityText(value?.venue ?? value?.name);
    if (!targetName) return null;
    const candidates = byName.get(targetName) || [];
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
