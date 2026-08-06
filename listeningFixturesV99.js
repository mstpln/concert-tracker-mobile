'use strict';

(() => {
  if (!globalThis.ListeningFixtures?.createSyntheticListens || globalThis.ListeningFixtures.createSyntheticListens.__liveVaultV99) return;
  const previous = globalThis.ListeningFixtures.createSyntheticListens;
  const wrapped = function createSyntheticListensV99(...args) {
    return previous.apply(this, args).map((listen) => {
      if (!listen?.spotifyTrackId) return listen;
      const spotifyTrackId = String(listen.spotifyTrackId).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
      return spotifyTrackId ? { ...listen, spotifyTrackId } : { ...listen, spotifyTrackId: null };
    });
  };
  wrapped.__liveVaultV99 = true;
  globalThis.ListeningFixtures.createSyntheticListens = wrapped;
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.ListeningFixtures;
