'use strict';

const ALTERNATE_OFFER_PATTERN = /\b(vip|premium|package|hospitality|lounge|sound\s*check|soundcheck|meet\s*(?:and|&)\s*greet|early\s*entry|early\s*access|upgrade|experience|vinyl\s*room|club\s*access|suite)\b/i;
const UNSAFE_EVENT_STATUSES = new Set(['cancelled', 'canceled', 'postponed', 'rescheduled']);
const UNKNOWN_VENUE_NAMES = new Set([
  'unknown venue', 'unknown', 'venue unknown', 'tba', 'tbd', 'venue tba', 'venue tbd',
  'to be announced', 'to be determined',
]);
// Fields that make an automatic destructive cleanup unsafe when they carry
// meaningful state. A stored support role is protected; headliner alone is
// not, because v155 lazily defaulted missing legacy roles to headliner.
const USER_OWNED_FIELDS = [
  'attending', 'attended', 'rating', 'notes', 'ticketPrice', 'ticketQuantity', 'freeTicket', 'freeTickets',
  'ownedTickets', 'tickets', 'playlistUrl', 'playlistProgress', 'photoUrl', 'photos', 'eventGroupId',
  'lineupRole', 'setlist', 'prepChecklist', 'concertDay', 'userLinks',
];

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeStatus(value) {
  return normalize(value).replace(/\s+/g, '_');
}

function isUnsafeEventStatus(value) {
  return UNSAFE_EVENT_STATUSES.has(normalizeStatus(value));
}

function isUnknownVenueName(value) {
  const normalized = normalize(value);
  return !normalized || UNKNOWN_VENUE_NAMES.has(normalized);
}

function offerKind(value) {
  return ALTERNATE_OFFER_PATTERN.test(String(value || '')) ? 'alternate_offer' : 'standard';
}

function minutesFromTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function compatibleTimes(first, second, toleranceMinutes = 5) {
  const a = minutesFromTime(first);
  const b = minutesFromTime(second);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= toleranceMinutes;
}

function performanceTimeRelationship(first, second, toleranceMinutes = 5) {
  const firstMinutes = minutesFromTime(first?.time);
  const secondMinutes = minutesFromTime(second?.time);
  if (firstMinutes == null || secondMinutes == null) return { kind: 'ambiguous', reason: 'time_missing' };
  if (Math.abs(firstMinutes - secondMinutes) > toleranceMinutes) return { kind: 'distinct', reason: 'time_conflict' };
  return { kind: 'same', reason: 'compatible_time' };
}

function providerAttractionMatches(first, second) {
  const a = String(first?.providerAttractionId || '').trim();
  const b = String(second?.providerAttractionId || '').trim();
  return Boolean(a && b && a === b);
}

function locationEvidence(first, second) {
  const venueIdA = String(first?.providerVenueId || '').trim();
  const venueIdB = String(second?.providerVenueId || '').trim();
  if (venueIdA && venueIdB) return venueIdA === venueIdB ? 'provider_venue_id' : null;

  const addressA = normalize(first?.venueAddress);
  const addressB = normalize(second?.venueAddress);
  if (addressA && addressB) return addressA === addressB ? 'exact_address' : null;

  const cityA = normalize(first?.city);
  const cityB = normalize(second?.city);
  const countryA = normalize(first?.country);
  const countryB = normalize(second?.country);
  const venueA = normalize(first?.venue);
  const venueB = normalize(second?.venue);
  if (!cityA || !cityB || cityA !== cityB) return null;
  if (countryA && countryB && countryA !== countryB) return null;
  if (!venueA || !venueB || isUnknownVenueName(first?.venue) || isUnknownVenueName(second?.venue)) return null;
  return venueA === venueB ? 'exact_venue_name' : null;
}

