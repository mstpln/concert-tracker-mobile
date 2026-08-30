'use strict';

(function installCanonicalIdentityRuntimeV174(root) {
  if (root.__BANDMARKR_CANONICAL_IDENTITY_RUNTIME_V174__) return;
  root.__BANDMARKR_CANONICAL_IDENTITY_RUNTIME_V174__ = true;

  const core = root.CanonicalIdentityV174;
  const priorVenueApi = root.VenueMetadataV158;
  if (!core || !priorVenueApi || typeof priorVenueApi.getRecords !== 'function') return;

  let venueIndex = null;
  let indexBuilds = 0;

  function invalidate() {
    venueIndex = null;
    indexBuilds = 0;
    if (typeof root.LiveVaultVenueNavigationPerformanceV166?.invalidate === 'function') root.LiveVaultVenueNavigationPerformanceV166.invalidate();
    if (typeof root.LiveVaultVenueNavigationRenderPerformanceV166?.invalidate === 'function') root.LiveVaultVenueNavigationRenderPerformanceV166.invalidate();
  }

  function getVenueIndex() {
    if (venueIndex) return venueIndex;
    venueIndex = core.buildVenueIndex(priorVenueApi.getRecords());
    indexBuilds += 1;
    return venueIndex;
  }

  function metadataFor(value) {
    const resolution = core.resolveCanonicalVenue(value, getVenueIndex());
    if (resolution.kind === 'same' && resolution.record) {
      return {
        ...resolution.record,
        name: resolution.venue,
        city: resolution.city,
        country: resolution.country,
        address: resolution.address,
      };
    }
    // v174 adds richer identity evidence, but must not remove the established
    // v164/v158 fail-closed recovery semantics for legacy records. In
    // particular, placeholder address recovery and raw fallback identities are
    // still authoritative when the richer resolver deliberately returns no
    // canonical record.
    return typeof priorVenueApi.metadataFor === 'function' ? priorVenueApi.metadataFor(value) : null;
  }

  function canonicalVenueIdentity(value) {
    const identity = core.canonicalVenueIdentity(value, getVenueIndex());
    if (identity) return identity;
    return typeof priorVenueApi.canonicalVenueIdentity === 'function'
      ? priorVenueApi.canonicalVenueIdentity(value)
      : null;
  }

  function canonicalVenueGroups(concertList) {
    const groups = new Map();
    for (const concert of concertList || []) {
      const identity = canonicalVenueIdentity(concert);
      if (!identity) continue;
      if (!groups.has(identity.key)) {
        groups.set(identity.key, {
          key: identity.key,
          venue: identity.venue,
          city: identity.city,
          country: identity.country,
          concerts: [],
          record: identity.record,
          identity,
        });
      }
      groups.get(identity.key).concerts.push(concert);
    }
    return [...groups.values()].sort((a, b) => a.venue.localeCompare(b.venue));
  }

  function setRecords(records) {
    const result = priorVenueApi.setRecords(records);
    invalidate();
    return result;
  }

  root.VenueMetadataV158 = Object.freeze({
    ...priorVenueApi,
    metadataFor,
    canonicalVenueIdentity,
    canonicalVenueGroups,
    setRecords,
  });

  function canonicalReadRecords(records) {
    return core.canonicalConcertReadView(records || [], getVenueIndex());
  }

  function displayUpcoming(records) {
    return (records || []).map((record) => core.displayVenueForConcert(record, getVenueIndex()));
  }

  const priorNearestPerBand = root.dlNearestPerBand;
  if (typeof priorNearestPerBand === 'function') {
    root.dlNearestPerBand = function dlNearestPerBandCanonicalV174(concerts, ...args) {
      const readView = canonicalReadRecords(concerts);
      return displayUpcoming(priorNearestPerBand.call(this, readView.records, ...args));
    };
  }

  const priorAllUpcomingForBand = root.dlAllUpcomingForBand;
  if (typeof priorAllUpcomingForBand === 'function') {
    root.dlAllUpcomingForBand = function dlAllUpcomingForBandCanonicalV174(concerts, bandId, ...args) {
      const readView = canonicalReadRecords(concerts);
      return displayUpcoming(priorAllUpcomingForBand.call(this, readView.records, bandId, ...args));
    };
  }

  const priorMyConcerts = root.dlMyConcerts;
  if (typeof priorMyConcerts === 'function') {
    root.dlMyConcerts = function dlMyConcertsCanonicalV174(concerts, ...args) {
      const readView = canonicalReadRecords(concerts);
      const result = priorMyConcerts.call(this, readView.records, ...args);
      return {
        ...result,
        upcoming: displayUpcoming(result?.upcoming || []),
        canonicalConcertConflictCount: readView.conflicts.length,
      };
    };
  }

  const priorConcertStats = root.dlConcertStats;
  if (typeof priorConcertStats === 'function') {
    root.dlConcertStats = function dlConcertStatsCanonicalV174(attendedPast, bands, upcomingGoing, ...args) {
      const pastView = canonicalReadRecords(attendedPast || []);
      const upcomingView = canonicalReadRecords(upcomingGoing || []);
      const result = priorConcertStats.call(this, pastView.records, bands, upcomingView.records, ...args);
      if (!result || typeof result !== 'object') return result;
      return {
        ...result,
        // The pre-v174 stats path already owns canonical venue visit counting.
        // Keep its top-venue multiplicities intact while using the richer v174
        // identity only for the unique-venue count and concert de-duplication.
        uniqueVenues: canonicalVenueGroups(pastView.records).length,
        canonicalConcertConflictCount: pastView.conflicts.length + upcomingView.conflicts.length,
        canonicalConcertDuplicateRowsExcluded: pastView.collapsedCount + upcomingView.collapsedCount,
      };
    };
  }

  const previousLoadDataAndShowApp = root.loadDataAndShowApp;
  if (typeof previousLoadDataAndShowApp === 'function') {
    root.loadDataAndShowApp = async function loadDataAndShowAppCanonicalIdentityV174(...args) {
      invalidate();
      return previousLoadDataAndShowApp.apply(this, args);
    };
  }

  root.CanonicalIdentityRuntimeV174 = Object.freeze({
    getVenueIndex,
    metadataFor,
    canonicalVenueIdentity,
    canonicalVenueGroups,
    canonicalReadRecords,
    invalidate,
    getMetrics: () => ({ indexBuilds }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
