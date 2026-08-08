'use strict';

const inventoryLib = require('./listening-inventory');

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;
const PROVIDERS = new Set(['spotify', 'musicbrainz', 'listenbrainz']);
const PROVIDER_RESULTS = new Set(['resolved', 'metadata', 'no_match', 'needs_review', 'retry', 'error']);
const TRACK_IDENTITY_STATUSES = new Set(['unresolved', 'resolved', 'no_match', 'needs_review', 'retry', 'error']);
const MAX_PROVIDER_IDS = 32;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function cleanStringList(values, validator = () => true) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value && validator(value)))].sort();
}

function validIsrc(value) {
  return typeof value === 'string' && ISRC.test(value) ? value : null;
}

function validMbid(value) {
  return inventoryLib.validMbid(value);
}

function validSpotifyId(value) {
  return inventoryLib.validSpotifyId(value);
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try { return new URL(value).protocol === 'https:'; } catch (_) { return false; }
}

function recordingMbidCandidates(record) {
  return [...new Set([
    validMbid(record?.musicbrainzRecordingId),
    validMbid(record?.musicbrainzRecordingMbid),
    validMbid(record?.recordingMbid),
  ].filter(Boolean))];
}

function recordingMbidFieldsValid(record) {
  return ['musicbrainzRecordingId', 'musicbrainzRecordingMbid', 'recordingMbid']
    .every((field) => record?.[field] == null || (typeof record[field] === 'string' && Boolean(validMbid(record[field]))));
}

function recordingMbidFromIdentity(record) {
  const candidates = recordingMbidCandidates(record);
  return candidates.length === 1 ? candidates[0] : null;
}

function dateMs(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerEntryPresent(record, provider) {
  return Boolean(record?.providers && typeof record.providers === 'object' && !Array.isArray(record.providers)
    && Object.prototype.hasOwnProperty.call(record.providers, provider));
}

function providerState(record, provider) {
  const state = record?.providers?.[provider];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return PROVIDER_RESULTS.has(state.status) ? state : null;
}

function retryBlocked(record, now = new Date().toISOString()) {
  const next = dateMs(record?.nextEligibleCheckAt);
  const current = dateMs(now);
  return next != null && current != null && next > current;
}

function providerAttemptAllowed(state, record, now, entryPresent = false) {
  if (!state) return !entryPresent;
  if (state.status !== 'retry') return false;
  const next = dateMs(record?.nextEligibleCheckAt);
  const current = dateMs(now);
  return next != null && current != null && next <= current;
}

function identityCompatible(item, record) {
  if (!record) return true;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.workKey != null && typeof record.workKey !== 'string') return false;
  const storedWorkKey = clean(record.workKey);
  if (storedWorkKey && storedWorkKey !== item.trackKey) return false;
  if (record.localBandId != null && (typeof record.localBandId !== 'string' || !inventoryLib.SAFE_ID.test(record.localBandId))) return false;
  const storedBandId = clean(record.localBandId);
  if (storedBandId && item.bandId && storedBandId !== item.bandId) return false;
  if (record.spotifyTrackId != null && !validSpotifyId(record.spotifyTrackId)) return false;
  const storedSpotifyTrackId = validSpotifyId(record.spotifyTrackId);
  if (storedSpotifyTrackId && item.spotifyTrackId && storedSpotifyTrackId !== item.spotifyTrackId) return false;
  if (!recordingMbidFieldsValid(record) || recordingMbidCandidates(record).length > 1) return false;
  if (record.isrc != null && !validIsrc(record.isrc)) return false;
  if (record.status != null && !TRACK_IDENTITY_STATUSES.has(record.status)) return false;
  if (record.providers != null && (!record.providers || typeof record.providers !== 'object' || Array.isArray(record.providers))) return false;

  if (record.spotifyArtistIds != null && (!Array.isArray(record.spotifyArtistIds) || record.spotifyArtistIds.length > MAX_PROVIDER_IDS)) return false;
  const trustedSpotifyArtistId = validSpotifyId(item.trustedSpotifyArtistId);
  const storedSpotifyArtistIds = cleanStringList(record.spotifyArtistIds, (id) => Boolean(validSpotifyId(id)));
  if (Array.isArray(record.spotifyArtistIds) && !record.spotifyArtistIds.every((id) => typeof id === 'string' && Boolean(validSpotifyId(id)))) return false;
  if (trustedSpotifyArtistId && storedSpotifyArtistIds.length && !storedSpotifyArtistIds.includes(trustedSpotifyArtistId)) return false;

  if (record.musicbrainzArtistIds != null && (!Array.isArray(record.musicbrainzArtistIds) || record.musicbrainzArtistIds.length > MAX_PROVIDER_IDS)) return false;
  const trustedMusicbrainzArtistMbid = validMbid(item.trustedMusicbrainzArtistMbid);
  const storedMusicbrainzArtistIds = cleanStringList(record.musicbrainzArtistIds, (id) => Boolean(validMbid(id))).map((id) => id.toLowerCase());
  if (Array.isArray(record.musicbrainzArtistIds) && !record.musicbrainzArtistIds.every((id) => typeof id === 'string' && Boolean(validMbid(id)))) return false;
  if (trustedMusicbrainzArtistMbid && storedMusicbrainzArtistIds.length && !storedMusicbrainzArtistIds.includes(trustedMusicbrainzArtistMbid)) return false;
  return true;
}

