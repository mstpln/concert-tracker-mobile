'use strict';
// Browser-only Spotify Authorization Code + PKCE and private-playlist client.
// Tokens remain only in chrome.storage.local; this module never touches R2.
(function () {
  const TOKEN_KEY = 'spotifyUserAuthorization'; const PENDING_KEY = 'spotifyUserPkcePending';
  const SCOPE = 'playlist-modify-private'; const ACCOUNTS = 'https://accounts.spotify.com'; const API = 'https://api.spotify.com/v1';
  const random = (bytes = 32) => { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); };
  const challengeFor = async (verifier) => { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)); return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); };
  const redirectUri = () => `${location.origin}${location.pathname}`;
  const getAuth = async () => (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] || null;
  const setAuth = async (auth) => chrome.storage.local.set({ [TOKEN_KEY]: auth });
  const clearAuth = async () => chrome.storage.local.remove([TOKEN_KEY, PENDING_KEY]);
  async function beginAuthorization(clientId) {
    const verifier = random(64); const state = random(32); const pending = { clientId, verifier, state, redirectUri: redirectUri(), createdAt: new Date().toISOString() };
    await chrome.storage.local.set({ [PENDING_KEY]: pending });
    const url = new URL(`${ACCOUNTS}/authorize`); url.searchParams.set('client_id', clientId); url.searchParams.set('response_type', 'code'); url.searchParams.set('redirect_uri', pending.redirectUri); url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', await challengeFor(verifier)); url.searchParams.set('state', state); url.searchParams.set('scope', SCOPE);
    location.assign(url.toString());
  }
  async function exchange(params, pending, fetchImpl = fetch) {
    const body = new URLSearchParams({ client_id: pending.clientId, grant_type: 'authorization_code', code: params.code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
    const response = await fetchImpl(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) throw new Error('Spotify authorization could not be completed');
    const data = await response.json(); if (!data?.access_token || !data?.refresh_token) throw new Error('Spotify returned an invalid authorization response');
    const auth = { clientId: pending.clientId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(), scope: data.scope || SCOPE, tokenType: data.token_type || 'Bearer' }; await setAuth(auth); await chrome.storage.local.remove(PENDING_KEY); return auth;
  }
  async function handleCallback(fetchImpl = fetch) {
    const params = new URLSearchParams(location.search); if (!params.has('code') && !params.has('error') && !location.search) return { kind: 'none' };
    const pending = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY];
    try { if (params.get('error')) throw new Error('Spotify authorization was declined'); if (!pending || !params.get('code') || params.get('state') !== pending.state) throw new Error('Spotify authorization could not be verified'); const auth = await exchange({ code: params.get('code') }, pending, fetchImpl); history.replaceState({}, '', redirectUri()); return { kind: 'ok', auth }; }
    catch (error) { await chrome.storage.local.remove(PENDING_KEY); history.replaceState({}, '', redirectUri()); return { kind: 'error', message: error.message }; }
  }
  async function refresh(auth, fetchImpl = fetch) {
    const body = new URLSearchParams({ client_id: auth.clientId, grant_type: 'refresh_token', refresh_token: auth.refreshToken }); const response = await fetchImpl(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) { await clearAuth(); throw new Error('Spotify connection expired. Connect again.'); }
    const data = await response.json(); if (!data?.access_token) throw new Error('Spotify refresh failed'); const next = { ...auth, accessToken: data.access_token, refreshToken: data.refresh_token || auth.refreshToken, expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(), scope: data.scope || auth.scope }; await setAuth(next); return next;
  }
  async function validAuth(fetchImpl = fetch) { const auth = await getAuth(); if (!auth) throw new Error('Connect Spotify first'); return Date.parse(auth.expiresAt) > Date.now() + 60_000 ? auth : refresh(auth, fetchImpl); }
  async function request(path, options = {}, fetchImpl = fetch) {
    let auth = await validAuth(fetchImpl); let response = await fetchImpl(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${auth.accessToken}` } });
    if (response.status === 401) { auth = await refresh(auth, fetchImpl); response = await fetchImpl(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${auth.accessToken}` } }); if (response.status === 401) { await clearAuth(); throw new Error('Spotify connection expired. Connect again.'); } }
    if (response.status === 429) { const seconds = Number(response.headers?.get?.('retry-after')) || 1; await new Promise((resolve) => setTimeout(resolve, seconds * 1000)); response = await fetchImpl(`${API}${path}`, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${auth.accessToken}` } }); }
    if (!response.ok) throw new Error(response.status === 403 ? 'Spotify permissions are missing. Connect again.' : 'Spotify request failed'); return response;
  }
  async function createPrivatePlaylist(name, uris, fetchImpl = fetch, operation = {}) {
    let playlist = operation.playlist || null; let added = operation.added || 0;
    if (!playlist) { const response = await request('/me/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, public: false, collaborative: false }) }, fetchImpl); playlist = await response.json(); if (!playlist?.id || !playlist?.external_urls?.spotify) throw new Error('Spotify returned an invalid playlist'); }
    for (let index = added; index < uris.length; index += 100) { try { await request(`/playlists/${encodeURIComponent(playlist.id)}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: uris.slice(index, index + 100), position: index }) }, fetchImpl); added = Math.min(uris.length, index + 100); } catch (error) { error.operation = { playlist, added }; throw error; } }
    return { playlist, added };
  }
  window.SpotifyUser = { SCOPE, TOKEN_KEY, redirectUri, random, challengeFor, getAuth, setAuth, clearAuth, beginAuthorization, handleCallback, refresh, createPrivatePlaylist };
})();
