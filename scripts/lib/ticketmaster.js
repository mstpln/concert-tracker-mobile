'use strict';

const config = require('./config');
const { haversineKm, slugify, isValidFullDate } = require('./util');
const ConcertIntegrity = require('./ticketmasterConcertIntegrityV163');

function apiKey() {
  const key = process.env[config.TICKETMASTER.apiKeyEnv];
  if (!key) throw new Error(`Missing required environment variable: ${config.TICKETMASTER.apiKeyEnv}`);
  return key;
}

const TRIBUTE_ACT_PATTERN =
  /\b(tribute|tributes|cover\s*band|coverband|revival|allstars?|experience|reunion|homage|ultimate|definitive|definitely|totally|simply|absolutely|unofficial|salut(e|ing)|remembering|celebrating|bootleg|counterfeit|replica|not|almost|nearly|roadshow|legacy\s+continues)\b/i;

function containsWholeWords(haystack, needle) {
  if (!needle) return false;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = idx === 0 || haystack[idx - 1] === ' ';
  const afterIdx = idx + needle.length;
  const after = afterIdx === haystack.length || haystack[afterIdx] === ' ';
  return before && after;
}

function normWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Retained as a review/discovery helper and for historical regression tests.
// It is deliberately NOT an authority for automatic concert admission.
function namesMatch(bandName, attractionName, eventName, eventUrl) {
  if (
    TRIBUTE_ACT_PATTERN.test(attractionName || '') ||
    TRIBUTE_ACT_PATTERN.test(eventName || '') ||
    TRIBUTE_ACT_PATTERN.test((eventUrl || '').replace(/[-_/]/g, ' '))
  ) return false;
  const band = normWords(bandName);
  const attraction = normWords(attractionName);
  if (!band || !attraction) return false;
  if (band === attraction) return true;
  return containsWholeWords(attraction, band) || containsWholeWords(band, attraction);
}

function trustedAttractionId(band) {
  return ConcertIntegrity.trustedTicketmasterIdentity(band);
}

function note(usage, message) {
  if (typeof usage?.note === 'function') usage.note(message);
}

async function ticketmasterRequest(url, usage, fetchImpl) {
  if (!usage?.canCallTicketmaster?.()) return { kind: 'quota' };
  await usage.recordTicketmasterCall();
  let response;
  try {
    response = await fetchImpl(url.toString());
  } catch (error) {
    return { kind: 'error', error: error.message || 'request_failed' };
  }
  if (response.status === 404) return { kind: 'not_found' };
  if (!response.ok) return { kind: 'error', error: `http_${response.status}` };
  try {
    return { kind: 'ok', data: await response.json() };
  } catch (error) {
    return { kind: 'error', error: 'malformed_json' };
  }
}

function providerSource(event) {
  const source = event?.source;
  if (typeof source === 'string' && source.trim()) return source.trim();
  if (typeof source?.name === 'string' && source.name.trim()) return source.name.trim();
  if (typeof source?.id === 'string' && source.id.trim()) return source.id.trim();
  return null;
}

function venueFields(venue) {
  const city = venue?.city?.name || '';
  const country = venue?.country?.name || '';
  const addressLine = venue?.address?.line1 || '';
  return {
    venue: typeof venue?.name === 'string' && venue.name.trim() ? venue.name.trim() : null,
    city,
    country,
    venueAddress: [addressLine, city, country].filter(Boolean).join(', ') || null,
    providerVenueId: typeof venue?.id === 'string' && venue.id.trim() ? venue.id.trim() : null,
    latitude: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
    longitude: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
  };
}

async function resolveVenue(eventVenue, usage, fetchImpl, venueCache) {
  const embedded = venueFields(eventVenue);
  if (embedded.venue) return embedded;
  if (!embedded.providerVenueId) return embedded;
  if (venueCache.has(embedded.providerVenueId)) return { ...embedded, ...venueCache.get(embedded.providerVenueId) };

  const url = new URL(`${config.TICKETMASTER.baseUrl}/venues/${encodeURIComponent(embedded.providerVenueId)}.json`);
  url.searchParams.set('apikey', apiKey());
  const result = await ticketmasterRequest(url, usage, fetchImpl);
  if (result.kind !== 'ok') {
    venueCache.set(embedded.providerVenueId, {});
    return embedded;
  }
  const recovered = venueFields(result.data);
  venueCache.set(embedded.providerVenueId, recovered);
  return { ...embedded, ...recovered, providerVenueId: embedded.providerVenueId };
}