function identityRecords(document) {
  if (document == null) return {};
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !document.records || typeof document.records !== 'object' || Array.isArray(document.records)) {
    throw new Error('Invalid track identity document.');
  }
  return document.records;
}

function step(trackKey, provider, operation, input) {
  return { trackKey, provider, operation, input: clone(input) };
}

function planEnrichment({ inventory, trackIdentities = null, now = new Date().toISOString() } = {}) {
  const items = Array.isArray(inventory?.items) ? inventory.items : [];
  const records = identityRecords(trackIdentities);
  const steps = [];
  const skipped = { complete: 0, blocked: 0, retry_wait: 0, no_route: 0 };

  for (const item of items) {
    const identity = records[item.trackKey] || null;
    if (!identityCompatible(item, identity)) {
      skipped.blocked += 1;
      continue;
    }
    const recordingMbid = recordingMbidFromIdentity(identity);
    if (recordingMbid || item.status === 'complete') {
      skipped.complete += 1;
      continue;
    }
    if (item.status === 'blocked') {
      skipped.blocked += 1;
      continue;
    }
    if (identity?.status === 'resolved') {
      skipped.blocked += 1;
      continue;
    }
    if (identity?.status === 'needs_review' || identity?.status === 'error' || identity?.status === 'no_match') {
      skipped.no_route += 1;
      continue;
    }

    const spotify = providerState(identity, 'spotify');
    const musicbrainz = providerState(identity, 'musicbrainz');
    const listenbrainz = providerState(identity, 'listenbrainz');
    const retryProviders = [
      ['spotify', spotify],
      ['musicbrainz', musicbrainz],
      ['listenbrainz', listenbrainz],
    ].filter(([, state]) => state?.status === 'retry').map(([provider]) => provider);
    if (identity?.status === 'retry' && retryProviders.length !== 1) {
      skipped.no_route += 1;
      continue;
    }
    if (identity?.status !== 'retry' && retryProviders.length) {
      skipped.no_route += 1;
      continue;
    }
    const retryProvider = retryProviders[0] || null;

    const storedIsrc = validIsrc(identity?.isrc);
    const metadataIsrc = validIsrc(item.spotifyMetadataIsrc);
    if ((item.spotifyMetadataIsrc != null && !metadataIsrc)
      || (storedIsrc && metadataIsrc && storedIsrc !== metadataIsrc)) {
      skipped.blocked += 1;
      continue;
    }
    if (retryBlocked(identity, now)) {
      skipped.retry_wait += 1;
      continue;
    }

    const hasSpotifyState = providerEntryPresent(identity, 'spotify');
    const hasMusicbrainzState = providerEntryPresent(identity, 'musicbrainz');
    const hasListenbrainzState = providerEntryPresent(identity, 'listenbrainz');
    const isrc = storedIsrc || metadataIsrc;
    const trustedMusicbrainzArtistMbid = validMbid(item.trustedMusicbrainzArtistMbid);
    const musicbrainzRouteUsable = Boolean(isrc && trustedMusicbrainzArtistMbid);

    if ((!retryProvider || retryProvider === 'musicbrainz') && musicbrainzRouteUsable
      && providerAttemptAllowed(musicbrainz, identity, now, hasMusicbrainzState)) {
      steps.push(step(item.trackKey, 'musicbrainz', 'isrc_lookup', {
        isrc,
        trustedMusicbrainzArtistMbid,
      }));
      continue;
    }

    if ((!retryProvider || retryProvider === 'spotify') && item.spotifyTrackId && item.status === 'needs_spotify'
      && (!isrc || !trustedMusicbrainzArtistMbid)
      && providerAttemptAllowed(spotify, identity, now, hasSpotifyState)) {
      steps.push(step(item.trackKey, 'spotify', 'exact_track', { spotifyTrackId: item.spotifyTrackId }));
      continue;
    }

    const spotifyRouteExhausted = !item.spotifyTrackId
      || Boolean(isrc)
      || item.status === 'spotify_metadata_present'
      || spotify?.status === 'no_match'
      || spotify?.status === 'metadata';
    const musicbrainzRouteExhausted = !musicbrainzRouteUsable || musicbrainz?.status === 'no_match';
    if ((!retryProvider || retryProvider === 'listenbrainz') && spotifyRouteExhausted && musicbrainzRouteExhausted
      && providerAttemptAllowed(listenbrainz, identity, now, hasListenbrainzState)
      && trustedMusicbrainzArtistMbid && clean(item.artistLookupName) && clean(item.recordingLookupName)) {
      steps.push(step(item.trackKey, 'listenbrainz', 'metadata_lookup', {
        artistName: item.artistLookupName,
        recordingName: item.recordingLookupName,
        trustedMusicbrainzArtistMbid,
      }));
      continue;
    }

    skipped.no_route += 1;
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    counts: { planned: steps.length, ...skipped },
    steps,
  };
}

