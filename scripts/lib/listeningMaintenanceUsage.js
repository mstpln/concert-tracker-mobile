'use strict';

const config = require('./config');
const { sleep } = require('./util');

const DEFAULT_LISTENBRAINZ_PER_RUN_CAP = 25;
const DEFAULT_LISTENBRAINZ_MIN_DELAY_MS = 1000;

function safeCounter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function safeDateMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureMaintenanceState(usage) {
  if (!usage || !usage.state || typeof usage.state !== 'object') {
    throw new Error('Listening maintenance requires a loaded UsageTracker.');
  }
  const existing = usage.state.listeningMaintenance;
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    usage.state.listeningMaintenance = {};
  }
  const state = usage.state.listeningMaintenance;
  state.spotifyCallsThisRun = safeCounter(state.spotifyCallsThisRun);
  state.musicbrainzCallsThisRun = safeCounter(state.musicbrainzCallsThisRun);
  state.listenbrainzCallsThisRun = safeCounter(state.listenbrainzCallsThisRun);
  if (!('listenbrainzLastCallAt' in state) || !safeDateMs(state.listenbrainzLastCallAt)) state.listenbrainzLastCallAt = null;
  if (!('lastRun' in state)) state.lastRun = null;
  return state;
}

async function waitForPersistedGap(lastCallAt, minDelayMs, now, sleepImpl) {
  const previous = safeDateMs(lastCallAt);
  if (!previous || minDelayMs <= 0) return;
  const gap = now() - previous;
  if (gap < minDelayMs) await sleepImpl(minDelayMs - gap);
}

function createListeningMaintenanceUsageGate(usage, {
  listenbrainzPerRunCap = DEFAULT_LISTENBRAINZ_PER_RUN_CAP,
  listenbrainzMinDelayMs = DEFAULT_LISTENBRAINZ_MIN_DELAY_MS,
  now = () => Date.now(),
  sleepImpl = sleep,
} = {}) {
  if (!Number.isInteger(listenbrainzPerRunCap) || listenbrainzPerRunCap < 1 || listenbrainzPerRunCap > 100) {
    throw new Error('Invalid ListenBrainz maintenance per-run cap.');
  }
  if (!Number.isInteger(listenbrainzMinDelayMs) || listenbrainzMinDelayMs < 0) {
    throw new Error('Invalid ListenBrainz maintenance pacing.');
  }
  const state = ensureMaintenanceState(usage);
  state.spotifyCallsThisRun = 0;
  state.musicbrainzCallsThisRun = 0;
  state.listenbrainzCallsThisRun = 0;
  let firstMusicbrainzReservation = true;
  let lastListenbrainzCallAt = safeDateMs(state.listenbrainzLastCallAt);
  const startedAt = new Date(now()).toISOString();

  async function reserve(provider) {
    if (provider === 'spotify') {
      if (typeof usage.canCallSpotify !== 'function' || typeof usage.recordSpotifyCall !== 'function') return false;
      if (!usage.canCallSpotify()) return false;
      await usage.recordSpotifyCall();
      state.spotifyCallsThisRun += 1;
      return true;
    }
    if (provider === 'musicbrainz') {
      if (typeof usage.canCallMusicbrainz !== 'function' || typeof usage.recordMusicbrainzAttempt !== 'function') return false;
      if (!usage.canCallMusicbrainz()) return false;
      if (firstMusicbrainzReservation) {
        await waitForPersistedGap(usage.state.musicbrainz?.lastCallAt, config.MUSICBRAINZ.minDelayMs, now, sleepImpl);
        firstMusicbrainzReservation = false;
      }
      await usage.recordMusicbrainzAttempt();
      usage.state.musicbrainz.lastCallAt = new Date(now()).toISOString();
      state.musicbrainzCallsThisRun += 1;
      return true;
    }
    if (provider === 'listenbrainz') {
      if (state.listenbrainzCallsThisRun >= listenbrainzPerRunCap) return false;
      const current = now();
      const gap = current - lastListenbrainzCallAt;
      if (lastListenbrainzCallAt && gap < listenbrainzMinDelayMs) {
        await sleepImpl(listenbrainzMinDelayMs - gap);
      }
      lastListenbrainzCallAt = now();
      state.listenbrainzLastCallAt = new Date(lastListenbrainzCallAt).toISOString();
      state.listenbrainzCallsThisRun += 1;
      return true;
    }
    return false;
  }

  function finish(summary = {}) {
    state.lastRun = {
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      spotifyCalls: state.spotifyCallsThisRun,
      musicbrainzCalls: state.musicbrainzCallsThisRun,
      listenbrainzCalls: state.listenbrainzCallsThisRun,
      ...summary,
    };
    return state.lastRun;
  }

  return { reserve, finish, state };
}

module.exports = {
  DEFAULT_LISTENBRAINZ_PER_RUN_CAP,
  DEFAULT_LISTENBRAINZ_MIN_DELAY_MS,
  safeDateMs,
  ensureMaintenanceState,
  waitForPersistedGap,
  createListeningMaintenanceUsageGate,
};
