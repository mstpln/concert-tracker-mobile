'use strict';

// v81 UI layer: focused overrides of existing rendering helpers.
(() => {
  const COLORS = { Rock: '#024ddf', Pop: '#7a2fd0', 'Hip-hop/R&B': '#2bb8cf', Electronic: '#d2a62f', Other: '#85868a' };
  const PERIODS = [['twoWeeks', '2 weeks'], ['threeMonths', '3 months'], ['oneYear', '1 year'], ['allTime', 'All time']];
  const KNOWN_NOTE = 'Listening time is based on listens with known duration.';
  let detailList = 'tracks';
  let yearlyGenre = 'All';
  let yearlyOffset = 0;
  let yearlyYear = null;
  let genreYear = null;
  let refreshBusy = false;
  let reloadStarted = false;

  const countText = (value) => `${Number(value || 0).toLocaleString()} listen${Number(value || 0) === 1 ? '' : 's'}`;
  const durationText = (item) => item.durationMs > 0 ? ListeningStats.formatDuration(item.durationMs) : 'time unavailable';
  const note = (listens) => ListeningStats.hasUnknownDuration(listens) ? `<p class="listening-known-time-note">${KNOWN_NOTE}</p>` : '';
  const yearTitle = (year) => Number(year) === listeningNow().getUTCFullYear() ? `${year} · Year to date` : String(year);
  const yearWindow = (items, offset) => { const maxOffset = Math.max(0, items.length - 6); const safe = Math.max(0, Math.min(maxOffset, offset)); const end = items.length - safe; return { items: items.slice(Math.max(0, end - 6), end), offset: safe, maxOffset }; };

  timeframeControlHtml = function timeframeControlV81(selected, label = 'Listening timeframe') {
    return `<div class="listening-timeframe" role="group" aria-label="${escapeAttr(label)}">${PERIODS.map(([key, text]) => `<button type="button" class="listening-timeframe-btn${selected === key ? ' active' : ''}" data-listening-timeframe="${key}" aria-pressed="${selected === key}">${text}</button>`).join('')}</div>`;
  };

  topBandRowsHtml = function topBandRowsV81(items, { compact = false, timeframe = 'threeMonths', showMovement = true } = {}) {
    if (!items.length) return '<p class="listening-empty">No matched top bands are available for this period.</p>';
    return items.map((item) => `<button type="button" class="top-band-row${compact ? ' is-compact' : ''}" data-listening-band-id="${escapeAttr(item.bandId)}" data-listening-source-timeframe="${timeframe}"><span class="top-band-rank">#${item.rank}</span>${listeningBandAvatarHtml(item)}<span class="top-band-copy"><strong>${escapeHtml(item.bandName)}</strong><small>${durationText(item)} · ${countText(item.listenCount)}</small></span>${showMovement ? movementHtml(item.movement) : ''}</button>`).join('');
  };

  startTopBandsHtml = function startTopBandsV81() {
    const stats = globalListeningStats('twoWeeks');
    return `<section class="listening-card start-top-bands-card" aria-labelledby="start-top-bands-title"><div class="listening-card-heading"><p id="start-top-bands-title">YOUR TOP BANDS · 2 WEEKS</p><button type="button" id="start-top-bands-view-all" class="listening-link">View all</button></div><div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 3), { compact: true, timeframe: 'twoWeeks' })}</div>${note(stats.listens)}<button type="button" id="start-listening-stats" class="listening-card-footer">See your listening stats${icon('chevronRight')}</button></section>`;
  };

  function globalSummary(stats) {
    const dominant = ListeningStats.dominantGenre(ListeningStats.genreDistributionByYear(stats.listens));
    return `<section class="listening-card listening-summary listening-summary-global" aria-label="Listening summary for ${escapeAttr(stats.label)}"><p class="listening-section-title">YOUR LISTENING · ${escapeHtml(stats.label.toUpperCase())}</p><div class="listening-summary-grid">${summaryMetricHtml('headphones', ListeningStats.formatDuration(stats.durationMs), 'listened')}${summaryMetricHtml('music', stats.listenCount.toLocaleString(), 'listens')}${summaryMetricHtml('trendUp', dominant ? '#1' : '—', dominant ? `${dominant.group} genre` : 'top genre rank')}</div>${note(stats.listens)}</section>`;
  }
  listeningSummaryHtml = function listeningSummaryV81(stats, { bandId = null } = {}) { return bandId ? bandSummary(stats, bandId) : globalSummary(stats); };

  function dateValue(listen) {
    if (!listen) return '<span class="listening-date-value">—</span>';
    const date = new Date(listen.listenedAt || listen.listenedAtMs);
    if (!Number.isFinite(date.getTime())) return '<span class="listening-date-value">—</span>';
    const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    return `<span class="listening-date-value"><span>${escapeHtml(monthDay)}</span><span class="listening-date-year">${date.getUTCFullYear()}</span></span>`;
  }
  function bandSummary(stats, bandId) {
    const allBand = listeningEvents.filter((listen) => listen.localBandId === bandId && ListeningStats.isValidListen(listen));
    const ranked = stats.topBands.find((item) => item.bandId === bandId);
    let rank = ranked ? `#${ranked.rank}` : '—';
    if (ranked?.movement?.kind === 'up') rank += ` ↑${ranked.movement.delta}`;
    if (ranked?.movement?.kind === 'down') rank += ` ↓${ranked.movement.delta}`;
    if (ranked?.movement?.kind === 'new') rank += ' NEW';
    return `<section class="listening-card listening-summary listening-summary-band" aria-label="Listening summary for ${escapeAttr(stats.label)}"><p class="listening-section-title">YOUR LISTENING · ${escapeHtml(stats.label.toUpperCase())}</p><div class="listening-summary-grid">${summaryMetricHtml('clock', ListeningStats.formatDuration(stats.durationMs), 'listening time')}${summaryMetricHtml('headphones', stats.listenCount.toLocaleString(), 'listens')}${summaryMetricHtml('trendUp', rank, ranked ? `of ${stats.distinctMatchedBands} bands` : 'not ranked')}${summaryMetricHtml('calendarPlain', dateValue(ListeningStats.firstListened(allBand)), 'first listened', 'listening-date-metric')}${summaryMetricHtml('calendarCheck', dateValue(ListeningStats.lastListened(allBand)), 'last listened', 'listening-date-metric')}</div>${note(stats.listens)}</section>`;
  }

  function lineDetails(item) {
    if (!item) return '';
    return `<div class="year-detail" aria-live="polite"><strong>${yearTitle(item.year)}</strong><span>${ListeningStats.formatDuration(item.durationMs)}</span><span>${countText(item.listenCount)}</span>${item.unknownDurationCount ? `<small>${KNOWN_NOTE}</small>` : ''}</div>`;
  }
  function yearlyChart() {
    const all = ListeningStats.yearlyListening(listeningEvents, listeningNow(), yearlyGenre);
    if (!all.length) return '<section class="listening-card"><p class="listening-section-title">LISTENING HOURS BY YEAR</p><p class="listening-empty">No yearly listening data is available.</p></section>';
    const window = yearWindow(all, yearlyOffset); yearlyOffset = window.offset;
    const values = window.items; const maxHours = Math.max(1, ...values.map((item) => item.hours));
    const width = 600, height = 210, left = 38, right = 12, top = 18, bottom = 38;
    const x = (index) => left + (values.length === 1 ? (width - left - right) / 2 : index * ((width - left - right) / (values.length - 1)));
    const y = (hours) => top + (maxHours - hours) * ((height - top - bottom) / maxHours);
    const color = yearlyGenre === 'All' ? 'currentColor' : COLORS[yearlyGenre];
    const selected = all.find((item) => item.year === yearlyYear) || null;
    return `<section class="listening-card yearly-listening-card" aria-labelledby="yearly-title"><div class="listening-card-heading"><p id="yearly-title">LISTENING HOURS BY YEAR</p>${all.length > 6 ? `<div class="genre-range-controls"><button type="button" data-v81-year-range="older" aria-label="Show older listening years" ${yearlyOffset >= window.maxOffset ? 'disabled' : ''}>${icon('back')}</button><button type="button" data-v81-year-range="newer" aria-label="Show newer listening years" ${yearlyOffset === 0 ? 'disabled' : ''}>${icon('chevronRight')}</button></div>` : ''}</div><div class="year-genre-pills" role="group" aria-label="Yearly chart genre">${['All', ...ListeningStats.GENRE_GROUPS].map((genre) => `<button type="button" data-v81-year-genre="${escapeAttr(genre)}" class="year-genre-pill${yearlyGenre === genre ? ' active' : ''}" aria-pressed="${yearlyGenre === genre}" style="--genre-color:${genre === 'All' ? 'currentColor' : COLORS[genre]}">${escapeHtml(genre)}</button>`).join('')}</div><svg class="listening-line-chart yearly-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Yearly listening hours for ${escapeAttr(yearlyGenre)}" preserveAspectRatio="none"><polyline points="${values.map((item, index) => `${x(index)},${y(item.hours)}`).join(' ')}" class="chart-line" style="stroke:${color}"/>${values.map((item, index) => `<g class="year-point${yearlyYear === item.year ? ' selected' : ''}" data-v81-year-point="${item.year}" role="button" tabindex="0" aria-label="${escapeAttr(`${yearTitle(item.year)}: ${ListeningStats.formatDuration(item.durationMs)}, ${countText(item.listenCount)}`)}"><circle cx="${x(index)}" cy="${y(item.hours)}" r="${yearlyYear === item.year ? 6 : 4}" style="stroke:${color};fill:${color}"/><text x="${x(index)}" y="${height - 12}" text-anchor="middle">${item.isCurrentYear ? `${item.year} · YTD` : item.year}</text></g>`).join('')}</svg>${lineDetails(selected)}</section>`;
  }

  function genreDetails(item) {
    if (!item) return '';
    return `<div class="genre-year-detail" aria-live="polite"><strong>${yearTitle(item.year)}</strong><div><b>Total</b><span>${ListeningStats.formatDuration(item.totalDurationMs)} · ${countText(item.totalListenCount)}</span></div>${ListeningStats.GENRE_GROUPS.map((group) => `<div><b>${escapeHtml(group)}</b><span>${ListeningStats.formatDuration(item.durations[group])} · ${countText(item.listenCounts[group])}</span></div>`).join('')}${item.unknownDurationCount ? `<small>${KNOWN_NOTE}</small>` : ''}</div>`;
  }
  genreChartHtml = function genreChartV81() {
    const all = ListeningStats.genreDistributionByYear(listeningEvents);
    if (!all.length) return '<section class="listening-card"><p class="listening-section-title">LISTENING BY GENRE (ALL TIME)</p><p class="listening-empty">No genre data is available.</p></section>';
    const window = yearWindow(all, genreYearOffset); genreYearOffset = window.offset; const selected = all.find((item) => item.year === genreYear) || null;
    const dominant = ListeningStats.dominantGenre(all);
    return `<section class="listening-card genre-card" aria-labelledby="genre-chart-title"><div class="listening-card-heading"><p id="genre-chart-title">LISTENING BY GENRE (ALL TIME)</p>${all.length > 6 ? `<div class="genre-range-controls"><button type="button" data-v81-genre-range="older" aria-label="Show older genre years" ${genreYearOffset >= window.maxOffset ? 'disabled' : ''}>${icon('back')}</button><button type="button" data-v81-genre-range="newer" aria-label="Show newer genre years" ${genreYearOffset === 0 ? 'disabled' : ''}>${icon('chevronRight')}</button></div>` : ''}</div><div class="genre-chart" role="group" aria-label="All-time genre distribution"><div class="genre-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="genre-bars">${window.items.map((item) => `<button type="button" class="genre-year${genreYear === item.year ? ' selected' : ''}" data-v81-genre-year="${item.year}" aria-label="${escapeAttr(`${yearTitle(item.year)}: ${ListeningStats.formatDuration(item.totalDurationMs)}, ${countText(item.totalListenCount)}`)}"><span class="genre-stack">${ListeningStats.GENRE_GROUPS.map((group) => `<span style="height:${item.percentages[group]}%;background:${COLORS[group]}"></span>`).join('')}</span><span>${item.year}</span></button>`).join('')}</div></div><div class="genre-legend">${ListeningStats.GENRE_GROUPS.map((group) => `<span><i style="background:${COLORS[group]}"></i>${escapeHtml(group)}</span>`).join('')}</div>${genreDetails(selected)}${dominant ? `<p class="listening-card-note">Most listened genre: <strong>${escapeHtml(dominant.group)}</strong> · ${dominant.percentage}%</p>` : ''}</section>`;
  };

  statsListeningHtml = function statsListeningV81() {
    const stats = globalListeningStats('threeMonths');
    if (!listeningEvents.length) return '<p class="screen-empty">Listening statistics will appear when ListenBrainz data is available.</p>';
    return `${globalSummary(stats)}${yearlyChart()}${genreChartHtml()}${topBandsPreviewHtml(stats)}`;
  };

  function placeholder() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>'; }
  function artwork(item, album) { if (!item.artworkPath) return `<span class="track-artwork is-placeholder">${placeholder()}</span>`; return `<span class="track-artwork"><span>${album ? placeholder() : icon('music')}</span><img src="${escapeAttr(item.artworkPath)}" alt="" data-listening-image /></span>`; }
  function rankedCard(stats) {
    const albums = detailList === 'albums'; const items = albums ? stats.topAlbums : stats.topTracks;
    const rows = items.length ? items.slice(0, 10).map((item) => `<div class="top-track-row"><span class="top-track-rank">#${item.rank}</span>${artwork(item, albums)}<span class="top-track-copy"><strong>${escapeHtml(albums ? item.releaseTitle : item.recordingTitle)}</strong><small>${countText(item.listenCount)} · ${durationText(item)}</small></span></div>`).join('') : `<p class="listening-empty">${albums ? 'No album data available for this period.' : 'No tracks in this period.'}</p>`;
    return `<section class="listening-card top-tracks-card"><div class="ranked-list-tabs" role="tablist" aria-label="Band listening rankings"><button type="button" role="tab" data-v81-ranked="tracks" aria-selected="${!albums}" class="ranked-list-tab${!albums ? ' active' : ''}">Top Tracks</button><button type="button" role="tab" data-v81-ranked="albums" aria-selected="${albums}" class="ranked-list-tab${albums ? ' active' : ''}">Top Albums</button></div><p class="listening-section-title">${albums ? 'TOP ALBUMS' : 'TOP TRACKS'} · ${escapeHtml(stats.label.toUpperCase())}</p><div class="top-tracks-list">${rows}</div>${note(stats.listens)}</section>`;
  }
  bandListeningHtml = function bandListeningV81(band) {
    const global = globalListeningStats(profileListeningTimeframe);
    const listens = global.listens.filter((listen) => listen.localBandId === band.id);
    const scoped = { ...global, listens, durationMs: ListeningStats.totalDurationMs(listens), listenCount: ListeningStats.listenCount(listens), topTracks: ListeningStats.topTracks(listens, 10), topAlbums: ListeningStats.topAlbums(listens, 10), buckets: ListeningStats.timeBuckets(listeningEvents.filter((listen) => listen.localBandId === band.id), global.window, global.window.bucket) };
    scoped.mostActive = scoped.buckets.length ? [...scoped.buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount)[0] : null;
    return `<div class="band-listening-panel">${timeframeControlHtml(profileListeningTimeframe, `${band.name} listening timeframe`)}${listens.length ? `${bandSummary(scoped, band.id)}${lineChartHtml(scoped)}${rankedCard(scoped)}` : '<p class="screen-empty">No listening data is available for this period.</p>'}<p class="listening-attribution">Listening data from ${LISTENING_ATTRIBUTION.listening} · Metadata from ${LISTENING_ATTRIBUTION.metadata} · Artwork from ${LISTENING_ATTRIBUTION.artwork}</p></div>`;
  };

  const originalStatsRender = renderStatsScreen;
  renderStatsScreen = function renderStatsV81() { originalStatsRender(); const container = el('screen-stats'); container.querySelectorAll('[data-genre-range]').forEach((button) => button.replaceWith(button.cloneNode(true))); };
  openTopBandsScreen = function openTopBandsV81({ fromHistory = false } = {}) { topBandsTimeframe = 'threeMonths'; currentScreen = 'top-bands'; setHeaderChrome({ showBack: true, title: 'Top bands' }); el('europe-toggle-btn').classList.add('hidden'); el('nearby-toggle-btn').classList.add('hidden'); setActiveBottomTab('stats'); showScreen('screen-top-bands'); renderTopBandsScreen(); if (!fromHistory) history.pushState({ tab: currentTab, screen: 'top-bands', timeframe: topBandsTimeframe }, ''); };
  renderTopBandsScreen = function renderTopBandsV81() { const container = el('screen-top-bands'); const stats = globalListeningStats(topBandsTimeframe); container.innerHTML = `${timeframeControlHtml(topBandsTimeframe, 'Top bands timeframe')}<section class="listening-card full-top-bands-card"><div class="top-bands-list">${topBandRowsHtml(stats.topBands, { timeframe: topBandsTimeframe })}</div>${note(stats.listens)}</section>`; wireListeningTimeframe(container, (timeframe) => { topBandsTimeframe = timeframe; renderTopBandsScreen(); }); wireListeningBandRows(container); wireListeningImages(container); };

  const originalOpenProfile = openProfile;
  openProfile = function openProfileV81(bandId, options = {}) { if ((options.selectedTab || 'concerts') === 'listening') { profileListeningTimeframe = 'oneYear'; detailList = 'tracks'; } return originalOpenProfile(bandId, options); };
  const originalProfileTab = activateProfileTab;
  activateProfileTab = function activateProfileV81(bandId, tab, options = {}) { if (tab === 'listening' && profileTab !== 'listening') { profileListeningTimeframe = 'oneYear'; detailList = 'tracks'; } return originalProfileTab(bandId, tab, options); };
  function resetStats() { statsListeningTimeframe = 'threeMonths'; yearlyGenre = 'All'; yearlyOffset = 0; yearlyYear = null; genreYearOffset = 0; genreYear = null; }
  const originalOpenStats = openStatsScreen;
  openStatsScreen = function openStatsV81(options = {}) { if ((options.subTab || 'listening') === 'listening') resetStats(); return originalOpenStats(options); };

  function refreshSvg() { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/></svg>'; }
  function headerCluster() {
    const old = el('start-version-refresh'); const visible = currentScreen === 'main' && currentTab === 'myconcerts';
    if (!visible) { old?.remove(); return; } if (old) return;
    const cluster = document.createElement('div'); cluster.id = 'start-version-refresh'; cluster.className = 'start-version-refresh'; cluster.innerHTML = `<span class="start-app-version">${escapeHtml(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '')}</span><span class="start-header-divider"></span><button type="button" class="icon-btn start-refresh-btn" aria-label="Check for app update and reload" title="Check for app update and reload">${refreshSvg()}</button>`; el('app-header').insertBefore(cluster, el('settings-btn'));
  }
  const originalHeader = setHeaderChrome; setHeaderChrome = function headerV81(options) { const result = originalHeader(options); headerCluster(); return result; };
  const originalGoToTab = goToTab; goToTab = function goToTabV81(tab, options = {}) { if (tab === 'stats') resetStats(); const result = originalGoToTab(tab, options); headerCluster(); return result; };
  const reload = () => { if (!reloadStarted) { reloadStarted = true; location.reload(); } };
  async function refresh(button) { if (refreshBusy) return; refreshBusy = true; button.disabled = true; button.classList.add('is-loading'); try { if ('serviceWorker' in navigator) { navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true }); const registration = await navigator.serviceWorker.getRegistration(); if (registration) { try { await registration.update(); } catch (_) {} if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' }); } setTimeout(reload, 2200); } else setTimeout(reload, 120); } catch (_) { setTimeout(reload, 120); } setTimeout(() => { refreshBusy = false; if (button.isConnected) { button.disabled = false; button.classList.remove('is-loading'); } }, 5000); }

  document.addEventListener('click', (event) => {
    const ranked = event.target.closest('[data-v81-ranked]'); if (ranked) { detailList = ranked.dataset.v81Ranked === 'albums' ? 'albums' : 'tracks'; renderProfileScreen(activeProfileBandId); return; }
    const pill = event.target.closest('[data-v81-year-genre]'); if (pill) { yearlyGenre = pill.dataset.v81YearGenre; yearlyYear = null; renderStatsScreen(); return; }
    const yearRange = event.target.closest('[data-v81-year-range]'); if (yearRange) { yearlyOffset += yearRange.dataset.v81YearRange === 'older' ? 1 : -1; yearlyYear = null; renderStatsScreen(); return; }
    const point = event.target.closest('[data-v81-year-point]'); if (point) { yearlyYear = Number(point.dataset.v81YearPoint); renderStatsScreen(); return; }
    const genreRange = event.target.closest('[data-v81-genre-range]'); if (genreRange) { genreYearOffset += genreRange.dataset.v81GenreRange === 'older' ? 1 : -1; genreYear = null; renderStatsScreen(); return; }
    const column = event.target.closest('[data-v81-genre-year]'); if (column) { genreYear = Number(column.dataset.v81GenreYear); renderStatsScreen(); return; }
    const button = event.target.closest('.start-refresh-btn'); if (button) refresh(button);
  });
  document.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-v81-year-point]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  document.addEventListener('DOMContentLoaded', headerCluster);
})();