function spotifyOutcome({ requestedTrackId, payload, trustedSpotifyArtistId = null } = {}) {
  const requested = validSpotifyId(requestedTrackId);
  const resolved = validSpotifyId(payload?.id);
  if (!requested || !resolved || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 'error', reason: 'malformed_spotify_response' };
  }
  if (!Array.isArray(payload.artists) || !payload.artists.length || payload.artists.length > MAX_PROVIDER_IDS
    || !payload.artists.every((artist) => artist && typeof artist === 'object' && !Array.isArray(artist) && Boolean(validSpotifyId(artist.id)))) {
    return { status: 'error', reason: 'malformed_spotify_artist_ids' };
  }
  const artistIds = cleanStringList(payload.artists.map((artist) => artist.id), (id) => Boolean(validSpotifyId(id)));
  const trustedArtist = validSpotifyId(trustedSpotifyArtistId);
  if (trustedArtist && !artistIds.includes(trustedArtist)) {
    return { status: 'needs_review', reason: 'spotify_artist_mismatch' };
  }

  if (payload.album != null && (!payload.album || typeof payload.album !== 'object' || Array.isArray(payload.album))) {
    return { status: 'error', reason: 'malformed_spotify_album' };
  }
  const album = payload.album || {};
  if (album.id != null && !validSpotifyId(album.id)) return { status: 'error', reason: 'malformed_spotify_album_id' };
  if (album.images != null && !Array.isArray(album.images)) return { status: 'error', reason: 'malformed_spotify_images' };
  if (Array.isArray(album.images) && album.images.some((image) => image?.url != null && !validHttpsUrl(image.url))) {
    return { status: 'error', reason: 'malformed_spotify_artwork_url' };
  }
  if (payload.external_ids != null && (!payload.external_ids || typeof payload.external_ids !== 'object' || Array.isArray(payload.external_ids))) {
    return { status: 'error', reason: 'malformed_spotify_external_ids' };
  }
  if (payload.external_ids?.isrc != null && !validIsrc(payload.external_ids.isrc)) {
    return { status: 'error', reason: 'malformed_spotify_isrc' };
  }
  const albumId = validSpotifyId(album.id);
  const images = Array.isArray(album.images) ? album.images : [];
  const artworkUrl = images.map((image) => clean(image?.url)).find(validHttpsUrl) || null;
  const isrc = validIsrc(payload?.external_ids?.isrc);

  return {
    status: 'metadata',
    reason: isrc ? 'spotify_metadata_with_isrc' : 'spotify_metadata_without_isrc',
    requestedTrackId: requested,
    resolvedTrackId: resolved,
    relinked: resolved !== requested,
    spotifyArtistIds: artistIds,
    spotifyAlbumId: albumId,
    artworkUrl,
    isrc,
  };
}

