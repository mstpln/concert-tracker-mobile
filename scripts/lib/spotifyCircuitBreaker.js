'use strict';

// Shared persisted Spotify safety state for Node-side research and trusted
// maintenance. The circuit lives inside apiUsage.json.spotify so separate
// invocations that use UsageTracker inherit the same provider backoff. It
// does not change Spotify's provider limits; it only prevents BANDMARKR from
// repeatedly probing while a known 429/quota condition is still active.

const RATE_LIMIT_FALLBACK_MS = 30 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_SAFETY_MS = 1000;
const USAGE_PATCH = Symbol.for('bandmarkr.dab6.spotifyUsageCircuit');
const MODULE_PATCH = Symbol.for('bandmarkr.dab6.spotifyModuleCircuit');
const VALID_REASONS = new Set(['rate_limited', 'quota_exceeded']);

function validDateMs(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNowMs(value = Date.now()) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function circuitValidation(value) {
  if (value == null) return { valid: true, circuit: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, circuit: null };
  if (!['open', 'closed'].includes(value.status)) return { valid: false, circuit: null };
  if (value.status === 'closed') return { valid: true, circuit: value };
  if (!VALID_REASONS.has(value.reason)) return { valid: false, circuit: null };
  if (validDateMs(value.openedAt) == null || validDateMs(value.blockedUntil) == null) return { valid: false, circuit: null };
  return { valid: true, circuit: value };
}

function spotifyCircuitBlockReason(spotifyState, nowMs = Date.now()) {
  const checked = circuitValidation(spotifyState?.circuit);
  if (!checked.valid) return 'circuit_state_invalid';
  const circuit = checked.circuit;
  if (!circuit || circuit.status === 'closed') return null;
  if (validDateMs(circuit.blockedUntil) <= safeNowMs(nowMs)) return null;
  return circuit.reason === 'quota_exceeded' ? 'quota_circuit_open' : 'rate_limit_circuit_open';
}

function ensureSpotifyUsageState(usage) {
  if (!usage?.state || typeof usage.state !== 'object' || !usage.state.spotify || typeof usage.state.spotify !== 'object' || Array.isArray(usage.state.spotify)) {
    throw new Error('Spotify circuit requires a loaded UsageTracker Spotify state.');
  }
  return usage.state.spotify;
}

function parseRetryAfterBlockedUntil(value, nowMs) {
  if (value == null || value === '') return null;
  const normalizedNow = safeNowMs(nowMs);
  const seconds = typeof value === 'number'
    ? value
    : (/^\s*\d+(?:\.\d+)?\s*$/.test(String(value)) ? Number(value) : NaN);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return normalizedNow + Math.ceil(seconds * 1000) + RETRY_AFTER_SAFETY_MS;
  }
  const absolute = validDateMs(value);
  return absolute != null && absolute > normalizedNow ? absolute + RETRY_AFTER_SAFETY_MS : null;
}

function retryBlockedUntil(outcome, nowMs) {
  const normalizedNow = safeNowMs(nowMs);
  for (const value of [outcome?.retryAfterSeconds, outcome?.retryAfter]) {
    const blockedUntil = parseRetryAfterBlockedUntil(value, normalizedNow);
    if (blockedUntil != null) return blockedUntil;
  }
  return normalizedNow + RATE_LIMIT_FALLBACK_MS;
}

function openCircuit(spotifyState, reason, blockedUntilMs, nowMs) {
  const checked = circuitValidation(spotifyState.circuit);
  if (!checked.valid) throw new Error('Spotify circuit state is invalid; refusing to overwrite it.');
  const previous = checked.circuit || {};
  const previousBlockedUntilMs = previous.status === 'open' ? validDateMs(previous.blockedUntil) : null;
  const active = previous.status === 'open' && previousBlockedUntilMs > nowMs;
  const nextBlockedUntilMs = active ? Math.max(previousBlockedUntilMs, blockedUntilMs) : blockedUntilMs;
  const nextReason = active && previous.reason === 'quota_exceeded' ? 'quota_exceeded' : reason;
  const next = {
    ...previous,
    status: 'open',
    reason: nextReason,
    openedAt: active ? previous.openedAt : new Date(nowMs).toISOString(),
    blockedUntil: new Date(nextBlockedUntilMs).toISOString(),
  };
  const changed = JSON.stringify(previous) !== JSON.stringify(next);
  spotifyState.circuit = next;
  return { changed, reason: next.reason, blockedUntil: next.blockedUntil };
}

