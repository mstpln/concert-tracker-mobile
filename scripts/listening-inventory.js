'use strict';

const crypto = require('node:crypto');
const identities = require('../providerIdentityState');

const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const KNOWN_PROVIDERS = ['spotify', 'musicbrainz', 'listenbrainz'];
const TRACK_IDENTITY_STATUSES = new Set(['unresolved', 'resolved', 'no_match', 'needs_review', 'retry', 'error']);

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

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
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
  return `text:${stableHash(`${bandId}\n${title}`)}`;
}

function workKey(event, bandId) {
  const spotifyTrackId = validSpotifyId(event?.spotifyTrackId);
  return spotifyTrackId ? `spotify:${spotifyTrackId}` : textTrackKey(event, bandId);
}

function lookupPair(event) {
  const artistName = clean(event?.artistCreditName);
  const recordingName = clean(event?.recordingTitle);
  if (!artistName || !recordingName) return null;
  return {
    artistName,
    recordingName,
    key: `${normalizeText(artistName)}\n${normalizeText(recordingName)}`,
  };
}

function newWorkItem({ trackKey, bandId, event, bandIdentity }) {
  const lookup = lookupPair(event);
  return {
    trackKey,
    bandIds: [bandId],
    bandId,
    sourceEventCount: 0,
    spotifyTrackId: validSpotifyId(event?.spotifyTrackId),
    trustedSpotifyArtistId: bandIdentity?.spotifyArtistId || null,
    trustedMusicbrainzArtistMbid: bandIdentity?.musicbrainzArtistMbid || null,
    artistLookupName: lookup?.artistName || null,
    recordingLookupName: lookup?.recordingName || null,
    lookupTextKey: lookup?.key || null,
    lookupTextConflict: false,
    spotifyMetadataIsrc: null,
    sourceMusicbrainzRecordingMbids: [],
    sourceMusicbrainzArtistMbids: [],
    sourceListenbrainzRecordingMsids: [],
    normalizedRecordingTitle: normalizeText(event?.recordingTitle) || null,
    status: 'unresolved',
    reason: null,
  };
}

function addLookupEvidence(item, event) {
  if (item.lookupTextConflict) return;
  const lookup = lookupPair(event);
  if (!lookup) return;
  if (!item.lookupTextKey) {
    item.lookupTextKey = lookup.key;
    item.artistLookupName = lookup.artistName;
    item.recordingLookupName = lookup.recordingName;
    return;
  }
  if (item.lookupTextKey !== lookup.key) {
    item.lookupTextConflict = true;
    item.lookupTextKey = null;
    item.artistLookupName = null;
    item.recordingLookupName = null;
  }
}

function spotifyMetadataArtistConflict(item, metadata) {
  if (metadata?.spotifyArtistIds == null) return false;
  if (!Array.isArray(metadata.spotifyArtistIds) || metadata.spotifyArtistIds.length > 32) return true;
  if (!metadata.spotifyArtistIds.every((id) => typeof id === 'string' && Boolean(validSpotifyId(id)))) return true;
  return Boolean(item.trustedSpotifyArtistId && metadata.spotifyArtistIds.length
    && !metadata.spotifyArtistIds.includes(item.trustedSpotifyArtistId));
}

function storedProviderEntriesValid(identity) {
  if (!identity?.providers || typeof identity.providers !== 'object' || Array.isArray(identity.providers)) return true;
  return KNOWN_PROVIDERS.every((provider) => {
    if (!Object.prototype.hasOwnProperty.call(identity.providers, provider)) return true;
    const entry = identity.providers[provider];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (entry.status != null && typeof entry.status !== 'string') return false;
    if (entry.reason != null && typeof entry.reason !== 'string') return false;
    if (entry.checkedAt != null && !validDate(entry.checkedAt)) return false;
    return true;
  });
}

