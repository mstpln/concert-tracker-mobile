'use strict';

(function exposeCanonicalIdentityV174(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanonicalIdentityV174 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const baseVenueModel = root?.VenueMetadataModelV158
    || (typeof require === 'function' ? require('./venueMetadataModelV158') : null);
  const baseEventModel = root?.EventModelV156
    || (typeof require === 'function' ? require('./eventModelV156') : null);
  if (!baseVenueModel || !baseEventModel) throw new Error('CanonicalIdentityV174 requires the v158 venue model and v156 event model.');

  const USER_OWNED_FIELDS = Object.freeze([
    'attending', 'attended', 'rating', 'notes', 'ticketPrice', 'ticketQuantity', 'freeTicket', 'freeTickets',
    'ownedTickets', 'tickets', 'playlistUrl', 'playlistProgress', 'photoUrl', 'photos', 'eventGroupId',
    'lineupRole', 'setlist', 'prepChecklist', 'concertDay', 'userLinks', 'manuallyAdded',
  ]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizedText(value) {
    if (typeof baseVenueModel.normalizeIdentityText === 'function') return baseVenueModel.normalizeIdentityText(value);
    return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function canonicalCity(value) {
    if (typeof baseVenueModel.canonicalCityKey === 'function') return baseVenueModel.canonicalCityKey(value);
    return normalizedText(value);
  }

  function canonicalCountry(value) {
    let key = typeof baseVenueModel.canonicalCountryKey === 'function'
      ? baseVenueModel.canonicalCountryKey(value)
      : normalizedText(value);
    if (['usa', 'us', 'u s', 'united states of america'].includes(key)) key = 'united states';
    if (key === 'uk') key = 'united kingdom';
    return key;
  }

  function addressLines(value) {
    if (typeof baseVenueModel.addressLines === 'function') return baseVenueModel.addressLines(value);
    if (typeof value === 'string') return value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return [value.street, value.streetAddress, value.line1, value.line2, value.postalCode, value.postal, value.zip, value.city, value.country]
      .map((part) => String(part || '').trim()).filter(Boolean);
  }

  function addressText(value) {
    if (value == null) return '';
    if (typeof value === 'object' && !Array.isArray(value) && ('venueAddress' in value || 'address' in value)) {
      const venueAddress = addressLines(value.venueAddress).join(' ');
      return venueAddress || addressLines(value.address).join(' ');
    }
    return addressLines(value).join(' ');
  }

  function normalizedAddress(value) {
    return normalizedText(addressText(value));
  }

  function addressHead(value) {
    const raw = typeof value === 'string' ? value : addressText(value);
    return normalizedText(String(raw || '').split(',')[0].split('\n')[0]);
  }

  function isPlaceholderVenueName(value) {
    return typeof baseVenueModel.isPlaceholderVenueName === 'function'
      ? baseVenueModel.isPlaceholderVenueName(value)
      : ['unknown venue', 'unknown', 'tba', 'tbd'].includes(normalizedText(value));
  }

  function validFullDate(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return false;
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
  }

  function currentLocation(record) {
    const explicit = record?.currentLocation && typeof record.currentLocation === 'object' && !Array.isArray(record.currentLocation)
      ? record.currentLocation : null;
    return {
      city: String(explicit?.city ?? record?.city ?? '').trim(),
      country: String(explicit?.country ?? record?.country ?? '').trim(),
      address: clone(explicit?.address ?? explicit?.venueAddress ?? record?.address ?? null),
    };
  }

  function currentName(record) {
    return String(record?.currentName || record?.name || '').trim();
  }

  function asNamedVariant(value, kind, fallbackLocation = {}, extra = {}) {
    if (typeof value === 'string') {
      const name = value.trim();
      if (!name) return null;
      return { kind, name, city: fallbackLocation.city || '', country: fallbackLocation.country || '', address: clone(fallbackLocation.address ?? null), ...extra };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = String(value.name || value.venue || '').trim();
    if (!name) return null;
    return {
      ...clone(value),
      kind,
      name,
      city: String(value.city ?? fallbackLocation.city ?? '').trim(),
      country: String(value.country ?? fallbackLocation.country ?? '').trim(),
      address: clone(value.address ?? value.venueAddress ?? fallbackLocation.address ?? null),
      ...extra,
    };
  }

  function providerNamespace(value) {
    return normalizedText(value?.provider || value?.namespace || value?.sourceProvider || value?.source || value?.providerSource);
  }

  function providerVenueId(value) {
    return String(value?.providerVenueId || value?.venueId || value?.id || '').trim();
  }

  function providerIdentityKey(value) {
    const namespace = providerNamespace(value);
    const venueId = providerVenueId(value);
    return namespace && venueId ? `${namespace}\u001f${venueId}` : '';
  }

  function recordLocationVariants(record) {
    const current = currentLocation(record);
    const locations = [{ kind: 'current_location', ...current }];
    for (const raw of Array.isArray(record?.locationHistory) ? record.locationHistory : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      locations.push({
        ...clone(raw),
        kind: 'historical_location',
        city: String(raw.city || '').trim(),
        country: String(raw.country || '').trim(),
        address: clone(raw.address ?? raw.venueAddress ?? null),
      });
    }
    return locations;
  }

  function identityVariants(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    const current = currentLocation(record);
    const variants = [];
    const seen = new Set();
    const add = (variant) => {
      if (!variant?.name) return;
      const key = JSON.stringify([
        variant.kind || '', normalizedText(variant.name), canonicalCity(variant.city), canonicalCountry(variant.country),
        normalizedAddress(variant.address), providerIdentityKey(variant), variant.subLocationType || '',
      ]);
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(variant);
    };

    add(asNamedVariant(currentName(record), 'current', current));
    if (record.name && normalizedText(record.name) !== normalizedText(currentName(record))) {
      add(asNamedVariant(record.name, 'legacy_primary_name', { city: record.city, country: record.country, address: record.address }));
    }

    for (const alias of Array.isArray(record.identityAliases) ? record.identityAliases : []) {
      add(asNamedVariant(alias, 'identity_alias', current));
    }

    const locations = recordLocationVariants(record);
    for (const historicalName of Array.isArray(record.historicalNames) ? record.historicalNames : []) {
      const explicit = asNamedVariant(historicalName, 'historical_name', current);
      if (!explicit) continue;
      add(explicit);
      if (typeof historicalName === 'string' || (!historicalName.address && !historicalName.venueAddress && !historicalName.city)) {
        for (const location of locations) add(asNamedVariant(explicit.name, 'historical_name', location));
      }
    }

    for (const location of locations) {
      add(asNamedVariant(currentName(record), location.kind, location));
      if (location.name) add(asNamedVariant(location.name, location.kind, location));
    }

    for (const subLocation of Array.isArray(record.subLocations) ? record.subLocations : []) {
      const raw = typeof subLocation === 'string' ? { name: subLocation } : subLocation;
      const variant = asNamedVariant(raw, 'sub_location', current, {
        subLocationType: String(raw?.type || raw?.kind || 'room').trim() || 'room',
      });
      add(variant);
    }

    for (const providerIdentity of Array.isArray(record.providerIdentities) ? record.providerIdentities : []) {
      const variant = asNamedVariant(providerIdentity, 'provider_identity', current, {
        provider: providerIdentity?.provider || providerIdentity?.namespace || providerIdentity?.sourceProvider || providerIdentity?.source || null,
        providerVenueId: providerVenueId(providerIdentity) || null,
      });
      if (variant) add(variant);
    }
    return variants;
  }

  function normalizeRichRecord(record) {
    const normalized = typeof baseVenueModel.normalizeRecord === 'function'
      ? baseVenueModel.normalizeRecord(record)
      : clone(record || {});
    if (!normalized || typeof normalized !== 'object') return normalized;
    const result = { ...normalized };
    if (record?.currentName != null) result.currentName = String(record.currentName || '').trim();
    if (record?.currentLocation && typeof record.currentLocation === 'object' && !Array.isArray(record.currentLocation)) result.currentLocation = clone(record.currentLocation);
    for (const key of ['historicalNames', 'locationHistory', 'providerIdentities', 'subLocations']) {
      if (Array.isArray(record?.[key])) result[key] = clone(record[key]);
    }
    if (Array.isArray(record?.legacyVenueIds)) result.legacyVenueIds = [...new Set(record.legacyVenueIds.map((value) => String(value || '').trim()).filter(Boolean))];
    return result;
  }

  function normalizeRichDocument(records) {
    const normalized = typeof baseVenueModel.normalizeDocument === 'function'
      ? baseVenueModel.normalizeDocument(records)
      : (Array.isArray(records) ? records : []).map(normalizeRichRecord).filter(Boolean);
    return normalized.map(normalizeRichRecord).filter(Boolean);
  }

  function addUniqueIndexValue(map, key, entry) {
    if (!key) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
      return;
    }
    if (existing === entry) return;
    if (Array.isArray(existing)) {
      if (!existing.includes(entry)) existing.push(entry);
      return;
    }
    map.set(key, [existing, entry]);
  }

  function uniqueIndexLookup(map, key) {
    const value = map.get(key);
    return { entry: value && !Array.isArray(value) ? value : null, collision: Array.isArray(value) };
  }

  function buildVenueIndex(records) {
    const normalizedRecords = normalizeRichDocument(records);
    const byVenueId = new Map();
    const byLegacyVenueId = new Map();
    const byProviderIdentity = new Map();
    const byName = new Map();
    const byFullAddress = new Map();
    const byAddressHead = new Map();
    const entries = [];

    const addMapValue = (map, key, entry) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    };

    for (const record of normalizedRecords) {
      const variants = identityVariants(record).map((variant) => ({
        ...variant,
        nameKey: normalizedText(variant.name),
        cityKey: canonicalCity(variant.city),
        countryKey: canonicalCountry(variant.country),
        fullAddress: normalizedAddress(variant.address),
        addressHead: addressHead(variant.address),
        providerKey: providerIdentityKey(variant),
      }));
      const entry = { record, variants };
      entries.push(entry);
      if (record.venueId) addUniqueIndexValue(byVenueId, String(record.venueId), entry);
      for (const legacyId of Array.isArray(record.legacyVenueIds) ? record.legacyVenueIds : []) {
        if (legacyId) addUniqueIndexValue(byLegacyVenueId, String(legacyId), entry);
      }
      for (const variant of variants) {
        addMapValue(byName, variant.nameKey, entry);
        addMapValue(byFullAddress, variant.fullAddress, entry);
        addMapValue(byAddressHead, variant.addressHead, entry);
        if (variant.providerKey) addUniqueIndexValue(byProviderIdentity, variant.providerKey, entry);
      }
      for (const providerIdentity of Array.isArray(record.providerIdentities) ? record.providerIdentities : []) {
        const key = providerIdentityKey(providerIdentity);
        if (key) addUniqueIndexValue(byProviderIdentity, key, entry);
      }
    }
    return { records: normalizedRecords, entries, byVenueId, byLegacyVenueId, byProviderIdentity, byName, byFullAddress, byAddressHead };
  }

  function countriesCompatible(left, right) {
    const a = canonicalCountry(left);
    const b = canonicalCountry(right);
    return !a || !b || a === b;
  }

  function knownRecordAddresses(entry) {
    return new Set(entry.variants.map((variant) => variant.fullAddress).filter(Boolean));
  }

  function scoreVariant(value, variant, entry) {
    const targetName = normalizedText(value?.venue ?? value?.name);
    if (!targetName || targetName !== variant.nameKey) return 0;
    if (!countriesCompatible(value?.country, variant.country)) return 0;

    const sourceAddress = normalizedAddress(value?.venueAddress ?? value?.address);
    const sourceHead = addressHead(value?.venueAddress ?? value?.address);
    const sourceCity = canonicalCity(value?.city);
    const recordAddresses = knownRecordAddresses(entry);

    if (sourceAddress) {
      if (variant.fullAddress && sourceAddress === variant.fullAddress) return variant.kind === 'sub_location' ? 98 : 96;
      if (sourceHead && variant.addressHead && sourceHead === variant.addressHead) return variant.kind === 'sub_location' ? 94 : 92;
      if (recordAddresses.size) return 0;
    }

    if (sourceCity && variant.cityKey && sourceCity === variant.cityKey) {
      return variant.kind === 'sub_location' ? 88
        : variant.kind === 'historical_name' || variant.kind === 'historical_location' ? 86
          : variant.kind === 'provider_identity' ? 84 : 82;
    }
    if (sourceCity && variant.cityKey && sourceCity !== variant.cityKey) return 0;
    return variant.kind === 'sub_location' ? 72 : 68;
  }

  function uniqueBestEntry(value, entries) {
    let bestScore = 0;
    let best = null;
    let ambiguous = false;
    for (const entry of entries || []) {
      let entryScore = 0;
      let matchedVariant = null;
      for (const variant of entry.variants) {
        const score = scoreVariant(value, variant, entry);
        if (score > entryScore) {
          entryScore = score;
          matchedVariant = variant;
        }
      }
      if (!entryScore) continue;
      if (entryScore > bestScore) {
        bestScore = entryScore;
        best = { entry, variant: matchedVariant, score: entryScore };
        ambiguous = false;
      } else if (entryScore === bestScore && best?.entry?.record?.venueId !== entry.record?.venueId) {
        ambiguous = true;
      }
    }
    return best && !ambiguous ? best : null;
  }

  function exactProviderKeyFromValue(value) {
    const namespace = normalizedText(value?.providerNamespace || value?.sourceProvider || value?.provider || value?.providerSource);
    const venueId = String(value?.providerVenueId || '').trim();
    return namespace && venueId ? `${namespace}\u001f${venueId}` : '';
  }

  function resolveCanonicalVenue(value, indexOrRecords) {
    if (!value || typeof value !== 'object') return { kind: 'ambiguous', reason: 'venue_missing', record: null };
    const index = indexOrRecords?.byVenueId ? indexOrRecords : buildVenueIndex(indexOrRecords || []);

    const canonicalId = String(value.canonicalVenueId || '').trim();
    if (canonicalId && index.byVenueId.has(canonicalId)) {
      const lookup = uniqueIndexLookup(index.byVenueId, canonicalId);
      if (lookup.collision) return { kind: 'ambiguous', reason: 'canonical_venue_id_collision', record: null };
      return venueResolution(lookup.entry, null, 'canonical_venue_id');
    }
    const venueId = String(value.venueId || '').trim();
    if (venueId && index.byVenueId.has(venueId)) {
      const lookup = uniqueIndexLookup(index.byVenueId, venueId);
      if (lookup.collision) return { kind: 'ambiguous', reason: 'venue_id_collision', record: null };
      return venueResolution(lookup.entry, null, 'venue_id');
    }
    if (venueId && index.byLegacyVenueId.has(venueId)) {
      const lookup = uniqueIndexLookup(index.byLegacyVenueId, venueId);
      if (lookup.collision) return { kind: 'ambiguous', reason: 'legacy_venue_id_collision', record: null };
      return venueResolution(lookup.entry, null, 'legacy_venue_id');
    }
    if (canonicalId && index.byLegacyVenueId.has(canonicalId)) {
      const lookup = uniqueIndexLookup(index.byLegacyVenueId, canonicalId);
      if (lookup.collision) return { kind: 'ambiguous', reason: 'legacy_venue_id_collision', record: null };
      return venueResolution(lookup.entry, null, 'legacy_venue_id');
    }

    const providerKey = exactProviderKeyFromValue(value);
    if (providerKey && index.byProviderIdentity.has(providerKey)) {
      const lookup = uniqueIndexLookup(index.byProviderIdentity, providerKey);
      if (lookup.collision) return { kind: 'ambiguous', reason: 'provider_venue_id_collision', record: null };
      return venueResolution(lookup.entry, null, 'provider_venue_id');
    }

    const rawVenue = String(value.venue ?? value.name ?? '').trim();
    if (isPlaceholderVenueName(rawVenue)) {
      const full = normalizedAddress(value.venueAddress ?? value.address);
      const head = addressHead(value.venueAddress ?? value.address);
      const candidates = new Set([...(index.byFullAddress.get(full) || []), ...(index.byAddressHead.get(head) || [])]);
      if (candidates.size === 1) return venueResolution([...candidates][0], null, 'placeholder_address');
      return { kind: 'ambiguous', reason: candidates.size > 1 ? 'placeholder_address_ambiguous' : 'placeholder_unresolved', record: null };
    }
    if (!rawVenue) return { kind: 'ambiguous', reason: 'venue_name_missing', record: null };

    const nameKey = normalizedText(rawVenue);
    // One venue record can contribute several variants with the same name
    // (for example a current address plus a reviewed historical address).
    // Treat those as one candidate venue so a location conflict is not
    // mislabeled as ambiguity between different venues.
    const nameCandidates = [...new Set(index.byName.get(nameKey) || [])];
    const best = uniqueBestEntry(value, nameCandidates);
    if (best) {
      const reason = best.variant?.kind === 'sub_location' ? 'sub_location_parent'
        : best.variant?.kind === 'historical_name' ? 'historical_name'
          : best.variant?.kind === 'historical_location' ? 'historical_location'
            : best.variant?.kind === 'provider_identity' ? 'provider_identity_name'
              : best.variant?.kind === 'identity_alias' ? 'identity_alias'
                : 'canonical_name';
      return venueResolution(best.entry, best.variant, reason);
    }

    if (nameCandidates.length > 1) return { kind: 'ambiguous', reason: 'venue_name_ambiguous', record: null };
    if (nameCandidates.length === 1) {
      // A known conflicting address/city failed scoring above. Do not let a
      // unique name silently override that evidence; relocation and locality
      // continuity must be represented explicitly in the venue record.
      return { kind: 'ambiguous', reason: 'venue_location_conflict', record: null };
    }

    const city = String(value.city || '').trim();
    const country = String(value.country || '').trim();
    if (!city) return { kind: 'ambiguous', reason: 'venue_identity_incomplete', record: null };
    const rawAddressKey = normalizedAddress(value.venueAddress ?? value.address);
    return {
      kind: 'same',
      reason: 'raw_fallback',
      canonicalVenueId: null,
      key: `raw:${nameKey}|${canonicalCity(city)}|${canonicalCountry(country)}${rawAddressKey ? `|${rawAddressKey}` : ''}`,
      venue: rawVenue,
      city,
      country,
      address: clone(value.venueAddress ?? value.address ?? null),
      record: null,
      matchedVariant: null,
      roomOrStage: value.roomOrStage || value.subLocation || null,
    };
  }

  function venueResolution(entry, matchedVariant, reason) {
    const record = entry?.record || null;
    if (!record?.venueId) return { kind: 'ambiguous', reason: 'canonical_venue_id_missing', record: null };
    const location = currentLocation(record);
    const roomOrStage = matchedVariant?.kind === 'sub_location'
      ? {
        name: matchedVariant.name,
        type: matchedVariant.subLocationType || 'room',
      }
      : null;
    return {
      kind: 'same',
      reason,
      canonicalVenueId: record.venueId,
      key: `venue:${record.venueId}`,
      venue: currentName(record),
      city: location.city,
      country: location.country,
      address: clone(location.address),
      record,
      matchedVariant: matchedVariant || null,
      roomOrStage,
    };
  }

  function currentViewRecord(record) {
    if (!record) return null;
    const location = currentLocation(record);
    return {
      ...clone(record),
      name: currentName(record),
      city: location.city,
      country: location.country,
      address: clone(location.address),
    };
  }

  function findVenueRecord(value, records) {
    const resolution = resolveCanonicalVenue(value, records || []);
    return resolution.kind === 'same' && resolution.record ? currentViewRecord(resolution.record) : null;
  }

  function canonicalVenueIdentity(value, indexOrRecords) {
    const resolution = resolveCanonicalVenue(value, indexOrRecords || []);
    if (resolution.kind !== 'same') return null;
    return {
      key: resolution.key,
      canonicalVenueId: resolution.canonicalVenueId,
      venue: resolution.venue,
      city: resolution.city,
      country: resolution.country,
      address: clone(resolution.address),
      record: resolution.record ? currentViewRecord(resolution.record) : null,
      roomOrStage: resolution.roomOrStage,
      reason: resolution.reason,
    };
  }

  function canonicalVenueRelationship(first, second, indexOrRecords) {
    const left = resolveCanonicalVenue(first, indexOrRecords || []);
    const right = resolveCanonicalVenue(second, indexOrRecords || []);
    if (left.kind !== 'same' || right.kind !== 'same') return { kind: 'ambiguous', reason: 'venue_unresolved', left, right };
    if (left.key === right.key) return { kind: 'same', reason: 'canonical_venue', left, right };
    if (left.canonicalVenueId && right.canonicalVenueId) return { kind: 'distinct', reason: 'canonical_venue_conflict', left, right };
    return { kind: 'distinct', reason: 'raw_venue_conflict', left, right };
  }

  function activeVenueIndex() {
    const runtime = root?.CanonicalIdentityRuntimeV174;
    if (runtime && typeof runtime.getVenueIndex === 'function') return runtime.getVenueIndex();
    const records = root?.VenueMetadataV158?.getRecords?.();
    return buildVenueIndex(Array.isArray(records) ? records : []);
  }

  function canonicalConcertIdentity(concert, index = activeVenueIndex()) {
    const bandId = String(concert?.bandId || '').trim();
    const date = String(concert?.date || '').trim();
    if (!bandId) return { kind: 'ambiguous', reason: 'band_missing', key: null };
    if (!validFullDate(date)) return { kind: 'ambiguous', reason: 'date_missing_or_tbd', key: null };
    const venue = resolveCanonicalVenue(concert, index);
    if (venue.kind !== 'same') return { kind: 'ambiguous', reason: venue.reason, key: null, venue };
    return {
      kind: 'same',
      reason: 'band_canonical_venue_date',
      key: `concert:${bandId}\u001f${venue.key}\u001f${date}`,
      bandId,
      date,
      venue,
    };
  }

  function canonicalConcertRelationship(first, second, index = activeVenueIndex()) {
    const firstBand = String(first?.bandId || '').trim();
    const secondBand = String(second?.bandId || '').trim();
    if (!firstBand || !secondBand) return { kind: 'ambiguous', reason: 'band_missing' };
    if (firstBand !== secondBand) return { kind: 'distinct', reason: 'band_conflict' };
    const firstDate = String(first?.date || '').trim();
    const secondDate = String(second?.date || '').trim();
    if (!validFullDate(firstDate) || !validFullDate(secondDate)) return { kind: 'ambiguous', reason: 'date_missing_or_tbd' };
    if (firstDate !== secondDate) return { kind: 'distinct', reason: 'date_conflict' };
    const venue = canonicalVenueRelationship(first, second, index);
    if (venue.kind !== 'same') return venue;
    return { kind: 'same', reason: 'band_canonical_venue_date', venue };
  }

  function meaningfulUserValue(field, value) {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'boolean') return value === true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  function stableValue(value) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function userOwnedConflicts(records) {
    const conflicts = [];
    for (const field of USER_OWNED_FIELDS) {
      const values = (records || []).map((record) => record?.[field]).filter((value) => meaningfulUserValue(field, value));
      const unique = [...new Set(values.map(stableValue))];
      // lineupRole=headliner was historically a lazy default. A support value
      // is meaningful and should win without treating the default as a real
      // user contradiction.
      if (field === 'lineupRole') {
        const roles = new Set(values.map((value) => String(value || '').trim()).filter(Boolean));
        if (roles.size <= 1 || (roles.size === 2 && roles.has('headliner') && roles.has('support'))) continue;
      }
      if (unique.length > 1) conflicts.push(field);
    }
    return conflicts;
  }

  function userRichScore(record) {
    let score = 0;
    if (record?.manuallyAdded === true) score += 30;
    if (record?.attending === true || record?.attended === true) score += 25;
    if (record?.lineupRole === 'support') score += 8;
    for (const field of USER_OWNED_FIELDS) if (meaningfulUserValue(field, record?.[field])) score += 2;
    if (Array.isArray(record?.legacyConcertIds)) score += Math.min(record.legacyConcertIds.length, 5);
    return score;
  }

  function canonicalConcertReadView(concerts, index = activeVenueIndex()) {
    const groups = new Map();
    const unresolved = [];
    (concerts || []).forEach((record, sourceIndex) => {
      const identity = canonicalConcertIdentity(record, index);
      if (identity.kind !== 'same') {
        unresolved.push({ sourceIndex, record, identity });
        return;
      }
      if (!groups.has(identity.key)) groups.set(identity.key, { identity, members: [] });
      groups.get(identity.key).members.push({ sourceIndex, record });
    });

    const selected = [];
    const conflicts = [];
    for (const group of groups.values()) {
      const records = group.members.map((member) => member.record);
      const fields = userOwnedConflicts(records);
      if (fields.length) {
        conflicts.push({ key: group.identity.key, fields, ids: records.map((record) => record?.id).filter(Boolean) });
        selected.push(...group.members.map((member) => ({ ...member, record: clone(member.record) })));
        continue;
      }
      const best = [...group.members].sort((a, b) => userRichScore(b.record) - userRichScore(a.record) || a.sourceIndex - b.sourceIndex)[0];
      selected.push({ ...best, record: clone(best.record), duplicateCount: group.members.length });
    }
    selected.push(...unresolved.map((item) => ({ sourceIndex: item.sourceIndex, record: clone(item.record), duplicateCount: 1 })));
    selected.sort((a, b) => a.sourceIndex - b.sourceIndex);
    return {
      records: selected.map((item) => item.record),
      conflicts,
      canonicalGroupCount: groups.size,
      collapsedCount: Math.max(0, (concerts || []).length - selected.length),
    };
  }

  function festivalEditionIdentity(record) {
    const structured = record?.festivalEdition && typeof record.festivalEdition === 'object' && !Array.isArray(record.festivalEdition)
      ? record.festivalEdition : null;
    const explicitId = String(record?.festivalEditionId || record?.canonicalFestivalEditionId || structured?.id || structured?.key || '').trim();
    if (explicitId) {
      return {
        id: explicitId,
        key: `festival:${explicitId}`,
        name: structured?.name || record?.festivalName || null,
        year: structured?.year || record?.festivalEditionYear || null,
        primaryCanonicalVenueId: structured?.primaryCanonicalVenueId || record?.festivalPrimaryCanonicalVenueId || record?.festivalPrimaryVenueId || null,
      };
    }
    const name = String(structured?.name || record?.festivalName || '').trim();
    const year = String(structured?.year || record?.festivalEditionYear || '').trim();
    const status = normalizedText(structured?.status || structured?.identityStatus || record?.festivalIdentityStatus);
    if (name && /^\d{4}$/.test(year) && ['verified', 'confirmed', 'manual confirmed', 'manual_confirmed'].includes(status)) {
      const id = `${normalizedText(name).replace(/\s+/g, '-')}-${year}`;
      return {
        id,
        key: `festival:${id}`,
        name,
        year,
        primaryCanonicalVenueId: structured?.primaryCanonicalVenueId || record?.festivalPrimaryCanonicalVenueId || record?.festivalPrimaryVenueId || null,
      };
    }
    return null;
  }

  function hashId(prefix, key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `${prefix}${hash.toString(36).padStart(8, '0')}`;
  }

  function ordinaryEventContext(record, index = activeVenueIndex()) {
    const date = String(record?.date || '').trim();
    if (!validFullDate(date)) return null;
    const venue = resolveCanonicalVenue(record, index);
    if (venue.kind !== 'same') return null;
    const key = `${venue.key}\u001f${date}`;
    return { date, venue, key };
  }

  function validateCanonicalOrdinaryGroup(records, index = activeVenueIndex()) {
    const list = records || [];
    if (!list.length) return { valid: false, reasons: ['empty'] };
    if (list.length === 1) return { valid: true, reasons: [] };
    const contexts = list.map((record) => ordinaryEventContext(record, index));
    const reasons = [];
    if (contexts.some((context) => !context)) return { valid: false, reasons: ['canonical_context'] };
    if (new Set(contexts.map((context) => context.date)).size !== 1) reasons.push('date');
    if (new Set(contexts.map((context) => context.venue.key)).size !== 1) reasons.push('venue');
    return { valid: reasons.length === 0, reasons };
  }

  function validateFestivalGroup(records) {
    const list = records || [];
    if (!list.length) return { valid: false, reasons: ['empty'] };
    if (list.length === 1) return { valid: true, reasons: [] };
    const identities = list.map(festivalEditionIdentity);
    if (identities.some((value) => !value)) return { valid: false, reasons: ['festivalEdition'] };
    return new Set(identities.map((value) => value.key)).size === 1
      ? { valid: true, reasons: [] }
      : { valid: false, reasons: ['festivalEdition'] };
  }

  function validateExplicitGroup(records, index = activeVenueIndex()) {
    const festivals = (records || []).map(festivalEditionIdentity).filter(Boolean);
    if (festivals.length === (records || []).length && festivals.length > 0 && new Set(festivals.map((value) => value.key)).size === 1) {
      return { valid: true, reasons: [] };
    }
    return validateCanonicalOrdinaryGroup(records, index);
  }

  function groupConcertPerformances(concerts) {
    const index = activeVenueIndex();
    const groups = new Map();
    (concerts || []).forEach((concert, sourceIndex) => {
      const explicit = typeof baseEventModel.validGroupId === 'function' && baseEventModel.validGroupId(concert?.eventGroupId);
      const festival = explicit ? null : festivalEditionIdentity(concert);
      const ordinary = explicit || festival ? null : ordinaryEventContext(concert, index);
      const key = explicit ? `group:${concert.eventGroupId}`
        : festival ? `festival:${festival.key}`
          : ordinary ? `auto:${ordinary.key}`
            : `concert:${concert?.id ?? sourceIndex}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          eventGroupId: explicit ? concert.eventGroupId
            : festival ? hashId('event-festival-', festival.key)
              : ordinary ? hashId('event-auto-', ordinary.key) : null,
          relationship: explicit ? 'explicit' : festival ? 'festival' : ordinary ? 'automatic' : 'single',
          festivalEdition: festival,
          records: [], indexes: [], firstIndex: sourceIndex,
        });
      }
      const group = groups.get(key);
      group.records.push(concert);
      group.indexes.push(sourceIndex);
      if (!group.festivalEdition && festival) group.festivalEdition = festival;
    });
    return [...groups.values()].map((event) => ({
      ...event,
      validation: event.relationship === 'festival'
        ? validateFestivalGroup(event.records)
        : event.relationship === 'explicit'
          ? validateExplicitGroup(event.records, index)
          : event.relationship === 'automatic'
            ? validateCanonicalOrdinaryGroup(event.records, index)
            : { valid: true, reasons: [] },
    }));
  }

  function stablePerformanceOrder(records) {
    return typeof baseEventModel.stablePerformanceOrder === 'function'
      ? baseEventModel.stablePerformanceOrder(records)
      : [...(records || [])];
  }

  function orderPerformances(concerts) {
    const input = [...(concerts || [])];
    const output = [...input];
    for (const event of groupConcertPerformances(input)) {
      if (event.records.length < 2 || !event.validation.valid) continue;
      if (new Set(event.records.map((record) => record?.date)).size !== 1) continue;
      const ordered = stablePerformanceOrder(event.records);
      event.indexes.forEach((index, offset) => { output[index] = ordered[offset]; });
    }
    return output;
  }

  function sameCandidateContext(first, second) {
    if (!first || !second || String(first.id) === String(second.id) || !first.attending || !second.attending) return false;
    const left = ordinaryEventContext(first);
    const right = ordinaryEventContext(second);
    return !!left && !!right && left.key === right.key;
  }

  function candidateConcerts(source, concerts) {
    return (concerts || []).filter((candidate) => sameCandidateContext(source, candidate));
  }

  function cleanupSingletonGroup(concerts, groupId) {
    if (!baseEventModel.validGroupId(groupId)) return concerts;
    const members = concerts.filter((record) => record?.eventGroupId === groupId);
    if (members.length !== 1) return concerts;
    return concerts.map((record) => {
      if (record?.id !== members[0].id) return record;
      const next = { ...record }; delete next.eventGroupId; return next;
    });
  }

  function linkConcerts(concerts, sourceId, targetId, idFactory = baseEventModel.createGroupId) {
    const list = clone(concerts || []);
    const source = list.find((record) => String(record?.id) === String(sourceId));
    const target = list.find((record) => String(record?.id) === String(targetId));
    if (!source || !target || source === target) throw new Error('Choose two existing concerts.');
    if (!sameCandidateContext(source, target)) throw new Error('Only attended concerts at the same canonical venue on the same date can be linked.');
    const oldGroup = baseEventModel.validGroupId(source.eventGroupId) ? source.eventGroupId : null;
    const sameExistingGroup = baseEventModel.validGroupId(source.eventGroupId) && source.eventGroupId === target.eventGroupId;
    let groupId = sameExistingGroup ? source.eventGroupId
      : baseEventModel.validGroupId(target.eventGroupId) ? target.eventGroupId : null;
    if (!groupId) {
      const occupied = new Set(list.map((record) => record?.eventGroupId).filter(baseEventModel.validGroupId));
      for (let attempt = 0; attempt < 4 && !groupId; attempt += 1) {
        const candidate = idFactory();
        if (baseEventModel.validGroupId(candidate) && !occupied.has(candidate)) groupId = candidate;
      }
    }
    if (!baseEventModel.validGroupId(groupId)) throw new Error('Could not create a safe event relationship.');
    let next = list.map((record) => [String(sourceId), String(targetId)].includes(String(record?.id)) ? { ...record, eventGroupId: groupId } : record);
    if (oldGroup && oldGroup !== groupId) next = cleanupSingletonGroup(next, oldGroup);
    return next;
  }

  function resolveEventDistance(records) {
    const festival = (records || []).map(festivalEditionIdentity).find(Boolean);
    const primaryId = festival?.primaryCanonicalVenueId ? String(festival.primaryCanonicalVenueId) : '';
    if (primaryId) {
      const index = activeVenueIndex();
      const primary = (records || []).filter((record) => resolveCanonicalVenue(record, index).canonicalVenueId === primaryId);
      if (primary.length) return baseEventModel.resolveEventDistance(primary);
    }
    return baseEventModel.resolveEventDistance(records);
  }

  function representativeRecord(records) {
    const list = records || [];
    const festival = list.map(festivalEditionIdentity).find(Boolean);
    if (festival) {
      const index = activeVenueIndex();
      if (festival.primaryCanonicalVenueId) {
        const primary = list.filter((record) => resolveCanonicalVenue(record, index).canonicalVenueId === String(festival.primaryCanonicalVenueId));
        if (primary.length) return baseEventModel.representativeRecord(primary);
      }
      const knownDistances = list.filter((record) => typeof record?.distanceKm === 'number' && Number.isFinite(record.distanceKm) && record.distanceKm >= 0);
      if (knownDistances.length) {
        const shortest = Math.min(...knownDistances.map((record) => record.distanceKm));
        return baseEventModel.representativeRecord(knownDistances.filter((record) => record.distanceKm === shortest));
      }
    }
    return baseEventModel.representativeRecord(list);
  }

  function presentationForEvent(records) {
    const ordered = stablePerformanceOrder(records || []);
    const representative = representativeRecord(ordered);
    if (!representative) return null;
    const quantity = typeof baseEventModel.resolveEventTicketQuantity === 'function'
      ? baseEventModel.resolveEventTicketQuantity(ordered)
      : { value: representative.ticketQuantity ?? null, conflict: false };
    const ticketOwner = [representative, ...ordered].find((record, index, all) => index === all.findIndex((candidate) => candidate?.id === record?.id) && Array.isArray(record?.ownedTickets) && record.ownedTickets.length) || representative;
    return {
      ...representative,
      id: ticketOwner.id,
      ownedTickets: ticketOwner.ownedTickets,
      ticketQuantity: quantity.value,
      eventTicketQuantityConflict: quantity.conflict,
      eventPerformances: ordered.map((record) => ({ id: record.id, bandName: record.bandName, lineupRole: record.lineupRole })),
    };
  }

  function nextEventPresentation(upcoming) {
    const first = upcoming?.[0];
    if (!first) return null;
    const firstId = String(first.id);
    const event = groupConcertPerformances(upcoming || []).find((candidate) => candidate.records.some((record) => String(record?.id) === firstId));
    if (!event || event.records.length < 2 || !event.validation.valid) return first;
    if (new Set(event.records.map((record) => record?.date)).size !== 1) return first;
    return presentationForEvent(event.records);
  }

  function displayVenueForConcert(concert, index = activeVenueIndex(), today = new Date()) {
    const result = clone(concert || {});
    const date = String(concert?.date || '').trim();
    const todayKey = Number.isFinite(today?.getTime?.()) ? today.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const resolution = resolveCanonicalVenue(concert, index);
    if (resolution.kind !== 'same') return result;
    result.canonicalVenueId = resolution.canonicalVenueId || result.canonicalVenueId;
    if (resolution.roomOrStage && !result.roomOrStage) result.roomOrStage = clone(resolution.roomOrStage);
    if (!validFullDate(date) || date < todayKey) return result;
    result.venue = resolution.venue || result.venue;
    result.city = resolution.city || result.city;
    result.country = resolution.country || result.country;
    if (resolution.address) result.venueAddress = addressLines(resolution.address).join(', ') || result.venueAddress;
    return result;
  }

  const VenueModelV174 = Object.freeze({
    ...baseVenueModel,
    normalizeRecord: normalizeRichRecord,
    normalizeDocument: normalizeRichDocument,
    findVenueRecord,
    identityVariants,
    buildVenueIndex,
    resolveCanonicalVenue,
    canonicalVenueIdentity,
    canonicalVenueRelationship,
    currentName,
    currentLocation,
  });

  const EventModelV174 = Object.freeze({
    ...baseEventModel,
    validateEventGroup: validateCanonicalOrdinaryGroup,
    validateExplicitEventGroup: validateExplicitGroup,
    strongAutomaticContext: ordinaryEventContext,
    groupConcertPerformances,
    stablePerformanceOrder,
    orderPerformances,
    sameCandidateContext,
    candidateConcerts,
    linkConcerts,
    resolveEventDistance,
    representativeRecord,
    presentationForEvent,
    nextEventPresentation,
    festivalEditionIdentity,
    ordinaryEventContext,
  });

  if (root) {
    root.VenueMetadataModelV158 = VenueModelV174;
    root.EventModelV156 = EventModelV174;
  }

  return Object.freeze({
    USER_OWNED_FIELDS,
    VenueModelV174,
    EventModelV174,
    buildVenueIndex,
    resolveCanonicalVenue,
    canonicalVenueIdentity,
    canonicalVenueRelationship,
    canonicalConcertIdentity,
    canonicalConcertRelationship,
    canonicalConcertReadView,
    festivalEditionIdentity,
    ordinaryEventContext,
    displayVenueForConcert,
    userOwnedConflicts,
    validFullDate,
  });
});
