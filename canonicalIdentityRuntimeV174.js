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
    if (resolution.kind !== 'same' || !resolution.record) return null;
    return {
      ...resolution.record,
      name: resolution.venue,
      city: resolution.city,
      country: resolution.country,
      address: resolution.address,
    };
  }

  function canonicalVenueIdentity(value) {
    return core.canonicalVenueIdentity(value, getVenueIndex());
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

  function canonicalTopVenueVisits(concertList) {
    if (typeof root.dlVenueVisits !== 'function') return null;
    const visits = root.dlVenueVisits(concertList || []);
    const visitRecords = visits.map((visit) => {
      const records = Array.isArray(visit?.concerts) ? visit.concerts : [];
      const representative = typeof root.EventModelV156?.representativeRecord === 'function'
        ? root.EventModelV156.representativeRecord(records)
        : records[0];
      return {
        venue: String(visit?.venue || representative?.venue || '').trim(),
        city: String(visit?.city || representative?.city || '').trim(),
        country: String(representative?.country || '').trim(),
        venueAddress: representative?.venueAddress || null,
        canonicalVenueId: representative?.canonicalVenueId || null,
        date: visit?.lastDate || representative?.date || null,
      };
    });
    return canonicalVenueGroups(visitRecords)
      .map((group) => ({
        venue: group.venue,
        city: group.city,
        count: group.concerts.length,
        lastDate: group.concerts.reduce((latest, concert) => (concert?.date && (!latest || concert.date > latest) ? concert.date : latest), null),
      }))
      .sort((a, b) => b.count - a.count || (b.lastDate || '').localeCompare(a.lastDate || ''))
      .slice(0, 5);
  }

  const priorConcertStats = root.dlConcertStats;
  if (typeof priorConcertStats === 'function') {
    root.dlConcertStats = function dlConcertStatsCanonicalV174(attendedPast, bands, upcomingGoing, ...args) {
      const pastView = canonicalReadRecords(attendedPast || []);
      const upcomingView = canonicalReadRecords(upcomingGoing || []);
      const result = priorConcertStats.call(this, pastView.records, bands, upcomingView.records, ...args);
      if (!result || typeof result !== 'object') return result;
      const topVenues = canonicalTopVenueVisits(pastView.records);
      return {
        ...result,
        uniqueVenues: canonicalVenueGroups(pastView.records).length,
        topVenues: Array.isArray(topVenues) ? topVenues : result.topVenues,
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
