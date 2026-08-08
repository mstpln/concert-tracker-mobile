'use strict';

const { sleep } = require('./util');

const DEFAULT_LISTENBRAINZ_PER_RUN_CAP = 25;
const DEFAULT_LISTENBRAINZ_MIN_DELAY_MS = 1000;

function safeCounter(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
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
  if (!('lastRun' in state)) state.lastRun = null;
  return state;
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
  let lastListenbrainzCallAt = 0;
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
      await usage.recordMusicbrainzAttempt();
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
  ensureMaintenanceState,
  createListeningMaintenanceUsageGate,
};
