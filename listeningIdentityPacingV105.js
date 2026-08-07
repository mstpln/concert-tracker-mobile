'use strict';

(function attachListeningIdentityPacingV105(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityPacingV105 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const RELEASE_CONTEXT_PATH = '/musicbrainz/release-context';
  const MUSICBRAINZ_MIN_INTERVAL_MS = 2000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function cleanUuid(value) {
    const text = String(value || '').trim().toLowerCase();
    return UUID_RE.test(text) ? text : null;
  }

  function requestUrl(input) {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input), root?.location?.href || 'https://bandmarkr.invalid/');
    if (input?.url) return new URL(input.url, root?.location?.href || 'https://bandmarkr.invalid/');
    return null;
  }

  function cachedResponse(payload) {
    if (typeof root?.Response === 'function') {
      return new root.Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return {
      status: 200,
      ok: true,
      async json() { return { ...payload }; },
    };
  }

  function createPacedFetch(fetchImpl, {
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => (root?.setTimeout || setTimeout)(resolve, ms)),
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    const releaseContextCache = new Map();
    let lastMusicBrainzRequestStartedAt = 0;

    return async function pacedFetch(input, init) {
      const url = requestUrl(input);
      const isReleaseContext = Boolean(url && url.pathname.endsWith(RELEASE_CONTEXT_PATH));
      if (!isReleaseContext) return fetchImpl(input, init);

      const releaseMbid = cleanUuid(url.searchParams.get('release_mbid'));
      if (!releaseMbid) return fetchImpl(input, init);

      const cached = releaseContextCache.get(releaseMbid);
      if (cached) return cachedResponse(cached);

      const elapsed = now() - lastMusicBrainzRequestStartedAt;
      if (lastMusicBrainzRequestStartedAt && elapsed < MUSICBRAINZ_MIN_INTERVAL_MS) {
        await sleep(MUSICBRAINZ_MIN_INTERVAL_MS - elapsed);
      }
      lastMusicBrainzRequestStartedAt = now();

      const response = await fetchImpl(input, init);
      if (response?.ok && typeof response.clone === 'function') {
        try {
          const payload = await response.clone().json();
          const returnedReleaseMbid = cleanUuid(payload?.releaseMbid);
          const releaseGroupMbid = cleanUuid(payload?.releaseGroupMbid);
          if (returnedReleaseMbid === releaseMbid && releaseGroupMbid) {
            releaseContextCache.set(releaseMbid, { releaseMbid, releaseGroupMbid });
          }
        } catch {
          // The v104 caller remains authoritative for malformed-response handling.
        }
      }
      return response;
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
    cleanUuid,
    requestUrl,
    createPacedFetch,
    install,
  };
});