function closeExpiredCircuit(spotifyState, nowMs) {
  const checked = circuitValidation(spotifyState.circuit);
  if (!checked.valid || !checked.circuit || checked.circuit.status !== 'open') return { changed: false };
  if (validDateMs(checked.circuit.blockedUntil) > nowMs) return { changed: false };
  spotifyState.circuit = {
    ...checked.circuit,
    status: 'closed',
    reason: null,
    blockedUntil: null,
    lastSuccessfulProbeAt: new Date(nowMs).toISOString(),
  };
  return { changed: true };
}

function textLooksRateLimited(value) {
  return typeof value === 'string' && (/(?:^|[^0-9])429(?:[^0-9]|$)/.test(value) || /http_429/i.test(value));
}

function textLooksQuotaExceeded(value) {
  return typeof value === 'string' && /(?:spotify[_ -]?)?quota[_ -]?exceeded/i.test(value);
}

function spotifyCircuitSignalFromResult(result, { successKinds = [], allowSuccess = true } = {}) {
  if (typeof result === 'string' && result) return allowSuccess ? { type: 'success' } : null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const reason = result.reason || result.error || result.errorCode || result.code || result.identity?.errorCategory || null;
  if (
    result.kind === 'quota_exceeded'
    || result.quotaExceeded === true
    || textLooksQuotaExceeded(reason)
    || textLooksQuotaExceeded(result.errorCode)
    || textLooksQuotaExceeded(result.code)
  ) {
    return { type: 'quota' };
  }
  if (result.status === 429 || result.kind === 'rate_limited' || textLooksRateLimited(reason)) {
    return {
      type: 'rate_limit',
      retryAfterSeconds: result.retryAfterSeconds,
      retryAfter: result.retryAfter,
    };
  }
  if (allowSuccess && successKinds.includes(result.kind)) return { type: 'success' };
  return null;
}

function spotifyCircuitSignalFromError(error) {
  if (!error) return null;
  if (
    error.quotaExceeded === true
    || textLooksQuotaExceeded(error.code)
    || textLooksQuotaExceeded(error.errorCode)
    || textLooksQuotaExceeded(error.message)
  ) return { type: 'quota' };
  const message = error.message || error.code || '';
  if (Number(error.status) === 429 || textLooksRateLimited(message)) {
    return {
      type: 'rate_limit',
      retryAfterSeconds: error.retryAfterSeconds,
      retryAfter: error.retryAfter,
    };
  }
  return null;
}

function reportSpotifyCircuitSignal(usage, signal, { nowMs = Date.now() } = {}) {
  if (!signal) return { changed: false };
  const spotifyState = ensureSpotifyUsageState(usage);
  const currentMs = safeNowMs(nowMs);
  if (signal.type === 'quota') {
    return openCircuit(spotifyState, 'quota_exceeded', currentMs + QUOTA_COOLDOWN_MS, currentMs);
  }
  if (signal.type === 'rate_limit') {
    return openCircuit(spotifyState, 'rate_limited', retryBlockedUntil(signal, currentMs), currentMs);
  }
  if (signal.type === 'success') return closeExpiredCircuit(spotifyState, currentMs);
  return { changed: false };
}

