'use strict';

const crypto = require('node:crypto');
const identities = require('../providerIdentityState');

const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function cleanList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
}

function validSpotifyId(value) {
  const text = clean(value);
  return text && SPOTIFY_ID.test(text) ? text : null;
}

function validMbid(value) {
  const text = clean(value)?.toLowerCase() || null;
  return text && MBID.test(text) ? text : null;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function bandIndex(bands = []) {
  const byId = new Map();
  const byName = new Map();
  const ambiguousNames = new Set();

  for (const band of bands || []) {
    const id = clean(band?.id);
    const name = normalizeText(band?.name);
    if (!id) continue;
    byId.set(id, band);
    if (!name || ambiguousNames.has(name)) continue;
    const existing = byName.get(name);
    if (existing && existing !== id) {
      byName.delete(name);
      ambiguousNames.add(name);
    } else if (!existing) {
      byName.set(name, id);
    }
  }

  return { byId, byName, ambiguousNames };
}

function mappedBandId(event, index) {
  const explicit = clean(event?.bandId || event?.localBandId);
  if (explicit) return index.byId.has(explicit) ? explicit : null;
  return index.byName.get(normalizeText(event?.artistCreditName)) || null;
}

function trustedBandIdentity(band) {
  const musicbrainz = identities.providerRecord(band, 'musicbrainz');
  const spotify = identities.providerRecord(band, 'spotify');
  return {
    bandId: clean(band?.id),
    musicbrainzArtistMbid: identities.isConfirmed(musicbrainz, 'musicbrainz') ? validMbid(musicbrainz?.mbid) : null,
    spotifyArtistId: identities.isConfirmed(spotify, 'spotify') ? validSpotifyId(spotify?.id) : null,
  };
}

function sourceRecordingMbids(event) {
  return cleanList([
    event?.recordingMbid,
    event?.musicbrainzRecordingId,
  ].map(validMbid).filter(Boolean));
}

function sourceArtistMbids(event) {
  return cleanList([
    event?.artistMbid,
    event?.musicbrainzArtistId,
    ...(Array.isArray(event?.artistMbids) ? event.artistMbids : []),
    ...(Array.isArray(event?.musicbrainzArtistIds) ? event.musicbrainzArtistIds : []),
  ].map(validMbid).filter(Boolean));
}

function textTrackKey(event, bandId) {
  const title = normalizeText(event?.recordingTitle);
  if (!bandId || !title) return null;
  return `listenbrainz:${stableHash(`${bandId}\n${title}`)}`;
}

function workKey(event, bandId) {
  const spotifyTrackId = validSpotifyId(event?.spotifyTrackId);
  return spotifyTrackId ? `spotify:${spotifyTrackId}` : textTrackKey(event, bandId);
}

function newWorkItem({ trackKey, bandId, event, bandIdentity }) {
  return {
    trackKey,
    bandIds: [bandId],
    bandId,
    sourceEventCount: 0,
    spotifyTrackId: validSpotifyId(event?.spotifyTrackId),
    trustedSpotifyArtistId: bandIdentity?.spotifyArtistId || null,
    trustedMusicbrainzArtistMbid: bandIdentity?.musicbrainzArtistMbid || null,
    sourceMusicbrainzRecordingMbids: [],
    sourceMusicbrainzArtistMbids: [],
    sourceListenbrainzRecordingMsids: [],
    normalizedRecordingTitle: normalizeText(event?.recordingTitle) || null,
    status: 'unresolved',
    reason: null,
  };
}

function addUnique(list, values) {
  const set = new Set(list);
  for (const value of values || []) if (value) set.add(value);
  return [...set].sort();
}

function normalizeIdentityDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return {};
  return document.records && typeof document.records === 'object' && !Array.isArray(document.records)
    ? document.records
    : {};
}

function normalizeSpotifyMetadata(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return {};
  return document.records && typeof document.records === 'object' && !Array.isArray(document.records)
    ? document.records
    : {};
}

