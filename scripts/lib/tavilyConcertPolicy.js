'use strict';

const DAY = 86400000;
const EMPTY_BACKOFF_DAYS = Object.freeze([30, 60, 90]);
const ACTIVE_RECHECK_DAYS = 28;

function validTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function routeState(band) {
  return band?.structuredResearch?.routing?.tavilyConcert || {};
}

function latestTrustedConcertObservation(concerts, bandId) {
  return (Array.isArray(concerts) ? concerts : [])
    .filter((concert) => concert?.bandId === bandId && concert.ticketRetailerVerified === true)
    .map((concert) => validTime(concert.foundAt))
    .filter((value) => value !== null)
    .sort((a, b) => b - a)[0] || null;
}

function normalizedState(band, concerts, now = Date.now()) {
  const stored = routeState(band);
  const lastCheckedAt = validTime(stored.lastCheckedAt || band?.structuredResearch?.routing?.lastTavilyTourAt);
  const nextEligibleAt = validTime(stored.nextEligibleAt);
  const latestTrustedAt = latestTrustedConcertObservation(concerts, band?.id);
  const trustedSinceLastCheck = latestTrustedAt && (!lastCheckedAt || latestTrustedAt > lastCheckedAt);
  const consecutiveEmpty = trustedSinceLastCheck ? 0 : Math.max(0, Number(stored.consecutiveEmpty) || 0);
  return {
    consecutiveEmpty,
    lastCheckedAt,
    nextEligibleAt: trustedSinceLastCheck ? latestTrustedAt + ACTIVE_RECHECK_DAYS * DAY : nextEligibleAt,
    lastConcertFoundAt: validTime(stored.lastConcertFoundAt) || latestTrustedAt,
    trustedSinceLastCheck: Boolean(trustedSinceLastCheck),
    now,
  };
}

function eligibility(band, concerts, now = Date.now()) {
  const state = normalizedState(band, concerts, now);
  if (!state.lastCheckedAt) return { due: true, reason: 'first_concert_web_check', priority: 0, state };
  if (state.nextEligibleAt && state.nextEligibleAt > now) return { due: false, reason: 'backoff_not_due', priority: 99, state };
  if (state.trustedSinceLastCheck) return { due: true, reason: 'ticketmaster_activity_reset', priority: 1, state };
  return { due: true, reason: state.consecutiveEmpty ? 'inactive_backoff_due' : 'supplemental_concert_check', priority: state.consecutiveEmpty ? 3 : 2, state };
}

function nextState(band, concerts, foundCount, checkedAt = new Date().toISOString()) {
  const checkedMs = validTime(checkedAt) || Date.now();
  const current = normalizedState(band, concerts, checkedMs);
  if (foundCount > 0) {
    return {
      consecutiveEmpty: 0,
      lastCheckedAt: new Date(checkedMs).toISOString(),
      lastConcertFoundAt: new Date(checkedMs).toISOString(),
      nextEligibleAt: new Date(checkedMs + ACTIVE_RECHECK_DAYS * DAY).toISOString(),
      lastResult: 'concerts_found',
    };
  }
  const consecutiveEmpty = Math.min(3, current.consecutiveEmpty + 1);
  const backoffDays = EMPTY_BACKOFF_DAYS[Math.min(consecutiveEmpty - 1, EMPTY_BACKOFF_DAYS.length - 1)];
  return {
    consecutiveEmpty,
    lastCheckedAt: new Date(checkedMs).toISOString(),
    lastConcertFoundAt: current.lastConcertFoundAt ? new Date(current.lastConcertFoundAt).toISOString() : null,
    nextEligibleAt: new Date(checkedMs + backoffDays * DAY).toISOString(),
    lastResult: 'no_concerts_found',
  };
}

function dueBands(bands, concerts, now = Date.now()) {
  return (Array.isArray(bands) ? bands : [])
    .map((band, index) => ({ band, index, eligibility: eligibility(band, concerts, now) }))
    .filter((item) => item.eligibility.due)
    .sort((a, b) => a.eligibility.priority - b.eligibility.priority || a.index - b.index);
}

module.exports = { DAY, EMPTY_BACKOFF_DAYS, ACTIVE_RECHECK_DAYS, routeState, latestTrustedConcertObservation, normalizedState, eligibility, nextState, dueBands };