function physicalPerformanceMatch(first, second) {
  if (!first || !second || first.bandId !== second.bandId || first.date !== second.date) return { match: false, reason: 'band_or_date' };
  const firstAttraction = String(first?.providerAttractionId || '').trim();
  const secondAttraction = String(second?.providerAttractionId || '').trim();
  if (!firstAttraction || !secondAttraction) return { match: false, reason: 'attraction_missing' };
  if (!providerAttractionMatches(first, second)) return { match: false, reason: 'attraction_conflict' };
  const locationReason = locationEvidence(first, second);
  if (!locationReason) return { match: false, reason: 'location' };
  if (minutesFromTime(first.time) == null || minutesFromTime(second.time) == null) return { match: false, reason: 'time_missing' };
  if (!compatibleTimes(first.time, second.time)) return { match: false, reason: 'time_conflict' };
  return { match: true, reason: locationReason };
}

function physicalPerformanceRelationship(first, second) {
  if (!first || !second || first.bandId !== second.bandId || first.date !== second.date) return { kind: 'distinct', reason: 'band_or_date' };

  const firstAttraction = String(first?.providerAttractionId || '').trim();
  const secondAttraction = String(second?.providerAttractionId || '').trim();
  if (!firstAttraction || !secondAttraction) return { kind: 'ambiguous', reason: 'attraction_missing' };
  if (firstAttraction !== secondAttraction) return { kind: 'ambiguous', reason: 'attraction_conflict' };

  const locationReason = locationEvidence(first, second);
  if (!locationReason) {
    const venueIdA = String(first?.providerVenueId || '').trim();
    const venueIdB = String(second?.providerVenueId || '').trim();
    if (venueIdA && venueIdB && venueIdA !== venueIdB) return { kind: 'distinct', reason: 'provider_venue_conflict' };
    const cityA = normalize(first?.city);
    const cityB = normalize(second?.city);
    if (cityA && cityB && cityA !== cityB) return { kind: 'distinct', reason: 'city_conflict' };
    const countryA = normalize(first?.country);
    const countryB = normalize(second?.country);
    if (countryA && countryB && countryA !== countryB) return { kind: 'distinct', reason: 'country_conflict' };
    return { kind: 'ambiguous', reason: 'location_incomplete' };
  }

  const timing = performanceTimeRelationship(first, second);
  if (timing.kind !== 'same') return timing;
  return { kind: 'same', reason: locationReason };
}

function providerOfferEvidence(record) {
  const eventId = String(record?.providerEventId || '').trim();
  if (!eventId) return null;
  const eventName = typeof record.providerEventName === 'string' && record.providerEventName.trim()
    ? record.providerEventName
    : null;
  const explicitOfferType = ['standard', 'alternate_offer'].includes(record?.providerOfferType)
    ? record.providerOfferType
    : null;
  return {
    providerEventId: eventId,
    ticketUrl: typeof record.ticketUrl === 'string' && record.ticketUrl.trim() ? record.ticketUrl : null,
    providerEventName: eventName,
    providerEventStatus: typeof record.providerEventStatus === 'string' && record.providerEventStatus.trim() ? record.providerEventStatus : null,
    providerSource: typeof record.providerSource === 'string' && record.providerSource.trim() ? record.providerSource : null,
    providerOfferType: explicitOfferType || (eventName ? offerKind(eventName) : null),
  };
}

function mergeOfferLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const offer of Array.isArray(list) ? list : []) {
      const providerEventId = String(offer?.providerEventId || '').trim();
      if (!providerEventId) continue;
      const prior = byId.get(providerEventId) || {};
      const merged = { ...prior, providerEventId };
      for (const [field, value] of Object.entries(offer)) {
        if (field === 'providerEventId') continue;
        if (value == null) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        if (Array.isArray(value) && !value.length) continue;
        if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) continue;
        merged[field] = value;
      }
      byId.set(providerEventId, merged);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.providerEventId).localeCompare(String(b.providerEventId)));
}