function musicbrainzArtistIds(recording) {
  const credits = recording?.['artist-credit'];
  if (!Array.isArray(credits) || credits.length > MAX_PROVIDER_IDS
    || !credits.every((credit) => credit && typeof credit === 'object' && !Array.isArray(credit)
      && credit.artist && typeof credit.artist === 'object' && !Array.isArray(credit.artist) && Boolean(validMbid(credit.artist.id)))) {
    return null;
  }
  return cleanStringList(credits.map((credit) => credit.artist.id), (id) => Boolean(validMbid(id))).map((id) => id.toLowerCase());
}

function musicbrainzIsrcOutcome({ payload, trustedMusicbrainzArtistMbid = null } = {}) {
  const trusted = validMbid(trustedMusicbrainzArtistMbid);
  if (!trusted) return { status: 'error', reason: 'missing_trusted_musicbrainz_artist' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.recordings)) {
    return { status: 'error', reason: 'malformed_musicbrainz_response' };
  }
  const parsed = [];
  for (const recording of payload.recordings) {
    if (!recording || typeof recording !== 'object' || Array.isArray(recording) || !validMbid(recording.id)) {
      return { status: 'error', reason: 'malformed_musicbrainz_recording' };
    }
    const artistMbids = musicbrainzArtistIds(recording);
    if (!artistMbids) return { status: 'error', reason: 'malformed_musicbrainz_artist_credits' };
    parsed.push({ recordingMbid: validMbid(recording.id), artistMbids });
  }
  const candidates = parsed.filter((candidate) => candidate.artistMbids.includes(trusted));
  const unique = [...new Map(candidates.map((candidate) => [candidate.recordingMbid, candidate])).values()];
  if (!unique.length) return { status: 'no_match', reason: 'no_trusted_artist_recording' };
  if (unique.length > 1) return { status: 'needs_review', reason: 'multiple_trusted_artist_recordings', candidates: unique.length };
  return { status: 'resolved', reason: 'isrc_exact_trusted_artist', ...unique[0] };
}

