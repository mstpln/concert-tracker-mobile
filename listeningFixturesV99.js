'use strict';

(() => {
  if (!globalThis.ListeningFixtures?.createSyntheticListens || globalThis.ListeningFixtures.createSyntheticListens.__liveVaultV99) return;
  const previous = globalThis.ListeningFixtures.createSyntheticListens;
  const wrapped = function createSyntheticListensV99(...args) {
    return previous.apply(this, args).map((listen) => {
      if (!listen?.spotifyTrackId) return listen;
      const spotifyTrackId = String(listen.spotifyTrackId).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
      if (!spotifyTrackId) return { ...listen, spotifyTrackId: null };
      const spotifyAlbumId = `album${spotifyTrackId}`.slice(0, 64);
      return {
        ...listen,
        spotifyTrackId,
        spotifyTrackUrl: `https://open.spotify.com/track/${spotifyTrackId}`,
        spotifyAlbumId,
        spotifyAlbumUrl: `https://open.spotify.com/album/${spotifyAlbumId}`,
        albumArtworkUrl: listen.artworkPath || null,
        spotifyMetadataSource: 'spotify_exact_track_id',
        spotifyMetadataFetchedAt: '2027-07-16T11:00:00.000Z',
      };
    });
  };
  wrapped.__liveVaultV99 = true;
  globalThis.ListeningFixtures.createSyntheticListens = wrapped;
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.ListeningFixtures;
