'use strict';

(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  if (!api) return;

  const normalize = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');

  const listenBandId = (listen) => listen?.bandId || listen?.localBandId || null;

  const spotifyUrl = (kind, id, explicitUrl) => {
    const explicit = String(explicitUrl || '').trim();
    if (/^https:\/\/open\.spotify\.com\/(track|album)\/[A-Za-z0-9]+(?:[?#].*)?$/i.test(explicit)) return explicit;
    const safeId = String(id || '').trim();
    return /^[A-Za-z0-9]{1,64}$/.test(safeId) ? `https://open.spotify.com/${kind}/${safeId}` : null;
  };

  function cachedMetadata(listen) {
    return globalThis.SpotifyListeningMetadataV99?.recordForTrack?.(listen?.spotifyTrackId) || null;
  }

  function trustedArtwork(listen, metadata) {
    if (metadata?.artworkUrl) return metadata.artworkUrl;
    if (listen?.albumArtworkUrl) return listen.albumArtworkUrl;
    if (listen?.spotifyMetadataSource === 'spotify_exact_track_id') return listen.artworkPath || null;
    return null;
  }

  function trustedTrackMeta(listen) {
    const metadata = cachedMetadata(listen);
    const id = listen?.spotifyTrackId || listen?.spotify?.trackId || metadata?.spotifyTrackId || null;
    const url = spotifyUrl('track', id, listen?.spotifyTrackUrl || listen?.spotify?.trackUrl || metadata?.spotifyTrackUrl);
    if (!id || !url) return null;
    return { spotifyTrackId: String(id), spotifyTrackUrl: url, artworkPath: trustedArtwork(listen, metadata) };
  }

  function trustedAlbumMeta(listen) {
    const metadata = cachedMetadata(listen);
    const id = listen?.spotifyAlbumId || listen?.spotify?.albumId || metadata?.spotifyAlbumId || null;
    const url = spotifyUrl('album', id, listen?.spotifyAlbumUrl || listen?.spotify?.albumUrl || metadata?.spotifyAlbumUrl);
    if (!id || !url) return null;
    return { spotifyAlbumId: String(id), spotifyAlbumUrl: url, artworkPath: trustedArtwork(listen, metadata) };
  }

  function aggregate(listens, kind, limit = 10) {
    const grouped = new Map();
    (listens || []).forEach((listen, index) => {
      if (!api.isValidListen(listen)) return;
      const title = kind === 'album'
        ? String(listen?.releaseTitle || '').trim().replace(/\s+/g, ' ')
        : String(listen?.recordingTitle || '').trim().replace(/\s+/g, ' ');
      if (!title) return;
      const trusted = kind === 'album' ? trustedAlbumMeta(listen) : trustedTrackMeta(listen);
      const stable = kind === 'album'
        ? (listen.musicbrainzReleaseId || listen.musicbrainzReleaseGroupId || listen.stableReleaseId || trusted?.spotifyAlbumId)
        : (listen.musicbrainzRecordingId || listen.stableRecordingId || trusted?.spotifyTrackId);
      const key = stable ? `stable:${stable}` : `event:${listen.id || listen.eventId || listen.listenId || `${api.listenTimeMs(listen)}:${index}`}`;
      const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
      const item = grouped.get(key) || {
        recordingKey: key,
        trustedIdentity: !!stable,
        [titleKey]: title,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        releaseTitle: listen.releaseTitle || null,
        localBandId: listenBandId(listen),
        durationMs: 0,
        listenCount: 0,
        lastListenedMs: 0,
        artworkPath: null,
        spotifyTrackId: null,
        spotifyTrackUrl: null,
        spotifyAlbumId: null,
        spotifyAlbumUrl: null,
        trustedSpotifyIdentity: false,
        spotifyConflict: false,
      };
      const durationMs = api.validDurationMs(listen);
      const listenedAtMs = api.listenTimeMs(listen);
      item.durationMs += Number.isFinite(durationMs) ? durationMs : 0;
      item.listenCount += 1;
      if (Number.isFinite(listenedAtMs)) item.lastListenedMs = Math.max(item.lastListenedMs, listenedAtMs);
      if (trusted && !item.spotifyConflict) {
        const currentId = kind === 'album' ? item.spotifyAlbumId : item.spotifyTrackId;
        const nextId = kind === 'album' ? trusted.spotifyAlbumId : trusted.spotifyTrackId;
        if (currentId && currentId !== nextId) {
          item.spotifyConflict = true;
          item.trustedSpotifyIdentity = false;
          item.spotifyTrackId = null;
          item.spotifyTrackUrl = null;
          item.spotifyAlbumId = null;
          item.spotifyAlbumUrl = null;
          item.artworkPath = null;
        } else {
          item.trustedSpotifyIdentity = true;
          if (kind === 'album') {
            item.spotifyAlbumId = trusted.spotifyAlbumId;
            item.spotifyAlbumUrl = trusted.spotifyAlbumUrl;
          } else {
            item.spotifyTrackId = trusted.spotifyTrackId;
            item.spotifyTrackUrl = trusted.spotifyTrackUrl;
          }
          if (!item.artworkPath && trusted.artworkPath) item.artworkPath = trusted.artworkPath;
        }
      }
      grouped.set(key, item);
    });
    const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
    return [...grouped.values()]
      .sort((a, b) => b.listenCount - a.listenCount || b.durationMs - a.durationMs || b.lastListenedMs - a.lastListenedMs || normalize(a[titleKey]).localeCompare(normalize(b[titleKey])))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function trustedTitleHtml(item, kind, title) {
    const url = kind === 'album' ? item.spotifyAlbumUrl : item.spotifyTrackUrl;
    if (!url) return `<strong>${escapeHtml(title)}</strong>`;
    return `<strong><a class="trusted-listening-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></strong>`;
  }

  function trustedArtworkHtml(item) {
    if (!item?.trustedSpotifyIdentity || !item.artworkPath) return `<span class="track-artwork is-placeholder" aria-hidden="true">${icon('music')}</span>`;
    return `<span class="track-artwork"><span aria-hidden="true">${icon('music')}</span><img src="${escapeAttr(item.artworkPath)}" alt="" data-listening-image /></span>`;
  }

  function installToplistRendering() {
    if (typeof topListTrackRowsHtml !== 'function' || topListTrackRowsHtml.__liveVaultV99) return;
    const render = function topListTrackRowsV99(stats, { limit = 100, timeframe = topBandsTimeframe } = {}) {
      const current = aggregate(stats.listens, 'track', limit);
      const previous = aggregate(stats.previousListens || [], 'track', limit);
      const previousRanks = new Map(previous.filter((item) => item.trustedIdentity).map((item) => [item.recordingKey, item.rank]));
      const tracks = current.map((item) => {
        if (timeframe === 'allTime' || !item.trustedIdentity) return { ...item, movement: null };
        const previousRank = previousRanks.get(item.recordingKey);
        if (!previousRank) return { ...item, movement: { kind: 'new', delta: null, label: 'New' } };
        const delta = previousRank - item.rank;
        if (delta > 0) return { ...item, movement: { kind: 'up', delta, label: `Up ${delta}` } };
        if (delta < 0) return { ...item, movement: { kind: 'down', delta: Math.abs(delta), label: `Down ${Math.abs(delta)}` } };
        return { ...item, movement: null };
      });
      if (!tracks.length) return '<p class="listening-empty">No tracks are available for this period.</p>';
      return tracks.map((track) => {
        const band = track.localBandId ? bands.find((candidate) => candidate.id === track.localBandId) : null;
        const artist = band?.name || track.artistCreditName || 'Unknown artist';
        const movement = track.movement ? movementHtml(track.movement) : '';
        const artistHtml = band
          ? `<button type="button" class="top-track-artist trusted-listening-artist" data-listening-band-id="${escapeAttr(band.id)}" data-listening-source-timeframe="${escapeAttr(timeframe)}">${escapeHtml(artist)}</button>`
          : `<span class="top-track-artist">${escapeHtml(artist)}</span>`;
        return `<div class="toplist-track-row"><span class="top-track-rank">#${track.rank}</span>${trustedArtworkHtml(track)}<span class="top-track-copy">${trustedTitleHtml(track, 'track', track.recordingTitle)}${artistHtml}<small>${track.listenCount.toLocaleString()} listens · ${ListeningStats.formatDuration(track.durationMs)}</small></span>${movement}</div>`;
      }).join('');
    };
    render.__liveVaultV99 = true;
    topListTrackRowsHtml = render;
  }

  function exactMetadataForItem(item, albumMode, sourceListens) {
    const itemArtist = normalize(item.artistCreditName);
    const matching = albumMode
      ? (sourceListens || []).filter((listen) => normalize(listen.releaseTitle) === normalize(item.releaseTitle))
      : (sourceListens || []).filter((listen) => normalize(listen.recordingTitle) === normalize(item.recordingTitle)
        && (!itemArtist || normalize(listen.artistCreditName) === itemArtist));
    const trusted = matching.map(albumMode ? trustedAlbumMeta : trustedTrackMeta).filter(Boolean);
    const ids = new Set(trusted.map((entry) => albumMode ? entry.spotifyAlbumId : entry.spotifyTrackId));
    if (ids.size !== 1) return null;
    return { ...trusted[0], artworkPath: trusted.find((entry) => entry.artworkPath)?.artworkPath || null, trustedSpotifyIdentity: true };
  }

  function bandRankedItems(albumMode, rankingListens, sourceListens = rankingListens) {
    const items = albumMode ? api.topAlbums(rankingListens, 10) : api.topTracks(rankingListens, 10);
    return items.map((item) => {
      const exact = exactMetadataForItem(item, albumMode, sourceListens);
      if (exact) return { ...item, ...exact };
      return albumMode
        ? { ...item, spotifyAlbumId: null, spotifyAlbumUrl: null, artworkPath: null, trustedSpotifyIdentity: false }
        : { ...item, spotifyTrackId: null, spotifyTrackUrl: null, artworkPath: null, trustedSpotifyIdentity: false };
    });
  }

  function sourceListensForStats(stats, bandId, timeframe = profileListeningTimeframe) {
    const source = typeof listeningEvents === 'undefined' ? [] : listeningEvents;
    const supplied = stats?.window;
    const now = typeof listeningNow === 'function' ? listeningNow() : new Date();
    const fallback = typeof api.resolveWindow === 'function' ? api.resolveWindow(timeframe, now, source) : null;
    const window = supplied && Number.isFinite(supplied.startMs) && Number.isFinite(supplied.endMs) ? supplied : fallback;
    if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) return [];
    return source.filter((listen) => {
      const time = api.listenTimeMs(listen);
      return listenBandId(listen) === bandId && Number.isFinite(time) && time >= window.startMs && time < window.endMs;
    });
  }

  function enhanceBandDetail(root = document) {
    const card = root.querySelector?.('#screen-profile .top-tracks-card');
    if (!card || !activeProfileBandId) return;
    const albumMode = card.querySelector('[data-v81-ranked="albums"]')?.getAttribute('aria-selected') === 'true';
    const signature = `${activeProfileBandId}:${profileListeningTimeframe}:${albumMode ? 'albums' : 'tracks'}`;
    if (card.dataset.v99Trusted === signature) return;
    const stats = globalListeningStats(profileListeningTimeframe);
    const rankingListens = (stats.listens || []).filter((listen) => listenBandId(listen) === activeProfileBandId);
    const sourceListens = sourceListensForStats(stats, activeProfileBandId, profileListeningTimeframe);
    const items = bandRankedItems(albumMode, rankingListens, sourceListens);
    let enhanced = 0;
    card.querySelectorAll('.top-track-row').forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      const art = row.querySelector('.track-artwork');
      if (art) art.outerHTML = trustedArtworkHtml(item);
      const strong = row.querySelector('.top-track-copy strong');
      if (strong) strong.outerHTML = trustedTitleHtml(item, albumMode ? 'album' : 'track', albumMode ? item.releaseTitle : item.recordingTitle);
      enhanced += 1;
    });
    if (!enhanced) return;
    card.dataset.v99Trusted = signature;
    wireListeningImages(card);
  }

  function install() {
    installToplistRendering();
    if (typeof document !== 'undefined') enhanceBandDetail(document);
  }

  install();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', install);
    const observer = new MutationObserver(() => enhanceBandDetail(document));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    globalThis.setTimeout?.(install, 0);
    globalThis.addEventListener?.('load', install, { once: true });
  }

  globalThis.TrustedListeningV99 = {
    aggregate, trustedTrackMeta, trustedAlbumMeta, spotifyUrl, trustedTitleHtml, trustedArtworkHtml,
    bandRankedItems, sourceListensForStats, listenBandId, install, enhanceBandDetail,
  };
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.TrustedListeningV99;
