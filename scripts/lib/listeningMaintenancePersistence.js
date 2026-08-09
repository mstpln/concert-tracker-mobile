'use strict';

const config = require('./config');
const { UsageTracker, freshState, ensureMusicbrainzState } = require('./usageTracker');
const { createListeningMaintenanceUsageGate } = require('./listeningMaintenanceUsage');

const TRACK_IDENTITIES_PATH = 'listening/track-identities.json';
const SPOTIFY_METADATA_PATH = 'listening/spotify-metadata.json';
const API_USAGE_PATH = 'apiUsage.json';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultIdentities() {
  return { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
}

function defaultSpotifyMetadata() {
  return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
}

function normalizeMaintenanceUsageState(state, today = new Date().toISOString().slice(0, 10)) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = freshState();
  const defaults = freshState();
  if (!state.spotify || typeof state.spotify !== 'object' || Array.isArray(state.spotify)) state.spotify = defaults.spotify;
  state.spotify.dailyCap = config.SPOTIFY.dailyCap;
  state.spotify.perRunCap = config.SPOTIFY.perRunCap;
  if (state.spotify.dayOfCounts !== today) {
    state.spotify.dayOfCounts = today;
    state.spotify.callsToday = 0;
  }
  const callsToday = Number(state.spotify.callsToday);
  state.spotify.callsToday = Number.isFinite(callsToday) && callsToday >= 0 ? callsToday : 0;
  state.spotify.callsThisRun = 0;
  ensureMusicbrainzState(state);
  state.musicbrainz.callsThisRun = 0;
  return state;
}

async function loadListeningMaintenanceContext(client, { today } = {}) {
  if (!client || typeof client.readJson !== 'function' || typeof client.writeJsonStrict !== 'function') {
    throw new Error('Listening maintenance persistence requires a conditional Worker client.');
  }

  const trackIdentities = await client.readJson(TRACK_IDENTITIES_PATH, defaultIdentities());
  const spotifyMetadata = await client.readJson(SPOTIFY_METADATA_PATH, defaultSpotifyMetadata());
  const rawUsage = await client.readJson(API_USAGE_PATH, freshState());
  let persistedUsageBase = clone(rawUsage);
  let persistedIdentities = clone(trackIdentities);
  let persistedMetadata = clone(spotifyMetadata);

  const usageTracker = new UsageTracker(normalizeMaintenanceUsageState(clone(rawUsage), today));
  const baseUsage = createListeningMaintenanceUsageGate(usageTracker);
  const checkpoint = clone(rawUsage?.listeningMaintenance?.checkpoint || null);

  async function persistUsageBeforeProvider(provider) {
    const allowed = await baseUsage.reserve(provider);
    if (!allowed) return false;
    try {
      await client.writeJsonStrict(API_USAGE_PATH, usageTracker.state);
    } catch (error) {
      const wrapped = new Error(`Listening maintenance could not persist ${provider} usage before the provider request.`);
      wrapped.code = 'USAGE_PERSIST_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
    persistedUsageBase = clone(usageTracker.state);
    return true;
  }

  const usage = {
    reserve: persistUsageBeforeProvider,
    state: baseUsage.state,
  };

  async function preflight(snapshot) {
    const remoteUsage = await client.readJson(API_USAGE_PATH, freshState());
    if (!same(remoteUsage, persistedUsageBase)) throw new Error('Listening maintenance apiUsage changed after load.');
    const remoteMetadata = await client.readJson(SPOTIFY_METADATA_PATH, defaultSpotifyMetadata());
    if (!same(remoteMetadata, snapshot.spotifyMetadata) || !same(remoteMetadata, persistedMetadata)) {
      throw new Error('Listening maintenance Spotify metadata changed after load.');
    }
    const remoteIdentities = await client.readJson(TRACK_IDENTITIES_PATH, defaultIdentities());
    if (!same(remoteIdentities, snapshot.trackIdentities) || !same(remoteIdentities, persistedIdentities)) {
      throw new Error('Listening maintenance track identities changed after load.');
    }
    return true;
  }

  async function persist(snapshot) {
    if (!usageTracker.state.listeningMaintenance || typeof usageTracker.state.listeningMaintenance !== 'object') {
      throw new Error('Listening maintenance usage state is unavailable.');
    }
    usageTracker.state.listeningMaintenance.checkpoint = clone(snapshot.checkpoint);

    // Provider usage was already conditionally persisted before the request.
    // Persist again here to attach the durable checkpoint before derived state.
    await client.writeJsonStrict(API_USAGE_PATH, usageTracker.state);
    persistedUsageBase = clone(usageTracker.state);

    if (!same(snapshot.spotifyMetadata, persistedMetadata)) {
      await client.writeJsonStrict(SPOTIFY_METADATA_PATH, snapshot.spotifyMetadata);
      persistedMetadata = clone(snapshot.spotifyMetadata);
    }
    if (!same(snapshot.trackIdentities, persistedIdentities)) {
      await client.writeJsonStrict(TRACK_IDENTITIES_PATH, snapshot.trackIdentities);
      persistedIdentities = clone(snapshot.trackIdentities);
    }
    return true;
  }

  return {
    trackIdentities,
    spotifyMetadata,
    checkpoint,
    usageTracker,
    usage,
    preflight,
    persist,
  };
}

module.exports = {
  TRACK_IDENTITIES_PATH,
  SPOTIFY_METADATA_PATH,
  API_USAGE_PATH,
  defaultIdentities,
  defaultSpotifyMetadata,
  normalizeMaintenanceUsageState,
  loadListeningMaintenanceContext,
};
