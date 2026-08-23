'use strict';

(function attachVenueMetadataModelV158(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VenueMetadataModelV158 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const RESEARCH_STATUSES = new Set(['complete', 'partial', 'unresolved', 'temporary_error', 'review_needed']);
  const MAX_DESCRIPTION_LENGTH = 900;
  const PLACEHOLDER_VENUE_NAMES = new Set(['unknown venue', 'unknown', 'tba', 'tbd', 'venue tba', 'venue tbd']);
  const COUNTRY_ALIAS_KEYS = new Map([
    ['uk', 'united kingdom'], ['gb', 'united kingdom'], ['great britain', 'united kingdom'],
    ['england', 'united kingdom'], ['scotland', 'united kingdom'], ['wales', 'united kingdom'],
    ['northern ireland', 'united kingdom'], ['czechia', 'czech republic'],
  ]);
  const CITY_ALIAS_KEYS = new Map([
    ['goteborg', 'gothenburg'], ['milano', 'milan'], ['napoli', 'naples'], ['koln', 'cologne'], ['munchen', 'munich'],
  ]);
  const NON_OFFICIAL_HOSTS = new Set([
    'bandsintown.com', 'www.bandsintown.com', 'songkick.com', 'www.songkick.com', 'ticketmaster.com', 'www.ticketmaster.com',
    'ticketmaster.de', 'www.ticketmaster.de', 'ticketmaster.se', 'www.ticketmaster.se', 'eventbrite.com', 'www.eventbrite.com',
    'facebook.com', 'www.facebook.com', 'instagram.com', 'www.instagram.com', 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com',
    'tripadvisor.com', 'www.tripadvisor.com', 'eventseeker.com', 'www.eventseeker.com', 'venuu.se', 'www.venuu.se',
    'visitgavle.se', 'www.visitgavle.se', 'esmadrid.com', 'www.esmadrid.com', 'timeout.com', 'www.timeout.com',
  ]);
  const KNOWN_RECORD_FIELDS = new Set([
    'venueId', 'name', 'city', 'country', 'address', 'maxCapacity', 'officialUrl', 'description', 'researchStatus',
    'researchedAt', 'sources', 'schemaVersion', 'reviewNote', 'identityAliases', 'legacyVenueIds', 'mergeReviewFields',
  ]);

  function normalizeIdentityText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function canonicalCountryKey(value) {
    const key = normalizeIdentityText(value);
    return COUNTRY_ALIAS_KEYS.get(key) || key;
  }

  function canonicalCityKey(value) {
    let key = normalizeIdentityText(value);
    key = key.replace(/\s+(paris|bologna|antwerpen|brussels)$/, '').trim();
    if (/^kobenhavn(?:\s+[a-z])?$/.test(key)) return 'copenhagen';
    if (/^praha(?:\s+\d+)?$/.test(key)) return 'prague';
    return CITY_ALIAS_KEYS.get(key) || key;
  }

  function isPlaceholderVenueName(value) {
    return PLACEHOLDER_VENUE_NAMES.has(normalizeIdentityText(value));
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
      city: canonicalCityKey(value?.city),
      country: canonicalCountryKey(value?.country),
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

  function officialVenueUrl(value) {
    const safe = safeOfficialUrl(value);
    if (!safe) return null;
    const hostname = new URL(safe).hostname.toLocaleLowerCase('en');
    if (NON_OFFICIAL_HOSTS.has(hostname)) return null;
    if (hostname.startsWith('visit') && !hostname.includes('venue')) return null;
    return safe;
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

  function identityAliases(record) {
    return Array.isArray(record?.identityAliases)
      ? record.identityAliases.filter((alias) => alias && typeof alias === 'object' && !Array.isArray(alias))
      : [];
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
    if (record.identityAliases != null && (!Array.isArray(record.identityAliases) || record.identityAliases.length > 64 || record.identityAliases.some((alias) => {
      if (!alias || typeof alias !== 'object' || Array.isArray(alias)) return true;
      if (typeof alias.name !== 'string' || !alias.name.trim()) return true;
      if (typeof alias.city !== 'string' || !alias.city.trim()) return true;
      if (alias.country != null && typeof alias.country !== 'string') return true;
      if (alias.address != null && !addressLines(alias.address).length) return true;
      return false;
    }))) return false;
    if (record.legacyVenueIds != null && (!Array.isArray(record.legacyVenueIds) || record.legacyVenueIds.length > 64 || record.legacyVenueIds.some((id) => typeof id !== 'string' || !/^venue-[a-f0-9]{8}$/.test(id)))) return false;
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
    if (record.officialUrl != null) {
      const official = officialVenueUrl(record.officialUrl);
      if (official) normalized.officialUrl = official;
      else delete normalized.officialUrl;
    }
    if ((normalized.researchStatus === 'unresolved' || normalized.researchStatus === 'temporary_error' || !Array.isArray(normalized.sources) || !normalized.sources.length) && normalized.researchedAt) {
      delete normalized.researchedAt;
    }
    if (record.identityAliases != null) normalized.identityAliases = identityAliases(record).map((alias) => ({ ...alias }));
    if (record.legacyVenueIds != null) normalized.legacyVenueIds = [...new Set(record.legacyVenueIds.map((id) => String(id)))];
    return recordIsValid(normalized) ? normalized : null;
  }

  function normalizeDocument(records) {
    if (!Array.isArray(records)) return [];
    const out = [];
    for (const record of records) {
      const normalized = normalizeRecord(record);
      if (!normalized) continue;
      const duplicateIndexes = [];
      for (let index = 0; index < out.length; index += 1) {
        if (out[index].venueId === normalized.venueId) duplicateIndexes.push(index);
      }
      if (!duplicateIndexes.length) {
        out.push(normalized);
        continue;
      }
      let merged = false;
      for (const index of duplicateIndexes) {
        const candidate = mergeDuplicateRecords(out[index], normalized);
        if (!candidate) continue;
        out[index] = candidate;
        merged = true;
        break;
      }
      if (!merged) out.push(normalized);
    }
    return out;
  }

  function valuesMatch(target, candidate) {
    const left = identityParts(target);
    const right = identityParts(candidate);
    if (left.name !== right.name || left.city !== right.city) return false;
    if (left.country && right.country && left.country !== right.country) return false;
    if (left.address && right.address && left.address !== right.address) return false;
    return true;
  }

  function recordMatches(value, record) {
    if (valuesMatch(value, record)) return true;
    return identityAliases(record).some((alias) => valuesMatch(value, alias));
  }

  function findVenueRecord(value, records) {
    const target = identityParts(value);
    if (!target.name || !target.city) return null;
    let matches = (records || []).filter((record) => recordMatches(value, record));
    if (matches.length <= 1) return matches[0] || null;

    if (target.address) {
      const addressMatches = matches.filter((record) => [record, ...identityAliases(record)].some((variant) => identityParts(variant).address === target.address));
      if (addressMatches.length === 1) return addressMatches[0];
      if (addressMatches.length) matches = addressMatches;
    }
    const complete = matches.filter((record) => isComplete(record));
    if (complete.length === 1) return complete[0];
    if (matches.every((record, index) => matches.slice(index + 1).every((other) => recordsCanConsolidate(record, other)))) {
      return [...matches].sort((a, b) => recordScore(b) - recordScore(a))[0] || null;
    }
    return null;
  }

  function isComplete(record) {
    return recordIsValid(record)
      && record.researchStatus === 'complete'
      && validCapacity(record.maxCapacity)
      && !!officialVenueUrl(record.officialUrl)
      && typeof record.description === 'string'
      && !!record.description.trim()
      && typeof record.researchedAt === 'string'
      && Number.isFinite(Date.parse(record.researchedAt))
      && Array.isArray(record.sources)
      && record.sources.length > 0;
  }

  function createVenueSeed(concert) {
    const name = String(concert?.venue || '').trim();
    const city = String(concert?.city || '').trim();
    if (!name || !city || isPlaceholderVenueName(name)) return null;
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
          if (identityParts(candidate).address) candidate.venueId = venueIdForAddressVariant(candidate);
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

  function streetAddressKey(value) {
    const first = addressLines(value)[0] || '';
    return normalizeIdentityText(first);
  }

  function duplicateConfirmation(record) {
    const note = normalizeIdentityText(record?.reviewNote);
    if (!note || /possibly|likely|relocat|moved|addresses differ|could not fully confirm/.test(note)) return false;
    return /confirmed duplicate|confirmed same|same physical address|same physical venue|same venue name variant|same building|same stadium|same real square/.test(note);
  }

  function stableJson(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }

  function unknownFieldsCompatible(a, b) {
    const shared = Object.keys(a || {}).filter((key) => !KNOWN_RECORD_FIELDS.has(key) && Object.prototype.hasOwnProperty.call(b || {}, key));
    return shared.every((key) => stableJson(a[key]) === stableJson(b[key]));
  }

  function recordsCanConsolidate(a, b) {
    const left = identityParts(a);
    const right = identityParts(b);
    if (!left.name || !left.city || !right.name || !right.city) return false;
    if (left.country && right.country && left.country !== right.country) return false;
    if (!unknownFieldsCompatible(a, b)) return false;
    const sameCanonicalIdentity = left.name === right.name && left.city === right.city;
    const leftStreet = streetAddressKey(a.address);
    const rightStreet = streetAddressKey(b.address);
    const streetCompatible = !leftStreet || !rightStreet || leftStreet === rightStreet;
    if (sameCanonicalIdentity && streetCompatible) return true;
    if (duplicateConfirmation(a) || duplicateConfirmation(b)) return true;
    return false;
  }

  function recordScore(record) {
    const statusScore = { complete: 500, partial: 400, review_needed: 300, unresolved: 200, temporary_error: 100 }[record?.researchStatus] || 0;
    return statusScore
      + (validCapacity(record?.maxCapacity) ? 20 : 0)
      + (officialVenueUrl(record?.officialUrl) ? 20 : 0)
      + (addressLines(record?.address).length ? 10 : 0)
      + (typeof record?.description === 'string' && record.description.trim() ? 10 : 0)
      + (Array.isArray(record?.sources) ? Math.min(record.sources.length, 9) : 0);
  }

  function aliasFromRecord(record) {
    const alias = { name: record.name, city: record.city };
    if (record.country) alias.country = record.country;
    if (record.address) alias.address = record.address;
    return alias;
  }

  function aliasKey(alias) {
    const parts = identityParts(alias);
    return `${parts.name}|${parts.city}|${parts.country}|${parts.address}`;
  }

  function mergeSources(...lists) {
    const out = [];
    for (const list of lists) {
      for (const raw of Array.isArray(list) ? list : []) {
        const url = safeOfficialUrl(raw);
        if (url && !out.includes(url)) out.push(url);
        if (out.length >= 16) return out;
      }
    }
    return out;
  }

  function mergeDuplicateRecords(a, b) {
    if (!recordsCanConsolidate(a, b)) return null;
    const aIsPrimary = recordScore(a) >= recordScore(b);
    const primary = { ...(aIsPrimary ? a : b) };
    const secondary = aIsPrimary ? b : a;
    const merged = { ...secondary, ...primary };
    merged.venueId = primary.venueId;
    const legacyIds = [...(primary.legacyVenueIds || []), ...(secondary.legacyVenueIds || []), secondary.venueId]
      .filter((id) => id && id !== primary.venueId);
    merged.legacyVenueIds = [...new Set(legacyIds)];
    const aliases = [aliasFromRecord(primary), aliasFromRecord(secondary), ...identityAliases(primary), ...identityAliases(secondary)];
    const seenAliases = new Set();
    merged.identityAliases = aliases.filter((alias) => {
      const key = aliasKey(alias);
      if (!key || seenAliases.has(key)) return false;
      seenAliases.add(key);
      return key !== aliasKey(merged);
    });
    merged.sources = mergeSources(primary.sources, secondary.sources);

    if (!officialVenueUrl(merged.officialUrl)) delete merged.officialUrl;
    if (merged.researchStatus === 'unresolved' || merged.researchStatus === 'temporary_error' || !merged.sources.length) delete merged.researchedAt;

    const conflicts = [];
    if (validCapacity(primary.maxCapacity) && validCapacity(secondary.maxCapacity) && primary.maxCapacity !== secondary.maxCapacity) conflicts.push('maxCapacity');
    if (officialVenueUrl(primary.officialUrl) && officialVenueUrl(secondary.officialUrl)
      && new URL(officialVenueUrl(primary.officialUrl)).origin !== new URL(officialVenueUrl(secondary.officialUrl)).origin) conflicts.push('officialUrl');
    if (conflicts.length) {
      merged.researchStatus = 'review_needed';
      merged.mergeReviewFields = [...new Set([...(Array.isArray(primary.mergeReviewFields) ? primary.mergeReviewFields : []), ...(Array.isArray(secondary.mergeReviewFields) ? secondary.mergeReviewFields : []), ...conflicts])];
    }
    if (merged.researchStatus === 'complete' && !isComplete(merged)) merged.researchStatus = 'partial';
    return normalizeRecord(merged) || null;
  }

  function consolidateDocument(records) {
    const normalized = normalizeDocument(records).filter((record) => !isPlaceholderVenueName(record.name)).map((record) => {
      const copy = { ...record };
      if (copy.officialUrl && !officialVenueUrl(copy.officialUrl)) delete copy.officialUrl;
      if ((copy.researchStatus === 'unresolved' || copy.researchStatus === 'temporary_error' || !Array.isArray(copy.sources) || !copy.sources.length) && copy.researchedAt) delete copy.researchedAt;
      if (copy.researchStatus === 'complete' && !isComplete(copy)) copy.researchStatus = 'partial';
      return copy;
    });
    const out = [];
    for (const record of normalized) {
      const index = out.findIndex((candidate) => recordsCanConsolidate(candidate, record));
      if (index < 0) {
        out.push(record);
        continue;
      }
      const merged = mergeDuplicateRecords(out[index], record);
      if (merged) out[index] = merged;
      else out.push(record);
    }
    return out;
  }

  return Object.freeze({
    RESEARCH_STATUSES,
    normalizeIdentityText,
    canonicalCountryKey,
    canonicalCityKey,
    isPlaceholderVenueName,
    venueIdFor,
    venueIdForAddressVariant,
    validCapacity,
    formatCapacity,
    capacityLabel,
    safeOfficialUrl,
    officialVenueUrl,
    addressLines,
    recordIsValid,
    normalizeRecord,
    normalizeDocument,
    findVenueRecord,
    isComplete,
    createVenueSeed,
    uniqueVenueSeeds,
    missingResearchSeeds,
    recordsCanConsolidate,
    mergeDuplicateRecords,
    consolidateDocument,
  });
});
