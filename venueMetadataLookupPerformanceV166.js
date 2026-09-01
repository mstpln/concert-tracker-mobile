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
  let indexRevision = null;
  let indexBuilds = 0;

  function invalidateCaches() {
    index = null;
    indexRevision = null;
    indexBuilds = 0;
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
    const revision = typeof prior.getRevision === 'function' ? prior.getRevision() : null;
    if (index && (revision == null || indexRevision === revision)) return index;
    const records = prior.getRecords();
    const byName = new Map();
    const byVenueId = new Map();
    const ambiguousVenueIds = new Set();
    for (const record of records) {
      const names = new Set(indexedNames(record));
      for (const name of names) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(record);
      }
      const ids = new Set([
        record?.venueId,
        ...(Array.isArray(record?.legacyVenueIds) ? record.legacyVenueIds : []),
      ].map((value) => String(value || '').trim()).filter(Boolean));
      for (const venueId of ids) {
        const existing = byVenueId.get(venueId);
        if (existing && existing?.venueId !== record?.venueId) {
          ambiguousVenueIds.add(venueId);
          byVenueId.delete(venueId);
        } else if (!ambiguousVenueIds.has(venueId)) {
          byVenueId.set(venueId, record);
        }
      }
    }
    index = { byName, byVenueId, ambiguousVenueIds };
    indexRevision = revision;
    indexBuilds += 1;
    return index;
  }

  function metadataFor(value) {
    // Migrated v176 concert rows may already carry the authoritative canonical
    // venue stable ID even when their historical/raw venue wording, city or
    // address intentionally differs from the current venue record. Resolve
    // that stable identity in O(1) before any text/evidence fallback. Legacy
    // IDs are accepted only when ownership is unique in the venue document.
    const { byName, byVenueId } = ensureIndex();
    const canonicalVenueId = String(value?.canonicalVenueId || '').trim();
    if (canonicalVenueId) {
      const canonicalRecord = byVenueId.get(canonicalVenueId);
      if (canonicalRecord) return canonicalRecord;
    }

    // Keep the indexed v166 lookup on the hot path. Calling the v174 runtime
    // first would delegate to v158's original full-record scan for every
    // concert, recreating the concert x venue regression that v166 removed.
    // Only fall through to v174 when established indexed name/alias evidence
    // has no answer, so richer historical/provider/sub-location evidence stays
    // additive without penalizing ordinary current-venue reads.
    const targetName = model.normalizeIdentityText(value?.venue ?? value?.name);
    if (targetName) {
      const candidates = byName.get(targetName) || [];
      const established = model.findVenueRecord(value, candidates);
      if (established) return established;
    }
    if (typeof root.CanonicalIdentityRuntimeV174?.richMetadataFallback === 'function') {
      return root.CanonicalIdentityRuntimeV174.richMetadataFallback(value);
    }
    if (typeof root.CanonicalIdentityRuntimeV174?.metadataFor === 'function') {
      return root.CanonicalIdentityRuntimeV174.metadataFor(value);
    }
    return null;
  }

  function setRecords(records) {
    return prior.setRecords(records);
  }

  root.VenueMetadataV158 = Object.freeze({
    ...prior,
    metadataFor,
    setRecords,
  });

  root.LiveVaultVenueMetadataLookupPerformanceV166 = Object.freeze({
    metadataFor,
    getMetrics: () => ({ indexBuilds }),
    invalidate: invalidateCaches,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
