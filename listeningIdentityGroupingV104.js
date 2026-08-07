'use strict';

(function attachListeningIdentityGroupingV104(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ListeningIdentityGroupingV104 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const ALBUM_EDITION_POLICY = 'specific_release';

  const normalize = (value) => String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const clean = (value) => String(value == null ? '' : value).trim() || null;

  function fallbackAlbumKey(listen, index = 0) {
    const title = normalize(listen?.releaseTitle);
    const artist = normalize(listen?.artistCreditName);
    return title ? `fallback:${artist}|${title}` : `event:${clean(listen?.stableListenId || listen?.sourceEventId) || index}`;
  }

  function stableAlbumIdentity(listen) {
    const releaseMbid = clean(listen?.musicbrainzReleaseId || listen?.releaseMbid);
    const stableReleaseId = clean(listen?.stableReleaseId);
    const spotifyAlbumId = clean(listen?.spotifyAlbumId || listen?.spotify?.albumId);
    if (releaseMbid) return { namespace: 'mb-release', id: releaseMbid, key: `mb-release:${releaseMbid}` };
    if (stableReleaseId) return { namespace: 'stable-release', id: stableReleaseId, key: `stable-release:${stableReleaseId}` };
    if (spotifyAlbumId) return { namespace: 'spotify-album', id: spotifyAlbumId, key: `spotify-album:${spotifyAlbumId}` };
    return null;
  }

  function albumIdentityKey(listen, index = 0, splitSignatures = null) {
    const fallback = fallbackAlbumKey(listen, index);
    const stable = stableAlbumIdentity(listen);
    if (!stable) return fallback;
    if (splitSignatures == null) return stable.key;
    // During aggregation, a provider ID splits a text group only when that same
    // provider proves that more than one specific edition exists under the same
    // artist + release title. One partially enriched listen must not split away
    // from otherwise identical unresolved historical listens.
    const namespaces = splitSignatures.get(fallback);
    return namespaces?.has(stable.namespace) ? stable.key : fallback;
  }

  function splitSignaturesFor(listens = [], stats = root?.ListeningStats) {
    const identities = new Map();
    (listens || []).forEach((listen, index) => {
      if (stats?.isValidListen && !stats.isValidListen(listen)) return;
      const fallback = fallbackAlbumKey(listen, index);
      if (!fallback.startsWith('fallback:')) return;
      const stable = stableAlbumIdentity(listen);
      if (!stable) return;
      const namespaces = identities.get(fallback) || new Map();
      const ids = namespaces.get(stable.namespace) || new Set();
      ids.add(stable.id);
      namespaces.set(stable.namespace, ids);
      identities.set(fallback, namespaces);
    });
    const output = new Map();
    for (const [fallback, namespaces] of identities) {
      const split = new Set([...namespaces.entries()].filter(([, ids]) => ids.size > 1).map(([namespace]) => namespace));
      if (split.size) output.set(fallback, split);
    }
    return output;
  }

  function aggregateAlbums(listens = [], limit = 10, stats = root?.ListeningStats) {
    if (!stats?.isValidListen || !stats?.validDurationMs || !stats?.listenTimeMs) return [];
    const splitSignatures = splitSignaturesFor(listens, stats);
    const grouped = new Map();
    (listens || []).forEach((listen, index) => {
      if (!stats.isValidListen(listen)) return;
      const releaseTitle = String(listen?.releaseTitle || '').trim().replace(/\s+/g, ' ');
      if (!releaseTitle) return;
      const key = albumIdentityKey(listen, index, splitSignatures);
      const item = grouped.get(key) || {
        releaseKey: key,
        releaseTitle,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        localBandId: listen.localBandId || listen.bandId || null,
        durationMs: 0,
        listenCount: 0,
        lastListenedMs: 0,
        artworkPath: null,
        musicbrainzReleaseId: clean(listen.musicbrainzReleaseId || listen.releaseMbid),
        musicbrainzReleaseGroupId: clean(listen.musicbrainzReleaseGroupId || listen.releaseGroupMbid),
        spotifyAlbumId: clean(listen.spotifyAlbumId || listen.spotify?.albumId),
      };
      const durationMs = stats.validDurationMs(listen);
      const listenedAtMs = stats.listenTimeMs(listen);
      item.durationMs += Number.isFinite(durationMs) ? durationMs : 0;
      item.listenCount += 1;
      if (Number.isFinite(listenedAtMs)) item.lastListenedMs = Math.max(item.lastListenedMs, listenedAtMs);
      if (!item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      if (!item.musicbrainzReleaseId) item.musicbrainzReleaseId = clean(listen.musicbrainzReleaseId || listen.releaseMbid);
      if (!item.musicbrainzReleaseGroupId) item.musicbrainzReleaseGroupId = clean(listen.musicbrainzReleaseGroupId || listen.releaseGroupMbid);
      if (!item.spotifyAlbumId) item.spotifyAlbumId = clean(listen.spotifyAlbumId || listen.spotify?.albumId);
      grouped.set(key, item);
    });
    return [...grouped.values()]
      .sort((a, b) => b.listenCount - a.listenCount
        || b.durationMs - a.durationMs
        || b.lastListenedMs - a.lastListenedMs
        || normalize(a.releaseTitle).localeCompare(normalize(b.releaseTitle)))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function install() {
    const stats = root?.ListeningStats;
    if (!stats || stats.__v104AlbumIdentityGrouping) return;
    stats.topAlbums = (listens, limit = 10) => aggregateAlbums(listens, limit, stats);
    const previousSelectedStats = stats.selectedStats;
    if (typeof previousSelectedStats === 'function') {
      stats.selectedStats = function selectedStatsV104(...args) {
        const result = previousSelectedStats.apply(this, args);
        return { ...result, topAlbums: aggregateAlbums(result?.listens || [], 10, stats) };
      };
    }
    stats.__v104AlbumIdentityGrouping = true;
  }

  install();
  if (typeof root?.document !== 'undefined') {
    root.document.addEventListener('DOMContentLoaded', install, { once: true });
    root.setTimeout?.(install, 0);
  }

  return { ALBUM_EDITION_POLICY, fallbackAlbumKey, stableAlbumIdentity, splitSignaturesFor, albumIdentityKey, aggregateAlbums, install };
});
