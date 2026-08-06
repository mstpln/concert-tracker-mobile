'use strict';

(() => {
  const spotify = globalThis.SpotifyUser;
  if (!spotify || typeof spotify.request === 'function') return;

  const API = 'https://api.spotify.com/v1';

  async function validAuth(fetchImpl = fetch) {
    let auth = await spotify.getAuth();
    if (!auth?.accessToken || !auth?.refreshToken || !auth?.clientId) {
      throw new Error('Connect Spotify first');
    }
    if (Date.parse(auth.expiresAt) <= Date.now() + 60_000) {
      auth = await spotify.refresh(auth, fetchImpl);
    }
    return auth;
  }

  async function request(path, options = {}, fetchImpl = fetch) {
    let auth = await validAuth(fetchImpl);
    const run = () => fetchImpl(`${API}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${auth.accessToken}` },
    });
    let response = await run();
    if (response.status === 401) {
      auth = await spotify.refresh(auth, fetchImpl);
      response = await run();
      if (response.status === 401) {
        await spotify.clearAuth();
        throw new Error('Spotify connection expired. Connect again.');
      }
    }
    if (response.status === 429) {
      const seconds = Number(response.headers?.get?.('retry-after')) || 1;
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      response = await run();
    }
    if (!response.ok) {
      throw new Error(response.status === 403
        ? 'Spotify permissions are missing. Connect again.'
        : 'Spotify request failed');
    }
    return response;
  }

  spotify.validAuth = validAuth;
  spotify.request = request;
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.SpotifyUser;
