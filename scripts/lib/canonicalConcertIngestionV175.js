'use strict';

const CanonicalIdentity = require('../../canonicalIdentityV174');
const { slugify } = require('./util');

const PROVIDER_FIELDS = Object.freeze([
  'venue', 'city', 'country', 'time', 'distanceKm', 'venueAddress', 'ticketUrl', 'articleUrl',
  'ticketRetailerVerified', 'sourceProvider', 'providerEventId', 'providerAttractionId', 'artistMatchMethod',
  'providerVenueId', 'providerEventName', 'providerEventStatus', 'providerSource', 'providerOfferType',
]);

const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);
const POSTPONED_STATUSES = new Set(['postponed']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || '').trim();
}

function providerNamespace(value) {
  return text(value?.providerNamespace || value?.sourceProvider || value?.provider || value?.namespace || 'unknown')
    .toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function providerEventId(value) {
  return text(value?.providerEventId || value?.eventId || value?.listingId);
}

function providerKey(namespace, eventId) {
  return namespace && eventId ? `${namespace}\u001f${eventId}` : '';
}

function lifecycleStatus(value) {
  const status = text(value?.providerEventStatus || value?.lifecycleStatus || value?.status).toLocaleLowerCase();
  if (CANCELLED_STATUSES.has(status)) return 'cancelled';
  if (POSTPONED_STATUSES.has(status)) return 'postponed';
  return status;
}

function isLifecycleObservation(value) {
  return ['cancelled', 'postponed', 'rescheduled'].includes(lifecycleStatus(value))
    || (Array.isArray(value?.providerRelatedEventIds) && value.providerRelatedEventIds.length > 0);
}

function normalizedRelatedEventIds(value) {
  return [...new Set((Array.isArray(value?.providerRelatedEventIds) ? value.providerRelatedEventIds : [])
    .map(text).filter(Boolean))].sort();
}

function observationFromCandidate(candidate, observedAt = null) {
  const provider = providerNamespace(candidate);
  const eventId = providerEventId(candidate) || null;
  const observation = {
    provider,
    providerEventId: eventId,
    providerVenueId: text(candidate?.providerVenueId) || null,
    providerAttractionId: text(candidate?.providerAttractionId) || null,
    eventName: text(candidate?.providerEventName) || null,
    venue: text(candidate?.venue) || null,
    city: text(candidate?.city) || null,
    country: text(candidate?.country) || null,
    address: clone(candidate?.venueAddress ?? null),
    roomOrStage: clone(candidate?.roomOrStage ?? candidate?.subLocation ?? null),
    date: text(candidate?.date) || null,
    time: text(candidate?.time) || null,
    ticketUrl: text(candidate?.ticketUrl) || null,
    articleUrl: text(candidate?.articleUrl) || null,
    offerType: text(candidate?.providerOfferType) || null,
    status: lifecycleStatus(candidate) || null,
    relatedEventIds: normalizedRelatedEventIds(candidate),
    source: text(candidate?.providerSource || candidate?.articleUrl || candidate?.sourceProvider) || null,
    observedAt: text(candidate?.observedAt || candidate?.foundAt || observedAt) || null,
  };
  return observation;
}

function stableValue(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function observationFingerprint(observation) {
  const copy = { ...observation };
  delete copy.observedAt;
  return stableValue(copy);
}

function mergeProviderObservations(existing, additions) {
  const output = [];
  const seen = new Set();
  for (const raw of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const observation = clone(raw);
    const fingerprint = observationFingerprint(observation);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push(observation);
  }
  return output;
}

function providerReferences(record) {
  const references = [];
  const add = (namespace, eventId) => {
    const key = providerKey(namespace, text(eventId));
    if (key && !references.includes(key)) references.push(key);
  };
  add(providerNamespace(record), providerEventId(record));
  for (const observation of Array.isArray(record?.providerObservations) ? record.providerObservations : []) {
    add(providerNamespace(observation), providerEventId(observation));
  }
  for (const offer of Array.isArray(record?.alternateProviderOffers) ? record.alternateProviderOffers : []) {
    add(providerNamespace({ ...offer, sourceProvider: offer?.sourceProvider || record?.sourceProvider }), providerEventId(offer));
  }
  return references;
}

function buildProviderIndex(records) {
  const index = new Map();
  for (const record of records || []) {
    for (const key of providerReferences(record)) {
      if (!index.has(key)) index.set(key, []);
      if (!index.get(key).includes(record)) index.get(key).push(record);
    }
  }
  return index;
}

function sameCanonicalVenue(first, second, venueIndex) {
  return CanonicalIdentity.canonicalVenueRelationship(first, second, venueIndex).kind === 'same';
}

function attractionCompatible(first, second) {
  const left = text(first?.providerAttractionId);
  const right = text(second?.providerAttractionId);
  return !left || !right || left === right;
}

function continuityMatch(records, candidate, providerIndex, venueIndex) {
  const namespace = providerNamespace(candidate);
  const keys = [providerEventId(candidate), ...normalizedRelatedEventIds(candidate)]
    .map((eventId) => providerKey(namespace, eventId)).filter(Boolean);
  const matches = [...new Set(keys.flatMap((key) => providerIndex.get(key) || []))];
  if (!matches.length) return { kind: 'none' };
  if (matches.length !== 1) return { kind: 'ambiguous', reason: 'provider_identity_collision' };
  const existing = matches[0];
  if (text(existing.bandId) !== text(candidate.bandId)) return { kind: 'ambiguous', reason: 'provider_band_conflict' };
  if (!attractionCompatible(existing, candidate)) return { kind: 'ambiguous', reason: 'provider_attraction_conflict' };
  const venueRelationship = CanonicalIdentity.canonicalVenueRelationship(existing, candidate, venueIndex);
  if (venueRelationship.kind === 'ambiguous') return { kind: 'ambiguous', reason: 'lifecycle_venue_unresolved' };
  const exact = providerReferences(existing).includes(providerKey(namespace, providerEventId(candidate)));
  return { kind: 'match', concert: existing, reason: exact ? 'provider_event_continuity' : 'provider_replacement_continuity' };
}

function canonicalMatches(records, candidate, venueIndex) {
  const identity = CanonicalIdentity.canonicalConcertIdentity(candidate, venueIndex);
  if (identity.kind !== 'same') return { identity, matches: [] };
  return {
    identity,
    matches: (records || []).filter((record) => CanonicalIdentity.canonicalConcertIdentity(record, venueIndex).key === identity.key),
  };
}

function reconcileCandidate(records, candidate, { venueIndex = CanonicalIdentity.buildVenueIndex([]) } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!candidate || typeof candidate !== 'object' || !text(candidate.bandId)) {
    return { action: 'hold_for_review', reason: 'candidate_identity_incomplete' };
  }
  const providerIndex = buildProviderIndex(list);
  const continuity = continuityMatch(list, candidate, providerIndex, venueIndex);
  if (continuity.kind === 'ambiguous') return { action: 'hold_for_review', reason: continuity.reason };
  if (continuity.kind === 'match') {
    return { action: 'lifecycle_continuation', concert: continuity.concert, reason: continuity.reason };
  }

  const canonical = canonicalMatches(list, candidate, venueIndex);
  if (canonical.matches.length > 1) {
    const conflicts = CanonicalIdentity.userOwnedConflicts(canonical.matches);
    return { action: 'hold_for_review', reason: conflicts.length ? 'user_owned_conflict' : 'multiple_existing_canonical_records', conflicts };
  }
  if (canonical.matches.length === 1) {
    return { action: 'merge_observation', concert: canonical.matches[0], reason: 'canonical_concert_identity' };
  }
  if (isLifecycleObservation(candidate)) return { action: 'hold_for_review', reason: 'lifecycle_target_missing' };
  if (canonical.identity.kind !== 'same') return { action: 'hold_for_review', reason: canonical.identity.reason };

  const possible = list.filter((record) => text(record?.bandId) === text(candidate.bandId) && text(record?.date) === text(candidate.date));
  if (possible.some((record) => CanonicalIdentity.canonicalConcertRelationship(record, candidate, venueIndex).kind === 'ambiguous')) {
    return { action: 'hold_for_review', reason: 'canonical_identity_ambiguous' };
  }
  return { action: 'add', reason: 'new_canonical_concert', identity: canonical.identity };
}

function lifecycleHistoryEntry(type, existing, candidate, now, extra = {}) {
  return {
    type,
    previousDate: text(existing?.date) || null,
    replacementDate: text(candidate?.date) || null,
    provider: providerNamespace(candidate),
    providerEventId: providerEventId(candidate) || null,
    observedAt: text(candidate?.observedAt || candidate?.foundAt || now) || null,
    ...extra,
  };
}

function mergeLifecycleHistory(existing, entries) {
  const output = [];
  const seen = new Set();
  for (const entry of [...(Array.isArray(existing) ? existing : []), ...entries]) {
    const fingerprint = stableValue({ ...entry, observedAt: undefined });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push(clone(entry));
  }
  return output;
}

function fillProviderFields(target, candidate) {
  const output = { ...target };
  for (const field of PROVIDER_FIELDS) {
    const incoming = candidate?.[field];
    if (incoming == null || incoming === '') continue;
    if (output[field] == null || output[field] === '') output[field] = clone(incoming);
  }
  return output;
}

function providerStrength(value) {
  const namespace = providerNamespace(value);
  const verified = value?.ticketRetailerVerified === true;
  const standard = text(value?.providerOfferType) === 'standard';
  if (namespace === 'ticketmaster' && verified && standard) return 4;
  if (namespace === 'ticketmaster' && verified) return 3;
  if (verified) return 2;
  return 1;
}

function providerPresentationFields() {
  return [
    'time', 'distanceKm', 'ticketUrl', 'articleUrl', 'ticketRetailerVerified', 'sourceProvider',
    'providerEventId', 'providerAttractionId', 'artistMatchMethod', 'providerVenueId',
    'providerEventName', 'providerEventStatus', 'providerSource', 'providerOfferType',
  ];
}

function alternateOfferObservations(candidate, now) {
  return (Array.isArray(candidate?.alternateProviderOffers) ? candidate.alternateProviderOffers : [])
    .filter((offer) => offer && typeof offer === 'object' && !Array.isArray(offer))
    .map((offer) => observationFromCandidate({
      ...candidate,
      ...offer,
      sourceProvider: offer.sourceProvider || candidate.sourceProvider,
      providerEventId: offer.providerEventId,
    }, now));
}

function existingProviderObservation(existing, now) {
  const namespace = providerNamespace(existing);
  const eventId = providerEventId(existing);
  if (!eventId && !text(existing?.sourceProvider)) return null;
  const key = providerKey(namespace, eventId);
  if (key && (Array.isArray(existing?.providerObservations) ? existing.providerObservations : [])
    .some((observation) => providerKey(providerNamespace(observation), providerEventId(observation)) === key)) {
    return null;
  }
  return observationFromCandidate(existing, now);
}

function applyPreferredProviderPresentation(output, existing, candidate, continuityReason) {
  const existingStrength = providerStrength(existing);
  const incomingStrength = providerStrength(candidate);
  const lifecycle = isLifecycleObservation(candidate);
  const replacementContinuity = continuityReason === 'provider_replacement_continuity';
  if (incomingStrength < existingStrength && !lifecycle) return output;
  if (incomingStrength === existingStrength && !replacementContinuity && !lifecycle) return output;
  const next = { ...output };
  for (const field of providerPresentationFields()) {
    const incoming = candidate?.[field];
    if (incoming == null || incoming === '') continue;
    next[field] = clone(incoming);
  }
  return next;
}

function applyReplacementVenue(output, existing, candidate, venueIndex) {
  const relationship = CanonicalIdentity.canonicalVenueRelationship(existing, candidate, venueIndex);
  if (relationship.kind !== 'distinct') return output;
  const venue = CanonicalIdentity.canonicalVenueIdentity(candidate, venueIndex);
  if (!venue?.canonicalVenueId) return output;
  const next = { ...output, canonicalVenueId: venue.canonicalVenueId };
  for (const field of ['venue', 'city', 'country', 'venueAddress', 'distanceKm', 'providerVenueId']) {
    const incoming = candidate?.[field];
    if (incoming == null || incoming === '') continue;
    next[field] = clone(incoming);
  }
  if (venue.roomOrStage) next.roomOrStage = clone(venue.roomOrStage);
  else delete next.roomOrStage;
  return next;
}

function applyCandidateToConcert(existing, candidate, { venueIndex = CanonicalIdentity.buildVenueIndex([]), now = new Date().toISOString(), continuity = false, continuityReason = '' } = {}) {
  let output = fillProviderFields(clone(existing), candidate);
  const observation = observationFromCandidate(candidate, now);
  const priorObservation = existingProviderObservation(existing, now);
  output.providerObservations = mergeProviderObservations(output.providerObservations, [priorObservation, observation, ...alternateOfferObservations(candidate, now)].filter(Boolean));
  output = applyPreferredProviderPresentation(output, existing, candidate, continuityReason);
  const venue = CanonicalIdentity.canonicalVenueIdentity(candidate, venueIndex);
  if (!output.canonicalVenueId && venue?.canonicalVenueId) output.canonicalVenueId = venue.canonicalVenueId;
  if (!output.roomOrStage && venue?.roomOrStage) output.roomOrStage = clone(venue.roomOrStage);

  const status = lifecycleStatus(candidate);
  const activeDate = text(output.date);
  const currentDate = text(now).slice(0, 10);
  const attendedHistorical = output.attended === true
    || (output.attending === true && /^\d{4}-\d{2}-\d{2}$/.test(activeDate) && activeDate < currentDate);
  const history = [];
  if (status === 'cancelled') {
    if (attendedHistorical) {
      history.push(lifecycleHistoryEntry('provider_status_conflict', output, candidate, now, { observedStatus: 'cancelled' }));
    } else {
      output.lifecycleStatus = 'cancelled';
      history.push(lifecycleHistoryEntry('cancelled', output, candidate, now));
    }
  } else if (status === 'postponed') {
    if (attendedHistorical) {
      history.push(lifecycleHistoryEntry('provider_status_conflict', output, candidate, now, { observedStatus: 'postponed' }));
    } else {
      if (!(output.lifecycleStatus === 'postponed' && !activeDate)) {
        history.push(lifecycleHistoryEntry('postponed', output, candidate, now, { replacementDate: null }));
      }
      output.date = null;
      output.time = null;
      output.lifecycleStatus = 'postponed';
    }
  } else if (continuity && text(candidate?.date) && text(candidate.date) !== text(output.date)) {
    if (attendedHistorical) {
      history.push(lifecycleHistoryEntry('provider_date_conflict', output, candidate, now, { observedDate: text(candidate.date) }));
    } else {
      history.push(lifecycleHistoryEntry('rescheduled', output, candidate, now));
      output.date = text(candidate.date);
      output = applyReplacementVenue(output, existing, candidate, venueIndex);
      if (candidate.time != null) output.time = candidate.time;
      output.lifecycleStatus = 'rescheduled';
    }
  } else if (output.lifecycleStatus === 'postponed' && text(candidate?.date)) {
    history.push(lifecycleHistoryEntry('rescheduled', output, candidate, now));
    output.date = text(candidate.date);
    output = applyReplacementVenue(output, existing, candidate, venueIndex);
    if (candidate.time != null) output.time = candidate.time;
    output.lifecycleStatus = 'rescheduled';
  }
  if (history.length) output.lifecycleHistory = mergeLifecycleHistory(output.lifecycleHistory, history);
  return output;
}

function uniqueConcertId(candidate, records) {
  const ids = new Set((records || []).map((record) => text(record?.id)).filter(Boolean));
  const base = text(candidate?.id) || `${text(candidate?.bandId)}-${text(candidate?.date) || 'date-tbd'}-${slugify(candidate?.city || candidate?.venue || 'concert')}`;
  if (!ids.has(base)) return base;
  const suffix = slugify(`${providerNamespace(candidate)}-${providerEventId(candidate) || 'observation'}`) || 'observation';
  let value = `${base}-${suffix}`;
  let number = 2;
  while (ids.has(value)) value = `${base}-${suffix}-${number++}`;
  return value;
}

function ingestCandidate(records, candidate, options = {}) {
  const list = clone(Array.isArray(records) ? records : []);
  const result = reconcileCandidate(list, candidate, options);
  if (result.action === 'hold_for_review') return { records: list, result, changed: false };
  if (result.action === 'add') {
    const added = applyCandidateToConcert({ ...clone(candidate), id: uniqueConcertId(candidate, list) }, candidate, options);
    return { records: [...list, added], result: { ...result, concert: added }, changed: true };
  }
  const index = list.findIndex((record) => text(record?.id) === text(result.concert?.id));
  if (index < 0) return { records: list, result: { action: 'hold_for_review', reason: 'stable_concert_missing' }, changed: false };
  const lifecycleContinuation = result.action === 'lifecycle_continuation';
  const updated = applyCandidateToConcert(list[index], candidate, {
    ...options,
    continuity: lifecycleContinuation,
    continuityReason: lifecycleContinuation ? result.reason : '',
  });
  const changed = stableValue(updated) !== stableValue(list[index]);
  if (changed) list[index] = updated;
  return { records: list, result: { ...result, concert: updated }, changed };
}

function reconcileBatch(records, candidates, options = {}) {
  let current = clone(Array.isArray(records) ? records : []);
  const results = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const applied = ingestCandidate(current, candidate, options);
    current = applied.records;
    results.push(applied.result);
  }
  return { records: current, results };
}

module.exports = {
  PROVIDER_FIELDS,
  providerNamespace,
  providerEventId,
  providerKey,
  lifecycleStatus,
  isLifecycleObservation,
  observationFromCandidate,
  observationFingerprint,
  mergeProviderObservations,
  providerReferences,
  buildProviderIndex,
  reconcileCandidate,
  applyCandidateToConcert,
  ingestCandidate,
  reconcileBatch,
};