function buildListeningInventory({ bands = [], events = [], spotifyMetadata = null, trackIdentities = null } = {}) {
  const index = bandIndex(bands);
  const trustedByBand = new Map((bands || []).map((band) => [clean(band?.id), trustedBandIdentity(band)]).filter(([id]) => id));
  const work = new Map();
  let mappedEvents = 0;
  let unmappedEvents = 0;
  let unusableEvents = 0;

  for (const event of events || []) {
    const bandId = mappedBandId(event, index);
    if (!bandId) {
      unmappedEvents += 1;
      continue;
    }
    const trackKey = workKey(event, bandId);
    if (!trackKey) {
      unusableEvents += 1;
      continue;
    }
    mappedEvents += 1;
    const bandIdentity = trustedByBand.get(bandId) || { bandId };
    let item = work.get(trackKey);
    if (!item) {
      item = newWorkItem({ trackKey, bandId, event, bandIdentity });
      work.set(trackKey, item);
    } else if (!item.bandIds.includes(bandId)) {
      item.bandIds = addUnique(item.bandIds, [bandId]);
      item.bandId = null;
      item.status = 'blocked';
      item.reason = 'band_conflict';
      item.trustedSpotifyArtistId = null;
      item.trustedMusicbrainzArtistMbid = null;
    }
    item.sourceEventCount += 1;
    item.sourceMusicbrainzRecordingMbids = addUnique(item.sourceMusicbrainzRecordingMbids, sourceRecordingMbids(event));
    item.sourceMusicbrainzArtistMbids = addUnique(item.sourceMusicbrainzArtistMbids, sourceArtistMbids(event));
    item.sourceListenbrainzRecordingMsids = addUnique(item.sourceListenbrainzRecordingMsids, [clean(event?.listenbrainzRecordingMsid)].filter(Boolean));
  }

  const identityRecords = normalizeIdentityDocument(trackIdentities);
  const metadataRecords = normalizeSpotifyMetadata(spotifyMetadata);
  const items = [...work.values()].sort((a, b) => a.trackKey.localeCompare(b.trackKey));

  for (const item of items) {
    if (item.reason === 'band_conflict') continue;

    const existingIdentity = identityRecords[item.trackKey];
    const existingRecordingMbid = validMbid(existingIdentity?.musicbrainzRecordingMbid || existingIdentity?.recordingMbid);
    if (existingRecordingMbid) {
      item.status = 'complete';
      item.reason = 'existing_track_identity';
      continue;
    }

    if (item.sourceMusicbrainzRecordingMbids.length === 1) {
      item.status = 'complete';
      item.reason = 'source_recording_mbid';
      continue;
    }
    if (item.sourceMusicbrainzRecordingMbids.length > 1) {
      item.status = 'blocked';
      item.reason = 'source_recording_conflict';
      continue;
    }

    if (item.spotifyTrackId) {
      const metadata = metadataRecords[item.spotifyTrackId];
      if (metadata?.spotifyTrackId === item.spotifyTrackId) {
        const isrc = clean(metadata.isrc);
        item.status = isrc ? 'needs_musicbrainz' : 'spotify_metadata_present';
        item.reason = isrc ? 'spotify_metadata_with_isrc' : 'spotify_metadata_without_isrc';
      } else {
        item.status = 'needs_spotify';
        item.reason = 'missing_spotify_metadata';
      }
      continue;
    }

    item.status = item.trustedMusicbrainzArtistMbid ? 'needs_listenbrainz_fallback' : 'blocked';
    item.reason = item.trustedMusicbrainzArtistMbid ? 'exact_id_routes_exhausted' : 'missing_trusted_musicbrainz_artist';
  }

  const counts = {
    sourceEvents: (events || []).length,
    mappedEvents,
    unmappedEvents,
    unusableEvents,
    uniqueTracks: items.length,
    spotifyKeyTracks: items.filter((item) => Boolean(item.spotifyTrackId)).length,
    textFallbackTracks: items.filter((item) => !item.spotifyTrackId).length,
    existingSpotifyMetadataTracks: items.filter((item) => item.reason === 'spotify_metadata_with_isrc' || item.reason === 'spotify_metadata_without_isrc').length,
    sourceRecordingIdentityTracks: items.filter((item) => item.reason === 'source_recording_mbid').length,
    existingTrackIdentityTracks: items.filter((item) => item.reason === 'existing_track_identity').length,
    needsSpotifyTracks: items.filter((item) => item.status === 'needs_spotify').length,
    needsMusicbrainzTracks: items.filter((item) => item.status === 'needs_musicbrainz').length,
    needsListenbrainzFallbackTracks: items.filter((item) => item.status === 'needs_listenbrainz_fallback').length,
    blockedTracks: items.filter((item) => item.status === 'blocked').length,
    completeTracks: items.filter((item) => item.status === 'complete').length,
  };

  return { schemaVersion: 1, counts, items };
}

function safeInventorySummary(inventory) {
  const counts = inventory?.counts || {};
  const allowed = [
    'sourceEvents', 'mappedEvents', 'unmappedEvents', 'unusableEvents', 'uniqueTracks',
    'spotifyKeyTracks', 'textFallbackTracks', 'existingSpotifyMetadataTracks',
    'sourceRecordingIdentityTracks', 'existingTrackIdentityTracks', 'needsSpotifyTracks',
    'needsMusicbrainzTracks', 'needsListenbrainzFallbackTracks', 'blockedTracks', 'completeTracks',
  ];
  return Object.fromEntries(allowed.map((key) => [key, Number(counts[key]) || 0]));
}

module.exports = {
  SPOTIFY_ID,
  MBID,
  clean,
  cleanList,
  normalizeText,
  validSpotifyId,
  validMbid,
  stableHash,
  bandIndex,
  mappedBandId,
  trustedBandIdentity,
  sourceRecordingMbids,
  sourceArtistMbids,
  textTrackKey,
  workKey,
  buildListeningInventory,
  safeInventorySummary,
};
