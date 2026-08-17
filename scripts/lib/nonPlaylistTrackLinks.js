'use strict';

// Provider-neutral reuse for display/non-playlist track links. This module
// never reads private storage or performs provider I/O on its own. Callers may
// seed trusted local / ListenBrainz / MusicBrainz evidence, and an explicitly
// installed provider-neutral lookup may run before the final Spotify fallback.
// Playlist preparation remains a separate contract and is not changed here.
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{1,64}$/;
const MUSICBRAINZ_MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATCH = Symbol.for('bandmarkr.v136.nonPlaylistTrackLinkReuse');

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function spotifyTrackIdFromUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
    const match = url.pathname.match(/^\/track\/([A-Za-z0-9]{1,64})\/?$/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function spotifyUrl(trackId) {
  const id = String(trackId || '').trim();
  return SPOTIFY_TRACK_ID.test(id) ? `https://open.spotify.com/track/${id}` : null;
}

function relationUrl(relation) {
  if (typeof relation === 'string') return relation;
  return relation?.url?.resource || relation?.target || relation?.url || null;
}

function uniqueSpotifyRelation(relations) {
  const ids = [...new Set((Array.isArray(relations) ? relations : [])
    .map(relationUrl)
    .map(spotifyTrackIdFromUrl)
    .filter(Boolean))];
  return ids.length === 1 ? spotifyUrl(ids[0]) : null;
}

function evidenceSpotifyUrl(evidence = {}) {
  const directId = String(evidence.spotifyTrackId || '').trim();
  if (SPOTIFY_TRACK_ID.test(directId)) return spotifyUrl(directId);
  const directUrlId = spotifyTrackIdFromUrl(evidence.spotifyUrl || evidence.spotifyTrackUrl);
  if (directUrlId) return spotifyUrl(directUrlId);
  const listenbrainz = uniqueSpotifyRelation(evidence.listenbrainzUrlRels || evidence.listenbrainzUrlRelations);
  if (listenbrainz) return listenbrainz;
  return uniqueSpotifyRelation(evidence.musicbrainzUrlRels || evidence.musicbrainzUrlRelations);
}

function identityKey({ bandId, spotifyArtistId, artistName, recordingTitle, title } = {}) {
  const recording = normalize(recordingTitle || title);
  if (!recording) return null;
  const artist = String(spotifyArtistId || '').trim()
    ? `spotify:${String(spotifyArtistId).trim()}`
    : String(bandId || '').trim()
      ? `band:${String(bandId).trim()}`
      : normalize(artistName)
        ? `name:${normalize(artistName)}`
        : null;
  return artist ? `${artist}\n${recording}` : null;
}

function createResolver(initialEvidence = []) {
  const links = new Map();
  const conflicts = new Set();

  function add(evidence = {}) {
    const key = identityKey(evidence);
    const url = evidenceSpotifyUrl(evidence);
    if (!key || !url || conflicts.has(key)) return false;
    const prior = links.get(key);
    if (prior && prior !== url) {
      links.delete(key);
      conflicts.add(key);
      return false;
    }
    links.set(key, url);
    return true;
  }

  function resolve(query = {}) {
    const key = identityKey(query);
    return key && !conflicts.has(key) ? links.get(key) || null : null;
  }

  for (const evidence of initialEvidence || []) add(evidence);
  return {
    add,
    resolve,
    size: () => links.size,
    hasConflict: (query) => conflicts.has(identityKey(query)),
  };
}

function trustedSpotifyArtistId(band) {
  const record = band?.musicbrainz?.spotify;
  return ['confirmed', 'manual_confirmed'].includes(record?.status) && SPOTIFY_TRACK_ID.test(String(record?.id || ''))
    ? record.id
    : null;
}

function songEvidence(song, artist = {}) {
  if (!song || typeof song !== 'object' || Array.isArray(song)) return null;
  const recordingTitle = song.recordingTitle || song.name || song.title;
  if (!normalize(recordingTitle)) return null;
  return {
    bandId: artist.bandId || song.bandId || song.localBandId || null,
    spotifyArtistId: artist.spotifyArtistId || song.spotifyArtistId || null,
    artistName: artist.artistName || song.artistCreditName || song.bandName || null,
    recordingTitle,
    spotifyTrackId: song.spotifyTrackId || null,
    spotifyUrl: song.spotifyUrl || song.spotifyTrackUrl || null,
    listenbrainzUrlRels: song.listenbrainzUrlRels || song.listenbrainzUrlRelations || null,
    musicbrainzUrlRels: song.musicbrainzUrlRels || song.musicbrainzUrlRelations || null,
    musicbrainzRecordingId: song.musicbrainzRecordingId || song.recordingMbid || null,
  };
}

function uniqueBandNameCounts(bands = []) {
  const counts = new Map();
  for (const band of bands || []) {
    const key = normalize(band?.name);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function appendSafeEvidence(evidence, row, band, nameCounts) {
  if (!row || !evidenceSpotifyUrl(row)) return;
  evidence.push(row);

  // Some established historical callers identify a song by artist name rather
  // than stable band id. Expose a name-keyed alias only when that normalized
  // name belongs to exactly one BANDMARKR band. Conflicting links for that
  // alias are still rejected by createResolver, so this never guesses across
  // duplicate artist names.
  const normalizedName = normalize(band?.name || row.artistName);
  if (normalizedName && nameCounts.get(normalizedName) === 1) {
    evidence.push({ ...row, bandId: null, spotifyArtistId: null, artistName: band?.name || row.artistName });
  }
}

function collectConcertRows(concerts = [], bands = []) {
  const bandsById = new Map((bands || []).map((band) => [band?.id, band]));
  const rows = [];
  for (const concert of concerts || []) {
    const band = bandsById.get(concert?.bandId);
    const artist = {
      bandId: concert?.bandId || null,
      spotifyArtistId: trustedSpotifyArtistId(band),
      artistName: band?.name || concert?.bandName || null,
    };
    for (const song of concert?.setlist?.songs || []) {
      const row = songEvidence(song, artist);
      if (row) rows.push({ row, band });
    }
    for (const song of concert?.predictedSetlist?.songs || []) {
      const row = songEvidence(song, artist);
      if (row) rows.push({ row, band });
    }
  }
  return rows;
}

// Trusted recording identity is useful even when no Spotify URL is known yet.
// Only syntactically valid MusicBrainz recording MBIDs enter this exact lookup
// lane; malformed historical values fall through to the broader safe route.
function collectConcertIdentityEvidence(concerts = [], bands = []) {
  return collectConcertRows(concerts, bands)
    .map(({ row }) => row)
    .filter((row) => MUSICBRAINZ_MBID.test(String(row.musicbrainzRecordingId || '').trim()));
}

// Build evidence the scheduled research job is already allowed to see. Exact
// setlist/prediction links can satisfy later non-playlist display-link work
// without another Spotify search. Raw private listening history is not read.
function collectConcertEvidence(concerts = [], bands = []) {
  const nameCounts = uniqueBandNameCounts(bands);
  const evidence = [];
  for (const { row, band } of collectConcertRows(concerts, bands)) {
    appendSafeEvidence(evidence, row, band, nameCounts);
  }
  return evidence;
}

// Private/local callers that already possess listening events may feed those
// observations to the same pure resolver. This does not publish or fetch them.
function collectListeningEvidence(events = [], { bands = [] } = {}) {
  const bandsById = new Map((bands || []).map((band) => [band?.id, band]));
  const nameCounts = uniqueBandNameCounts(bands);
  const evidence = [];
  for (const event of events || []) {
    const bandId = event?.localBandId || event?.bandId || null;
    const band = bandsById.get(bandId);
    const row = songEvidence(event, {
      bandId,
      spotifyArtistId: trustedSpotifyArtistId(band),
      artistName: band?.name || event?.artistCreditName || null,
    });
    appendSafeEvidence(evidence, row, band, nameCounts);
  }
  return evidence;
}

const sharedResolver = createResolver();
let providerNeutralLookup = null;

function seedEvidence(rows = []) {
  let added = 0;
  for (const row of rows || []) if (sharedResolver.add(row)) added += 1;
  return added;
}

function setProviderNeutralLookup(fn) {
  providerNeutralLookup = typeof fn === 'function' ? fn : null;
}

function installSpotifyNonPlaylistReuse(spotify) {
  if (!spotify || typeof spotify.resolveSongLinks !== 'function' || typeof spotify.searchTrackOutcome !== 'function') {
    throw new Error('Non-playlist reuse requires Spotify song-link helpers.');
  }
  if (spotify[PATCH]) return false;
  Object.defineProperty(spotify, PATCH, { value: true, enumerable: false });
  const originalResolveSongLinks = spotify.resolveSongLinks;

  spotify.resolveSongLinks = async function reusedResolveSongLinks(songs, bandName, usage, options = {}) {
    const artist = {
      bandId: options.bandId || null,
      spotifyArtistId: options.spotifyArtistId || null,
      artistName: bandName,
    };
    seedEvidence(Array.isArray(options.evidence) ? options.evidence : []);
    for (const song of songs || []) {
      const row = songEvidence(song, artist);
      if (row) sharedResolver.add(row);
    }

    const providerSearch = typeof options.search === 'function' ? options.search : spotify.searchTrackOutcome;
    const search = async (title, currentBandName, currentUsage, searchOptions = {}) => {
      const query = {
        bandId: searchOptions.bandId || artist.bandId,
        spotifyArtistId: searchOptions.spotifyArtistId || artist.spotifyArtistId,
        artistName: currentBandName,
        recordingTitle: title,
      };
      const known = sharedResolver.resolve(query);
      if (known) return { kind: 'ok', url: known, reused: true };

      if (providerNeutralLookup) {
        const neutral = await providerNeutralLookup({ ...query, usage: currentUsage });
        if (neutral?.kind === 'ok' && neutral.url) {
          sharedResolver.add({ ...query, spotifyUrl: neutral.url });
          return { ...neutral, reused: true };
        }
        // A transient/cap failure in the earlier provider-neutral route must
        // not be widened into a Spotify guess during the same item.
        if (neutral?.kind === 'error' || neutral?.kind === 'skipped') return neutral;
      }

      const outcome = await providerSearch(title, currentBandName, currentUsage, searchOptions);
      if (outcome?.kind === 'ok' && outcome.url) sharedResolver.add({ ...query, spotifyUrl: outcome.url });
      return outcome;
    };

    return originalResolveSongLinks(songs, bandName, usage, { ...options, search });
  };
  return true;
}

module.exports = {
  normalize,
  spotifyTrackIdFromUrl,
  spotifyUrl,
  uniqueSpotifyRelation,
  evidenceSpotifyUrl,
  identityKey,
  createResolver,
  trustedSpotifyArtistId,
  songEvidence,
  uniqueBandNameCounts,
  collectConcertIdentityEvidence,
  collectConcertEvidence,
  collectListeningEvidence,
  seedEvidence,
  setProviderNeutralLookup,
  installSpotifyNonPlaylistReuse,
};