function mergeAlternateOffer(existing, incoming) {
  const match = physicalPerformanceMatch(existing, incoming);
  if (!match.match) return null;

  const existingKind = existing.providerOfferType || offerKind(existing.providerEventName);
  const incomingKind = incoming.providerOfferType || offerKind(incoming.providerEventName);
  if (existingKind !== 'alternate_offer' && incomingKind !== 'alternate_offer') return null;

  const preferIncomingPrimary = existingKind === 'alternate_offer' && incomingKind !== 'alternate_offer';
  const primary = preferIncomingPrimary ? incoming : existing;
  const alternate = preferIncomingPrimary ? existing : incoming;
  const primaryEvidence = providerOfferEvidence(primary);
  const alternateEvidence = providerOfferEvidence(alternate);
  const alternateProviderOffers = mergeOfferLists(
    existing.alternateProviderOffers,
    incoming.alternateProviderOffers,
    alternateEvidence ? [alternateEvidence] : []
  ).filter((offer) => offer.providerEventId !== primaryEvidence?.providerEventId);

  const merged = { ...existing };
  const providerFields = [
    'venue', 'city', 'country', 'time', 'distanceKm', 'venueAddress', 'providerVenueId',
    'sourceProvider', 'providerAttractionId', 'artistMatchMethod',
  ];
  for (const field of providerFields) {
    const value = primary?.[field] ?? incoming?.[field];
    if (value == null || value === '') continue;
    if (field === 'venue' && !isUnknownVenueName(existing.venue) && isUnknownVenueName(value)) continue;
    merged[field] = value;
  }
  for (const field of ['providerEventId', 'ticketUrl', 'providerEventName', 'providerEventStatus', 'providerSource', 'providerOfferType']) {
    if (primary?.[field] != null && primary[field] !== '') merged[field] = primary[field];
  }
  merged.sourceProvider = 'ticketmaster';
  merged.ticketRetailerVerified = true;
  if (alternateProviderOffers.length) merged.alternateProviderOffers = alternateProviderOffers;
  return merged;
}

function collapseTicketmasterOffers(records) {
  const output = [];
  for (const record of records || []) {
    let merged = false;
    for (let index = 0; index < output.length; index += 1) {
      const candidate = mergeAlternateOffer(output[index], record);
      if (!candidate) continue;
      output[index] = candidate;
      merged = true;
      break;
    }
    if (!merged) output.push(record);
  }
  return output;
}

function meaningfulUserOwnedValue(field, value) {
  if (field === 'lineupRole') return value === 'support';
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function userOwnedFieldNames(record) {
  return USER_OWNED_FIELDS.filter((field) => meaningfulUserOwnedValue(field, record?.[field]));
}

function hasUserOwnedData(record) {
  return userOwnedFieldNames(record).length > 0;
}

function trustedTicketmasterIdentity(band) {
  const identity = band?.musicbrainz?.ticketmaster;
  return identity?.id && ['confirmed', 'manual_confirmed'].includes(identity.status) ? String(identity.id) : null;
}

function wrongArtistReason(record, band) {
  if (record?.sourceProvider !== 'ticketmaster') return null;
  const trustedId = trustedTicketmasterIdentity(band);
  const recordId = String(record?.providerAttractionId || '').trim();
  if (trustedId && recordId && trustedId !== recordId) return 'provider_attraction_conflict';
  if (record?.artistMatchMethod === 'validated_name_fallback') return 'untrusted_name_fallback';
  return null;
}

module.exports = {
  ALTERNATE_OFFER_PATTERN,
  UNSAFE_EVENT_STATUSES,
  USER_OWNED_FIELDS,
  normalize,
  isUnsafeEventStatus,
  isUnknownVenueName,
  offerKind,
  minutesFromTime,
  compatibleTimes,
  performanceTimeRelationship,
  providerAttractionMatches,
  locationEvidence,
  physicalPerformanceMatch,
  physicalPerformanceRelationship,
  providerOfferEvidence,
  mergeOfferLists,
  mergeAlternateOffer,
  collapseTicketmasterOffers,
  meaningfulUserOwnedValue,
  userOwnedFieldNames,
  hasUserOwnedData,
  trustedTicketmasterIdentity,
  wrongArtistReason,
};
