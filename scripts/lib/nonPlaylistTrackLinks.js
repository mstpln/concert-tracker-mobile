'use strict';

// Provider-neutral reuse for display/non-playlist track links. This module
// never performs provider I/O itself. Playlist matching remains separate.
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{1,64}$/;
const PATCH = Symbol.for('bandmarkr.v136.nonPlaylistTrackLinkReuse');

function normalize(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }
function spotifyTrackIdFromUrl(value) { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null; const match = url.pathname.match(/^\/track\/([A-Za-z0-9]{1,64})\/?$/); return match ? match[1] : null; } catch (_) { return null; } }
function spotifyUrl(trackId) { const id = String(trackId || '').trim(); return SPOTIFY_TRACK_ID.test(id) ? `https://open.spotify.com/track/${id}` : null; }
function relationUrl(relation) { if (typeof relation === 'string') return relation; return relation?.url?.resource || relation?.target || relation?.url || null; }
function uniqueSpotifyRelation(relations) { const ids = [...new Set((Array.isArray(relations) ? relations : []).map(relationUrl).map(spotifyTrackIdFromUrl).filter(Boolean))]; return ids.length === 1 ? spotifyUrl(ids[0]) : null; }
function evidenceSpotifyUrl(evidence = {}) { const directId = String(evidence.spotifyTrackId || '').trim(); if (SPOTIFY_TRACK_ID.test(directId)) return spotifyUrl(directId); const directUrlId = spotifyTrackIdFromUrl(evidence.spotifyUrl || evidence.spotifyTrackUrl); if (directUrlId) return spotifyUrl(directUrlId); const lb = uniqueSpotifyRelation(evidence.listenbrainzUrlRels || evidence.listenbrainzUrlRelations); if (lb) return lb; return uniqueSpotifyRelation(evidence.musicbrainzUrlRels || evidence.musicbrainzUrlRelations); }
function identityKey({ bandId, spotifyArtistId, artistName, recordingTitle, title } = {}) { const recording = normalize(recordingTitle || title); if (!recording) return null; const artist = String(spotifyArtistId || '').trim() ? `spotify:${String(spotifyArtistId).trim()}` : String(bandId || '').trim() ? `band:${String(bandId).trim()}` : normalize(artistName) ? `name:${normalize(artistName)}` : null; return artist ? `${artist}\n${recording}` : null; }
function createResolver(initialEvidence = []) { const links = new Map(); const conflicts = new Set(); function add(evidence = {}) { const key = identityKey(evidence); const url = evidenceSpotifyUrl(evidence); if (!key || !url || conflicts.has(key)) return false; const prior = links.get(key); if (prior && prior !== url) { links.delete(key); conflicts.add(key); return false; } links.set(key, url); return true; } function resolve(query = {}) { const key = identityKey(query); return key && !conflicts.has(key) ? links.get(key) || null : null; } for (const evidence of initialEvidence || []) add(evidence); return { add, resolve, size: () => links.size, hasConflict: (query) => conflicts.has(identityKey(query)) }; }
function trustedSpotifyArtistId(band) { const record = band?.musicbrainz?.spotify; return ['confirmed', 'manual_confirmed'].includes(record?.status) && SPOTIFY_TRACK_ID.test(String(record?.id || '')) ? record.id : null; }
function songEvidence(song, artist = {}) { if (!song || typeof song !== 'object' || Array.isArray(song)) return null; const recordingTitle = song.recordingTitle || song.name || song.title; if (!normalize(recordingTitle)) return null; return { bandId: artist.bandId || song.bandId || song.localBandId || null, spotifyArtistId: artist.spotifyArtistId || song.spotifyArtistId || null, artistName: artist.artistName || song.artistCreditName || song.bandName || null, recordingTitle, spotifyTrackId: song.spotifyTrackId || null, spotifyUrl: song.spotifyUrl || song.spotifyTrackUrl || null, listenbrainzUrlRels: song.listenbrainzUrlRels || song.listenbrainzUrlRelations || null, musicbrainzUrlRels: song.musicbrainzUrlRels || song.musicbrainzUrlRelations || null }; }
function collectConcertEvidence(concerts = [], bands = []) { const bandsById = new Map((bands || []).map((band) => [band?.id, band])); const evidence = []; for (const concert of concerts || []) { const band = bandsById.get(concert?.bandId); const artist = { bandId: concert?.bandId || null, spotifyArtistId: trustedSpotifyArtistId(band), artistName: band?.name || concert?.bandName || null }; for (const song of concert?.setlist?.songs || []) { const row = songEvidence(song, artist); if (row && evidenceSpotifyUrl(row)) evidence.push(row); } for (const song of concert?.predictedSetlist?.songs || []) { const row = songEvidence(song, artist); if (row && evidenceSpotifyUrl(row)) evidence.push(row); } } return evidence; }
function collectListeningEvidence(events = [], { bands = [] } = {}) { const bandsById = new Map((bands || []).map((band) => [band?.id, band])); const evidence = []; for (const event of events || []) { const bandId = event?.localBandId || event?.bandId || null; const band = bandsById.get(bandId); const row = songEvidence(event, { bandId, spotifyArtistId: trustedSpotifyArtistId(band), artistName: band?.name || event?.artistCreditName || null }); if (row && evidenceSpotifyUrl(row)) evidence.push(row); } return evidence; }

const sharedResolver = createResolver();
function seedEvidence(evidence = []) { let added = 0; for (const row of evidence || []) if (sharedResolver.add(row)) added += 1; return added; }

function installSpotifyNonPlaylistReuse(spotify) {
  if (!spotify || typeof spotify.resolveSongLinks !== 'function' || typeof spotify.searchTrackOutcome !== 'function') throw new Error('Non-playlist reuse requires Spotify song-link helpers.');
  if (spotify[PATCH]) return false;
  Object.defineProperty(spotify, PATCH, { value: true, enumerable: false });
  const originalResolveSongLinks = spotify.resolveSongLinks;
  spotify.resolveSongLinks = async function reusedResolveSongLinks(songs, bandName, usage, options = {}) {
    const artist = { bandId: options.bandId || null, spotifyArtistId: options.spotifyArtistId || null, artistName: bandName };
    seedEvidence(Array.isArray(options.evidence) ? options.evidence : []);
    for (const song of songs || []) { const row = songEvidence(song, artist); if (row) sharedResolver.add(row); }
    const providerSearch = typeof options.search === 'function' ? options.search : spotify.searchTrackOutcome;
    const search = async (title, currentBandName, currentUsage, searchOptions = {}) => {
      const query = { bandId: searchOptions.bandId || artist.bandId, spotifyArtistId: searchOptions.spotifyArtistId || artist.spotifyArtistId, artistName: currentBandName, recordingTitle: title };
      const known = sharedResolver.resolve(query);
      if (known) return { kind: 'ok', url: known, reused: true };
      const outcome = await providerSearch(title, currentBandName, currentUsage, searchOptions);
      if (outcome?.kind === 'ok' && outcome.url) sharedResolver.add({ ...query, spotifyUrl: outcome.url });
      return outcome;
    };
    return originalResolveSongLinks(songs, bandName, usage, { ...options, search });
  };
  return true;
}

module.exports = { normalize, spotifyTrackIdFromUrl, spotifyUrl, uniqueSpotifyRelation, evidenceSpotifyUrl, identityKey, createResolver, trustedSpotifyArtistId, songEvidence, collectConcertEvidence, collectListeningEvidence, seedEvidence, installSpotifyNonPlaylistReuse };
