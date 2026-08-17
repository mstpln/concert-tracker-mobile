'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../scripts/lib/nonPlaylistTrackLinks');
const artwork = require('../scripts/lib/providerNeutralArtworkV136');
const diagnostics = require('../scripts/lib/spotifyDiagnosticsV135');
const history = require('../listeningHistoryV2');

test('v136 reuses existing concert and prediction track evidence without provider I/O', () => {
  const bands = [{ id: 'band-a', name: 'Example Artist', musicbrainz: { spotify: { status: 'confirmed', id: 'artist123' } } }];
  const concerts = [{
    bandId: 'band-a',
    bandName: 'Example Artist',
    setlist: { songs: [{ name: 'Known Song', spotifyUrl: 'https://open.spotify.com/track/track123' }] },
    predictedSetlist: { songs: [{ name: 'Predicted Song', spotifyTrackId: 'track456' }] },
  }];
  const resolver = links.createResolver(links.collectConcertEvidence(concerts, bands));
  assert.equal(resolver.resolve({ bandId: 'band-a', spotifyArtistId: 'artist123', recordingTitle: 'Known Song' }), 'https://open.spotify.com/track/track123');
  assert.equal(resolver.resolve({ bandId: 'band-a', spotifyArtistId: 'artist123', recordingTitle: 'Predicted Song' }), 'https://open.spotify.com/track/track456');
});

test('v136 keeps ambiguous non-playlist evidence fail-closed', () => {
  const resolver = links.createResolver([
    { bandId: 'band-a', recordingTitle: 'Song', spotifyTrackId: 'one' },
    { bandId: 'band-a', recordingTitle: 'Song', spotifyTrackId: 'two' },
  ]);
  assert.equal(resolver.resolve({ bandId: 'band-a', recordingTitle: 'Song' }), null);
  assert.equal(resolver.hasConflict({ bandId: 'band-a', recordingTitle: 'Song' }), true);
});

test('v136 derives Cover Art Archive artwork only from one exact release MBID', () => {
  const releaseMbid = '12345678-1234-4123-8123-123456789abc';
  assert.equal(artwork.coverArtArchiveUrl({ musicbrainzReleaseId: releaseMbid }), `https://coverartarchive.org/release/${releaseMbid}/front-500`);
  assert.equal(artwork.groupArtworkEvidence([{ musicbrainzReleaseId: releaseMbid }, { listenbrainzCaaReleaseMbid: releaseMbid }]).releaseMbid, releaseMbid);
  assert.equal(artwork.groupArtworkEvidence([
    { musicbrainzReleaseId: releaseMbid },
    { musicbrainzReleaseId: '22345678-1234-4123-8123-123456789abc' },
  ]), null);
});

test('v136 listening working copy uses exact CAA evidence without claiming Spotify ownership', () => {
  const releaseMbid = '12345678-1234-4123-8123-123456789abc';
  const event = history.sanitizeEvent({
    stableListenId: 'listen-1', listenedAt: '2026-08-17T00:00:00Z', listenedDurationMs: 180000,
    artistCreditName: 'Example Artist', recordingTitle: 'Song', releaseTitle: 'Album', spotifyTrackId: 'track123',
    musicbrainzReleaseId: releaseMbid, source: 'spotify_import',
  });
  assert.equal(event.albumArtworkUrl, `https://coverartarchive.org/release/${releaseMbid}/front-500`);
  assert.equal(event.albumArtworkSource, 'cover-art-archive-exact-release');
  assert.equal(event.spotifyAlbumArtworkSource, undefined);
});

test('v136 trusted-local diagnostics attribute exact artwork calls to album artwork', () => {
  const usage = { state: { spotify: { callsThisRun: 0, circuit: null } } };
  diagnostics.resetDiagnostics(usage);
  const before = diagnostics.calls(usage);
  usage.state.spotify.callsThisRun = 1;
  diagnostics.recordOperation(usage, { lane: 'album_artwork', endpoint: 'track_exact', before, result: { kind: 'ok' } });
  assert.equal(usage.state.spotify.diagnostics.callsByLane.album_artwork, 1);
  assert.equal(usage.state.spotify.diagnostics.callsByEndpoint.track_exact, 1);
});