function listenbrainzOutcome({ payload, artistName, recordingName, trustedMusicbrainzArtistMbid = null } = {}) {
  const trusted = validMbid(trustedMusicbrainzArtistMbid);
  if (!trusted) return { status: 'error', reason: 'missing_trusted_musicbrainz_artist' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 'error', reason: 'malformed_listenbrainz_response' };
  if (payload.recording_mbid != null && !validMbid(payload.recording_mbid)) return { status: 'error', reason: 'malformed_listenbrainz_recording_mbid' };
  const recordingMbid = validMbid(payload.recording_mbid);
  if (!recordingMbid) return { status: 'no_match', reason: 'listenbrainz_no_recording_mbid' };
  if (!Array.isArray(payload.artist_mbids) || payload.artist_mbids.length > MAX_PROVIDER_IDS
    || !payload.artist_mbids.every((id) => typeof id === 'string' && Boolean(validMbid(id)))) {
    return { status: 'error', reason: 'malformed_listenbrainz_artist_ids' };
  }
  if (typeof payload.artist_credit_name !== 'string' || typeof payload.recording_name !== 'string') {
    return { status: 'error', reason: 'malformed_listenbrainz_text' };
  }
  const artistMbids = cleanStringList(payload.artist_mbids, (id) => Boolean(validMbid(id))).map((id) => id.toLowerCase());
  const artistMatches = inventoryLib.normalizeText(payload.artist_credit_name) === inventoryLib.normalizeText(artistName);
  const recordingMatches = inventoryLib.normalizeText(payload.recording_name) === inventoryLib.normalizeText(recordingName);
  if (!artistMatches || !recordingMatches || !artistMbids.includes(trusted)) {
    return { status: 'needs_review', reason: 'listenbrainz_identity_mismatch' };
  }
  return { status: 'resolved', reason: 'listenbrainz_exact_trusted_artist', recordingMbid, artistMbids };
}

function providerObservation(provider, outcome, now) {
  if (!PROVIDERS.has(provider)) throw new Error('Unknown enrichment provider.');
  if (!outcome || !PROVIDER_RESULTS.has(outcome.status)) throw new Error('Invalid enrichment provider outcome.');
  if (provider === 'spotify' && outcome.status === 'resolved') throw new Error('Invalid Spotify enrichment outcome status.');
  if (provider !== 'spotify' && outcome.status === 'metadata') throw new Error('Invalid enrichment provider outcome status.');
  if (outcome.status === 'retry' && dateMs(outcome.nextEligibleCheckAt) == null) throw new Error('Retry outcome requires nextEligibleCheckAt.');
  return {
    status: outcome.status,
    reason: outcome.reason,
    checkedAt: now,
  };
}

function validatedOutcomeArtistIds(item, outcome) {
  if (outcome.spotifyArtistIds != null) {
    if (!Array.isArray(outcome.spotifyArtistIds) || outcome.spotifyArtistIds.length > MAX_PROVIDER_IDS) throw new Error('Invalid Spotify artist identity outcome.');
    const spotifyIds = cleanStringList(outcome.spotifyArtistIds, (id) => Boolean(validSpotifyId(id)));
    if (!outcome.spotifyArtistIds.every((id) => typeof id === 'string' && Boolean(validSpotifyId(id)))) throw new Error('Invalid Spotify artist identity outcome.');
    const trusted = validSpotifyId(item.trustedSpotifyArtistId);
    if (trusted && spotifyIds.length && !spotifyIds.includes(trusted)) throw new Error('Spotify artist identity conflicts with the planned work item.');
  }
  if (outcome.artistMbids != null) {
    if (!Array.isArray(outcome.artistMbids) || outcome.artistMbids.length > MAX_PROVIDER_IDS) throw new Error('Invalid MusicBrainz artist identity outcome.');
    const musicbrainzIds = cleanStringList(outcome.artistMbids, (id) => Boolean(validMbid(id))).map((id) => id.toLowerCase());
    if (!outcome.artistMbids.every((id) => typeof id === 'string' && Boolean(validMbid(id)))) throw new Error('Invalid MusicBrainz artist identity outcome.');
    const trusted = validMbid(item.trustedMusicbrainzArtistMbid);
    if (trusted && musicbrainzIds.length && !musicbrainzIds.includes(trusted)) throw new Error('MusicBrainz artist identity conflicts with the planned work item.');
  }
}

