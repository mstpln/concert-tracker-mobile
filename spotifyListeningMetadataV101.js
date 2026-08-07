'use strict';

(function attachSpotifyListeningMetadataV101(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpotifyListeningMetadataV101 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_TRACKS_PER_RUN = 500;
  const PERSIST_EVERY = 25;
  const REQUEST_DELAY_MS = 150;
  const MARKET = 'SE';
  const SETTINGS_HINT = 'Fetch exact Spotify track, album and artwork metadata for listening records that already contain a trusted Spotify track ID. No title search is used. Up to 500 tracks are processed per run with paced requests.';

  const sleep = (ms) => new Promise((resolve) => root.setTimeout ? root.setTimeout(resolve, ms) : setTimeout(resolve, ms));
  const validSpotifyId = (value) => /^[A-Za-z0-9]{1,64}$/.test(String(value || '').trim());

  async function requestTrack(spotifyTrackId, {
    fetchImpl = root.fetch,
    spotifyUser = root.SpotifyUser,
    requestDelayMs = REQUEST_DELAY_MS,
  } = {}) {
    const id = String(spotifyTrackId || '').trim();
    if (!validSpotifyId(id)) throw new Error('Spotify track identity is invalid.');
    if (!spotifyUser?.validAuth || !spotifyUser?.refresh) throw new Error('Spotify connection support is unavailable.');

    let auth = await spotifyUser.validAuth(fetchImpl);
    const url = `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}?market=${MARKET}`;
    const run = () => fetchImpl(url, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
    let refreshed = false;
    let rateLimitRetried = false;
    let response;

    while (true) {
      response = await run();
      if (response.status === 401) {
        if (refreshed) {
          await spotifyUser.clearAuth?.();
          throw new Error('Spotify connection expired. Connect again.');
        }
        auth = await spotifyUser.refresh(auth, fetchImpl);
        refreshed = true;
        continue;
      }
      if (response.status === 429 && !rateLimitRetried) {
        const retryAfterMs = Math.max(Number(response.headers?.get?.('retry-after')) * 1000 || 0, requestDelayMs);
        await sleep(retryAfterMs);
        rateLimitRetried = true;
        continue;
      }
      break;
    }

    if (response.status === 404) return null;
    if (response.status === 403) {
      throw new Error('Spotify rejected the track metadata request. Your saved Spotify connection is still present; reconnecting is not expected to fix this.');
    }
    if (!response.ok) throw new Error(`Spotify track metadata request failed (${response.status}).`);
    const track = await response.json();
    if (!track || !validSpotifyId(track.id)) throw new Error('Spotify returned an invalid track metadata response.');
    return track;
  }

  function recordForRequestedTrack(metadata, requestedSpotifyTrackId, track) {
    const requestedId = String(requestedSpotifyTrackId || '').trim();
    const resolvedId = String(track?.id || '').trim();
    if (!validSpotifyId(requestedId) || !validSpotifyId(resolvedId)) return null;

    const requestedTrack = {
      ...track,
      id: requestedId,
      external_urls: {
        ...(track.external_urls || {}),
        spotify: `https://open.spotify.com/track/${requestedId}`,
      },
    };
    const record = metadata.recordFromSpotifyTrack(requestedTrack);
    if (!record) return null;
    if (resolvedId === requestedId) return record;
    return {
      ...record,
      spotifyProviderResolvedTrackId: resolvedId,
      spotifyProviderRelinked: true,
    };
  }

  async function enrich({
    cap = MAX_TRACKS_PER_RUN,
    onProgress = () => {},
    fetchImpl = root.fetch,
    metadata = root.SpotifyListeningMetadataV99,
    spotifyUser = root.SpotifyUser,
    requestDelayMs = REQUEST_DELAY_MS,
  } = {}) {
    if (!metadata?.readRemote || !metadata?.loadLocal || !metadata?.recordFromSpotifyTrack) {
      throw new Error('Spotify listening metadata support is unavailable.');
    }
    const remoteState = await metadata.readRemote(fetchImpl);
    let document = metadata.mergeDocuments(await metadata.loadLocal().catch(() => metadata.emptyDocument()), remoteState.document);
    const limit = Math.max(1, Math.min(MAX_TRACKS_PER_RUN, Number(cap) || MAX_TRACKS_PER_RUN));
    const ids = metadata.unresolvedTrackIds(document).slice(0, limit);
    let added = 0;

    for (let index = 0; index < ids.length; index += 1) {
      const requestedId = ids[index];
      const track = await requestTrack(requestedId, { fetchImpl, spotifyUser, requestDelayMs });
      if (track) {
        const record = recordForRequestedTrack(metadata, requestedId, track);
        if (record) {
          document.records[record.spotifyTrackId] = record;
          added += 1;
        }
      }

      const processed = index + 1;
      if (processed % PERSIST_EVERY === 0 || processed === ids.length) {
        document.updatedAt = new Date().toISOString();
        document = await metadata.saveLocal(document);
        metadata.applyToEvents(document);
        onProgress({ processed, total: ids.length, added });
      }
      if (processed < ids.length && requestDelayMs > 0) await sleep(requestDelayMs);
    }

    const remoteChanged = !metadata.documentsEqual(document, remoteState.document);
    if (remoteChanged) await metadata.writeRemote(document, remoteState.etag, remoteState.missing, fetchImpl);
    metadata.applyToEvents(document);
    return { requested: ids.length, added, total: Object.keys(document.records).length, synced: remoteChanged };
  }

  function install() {
    const document = root.document;
    if (!document || document.documentElement?.dataset.v101SpotifyMetadataInstalled === 'true') return;
    document.documentElement.dataset.v101SpotifyMetadataInstalled = 'true';

    const refreshHint = () => {
      const wrapper = document.querySelector('[data-v99-spotify-listening-metadata]');
      const hint = wrapper?.querySelector('.settings-hint');
      if (hint && hint.textContent !== SETTINGS_HINT) hint.textContent = SETTINGS_HINT;
    };

    document.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('[data-v99-enrich-listening]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const wrapper = button.closest('[data-v99-spotify-listening-metadata]');
      const status = wrapper?.querySelector('[data-v99-enrich-status]');
      if (!status) return;

      button.disabled = true;
      status.textContent = 'Checking trusted Spotify track IDs…';
      try {
        const result = await enrich({ onProgress: ({ processed, total, added }) => {
          status.textContent = `Fetched ${processed.toLocaleString()} of ${total.toLocaleString()} · ${added.toLocaleString()} matched`;
        } });
        status.textContent = result.requested
          ? `${result.added.toLocaleString()} exact Spotify records added · ${result.total.toLocaleString()} cached`
          : result.synced
            ? `Pending listening artwork metadata synchronized · ${result.total.toLocaleString()} cached`
            : 'Artwork metadata is already complete for the trusted Spotify track IDs on this device.';
      } catch (error) {
        status.textContent = error?.message || 'Spotify listening artwork could not be fetched.';
      } finally {
        button.disabled = false;
      }
    }, true);

    refreshHint();
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(refreshHint);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (root.document) {
    root.document.addEventListener('DOMContentLoaded', install, { once: true });
    root.setTimeout?.(install, 0);
  }

  return { MAX_TRACKS_PER_RUN, PERSIST_EVERY, REQUEST_DELAY_MS, requestTrack, recordForRequestedTrack, enrich, install };
});