function eventStatus(event) {
  const value = event?.dates?.status?.code;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

async function eventToConcert(event, band, attractionId, usage, fetchImpl, venueCache, now) {
  const attractions = event?._embedded?.attractions || [];
  const matchingAttraction = attractions.find((attraction) => attraction?.id === attractionId);
  if (!matchingAttraction) return null;

  const localDate = event?.dates?.start?.localDate;
  const start = event?.dates?.start || {};
  if (start.dateTBD || start.dateTBA || !isValidFullDate(localDate)) return null;

  const status = eventStatus(event);
  if (ConcertIntegrity.isUnsafeEventStatus(status)) {
    note(usage, `Ticketmaster ${status} event held from automatic concert admission for "${band.name}" on ${localDate}`);
    return null;
  }

  const embeddedVenue = event?._embedded?.venues?.[0];
  if (!embeddedVenue) return null;
  const venue = await resolveVenue(embeddedVenue, usage, fetchImpl, venueCache);
  if (!venue.venue) {
    note(usage, `Ticketmaster venue unresolved for "${band.name}" on ${localDate}; event held instead of storing Unknown venue`);
    return null;
  }

  const distanceKm = haversineKm(config.HOME_LAT, config.HOME_LON, venue.latitude, venue.longitude);
  const eventName = typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : null;
  return {
    id: `${band.id}-${localDate}-${slugify(venue.city || venue.venue)}`,
    bandId: band.id,
    bandName: band.name,
    venue: venue.venue,
    city: venue.city,
    country: venue.country,
    date: localDate,
    time: start.localTime || null,
    distanceKm,
    articleUrl: null,
    ticketUrl: event.url || null,
    ticketRetailerVerified: true,
    isNew: true,
    foundAt: now,
    venueAddress: venue.venueAddress,
    sourceProvider: 'ticketmaster',
    providerEventId: event.id || null,
    providerAttractionId: attractionId,
    providerVenueId: venue.providerVenueId,
    providerEventName: eventName,
    providerEventStatus: status,
    providerSource: providerSource(event),
    providerOfferType: ConcertIntegrity.offerKind(eventName),
    artistMatchMethod: 'confirmed_attraction_id',
  };
}

// Automatic event admission is identity-first. Bands without a trusted,
// reviewed Ticketmaster attraction ID do not make an events request and can
// only obtain identity through the separate resolver below.
async function fetchUpcomingEvents(band, usage, { fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const attractionId = trustedAttractionId(band);
  if (!attractionId) {
    note(usage, `Ticketmaster event lookup skipped for "${band.name}": trusted attraction identity required`);
    return [];
  }

  const venueCache = new Map();
  const rawEvents = [];
  const pageSize = 200;
  const maxPages = 5; // Ticketmaster deep paging is capped at 1,000 items.

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${config.TICKETMASTER.baseUrl}/events.json`);
    url.searchParams.set('apikey', apiKey());
    url.searchParams.set('attractionId', attractionId);
    url.searchParams.set('classificationName', 'Music');
    url.searchParams.set('sort', 'date,asc');
    url.searchParams.set('size', String(pageSize));
    url.searchParams.set('page', String(page));
    url.searchParams.set('startDateTime', now.replace(/\.\d{3}Z$/, 'Z'));

    const result = await ticketmasterRequest(url, usage, fetchImpl);
    if (result.kind === 'quota') {
      note(usage, `Ticketmaster per-run/daily cap reached while paging "${band.name}"`);
      break;
    }
    if (result.kind === 'not_found') break;
    if (result.kind !== 'ok') {
      note(usage, `Ticketmaster request failed for "${band.name}": ${result.error}`);
      break;
    }

    const events = result.data?._embedded?.events || [];
    rawEvents.push(...events);
    const totalPages = Number(result.data?.page?.totalPages);
    if (!events.length || !Number.isFinite(totalPages) || page + 1 >= totalPages) break;
  }

  const concerts = [];
  for (const event of rawEvents) {
    const concert = await eventToConcert(event, band, attractionId, usage, fetchImpl, venueCache, now);
    if (concert) concerts.push(concert);
  }
  return ConcertIntegrity.collapseTicketmasterOffers(concerts);
}

const identityNorm = (value) => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the\s+/u, '').replace(/\s+/g, ' ');

function attractionIdentity(candidate, now = new Date().toISOString()) {
  return {
    id: candidate.id,
    attractionName: candidate.name || null,
    url: candidate.url || null,
    status: 'confirmed',
    matchMethod: 'exact_music_attraction',
    confidence: 100,
    matchedAt: now,
    lastAttemptedAt: now,
    lastCheckedAt: now,
    lastSuccessfulAt: now,
    nextEligibleCheckAt: null,
    errorCategory: null,
    reviewCandidates: [],
  };
}

function attractionReviewCandidates(candidates) {
  const seen = new Set();
  return (candidates || [])
    .filter((candidate) => candidate?.id && !seen.has(candidate.id) && seen.add(candidate.id))
    .slice(0, 5)
    .map((candidate) => ({ id: candidate.id, attractionName: candidate.name || null, url: candidate.url || null }));
}

function unresolvedAttraction(prior, status, now, errorCategory = null, candidates = []) {
  const retryMs = status === 'error'
    ? config.STRUCTURED_RESEARCH.temporaryErrorRetryHours * 3600000
    : config.STRUCTURED_RESEARCH.unresolvedIdentityRetryDays * 86400000;
  return {
    ...prior,
    id: null,
    attractionName: null,
    url: null,
    status,
    matchMethod: null,
    confidence: null,
    matchedAt: null,
    lastAttemptedAt: now,
    lastCheckedAt: now,
    lastSuccessfulAt: prior?.lastSuccessfulAt || null,
    nextEligibleCheckAt: new Date(Date.parse(now) + retryMs).toISOString(),
    errorCategory,
    reviewCandidates: status === 'needs_review' ? attractionReviewCandidates(candidates) : [],
  };
}

function candidateIsMusic(candidate) {
  return (candidate?.classifications || []).some((classification) => String(classification?.segment?.name || '').toLowerCase() === 'music');
}

function canonicalIdentityNames(band, metadata) {
  return new Set([band?.name, metadata?.artistName].map(identityNorm).filter(Boolean));
}

function aliasIdentityNames(metadata) {
  return new Set((metadata?.aliases || []).map(identityNorm).filter(Boolean));
}

function collisionRisk(candidate, candidates, canonicalNames, searchComplete) {
  const exact = identityNorm(candidate?.name);
  const tokenCount = exact.split(' ').filter(Boolean).length;
  const shortOrGeneric = tokenCount <= 1 || exact.length <= 6;
  const similarCandidateExists = candidates.some((other) => {
    if (!other?.id || other.id === candidate.id || !candidateIsMusic(other)) return false;
    const otherName = identityNorm(other.name);
    if (!otherName || canonicalNames.has(otherName)) return false;
    return containsWholeWords(otherName, exact) || containsWholeWords(exact, otherName);
  });
  if (similarCandidateExists) return true;
  return shortOrGeneric && !searchComplete;
}

async function resolveAttractionIdentity({ band, metadata, usage, fetchImpl = fetch, now = new Date().toISOString() }) {
  const prior = band.musicbrainz?.ticketmaster;
  if (['confirmed', 'manual_confirmed'].includes(prior?.status) && prior.id) return { kind: 'reused', identity: prior };
  if (prior?.status === 'manual_rejected') return { kind: 'skipped', identity: prior };
  if (prior?.nextEligibleCheckAt && Date.parse(prior.nextEligibleCheckAt) > Date.parse(now)) return { kind: 'skipped', identity: prior };
  if (!usage.canCallTicketmaster()) return { kind: 'skipped', identity: prior || null };

  try {
    const url = new URL(`${config.TICKETMASTER.baseUrl}/attractions.json`);
    url.searchParams.set('apikey', apiKey());
    url.searchParams.set('keyword', metadata?.artistName || band.name);
    url.searchParams.set('classificationName', 'Music');
    url.searchParams.set('size', '200');
    await usage.recordTicketmasterCall();
    const response = await fetchImpl(url.toString());
    if (response.status === 404) return { kind: 'no_match', identity: unresolvedAttraction(prior, 'no_match', now) };
    if (!response.ok) return { kind: 'error', identity: unresolvedAttraction(prior, 'error', now, `http_${response.status}`) };
    const data = await response.json();
    const candidates = data?._embedded?.attractions || [];
    const canonicalNames = canonicalIdentityNames(band, metadata);
    const aliasNames = aliasIdentityNames(metadata);
    const musicCandidates = candidates.filter(candidateIsMusic);
    const canonicalMatches = musicCandidates.filter((candidate) => {
      const candidateName = identityNorm(candidate.name);
      return canonicalNames.has(candidateName)
        && !TRIBUTE_ACT_PATTERN.test(`${candidate.name || ''} ${candidate.url || ''}`);
    });
    const aliasMatches = musicCandidates.filter((candidate) => {
      const candidateName = identityNorm(candidate.name);
      return aliasNames.has(candidateName)
        && !canonicalNames.has(candidateName)
        && !TRIBUTE_ACT_PATTERN.test(`${candidate.name || ''} ${candidate.url || ''}`);
    });
    const totalElements = Number(data?.page?.totalElements);
    const searchComplete = Number.isFinite(totalElements) && totalElements <= candidates.length;

    if (canonicalMatches.length === 1 && !collisionRisk(canonicalMatches[0], candidates, canonicalNames, searchComplete)) {
      return { kind: 'confirmed', identity: attractionIdentity(canonicalMatches[0], now) };
    }
    if (canonicalMatches.length || aliasMatches.length) {
      const reviewPool = [...canonicalMatches, ...aliasMatches, ...musicCandidates.filter((candidate) => namesMatch(band.name, candidate.name))];
      return { kind: 'needs_review', identity: unresolvedAttraction(prior, 'needs_review', now, null, reviewPool) };
    }
    return { kind: 'no_match', identity: unresolvedAttraction(prior, 'no_match', now) };
  } catch (error) {
    return { kind: 'error', identity: unresolvedAttraction(prior, 'error', now, error.message || 'request_failed') };
  }
}

module.exports = {
  fetchUpcomingEvents,
  resolveAttractionIdentity,
  namesMatch,
  attractionReviewCandidates,
  unresolvedAttraction,
  trustedAttractionId,
  eventStatus,
  venueFields,
  collisionRisk,
  canonicalIdentityNames,
  aliasIdentityNames,
};