function mergeIdentityRecord(existing, item, provider, outcome, now = new Date().toISOString()) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? clone(existing) : {};
  if (!identityCompatible(item, base)) throw new Error('Stored track identity conflicts with the planned work item.');
  validatedOutcomeArtistIds(item, outcome || {});
  const existingRecordingMbid = recordingMbidFromIdentity(base);
  const incomingRecordingMbid = validMbid(outcome?.recordingMbid);
  if (outcome?.status === 'resolved' && !incomingRecordingMbid && !existingRecordingMbid) {
    throw new Error('Resolved provider outcome is missing recording identity.');
  }
  if (existingRecordingMbid && incomingRecordingMbid && existingRecordingMbid !== incomingRecordingMbid) {
    throw new Error('Resolved recording identity conflicts with the provider outcome.');
  }
  const existingIsrc = validIsrc(base.isrc);
  const incomingIsrc = validIsrc(outcome?.isrc);
  if (outcome?.isrc != null && !incomingIsrc) throw new Error('Invalid ISRC provider outcome.');
  if (existingIsrc && incomingIsrc && existingIsrc !== incomingIsrc) throw new Error('ISRC conflicts with the stored track identity.');

  if (provider === 'spotify' && outcome?.status === 'metadata'
    && (!Array.isArray(outcome.spotifyArtistIds) || outcome.spotifyArtistIds.length === 0)) {
    throw new Error('Spotify metadata outcome is missing artist identity.');
  }
  const providers = base.providers && typeof base.providers === 'object' && !Array.isArray(base.providers) ? clone(base.providers) : {};
  providers[provider] = { ...(providers[provider] || {}), ...providerObservation(provider, outcome, now) };
  const resolved = outcome.status === 'resolved' || Boolean(existingRecordingMbid);
  const status = resolved ? 'resolved'
    : outcome.status === 'needs_review' ? 'needs_review'
      : outcome.status === 'retry' ? 'retry'
        : outcome.status === 'error' ? 'error'
          : 'unresolved';
  const next = outcome.status === 'retry' ? outcome.nextEligibleCheckAt : null;
  const record = {
    ...base,
    workKey: item.trackKey,
    localBandId: item.bandId || base.localBandId || null,
    spotifyTrackId: item.spotifyTrackId || base.spotifyTrackId || null,
    status,
    updatedAt: now,
    nextEligibleCheckAt: resolved ? null : next,
    providers,
  };
  if (Array.isArray(outcome.spotifyArtistIds) && outcome.spotifyArtistIds.length) record.spotifyArtistIds = clone(outcome.spotifyArtistIds);
  if (incomingIsrc) record.isrc = incomingIsrc;
  if (incomingRecordingMbid) record.musicbrainzRecordingId = incomingRecordingMbid;
  if (Array.isArray(outcome.artistMbids) && outcome.artistMbids.length) record.musicbrainzArtistIds = clone(outcome.artistMbids);
  return record;
}