function storedIdentityState(item, identity) {
  if (identity === undefined) return { recordingMbid: null, conflict: false };
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return { recordingMbid: null, conflict: true };
  if (identity.workKey != null && (typeof identity.workKey !== 'string' || identity.workKey !== item.trackKey)) return { recordingMbid: null, conflict: true };
  if (identity.localBandId != null && (typeof identity.localBandId !== 'string' || !SAFE_ID.test(identity.localBandId)
    || (item.bandId && identity.localBandId !== item.bandId))) return { recordingMbid: null, conflict: true };
  if (identity.spotifyTrackId != null) {
    const storedTrackId = validSpotifyId(identity.spotifyTrackId);
    if (!storedTrackId || (item.spotifyTrackId && storedTrackId !== item.spotifyTrackId)) return { recordingMbid: null, conflict: true };
  }
  if (identity.isrc != null && (typeof identity.isrc !== 'string' || !ISRC.test(identity.isrc))) return { recordingMbid: null, conflict: true };
  if (identity.status != null && !TRACK_IDENTITY_STATUSES.has(identity.status)) return { recordingMbid: null, conflict: true };
  if (identity.updatedAt != null && !validDate(identity.updatedAt)) return { recordingMbid: null, conflict: true };
  if (identity.nextEligibleCheckAt != null && !validDate(identity.nextEligibleCheckAt)) return { recordingMbid: null, conflict: true };
  if (identity.providers != null && (!identity.providers || typeof identity.providers !== 'object' || Array.isArray(identity.providers))) {
    return { recordingMbid: null, conflict: true };
  }
  if (!storedProviderEntriesValid(identity)) return { recordingMbid: null, conflict: true };

  const recordingFields = ['musicbrainzRecordingId', 'musicbrainzRecordingMbid', 'recordingMbid'];
  if (!recordingFields.every((field) => identity[field] == null
    || (typeof identity[field] === 'string' && Boolean(validMbid(identity[field]))))) {
    return { recordingMbid: null, conflict: true };
  }
  const recordingMbids = [...new Set(recordingFields.map((field) => validMbid(identity[field])).filter(Boolean))];
  if (recordingMbids.length > 1) return { recordingMbid: null, conflict: true };

  if (identity.spotifyArtistIds != null) {
    if (!Array.isArray(identity.spotifyArtistIds) || identity.spotifyArtistIds.length > 32
      || !identity.spotifyArtistIds.every((id) => typeof id === 'string' && Boolean(validSpotifyId(id)))) {
      return { recordingMbid: null, conflict: true };
    }
    if (item.trustedSpotifyArtistId && identity.spotifyArtistIds.length
      && !identity.spotifyArtistIds.includes(item.trustedSpotifyArtistId)) {
      return { recordingMbid: null, conflict: true };
    }
  }
  if (identity.musicbrainzArtistIds != null) {
    if (!Array.isArray(identity.musicbrainzArtistIds) || identity.musicbrainzArtistIds.length > 32
      || !identity.musicbrainzArtistIds.every((id) => typeof id === 'string' && Boolean(validMbid(id)))) {
      return { recordingMbid: null, conflict: true };
    }
    const artistMbids = identity.musicbrainzArtistIds.map(validMbid);
    if (item.trustedMusicbrainzArtistMbid && artistMbids.length
      && !artistMbids.includes(item.trustedMusicbrainzArtistMbid)) {
      return { recordingMbid: null, conflict: true };
    }
  }
  return { recordingMbid: recordingMbids[0] || null, conflict: false };
}

function addUnique(list, values) {
  const set = new Set(list);
  for (const value of values || []) if (value) set.add(value);
  return [...set].sort();
}

function normalizeIdentityDocument(document) {
  if (document == null) return {};
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !document.records || typeof document.records !== 'object' || Array.isArray(document.records)) {
    throw new Error('Invalid track identity document.');
  }
  return document.records;
}

function normalizeSpotifyMetadata(document) {
  if (document == null) return {};
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !document.records || typeof document.records !== 'object' || Array.isArray(document.records)) {
    throw new Error('Invalid Spotify metadata document.');
  }
  return document.records;
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
      item.lookupTextConflict = true;
      item.lookupTextKey = null;
      item.artistLookupName = null;
      item.recordingLookupName = null;
    } else {
      addLookupEvidence(item, event);
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

    const identityState = storedIdentityState(item, identityRecords[item.trackKey]);
    if (identityState.conflict) {
      item.status = 'blocked';
      item.reason = 'stored_track_identity_conflict';
      continue;
    }
    if (identityState.recordingMbid) {
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
      if (metadata !== undefined) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
          || metadata.spotifyTrackId !== item.spotifyTrackId
          || spotifyMetadataArtistConflict(item, metadata)
          || (metadata.isrc != null && (typeof metadata.isrc !== 'string' || !ISRC.test(metadata.isrc)))) {
          item.status = 'blocked';
          item.reason = 'spotify_metadata_identity_conflict';
          continue;
        }
        item.spotifyMetadataIsrc = metadata.isrc || null;
        item.status = item.spotifyMetadataIsrc ? 'needs_musicbrainz' : 'spotify_metadata_present';
        item.reason = item.spotifyMetadataIsrc ? 'spotify_metadata_with_isrc' : 'spotify_metadata_without_isrc';
      } else {
        item.status = 'needs_spotify';
        item.reason = 'missing_spotify_metadata';
      }
      continue;
    }

    item.status = item.trustedMusicbrainzArtistMbid && !item.lookupTextConflict && item.artistLookupName && item.recordingLookupName
      ? 'needs_listenbrainz_fallback'
      : 'blocked';
    item.reason = item.status === 'needs_listenbrainz_fallback'
      ? 'exact_id_routes_exhausted'
      : item.lookupTextConflict
        ? 'conflicting_lookup_text'
        : !item.trustedMusicbrainzArtistMbid
          ? 'missing_trusted_musicbrainz_artist'
          : 'missing_lookup_text';
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
  ISRC,
  SAFE_ID,
  KNOWN_PROVIDERS,
  TRACK_IDENTITY_STATUSES,
  clean,
  cleanList,
  normalizeText,
  validSpotifyId,
  validMbid,
  validDate,
  stableHash,
  bandIndex,
  mappedBandId,
  trustedBandIdentity,
  sourceRecordingMbids,
  sourceArtistMbids,
  textTrackKey,
  workKey,
  lookupPair,
  addLookupEvidence,
  spotifyMetadataArtistConflict,
  storedProviderEntriesValid,
  storedIdentityState,
  normalizeIdentityDocument,
  normalizeSpotifyMetadata,
  buildListeningInventory,
  safeInventorySummary,
};
