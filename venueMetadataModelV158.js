'use strict';

(function attachVenueMetadataModelV158(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VenueMetadataModelV158 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const RESEARCH_STATUSES = new Set(['complete', 'partial', 'unresolved', 'temporary_error', 'review_needed']);
  const MAX_DESCRIPTION_LENGTH = 900;

  function normalizeIdentityText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function fnv1a32(value) {
    let hash = 0x811c9dc5;
    for (const ch of String(value || '')) {
      hash ^= ch.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function identityParts(value) {
    return {
      name: normalizeIdentityText(value?.name ?? value?.venue),
      city: normalizeIdentityText(value?.city),
      country: normalizeIdentityText(value?.country),
      address: normalizeIdentityText(value?.address ?? value?.venueAddress),
    };
  }

  function identityKey(value) {
    const parts = identityParts(value);
    return parts.name && parts.city ? `${parts.name}|${parts.city}|${parts.country}` : '';
  }

  function venueIdFor(value) {
    const key = identityKey(value);
    return key ? `venue-${fnv1a32(key)}` : null;
  }

  function venueIdForAddressVariant(value) {
    const parts = identityParts(value);
    const key = identityKey(value);
    return key && parts.address ? `venue-${fnv1a32(`${key}|${parts.address}`)}` : venueIdFor(value);
  }

  function validCapacity(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function formatCapacity(value) {
    if (!validCapacity(value)) return '';
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function capacityLabel(value) {
    const formatted = formatCapacity(value);
    return formatted ? `Max Capacity: ${formatted}` : '';
  }

  function safeOfficialUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value).trim());
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function addressLines(address) {
    if (!address) return [];
    if (typeof address === 'string') {
      return address.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    if (!address || typeof address !== 'object' || Array.isArray(address)) return [];
    const street = String(address.street || address.streetAddress || address.line1 || '').trim();
    const second = String(address.line2 || '').trim();
    const locality = [address.postalCode || address.postal || address.zip, address.city].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
    const country = String(address.country || '').trim();
    return [street, second, locality, country].filter(Boolean);
  }

  function recordIsValid(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    if (typeof record.venueId !== 'string' || !/^venue-[a-f0-9]{8}$/.test(record.venueId)) return false;
    if (typeof record.name !== 'string' || !record.name.trim()) return false;
    if (typeof record.city !== 'string' || !record.city.trim()) return false;
    if (record.country != null && typeof record.country !== 'string') return false;
    if (record.address != null && !addressLines(record.address).length) return false;
    if (record.maxCapacity != null && !validCapacity(record.maxCapacity)) return false;
    if (record.officialUrl != null && !safeOfficialUrl(record.officialUrl)) return false;
    if (record.description != null && (typeof record.description !== 'string' || !record.description.trim() || record.description.trim().length > MAX_DESCRIPTION_LENGTH)) return false;
    if (record.researchStatus != null && !RESEARCH_STATUSES.has(record.researchStatus)) return false;
    if (record.researchedAt != null && (typeof record.researchedAt !== 'string' || !Number.isFinite(Date.parse(record.researchedAt)))) return false;
    if (record.sources != null && (!Array.isArray(record.sources) || record.sources.length > 16 || record.sources.some((url) => !safeOfficialUrl(url)))) return false;
    if (record.schemaVersion != null && record.schemaVersion !== 1) return false;
    return true;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const normalized = { ...record };
    normalized.name = String(record.name || '').trim();
    normalized.city = String(record.city || '').trim();
    if (record.country != null) normalized.country = String(record.country).trim();
    if (!normalized.venueId) normalized.venueId = venueIdFor(normalized);
    if (record.description != null) normalized.description = String(record.description).trim();
    if (record.officialUrl != null) normalized.officialUrl = safeOfficialUrl(record.officialUrl);
    return recordIsValid(normalized) ? normalized : null;
  }

  function normalizeDocument(records) {
    if (!Array.isArray(records)) return [];
    const seen = new Set();
    const out = [];
    for (const record of records) {
      const normalized = normalizeRecord(record);
      if (!normalized || seen.has(normalized.venueId)) continue;
      seen.add(normalized.venueId);
      out.push(normalized);
    }
    return out;
  }

  function findVenueRecord(value, records) {
    const target = identityParts(value);
    if (!target.name || !target.city) return null;
    let matches = (records || []).filter((record) => {
      const parts = identityParts(record);
      if (parts.name !== target.name || parts.city !== target.city) return false;
      if (parts.country && target.country && parts.country !== target.country) return false;
      if (parts.address && target.address && parts.address !== target.address) return false;
      return true;
    });
    if (matches.length <= 1) return matches[0] || null;

    if (target.country) {
      const countryMatches = matches.filter((record) => identityParts(record).country === target.country);
      if (countryMatches.length === 1) return countryMatches[0];
      if (countryMatches.length) matches = countryMatches;
    }
    if (target.address) {
      const addressMatches = matches.filter((record) => identityParts(record).address === target.address);
      if (addressMatches.length === 1) return addressMatches[0];
    }
    return null;
  }

  function isComplete(record) {
    return !!record && validCapacity(record.maxCapacity) && !!safeOfficialUrl(record.officialUrl) && typeof record.description === 'string' && !!record.description.trim();
  }

  function createVenueSeed(concert) {
    const name = String(concert?.venue || '').trim();
    const city = String(concert?.city || '').trim();
    if (!name || !city) return null;
    const seed = {
      venueId: venueIdFor({ name, city, country: concert?.country }),
      name,
      city,
      country: String(concert?.country || '').trim(),
      address: String(concert?.venueAddress || '').trim() || undefined,
      researchStatus: 'unresolved',
      schemaVersion: 1,
    };
    return seed.venueId ? seed : null;
  }

  function uniqueVenueSeeds(concerts, { attendedOnly = true } = {}) {
    const seeds = [];
    for (const concert of concerts || []) {
      if (attendedOnly && !concert?.attending) continue;
      const seed = createVenueSeed(concert);
      if (!seed) continue;
      const existing = findVenueRecord(seed, seeds);
      if (existing) {
        if (!existing.country && seed.country) existing.country = seed.country;
        if (!existing.address && seed.address) existing.address = seed.address;
        continue;
      }
      const sameIdentity = seeds.filter((candidate) => identityKey(candidate) === identityKey(seed));
      if (sameIdentity.length && seed.address) {
        for (const candidate of sameIdentity) {
          const candidateParts = identityParts(candidate);
          if (candidateParts.address && candidate.venueId === venueIdFor(candidate)) candidate.venueId = venueIdForAddressVariant(candidate);
        }
        seed.venueId = venueIdForAddressVariant(seed);
      }
      if (seeds.some((candidate) => candidate.venueId === seed.venueId)) continue;
      seeds.push(seed);
    }
    return seeds;
  }

  function missingResearchSeeds(concerts, records, options = {}) {
    return uniqueVenueSeeds(concerts, options).filter((seed) => {
      const existing = findVenueRecord(seed, records || []);
      return !existing || !isComplete(existing);
    });
  }

  return Object.freeze({
    RESEARCH_STATUSES,
    normalizeIdentityText,
    venueIdFor,
    venueIdForAddressVariant,
    validCapacity,
    formatCapacity,
    capacityLabel,
    safeOfficialUrl,
    addressLines,
    recordIsValid,
    normalizeRecord,
    normalizeDocument,
    findVenueRecord,
    isComplete,
    createVenueSeed,
    uniqueVenueSeeds,
    missingResearchSeeds,
  });
});