function spotifyMetadataRecord(existing, item, outcome, now = new Date().toISOString()) {
  if (outcome.status !== 'metadata') return null;
  const requested = validSpotifyId(item.spotifyTrackId);
  if (!requested || outcome.requestedTrackId !== requested) return null;
  try { validatedOutcomeArtistIds(item, outcome); } catch (_) { return null; }
  const resolvedTrackId = outcome.resolvedTrackId == null ? null : validSpotifyId(outcome.resolvedTrackId);
  if (outcome.resolvedTrackId != null && !resolvedTrackId) return null;
  const expectedRelinked = Boolean(resolvedTrackId && resolvedTrackId !== requested);
  if (outcome.relinked === true && !expectedRelinked) return null;
  if (outcome.relinked === false && resolvedTrackId && expectedRelinked) return null;

  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? clone(existing) : {};
  if (base.spotifyTrackId != null && base.spotifyTrackId !== requested) return null;
  const existingIsrc = validIsrc(base.isrc);
  const incomingIsrc = validIsrc(outcome.isrc);
  if ((base.isrc != null && !existingIsrc) || (outcome.isrc != null && !incomingIsrc)) return null;
  if (existingIsrc && incomingIsrc && existingIsrc !== incomingIsrc) return null;
  const outcomeAlbumId = validSpotifyId(outcome.spotifyAlbumId);
  if (outcome.spotifyAlbumId != null && !outcomeAlbumId) return null;
  if (outcome.artworkUrl != null && !validHttpsUrl(outcome.artworkUrl)) return null;
  if (base.artworkUrl != null && !validHttpsUrl(base.artworkUrl)) return null;
  const existingAlbumId = validSpotifyId(base.spotifyAlbumId);
  if (base.spotifyAlbumId != null && !existingAlbumId) return null;
  const albumId = outcomeAlbumId || existingAlbumId || null;
  const sameAlbum = !outcomeAlbumId || outcomeAlbumId === existingAlbumId;
  const incomingSpotifyArtistIds = Array.isArray(outcome.spotifyArtistIds) && outcome.spotifyArtistIds.length
    ? clone(outcome.spotifyArtistIds)
    : null;
  const existingSpotifyArtistIds = Array.isArray(base.spotifyArtistIds) && base.spotifyArtistIds.length <= MAX_PROVIDER_IDS
    && base.spotifyArtistIds.every((id) => typeof id === 'string' && Boolean(validSpotifyId(id)))
    ? clone(base.spotifyArtistIds)
    : null;
  const effectiveSpotifyArtistIds = incomingSpotifyArtistIds || existingSpotifyArtistIds;
  if (!effectiveSpotifyArtistIds || effectiveSpotifyArtistIds.length === 0) return null;
  const trustedSpotifyArtistId = validSpotifyId(item.trustedSpotifyArtistId);
  if (trustedSpotifyArtistId && !effectiveSpotifyArtistIds.includes(trustedSpotifyArtistId)) return null;

  const record = {
    ...base,
    spotifyTrackId: requested,
    spotifyTrackUrl: `https://open.spotify.com/track/${requested}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: outcomeAlbumId
      ? `https://open.spotify.com/album/${outcomeAlbumId}`
      : existingAlbumId ? `https://open.spotify.com/album/${existingAlbumId}` : null,
    artworkUrl: outcome.artworkUrl || (sameAlbum ? base.artworkUrl : null) || null,
    spotifyArtistIds: effectiveSpotifyArtistIds,
    isrc: incomingIsrc || existingIsrc || null,
    fetchedAt: now,
    source: 'spotify_exact_track_id',
  };
  if (expectedRelinked) {
    record.spotifyProviderResolvedTrackId = resolvedTrackId;
    record.spotifyProviderRelinked = true;
  } else {
    delete record.spotifyProviderResolvedTrackId;
    delete record.spotifyProviderRelinked;
  }
  return record;
}

function safePlanSummary(plan) {
  const counts = plan?.counts || {};
  return {
    planned: Number(counts.planned) || 0,
    complete: Number(counts.complete) || 0,
    blocked: Number(counts.blocked) || 0,
    retry_wait: Number(counts.retry_wait) || 0,
    no_route: Number(counts.no_route) || 0,
    spotify: (plan?.steps || []).filter((item) => item.provider === 'spotify').length,
    musicbrainz: (plan?.steps || []).filter((item) => item.provider === 'musicbrainz').length,
    listenbrainz: (plan?.steps || []).filter((item) => item.provider === 'listenbrainz').length,
  };
}

module.exports = {
  ISRC,
  TRACK_IDENTITY_STATUSES,
  MAX_PROVIDER_IDS,
  validIsrc,
  validHttpsUrl,
  recordingMbidCandidates,
  recordingMbidFieldsValid,
  recordingMbidFromIdentity,
  providerEntryPresent,
  providerState,
  retryBlocked,
  providerAttemptAllowed,
  identityCompatible,
  identityRecords,
  planEnrichment,
  spotifyOutcome,
  musicbrainzIsrcOutcome,
  listenbrainzOutcome,
  providerObservation,
  validatedOutcomeArtistIds,
  mergeIdentityRecord,
  spotifyMetadataRecord,
  safePlanSummary,
};