async function applyAndPersistSpotifyCircuitSignal(usage, signal, { nowMs = Date.now() } = {}) {
  if (!signal) return { changed: false };
  const result = typeof usage?.reportSpotifyCircuitSignal === 'function'
    ? usage.reportSpotifyCircuitSignal(signal)
    : reportSpotifyCircuitSignal(usage, signal, { nowMs });
  if (!result.changed) return result;
  if (typeof usage?.save !== 'function') throw new Error('Spotify circuit changed but UsageTracker.save() is unavailable.');
  try {
    await usage.save();
  } catch (error) {
    const wrapped = new Error(`Spotify circuit state could not be persisted: ${error.message}`);
    wrapped.code = 'SPOTIFY_CIRCUIT_SAVE_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
  return result;
}

function installUsageTrackerSpotifyCircuit(UsageTracker, { now = () => Date.now() } = {}) {
  const prototype = UsageTracker?.prototype;
  if (!prototype || typeof prototype.canCallSpotify !== 'function') throw new Error('DAB6 requires UsageTracker.canCallSpotify().');
  if (prototype[USAGE_PATCH]) return false;
  const originalCanCallSpotify = prototype.canCallSpotify;

  Object.defineProperty(prototype, USAGE_PATCH, { value: true, enumerable: false });
  prototype.spotifyCircuitBlockReason = function spotifyCircuitReason() {
    const circuitReason = spotifyCircuitBlockReason(this.state?.spotify, now());
    if (circuitReason) return circuitReason;
    const spotify = this.state?.spotify || {};
    if (Number(spotify.callsThisRun) >= Number(spotify.perRunCap)) return 'per_run_cap';
    if (Number(spotify.callsToday) >= Number(spotify.dailyCap)) return 'daily_cap';
    return null;
  };
  prototype.canCallSpotify = function dab6CanCallSpotify() {
    if (spotifyCircuitBlockReason(this.state?.spotify, now())) return false;
    return originalCanCallSpotify.call(this);
  };
  prototype.reportSpotifyCircuitSignal = function reportSignal(signal) {
    return reportSpotifyCircuitSignal(this, signal, { nowMs: now() });
  };
  return true;
}

function spotifyCallsThisRun(usage) {
  const value = Number(usage?.state?.spotify?.callsThisRun);
  return Number.isFinite(value) ? value : null;
}

async function reportModuleResult(usage, result, successKinds, callsBefore) {
  if (!usage) return;
  const callsAfter = spotifyCallsThisRun(usage);
  const allowSuccess = callsBefore != null && callsAfter != null && callsAfter > callsBefore;
  const signal = spotifyCircuitSignalFromResult(result, { successKinds, allowSuccess });
  if (!signal) return;
  await applyAndPersistSpotifyCircuitSignal(usage, signal);
}

function installSpotifyModuleCircuit(spotify) {
  if (!spotify || typeof spotify !== 'object') throw new Error('DAB6 requires the Spotify provider module.');
  if (spotify[MODULE_PATCH]) return false;
  Object.defineProperty(spotify, MODULE_PATCH, { value: true, enumerable: false });

  const originalSearchTrackOutcome = spotify.searchTrackOutcome;
  const originalResolveSongLinks = spotify.resolveSongLinks;
  const originalResolveArtistIdentity = spotify.resolveArtistIdentity;
  const originalListArtistReleases = spotify.listArtistReleases;
  const originalGetReleaseTracks = spotify.getReleaseTracks;
  const originalMatchPredictedSong = spotify.matchPredictedSong;

  spotify.searchTrackOutcome = async function dab6SearchTrackOutcome(songTitle, bandName, usage, options) {
    const callsBefore = spotifyCallsThisRun(usage);
    const result = await originalSearchTrackOutcome(songTitle, bandName, usage, options);
    await reportModuleResult(usage, result, ['ok', 'no_match'], callsBefore);
    return result;
  };

  spotify.resolveSongLinks = async function dab6ResolveSongLinks(songs, bandName, usage, options = {}) {
    if (typeof options.search === 'function') return originalResolveSongLinks(songs, bandName, usage, options);
    return originalResolveSongLinks(songs, bandName, usage, { ...options, search: spotify.searchTrackOutcome });
  };

  spotify.resolveArtistIdentity = async function dab6ResolveArtistIdentity(args) {
    const callsBefore = spotifyCallsThisRun(args?.usage);
    const result = await originalResolveArtistIdentity(args);
    await reportModuleResult(args?.usage, result, ['confirmed', 'no_match', 'needs_review'], callsBefore);
    return result;
  };

  spotify.listArtistReleases = async function dab6ListArtistReleases(artistId, usage, options) {
    const callsBefore = spotifyCallsThisRun(usage);
    const result = await originalListArtistReleases(artistId, usage, options);
    await reportModuleResult(usage, result, ['ok'], callsBefore);
    return result;
  };

  spotify.getReleaseTracks = async function dab6GetReleaseTracks(releaseId, usage, options) {
    const callsBefore = spotifyCallsThisRun(usage);
    const result = await originalGetReleaseTracks(releaseId, usage, options);
    await reportModuleResult(usage, result, ['ok'], callsBefore);
    return result;
  };

  spotify.matchPredictedSong = async function dab6MatchPredictedSong(song, spotifyArtistId, usage, options) {
    const callsBefore = spotifyCallsThisRun(usage);
    const result = await originalMatchPredictedSong(song, spotifyArtistId, usage, options);
    await reportModuleResult(usage, result, ['ok', 'no_match'], callsBefore);
    return result;
  };
  return true;
}

module.exports = {
  RATE_LIMIT_FALLBACK_MS,
  QUOTA_COOLDOWN_MS,
  RETRY_AFTER_SAFETY_MS,
  validDateMs,
  circuitValidation,
  spotifyCircuitBlockReason,
  parseRetryAfterBlockedUntil,
  retryBlockedUntil,
  spotifyCircuitSignalFromResult,
  spotifyCircuitSignalFromError,
  reportSpotifyCircuitSignal,
  applyAndPersistSpotifyCircuitSignal,
  installUsageTrackerSpotifyCircuit,
  installSpotifyModuleCircuit,
};
