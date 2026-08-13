'use strict';

(function attachV72Corrections(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultV72 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const THREE_MONTHS = 'threeMonths';
  const CACHE_KEY = 'spotifyTrackArtworkCacheV1';
  const GENRE_GROUPS = Object.freeze(['Rock', 'Pop', 'Hip-hop/R&B', 'Electronic', 'Other']);
  const artworkCache = new Map();
  let cacheLoaded = false;
  let enrichmentRunning = false;

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('en');
  }

  function parseDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function shiftUtcMonths(value, amount) {
    const date = parseDate(value);
    if (!date) return null;
    const target = new Date(date.getTime());
    const day = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + amount);
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target;
  }

  function shiftUtcYears(value, amount) {
    const date = parseDate(value);
    if (!date) return null;
    const targetYear = date.getUTCFullYear() + amount;
    const target = new Date(date.getTime());
    target.setUTCFullYear(targetYear, date.getUTCMonth(), 1);
    const lastDay = new Date(Date.UTC(targetYear, date.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return target;
  }

  function listenTimeMs(listen) {
    if (Number.isFinite(Number(listen?.listenedAtMs))) return Number(listen.listenedAtMs);
    return parseDate(listen?.listenedAt)?.getTime() ?? NaN;
  }

  function safeResolveWindow(timeframe, now, listens) {
    const endAt = parseDate(now) || new Date();
    const endMs = endAt.getTime() + 1;
    if (timeframe === THREE_MONTHS) {
      const startAt = shiftUtcMonths(endAt, -3);
      const previousStartAt = shiftUtcMonths(startAt, -3);
      return { timeframe, label: '3 months', bucket: 'week', startMs: startAt.getTime(), endMs, previousStartMs: previousStartAt.getTime(), previousEndMs: startAt.getTime() };
    }
    if (timeframe === 'oneYear') {
      const startAt = shiftUtcYears(endAt, -1);
      const previousStartAt = shiftUtcYears(startAt, -1);
      return { timeframe, label: '1 year', bucket: 'month', startMs: startAt.getTime(), endMs, previousStartMs: previousStartAt.getTime(), previousEndMs: startAt.getTime() };
    }
    let earliest = Infinity;
    for (const listen of listens || []) {
      const value = listenTimeMs(listen);
      if (Number.isFinite(value) && value < earliest) earliest = value;
    }
    return { timeframe: 'allTime', label: 'All time', bucket: 'year', startMs: earliest === Infinity ? endAt.getTime() : earliest, endMs, previousStartMs: null, previousEndMs: null };
  }

  function classifyGenre(value) {
    const genre = normalizeText(value);
    if (!genre) return 'Other';
    if (/alternative rock|indie rock|hard rock|garage rock|post[- ]?punk|nu metal|alternative metal|heavy metal|rock|metal|punk|grunge|emo/.test(genre)) return 'Rock';
    if (/indie pop|synth[- ]?pop|power pop|pop rock|\bpop\b/.test(genre)) return 'Pop';
    if (/hip[- ]?hop|\brap\b|trap|r&b|rnb|rhythm and blues|soul|funk/.test(genre)) return 'Hip-hop/R&B';
    if (/electronic|\bdance\b|edm|house|techno|electro|drum and bass|dnb|ambient|trip[- ]?hop/.test(genre)) return 'Electronic';
    return 'Other';
  }

  function storedGenres(band) {
    if (Array.isArray(band?.genres)) return band.genres.filter(Boolean);
    if (Array.isArray(band?.genre)) return band.genre.filter(Boolean);
    return String(band?.genre || band?.genres || '')
      .split(/[,;/|]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function classifyBand(band) {
    for (const genre of storedGenres(band)) {
      const group = classifyGenre(genre);
      if (group !== 'Other') return group;
    }
    return 'Other';
  }

  function eligibleBandMap() {
    if (typeof bands === 'undefined') return new Map();
    return new Map((bands || []).filter((band) => band?.id).map((band) => [String(band.id), band]));
  }

  function eligibleListens(listens) {
    const lookup = eligibleBandMap();
    return (listens || []).filter((listen) => listen?.localBandId != null && lookup.has(String(listen.localBandId)));
  }

  function recordingKey(listen) {
    if (listen?.spotifyTrackId) return `spotify:${listen.spotifyTrackId}`;
    if (listen?.musicbrainzRecordingId) return `mbid:${listen.musicbrainzRecordingId}`;
    if (listen?.stableRecordingId) return `recording:${listen.stableRecordingId}`;
    return `fallback:${normalizeText(listen?.artistCreditName)}|${normalizeText(listen?.recordingTitle)}|${normalizeText(listen?.releaseTitle)}`;
  }

  function correctedTopTracks(listens, limit = 10) {
    const grouped = new Map();
    for (const listen of listens || []) {
      const duration = Number(listen?.listenedDurationMs);
      if (!Number.isFinite(duration) || duration <= 0 || !listen?.recordingTitle) continue;
      const key = recordingKey(listen);
      const cached = listen.spotifyTrackId ? artworkCache.get(String(listen.spotifyTrackId)) : null;
      const item = grouped.get(key) || {
        recordingKey: key,
        recordingTitle: listen.recordingTitle,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        releaseTitle: listen.releaseTitle || null,
        localBandId: listen.localBandId || null,
        spotifyTrackId: listen.spotifyTrackId || null,
        artworkPath: cached?.imageUrl || listen.artworkPath || null,
        durationMs: 0,
        listenCount: 0,
      };
      item.durationMs += duration;
      item.listenCount += 1;
      if (!item.spotifyTrackId && listen.spotifyTrackId) item.spotifyTrackId = listen.spotifyTrackId;
      if (!item.artworkPath && cached?.imageUrl) item.artworkPath = cached.imageUrl;
      grouped.set(key, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || normalizeText(a.recordingTitle).localeCompare(normalizeText(b.recordingTitle)))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function correctedGenreDistribution(listens) {
    const lookup = eligibleBandMap();
    const years = new Map();
    for (const listen of listens || []) {
      const band = listen?.localBandId == null ? null : lookup.get(String(listen.localBandId));
      const time = listenTimeMs(listen);
      const duration = Number(listen?.listenedDurationMs);
      if (!band || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) continue;
      const year = new Date(time).getUTCFullYear();
      const groups = years.get(year) || Object.fromEntries(GENRE_GROUPS.map((group) => [group, 0]));
      groups[classifyBand(band)] += duration;
      years.set(year, groups);
    }
    return [...years.entries()].sort(([a], [b]) => a - b).map(([year, groups]) => {
      const total = Object.values(groups).reduce((sum, value) => sum + value, 0);
      const percentages = {};
      let assigned = 0;
      GENRE_GROUPS.forEach((group, index) => {
        const percentage = index === GENRE_GROUPS.length - 1
          ? Math.max(0, Math.round((100 - assigned) * 10) / 10)
          : Math.round(((groups[group] || 0) / total) * 1000) / 10;
        percentages[group] = percentage;
        assigned += percentage;
      });
      return { year, totalDurationMs: total, percentages };
    });
  }

  function correctedSelectedStats(listens, appBands, timeframe = THREE_MONTHS, now = new Date()) {
    const source = eligibleListens(listens);
    const window = safeResolveWindow(timeframe, now, source);
    const selected = root.ListeningStats.listensForWindow(source, window);
    const previous = root.ListeningStats.previousListensForWindow(source, window);
    const ranked = root.ListeningStats.rankMovement(
      root.ListeningStats.topBands(selected, appBands, 100),
      root.ListeningStats.topBands(previous, appBands, 100),
      timeframe,
    );
    const buckets = root.ListeningStats.timeBuckets(source, window, window.bucket);
    return {
      timeframe,
      label: window.label,
      window,
      listens: selected,
      previousListens: previous,
      durationMs: root.ListeningStats.totalDurationMs(selected),
      listenCount: root.ListeningStats.listenCount(selected),
      lastListened: root.ListeningStats.lastListened(selected),
      distinctMatchedBands: ranked.length,
      topBands: ranked,
      topTracks: correctedTopTracks(selected, 10),
      buckets,
      mostActive: buckets.length ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || a.startAt.localeCompare(b.startAt))[0] : null,
    };
  }

  function concertListeningWindow(concert, isPast, now = new Date()) {
    const nowAt = parseDate(now);
    if (!nowAt) return null;
    if (!isPast) {
      const start = shiftUtcMonths(nowAt, -6);
      return { startMs: start.getTime(), endMs: nowAt.getTime() + 1 };
    }

    const concertAt = parseDate(`${concert?.date || ''}T00:00:00Z`);
    if (!concertAt) return null;
    const start = shiftUtcMonths(concertAt, -3);
    const fixedEndDate = shiftUtcMonths(concertAt, 3);
    const fixedEndExclusive = new Date(fixedEndDate.getTime());
    fixedEndExclusive.setUTCDate(fixedEndExclusive.getUTCDate() + 1);
    return {
      startMs: start.getTime(),
      endMs: Math.min(nowAt.getTime() + 1, fixedEndExclusive.getTime()),
    };
  }

  function concertListeningAggregate(concert, isPast, now = new Date(), listens = []) {
    const window = concertListeningWindow(concert, isPast, now);
    if (!window || !concert?.bandId) return null;
    const matching = eligibleListens(listens).filter((listen) => String(listen.localBandId) === String(concert.bandId) && listenTimeMs(listen) >= window.startMs && listenTimeMs(listen) < window.endMs);
    if (!matching.length) return null;
    return {
      durationMs: root.ListeningStats.totalDurationMs(matching),
      listenCount: root.ListeningStats.listenCount(matching),
    };
  }

  function listeningRowHtml(concert, isPast) {
    if (typeof listeningEvents === 'undefined' || typeof icon !== 'function') return '';
    const aggregate = concertListeningAggregate(concert, isPast, typeof listeningNow === 'function' ? listeningNow() : new Date(), listeningEvents);
    if (!aggregate) return '';
    return `<div class="concert-listening-row">${icon('headphones')}<span><strong>Your listening</strong><small>${root.ListeningStats.formatDuration(aggregate.durationMs)} · ${aggregate.listenCount.toLocaleString()} listens</small></span></div>`;
  }

  function injectBefore(source, marker, html) {
    const index = source.indexOf(marker);
    if (index < 0) return source;
    return source.slice(0, index) + html + source.slice(index);
  }

  function applyFunctionOverrides() {
    if (!root.ListeningStats || typeof bands === 'undefined') return;
    root.ListeningStats.GENRE_GROUPS = GENRE_GROUPS;
    root.ListeningStats.genreGroup = classifyGenre;
    root.ListeningStats.genreDistributionByYear = correctedGenreDistribution;
    root.ListeningStats.topTracks = correctedTopTracks;
    root.ListeningStats.selectedStats = correctedSelectedStats;

    if (typeof startTopBandsHtml === 'function') {
      startTopBandsHtml = function correctedStartTopBandsHtml() {
        const stats = globalListeningStats(THREE_MONTHS);
        return `<section class="listening-card start-top-bands-card" aria-labelledby="start-top-bands-title">
          <div class="listening-card-heading"><p id="start-top-bands-title">YOUR TOP BANDS · 3 MONTHS</p><button type="button" id="start-top-bands-view-all" class="listening-link">View all</button></div>
          <div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 3), { compact: true, timeframe: THREE_MONTHS, showMovement: true })}</div>
          <button type="button" id="start-listening-stats" class="listening-card-footer">See your listening stats${icon('chevronRight')}</button>
        </section>`;
      };
    }

    if (typeof topBandsPreviewHtml === 'function') {
      topBandsPreviewHtml = function correctedTopBandsPreviewHtml(stats) {
        return `<section class="listening-card top-bands-card" aria-labelledby="stats-top-bands-title">
          <div class="listening-card-heading"><p id="stats-top-bands-title">TOP BANDS · ${escapeHtml(stats.label.toUpperCase())}</p><button type="button" class="listening-link" data-open-top-bands>View all</button></div>
          <div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 10), { timeframe: stats.timeframe, showMovement: true })}</div>
          <button type="button" class="listening-card-footer" data-open-top-bands>View full top 100${icon('chevronRight')}</button>
        </section>`;
      };
    }

    if (typeof topTracksHtml === 'function') {
      topTracksHtml = function correctedTopTracksHtml(stats) {
        return `<section class="listening-card top-tracks-card" aria-labelledby="top-tracks-title">
          <p id="top-tracks-title" class="listening-section-title">TOP TRACKS · ${escapeHtml(stats.label.toUpperCase())}</p>
          <div class="top-tracks-list">${stats.topTracks.length ? stats.topTracks.slice(0, 10).map((track) => `<div class="top-track-row"${track.spotifyTrackId ? ` data-spotify-track-id="${escapeAttr(track.spotifyTrackId)}"` : ''}><span class="top-track-rank">#${track.rank}</span>${trackArtworkHtml(track)}<span class="top-track-copy"><strong>${escapeHtml(track.recordingTitle)}</strong><small>${track.listenCount.toLocaleString()} plays · ${root.ListeningStats.formatDuration(track.durationMs)}</small></span></div>`).join('') : `<p class="listening-empty">No tracks in this period.</p>`}</div>
        </section>`;
      };
    }

    if (typeof bandListeningHtml === 'function') {
      bandListeningHtml = function correctedBandListeningHtml(band) {
        const allStats = globalListeningStats(profileListeningTimeframe);
        const bandListens = allStats.listens.filter((listen) => String(listen.localBandId) === String(band.id));
        const bandStats = {
          ...allStats,
          listens: bandListens,
          durationMs: root.ListeningStats.totalDurationMs(bandListens),
          listenCount: root.ListeningStats.listenCount(bandListens),
          lastListened: root.ListeningStats.lastListened(bandListens),
          topTracks: correctedTopTracks(bandListens, 10),
          buckets: root.ListeningStats.timeBuckets((listeningEvents || []).filter((listen) => String(listen.localBandId) === String(band.id)), allStats.window, allStats.window.bucket),
        };
        bandStats.mostActive = bandStats.buckets.length ? [...bandStats.buckets].sort((a, b) => b.durationMs - a.durationMs || a.startAt.localeCompare(b.startAt))[0] : null;
        const hasArtwork = bandStats.topTracks.some((track) => track.artworkPath);
        return `<div class="band-listening-panel">
          ${timeframeControlHtml(profileListeningTimeframe, `${band.name} listening timeframe`)}
          ${bandListens.length ? `${listeningSummaryHtml(bandStats, { bandId: band.id })}${lineChartHtml(bandStats)}${topTracksHtml(bandStats)}` : `<p class="screen-empty">No listening data is available for this period.</p>`}
          <p class="listening-attribution" data-track-attribution>${hasArtwork ? 'Track data and artwork from Spotify' : 'Track identity from Spotify history'}</p>
        </div>`;
      };
    }

    if (typeof myConcertRowHtml === 'function') {
      const original = myConcertRowHtml;
      myConcertRowHtml = function correctedMyConcertRowHtml(concert, isPast, options = {}) {
        let html = original(concert, isPast, options).replace('row-card-mc row-card clickable', 'row-card-mc row-card clickable concert-card-tinted');
        const row = listeningRowHtml(concert, isPast);
        if (row) html = injectBefore(html, '<div class="concert-prep-group', row);
        return html;
      };
    }

    if (typeof profileUpcomingRowHtml === 'function') {
      const original = profileUpcomingRowHtml;
      profileUpcomingRowHtml = function correctedProfileUpcomingRowHtml(concert) {
        let html = original(concert).replace('<div class="row-card">', '<div class="row-card concert-card-tinted" data-band-id="' + escapeAttr(concert.bandId) + '">');
        const row = listeningRowHtml(concert, false);
        if (row) html = injectBefore(html, '<div class="show-buttons">', row);
        return html;
      };
    }
  }

  async function loadArtworkCache() {
    if (cacheLoaded || !root.chrome?.storage?.local) return;
    const stored = await root.chrome.storage.local.get(CACHE_KEY);
    const values = stored?.[CACHE_KEY] || {};
    for (const [id, value] of Object.entries(values)) if (value?.imageUrl) artworkCache.set(id, value);
    cacheLoaded = true;
  }

  async function persistArtworkCache() {
    if (!root.chrome?.storage?.local) return;
    await root.chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(artworkCache) });
  }

  async function spotifyAccessToken() {
    if (!root.SpotifyUser?.getAuth) return null;
    let auth = await root.SpotifyUser.getAuth();
    if (!auth) return null;
    if (Date.parse(auth.expiresAt) <= Date.now() + 60000 && root.SpotifyUser.refresh) auth = await root.SpotifyUser.refresh(auth);
    return auth?.accessToken || null;
  }

  function applyArtworkToRow(row, imageUrl) {
    const holder = row.querySelector('.track-artwork');
    if (!holder || !imageUrl) return;
    let image = holder.querySelector('img');
    if (!image) {
      image = root.document.createElement('img');
      image.alt = '';
      image.dataset.listeningImage = '';
      holder.append(image);
    }
    image.src = imageUrl;
    holder.classList.remove('is-placeholder');
  }

  async function enrichVisibleArtwork() {
    if (enrichmentRunning || !root.document) return;
    await loadArtworkCache();
    const rows = [...root.document.querySelectorAll('.top-track-row[data-spotify-track-id]')];
    if (!rows.length) return;
    const missing = [];
    for (const row of rows) {
      const id = row.dataset.spotifyTrackId;
      const cached = artworkCache.get(id);
      if (cached?.imageUrl) applyArtworkToRow(row, cached.imageUrl);
      else if (!missing.includes(id)) missing.push(id);
    }
    if (!missing.length) {
      root.document.querySelectorAll('[data-track-attribution]').forEach((node) => { node.textContent = 'Track data and artwork from Spotify'; });
      return;
    }
    const token = await spotifyAccessToken().catch(() => null);
    if (!token) return;
    enrichmentRunning = true;
    try {
      for (let index = 0; index < missing.length; index += 50) {
        const ids = missing.slice(index, index + 50);
        const response = await root.fetch(`https://api.spotify.com/v1/tracks?ids=${encodeURIComponent(ids.join(','))}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) break;
        const payload = await response.json();
        for (const track of payload?.tracks || []) {
          const imageUrl = track?.album?.images?.[1]?.url || track?.album?.images?.[0]?.url || null;
          if (!track?.id || !imageUrl) continue;
          artworkCache.set(String(track.id), { imageUrl, albumName: track.album?.name || null, updatedAt: new Date().toISOString() });
        }
      }
      await persistArtworkCache();
      for (const row of rows) {
        const cached = artworkCache.get(row.dataset.spotifyTrackId);
        if (cached?.imageUrl) applyArtworkToRow(row, cached.imageUrl);
      }
      if (rows.some((row) => artworkCache.get(row.dataset.spotifyTrackId)?.imageUrl)) {
        root.document.querySelectorAll('[data-track-attribution]').forEach((node) => { node.textContent = 'Track data and artwork from Spotify'; });
      }
    } catch (_) {
      // Artwork enrichment is optional. Existing history and placeholders remain usable.
    } finally {
      enrichmentRunning = false;
    }
  }

  function applyDomCorrections() {
    if (!root.document) return;
    root.document.querySelectorAll('#screen-concerts .row-card[data-band-id], #screen-venue-detail .row-card[data-band-id]').forEach((card) => card.classList.add('concert-card-tinted'));
    const title = root.document.getElementById('header-title');
    const headerIcon = root.document.getElementById('header-icon');
    if (title && headerIcon && normalizeText(title.textContent).replace(/\s+/g, '') === 'concertdates' && typeof icon === 'function') headerIcon.innerHTML = icon('calendar');
    enrichVisibleArtwork();
  }

  function observeDom() {
    if (!root.document || !root.MutationObserver) return;
    let queued = false;
    const observer = new root.MutationObserver(() => {
      if (queued) return;
      queued = true;
      root.requestAnimationFrame(() => { queued = false; applyDomCorrections(); });
    });
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
  }

  async function bootstrap() {
    await loadArtworkCache().catch(() => {});
    applyFunctionOverrides();
    observeDom();
    applyDomCorrections();
    if (typeof currentScreen !== 'undefined') {
      if (currentScreen === 'main' && typeof currentTab !== 'undefined' && currentTab === 'myconcerts' && typeof renderMyConcertsScreen === 'function') renderMyConcertsScreen();
      else if (currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
      else if (currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
      else if (currentScreen === 'profile' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
    }
  }

  return {
    GENRE_GROUPS,
    normalizeText,
    safeResolveWindow,
    classifyGenre,
    classifyBand,
    correctedTopTracks,
    correctedGenreDistribution,
    concertListeningWindow,
    concertListeningAggregate,
    bootstrap,
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => window.LiveVaultV72.bootstrap(), { once: true });
}
