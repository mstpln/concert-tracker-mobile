'use strict';

(function attachSpotifyListeningMetadataV101(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpotifyListeningMetadataV101 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_TRACKS_PER_RUN = 100;
  const PERSIST_EVERY = 10;
  const REQUEST_DELAY_MS = 1000;
  const MARKET = 'SE';
  const SETTINGS_HINT = 'Fetch exact Spotify track, album and artwork metadata for listening records that already contain a trusted Spotify track ID. No title search is used. Up to 100 tracks are processed per run with slow, quota-friendly requests.';

  const sleep = (ms) => new Promise((resolve) => root.setTimeout ? root.setTimeout(resolve, ms) : setTimeout(resolve, ms));
  const validSpotifyId = (value) => /^[A-Za-z0-9]{1,64}$/.test(String(value || '').trim());
  const retryAfterSeconds = (response) => Math.max(0, Math.ceil(Number(response?.headers?.get?.('retry-after')) || 0));

  async function readSpotifyError(response) {
    try {
      const payload = await response.clone().json();
      return payload?.error && typeof payload.error === 'object' ? payload.error : {};
    } catch (_) {
      return {};
    }
  }

  function rateLimitError({ quotaExceeded = false, retryAfter = 0 } = {}) {
    if (quotaExceeded) {
      return new Error('Spotify has reached its Development Mode quota. BANDMARKR stopped safely and kept the artwork already fetched. Try again later after Spotify resets the quota. Reconnecting Spotify will not help.');
    }
    if (retryAfter > 0) {
      const unit = retryAfter === 1 ? 'second' : 'seconds';
      return new Error(`Spotify is temporarily rate-limiting artwork requests. BANDMARKR stopped safely and kept the artwork already fetched. Wait about ${retryAfter} ${unit}, then try again.`);
    }
    return new Error('Spotify is temporarily rate-limiting artwork requests. BANDMARKR stopped safely and kept the artwork already fetched. Wait a little while, then try again.');
  }

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
          throw new Error('Spotify connection expired. Connect Spotify again, then retry the artwork fetch.');
        }
        auth = await spotifyUser.refresh(auth, fetchImpl);
        refreshed = true;
        continue;
      }
      if (response.status === 429) {
        const spotifyError = await readSpotifyError(response);
        if (spotifyError.reason === 'QUOTA_EXCEEDED') throw rateLimitError({ quotaExceeded: true });
        const retryAfter = retryAfterSeconds(response);
        if (!rateLimitRetried) {
          await sleep(Math.max(retryAfter * 1000, requestDelayMs));
          rateLimitRetried = true;
          continue;
        }
        throw rateLimitError({ retryAfter });
      }
      break;
    }

    if (response.status === 404) return null;
    if (response.status === 403) {
      throw new Error('Spotify rejected this artwork request. Your Spotify connection is still saved, so reconnecting is not expected to fix it.');
    }
    if (!response.ok) throw new Error(`Spotify could not fetch this track right now (error ${response.status}). Try again later.`);
    const track = await response.json();
    if (!track || !validSpotifyId(track.id)) throw new Error('Spotify returned track information BANDMARKR could not safely use. Nothing was guessed or overwritten.');
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

  async function persistProgress(metadata, document, processed, total, added, onProgress) {
    document.updatedAt = new Date().toISOString();
    const saved = await metadata.saveLocal(document);
    metadata.applyToEvents(saved);
    onProgress({ processed, total, added });
    return saved;
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
      throw new Error('Spotify listening artwork support is unavailable. Refresh BANDMARKR and try again.');
    }
    const remoteState = await metadata.readRemote(fetchImpl);
    let document = metadata.mergeDocuments(await metadata.loadLocal().catch(() => metadata.emptyDocument()), remoteState.document);
    const limit = Math.max(1, Math.min(MAX_TRACKS_PER_RUN, Number(cap) || MAX_TRACKS_PER_RUN));
    const ids = metadata.unresolvedTrackIds(document).slice(0, limit);
    let added = 0;
    let processed = 0;

    try {
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

        processed = index + 1;
        if (processed % PERSIST_EVERY === 0 || processed === ids.length) {
          document = await persistProgress(metadata, document, processed, ids.length, added, onProgress);
        }
        if (processed < ids.length && requestDelayMs > 0) await sleep(requestDelayMs);
      }
    } catch (error) {
      if (added > 0 && processed % PERSIST_EVERY !== 0) {
        document = await persistProgress(metadata, document, processed, ids.length, added, onProgress);
      }
      error.liveVaultProgress = { processed, total: ids.length, added };
      throw error;
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
      status.textContent = 'Checking which trusted Spotify tracks still need artwork…';
      try {
        const result = await enrich({ onProgress: ({ processed, total, added }) => {
          status.textContent = `Fetching artwork: ${processed.toLocaleString()} of ${total.toLocaleString()} checked · ${added.toLocaleString()} added`;
        } });
        status.textContent = result.requested
          ? `Done. ${result.added.toLocaleString()} artwork records added · ${result.total.toLocaleString()} cached in total.`
          : result.synced
            ? `Done. Saved artwork metadata was synchronized · ${result.total.toLocaleString()} cached in total.`
            : 'Done. Artwork is already complete for the trusted Spotify track IDs on this device.';
      } catch (error) {
        const progress = error?.liveVaultProgress;
        const prefix = progress?.added > 0
          ? `${progress.added.toLocaleString()} new artwork records were saved before the fetch stopped. `
          : '';
        status.textContent = `${prefix}${error?.message || 'Spotify artwork could not be fetched. Please try again later.'}`;
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
