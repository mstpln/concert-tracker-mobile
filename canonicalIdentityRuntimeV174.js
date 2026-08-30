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

  function isPlaceholder(value) {
    const raw = String(value?.venue ?? value?.name ?? '').trim();
    return typeof root.VenueMetadataModelV158?.isPlaceholderVenueName === 'function'
      ? root.VenueMetadataModelV158.isPlaceholderVenueName(raw)
      : ['unknown venue', 'unknown', 'tba', 'tbd'].includes(raw.toLowerCase());
  }

  function metadataFor(value) {
    // Existing v158/v164 lookup semantics stay first. v174 only adds evidence
    // when the established lookup has no answer. Placeholder recovery remains
    // canonical-only and therefore must never turn ordinary metadataFor() into
    // a successful lookup.
    const prior = typeof priorVenueApi.metadataFor === 'function' ? priorVenueApi.metadataFor(value) : null;
    if (prior || isPlaceholder(value)) return prior || null;

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
    // Preserve every established v164 canonical decision exactly. The richer
    // v174 resolver is an additive fallback for historical names/locations,
    // sub-locations, provider IDs and other new evidence classes. Placeholder
    // names remain fail-closed unless the established canonical resolver has
    // already recovered one unique physical venue from stronger evidence.
    const prior = typeof priorVenueApi.canonicalVenueIdentity === 'function'
      ? priorVenueApi.canonicalVenueIdentity(value)
      : null;
    if (prior || isPlaceholder(value)) return prior || null;
    return core.canonicalVenueIdentity(value, getVenueIndex());
  }

  function richerIdentityForGroup(group) {
    const identities = (group?.concerts || [])
      .map((concert) => core.canonicalVenueIdentity(concert, getVenueIndex()))
      .filter(Boolean);
    if (!identities.length) return null;
    const keys = [...new Set(identities.map((identity) => identity.key).filter(Boolean))];
    return keys.length === 1 ? identities[0] : null;
  }

  function canonicalVenueGroups(concertList) {
    // v164 already contains important physical-venue merge semantics that are
    // broader than literal identity-key equality (same venue record, or same
    // name/address across city aliases). Keep those established groups intact.
    // v174 may then merge separate v164 groups when every member of each group
    // resolves to one identical richer canonical identity. It never splits a
    // pre-existing group and unresolved placeholders remain excluded.
    const baseGroups = typeof priorVenueApi.canonicalVenueGroups === 'function'
      ? priorVenueApi.canonicalVenueGroups(concertList || [])
      : [];
    if (!baseGroups.length) return [];

    const merged = [];
    const byRichKey = new Map();
    for (const baseGroup of baseGroups) {
      const rich = richerIdentityForGroup(baseGroup);
      if (!rich?.key) {
        merged.push({ ...baseGroup, concerts: [...(baseGroup.concerts || [])] });
        continue;
      }

      const existing = byRichKey.get(rich.key);
      if (!existing) {
        const group = {
          ...baseGroup,
          key: rich.key,
          venue: rich.venue || baseGroup.venue,
          city: rich.city || baseGroup.city,
          country: rich.country || baseGroup.country,
          record: rich.record || baseGroup.record,
          identity: rich,
          concerts: [...(baseGroup.concerts || [])],
        };
        merged.push(group);
        byRichKey.set(rich.key, group);
      } else {
        existing.concerts.push(...(baseGroup.concerts || []));
      }
    }
    return merged.sort((a, b) => a.venue.localeCompare(b.venue));
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
