'use strict';

(function attachListeningIdentityPacingV105(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityPacingV105 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const RELEASE_CONTEXT_PATH = '/musicbrainz/release-context';
  const MUSICBRAINZ_MIN_INTERVAL_MS = 2000;

  function requestUrl(input) {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input), root?.location?.href || 'https://bandmarkr.invalid/');
    if (input?.url) return new URL(input.url, root?.location?.href || 'https://bandmarkr.invalid/');
    return null;
  }

  function createPacedFetch(fetchImpl, {
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => (root?.setTimeout || setTimeout)(resolve, ms)),
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    let nextMusicBrainzStartAt = 0;

    return async function pacedFetch(input, init) {
      const url = requestUrl(input);
      const isReleaseContext = Boolean(url && url.pathname.endsWith(RELEASE_CONTEXT_PATH));
      if (!isReleaseContext) return fetchImpl(input, init);

      const current = now();
      const scheduledAt = Math.max(current, nextMusicBrainzStartAt);
      nextMusicBrainzStartAt = scheduledAt + MUSICBRAINZ_MIN_INTERVAL_MS;
      if (scheduledAt > current) await sleep(scheduledAt - current);
      return fetchImpl(input, init);
    };
  }

  function install() {
    if (!root || root.__bandmarkrIdentityPacingV105Installed) return false;
    if (typeof root.fetch !== 'function') return false;
    root.fetch = createPacedFetch(root.fetch.bind(root));
    root.__bandmarkrIdentityPacingV105Installed = true;
    return true;
  }

  if (typeof root?.document !== 'undefined') install();

  return {
    RELEASE_CONTEXT_PATH,
    MUSICBRAINZ_MIN_INTERVAL_MS,
    requestUrl,
    createPacedFetch,
    install,
  };
});
