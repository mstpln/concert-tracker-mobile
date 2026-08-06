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

  const spotifyUrl = (kind, id, explicitUrl) => {
    const explicit = String(explicitUrl || '').trim();
    if (/^https:\/\/open\.spotify\.com\/(track|album)\/[A-Za-z0-9_-]+(?:[?#].*)?$/i.test(explicit)) return explicit;
    const safeId = String(id || '').trim();
    return safeId ? `https://open.spotify.com/${kind}/${encodeURIComponent(safeId)}` : null;
  };

  function trustedTrackMeta(listen) {
    const id = listen?.spotifyTrackId || listen?.spotify?.trackId || null;
    if (!id) return null;
    return {
      spotifyTrackId: String(id),
      spotifyTrackUrl: spotifyUrl('track', id, listen.spotifyTrackUrl || listen.spotifyTrackUri || listen.spotify?.trackUrl || listen.externalUrls?.spotify),
      artworkPath: listen.artworkPath || listen.albumArtworkUrl || listen.spotifyArtworkUrl || null,
    };
  }

  function trustedAlbumMeta(listen) {
    const id = listen?.spotifyAlbumId || listen?.spotify?.albumId || null;
    if (!id) return null;
    return {
      spotifyAlbumId: String(id),
      spotifyAlbumUrl: spotifyUrl('album', id, listen.spotifyAlbumUrl || listen.spotifyAlbumUri || listen.spotify?.albumUrl || listen.albumExternalUrls?.spotify),
      artworkPath: listen.artworkPath || listen.albumArtworkUrl || listen.spotifyArtworkUrl || null,
    };
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
        ? (listen.spotifyAlbumId || listen.musicbrainzReleaseId || listen.musicbrainzReleaseGroupId || listen.stableReleaseId)
        : (listen.spotifyTrackId || listen.musicbrainzRecordingId || listen.stableRecordingId);
      const key = stable
        ? `stable:${stable}`
        : `event:${listen.id || listen.eventId || listen.listenId || `${api.listenTimeMs(listen)}:${index}`}`;
      const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
      const item = grouped.get(key) || {
        [titleKey]: title,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        releaseTitle: listen.releaseTitle || null,
        localBandId: listen.localBandId || null,
        durationMs: 0,
        listenCount: 0,
        lastListenedMs: 0,
        artworkPath: null,
        spotifyTrackId: null,
        spotifyTrackUrl: null,
        spotifyAlbumId: null,
        spotifyAlbumUrl: null,
        trustedSpotifyIdentity: false,
      };
      const durationMs = api.validDurationMs(listen);
      const listenedAtMs = api.listenTimeMs(listen);
      item.durationMs += Number.isFinite(durationMs) ? durationMs : 0;
      item.listenCount += 1;
      if (Number.isFinite(listenedAtMs)) item.lastListenedMs = Math.max(item.lastListenedMs, listenedAtMs);
      if (trusted) {
        item.trustedSpotifyIdentity = true;
        if (kind === 'album') {
          item.spotifyAlbumId ||= trusted.spotifyAlbumId;
          item.spotifyAlbumUrl ||= trusted.spotifyAlbumUrl;
        } else {
          item.spotifyTrackId ||= trusted.spotifyTrackId;
          item.spotifyTrackUrl ||= trusted.spotifyTrackUrl;
        }
        if (!item.artworkPath && trusted.artworkPath) item.artworkPath = trusted.artworkPath;
      }
      grouped.set(key, item);
    });
    const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
    return [...grouped.values()]
      .sort((a, b) => b.listenCount - a.listenCount
        || b.durationMs - a.durationMs
        || b.lastListenedMs - a.lastListenedMs
        || normalize(a[titleKey]).localeCompare(normalize(b[titleKey])))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function installStatsAggregation() {
    api.topTracks = (listens, limit = 10) => aggregate(listens, 'track', limit);
    api.topAlbums = (listens, limit = 10) => aggregate(listens, 'album', limit);
    if (!api.selectedStats?.__liveVaultV99) {
      const previousSelectedStats = api.selectedStats;
      const selectedStatsV99 = function selectedStatsV99(listens, localBands, timeframe = 'threeMonths', now = new Date()) {
        const result = previousSelectedStats.call(this, listens, localBands, timeframe, now);
        return {
          ...result,
          topTracks: aggregate(result?.listens || [], 'track', 10),
          topAlbums: aggregate(result?.listens || [], 'album', 10),
        };
      };
      selectedStatsV99.__liveVaultV99 = true;
      api.selectedStats = selectedStatsV99;
    }
  }

  function trustedTitleHtml(item, kind, title) {
    const url = kind === 'album' ? item.spotifyAlbumUrl : item.spotifyTrackUrl;
    if (!url) return `<strong>${escapeHtml(title)}</strong>`;
    return `<strong><a class="trusted-listening-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></strong>`;
  }

  function trustedArtworkHtml(item, album = false) {
    if (!item?.trustedSpotifyIdentity || !item.artworkPath) {
      return `<span class="track-artwork is-placeholder" aria-hidden="true">${icon('music')}</span>`;
    }
    return `<span class="track-artwork"><span aria-hidden="true">${icon('music')}</span><img src="${escapeAttr(item.artworkPath)}" alt="" data-listening-image /></span>`;
  }

  function installToplistRendering() {
    if (typeof topListTrackRowsHtml !== 'function') return;
    topListTrackRowsHtml = function topListTrackRowsV99(stats, { limit = 100, timeframe = topBandsTimeframe } = {}) {
      const current = aggregate(stats.listens, 'track', limit);
      const previous = aggregate(stats.previousListens || [], 'track', limit);
      const previousRanks = new Map(previous.filter((item) => item.spotifyTrackId).map((item) => [item.spotifyTrackId, item.rank]));
      const tracks = current.map((item) => {
        if (timeframe === 'allTime' || !item.spotifyTrackId) return { ...item, movement: null };
        const previousRank = previousRanks.get(item.spotifyTrackId);
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
  }

  function enhanceBandDetail(root = document) {
    const card = root.querySelector?.('#screen-profile .top-tracks-card');
    if (!card || card.dataset.v99Trusted === 'true' || !activeProfileBandId) return;
    const albumMode = card.querySelector('[data-v81-ranked="albums"]')?.getAttribute('aria-selected') === 'true';
    const stats = globalListeningStats(profileListeningTimeframe);
    const listens = (stats.listens || []).filter((listen) => listen.localBandId === activeProfileBandId);
    const items = aggregate(listens, albumMode ? 'album' : 'track', 10);
    card.querySelectorAll('.top-track-row').forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      const art = row.querySelector('.track-artwork');
      if (art) art.outerHTML = trustedArtworkHtml(item, albumMode);
      const strong = row.querySelector('.top-track-copy strong');
      if (strong) strong.outerHTML = trustedTitleHtml(item, albumMode ? 'album' : 'track', albumMode ? item.releaseTitle : item.recordingTitle);
    });
    card.dataset.v99Trusted = 'true';
    wireListeningImages(card);
  }

  function install() {
    installStatsAggregation();
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

  globalThis.TrustedListeningV99 = { aggregate, trustedTrackMeta, trustedAlbumMeta, spotifyUrl, install, enhanceBandDetail };
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.TrustedListeningV99;
