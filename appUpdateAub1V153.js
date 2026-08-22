'use strict';

// AUB1 / v153: approved UI, discovery and listening-stat usability updates.
// This layer is intentionally additive and presentation-oriented. It preserves
// stored concert/band identities, provider ownership, ticket ownership and all
// unrelated navigation/data behavior.
(function attachAppUpdateAub1V153(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppUpdateAub1V153 = api;
  if (root?.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const EQUALIZER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5"></path></svg>';
  const STATS_SVG_FALLBACK = '<svg class="aub1-stats-glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>';
  const STATS_SVG = (() => {
    try {
      if (typeof icon === 'function') return icon('statsBars') || STATS_SVG_FALLBACK;
    } catch (_) {}
    return STATS_SVG_FALLBACK;
  })();
  const DAY_MS = 86400000;
  let myBandsQuery = '';
  let installing = false;
  let headerObserver = null;
  let statsObserver = null;

  function getBands() {
    try { if (typeof bands !== 'undefined') return bands; } catch (_) {}
    return root.bands || [];
  }

  function getConcerts() {
    try { if (typeof concerts !== 'undefined') return concerts; } catch (_) {}
    return root.concerts || [];
  }

  function getListeningEvents() {
    try { if (typeof listeningEvents !== 'undefined') return listeningEvents; } catch (_) {}
    return root.listeningEvents || [];
  }

  function getListeningStats() {
    try { if (typeof ListeningStats !== 'undefined') return ListeningStats; } catch (_) {}
    return root.ListeningStats || null;
  }

  function currentListeningNow() {
    try { if (typeof listeningNow === 'function') return listeningNow(); } catch (_) {}
    return new Date();
  }

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  }

  function utcDateKey(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function activityMetrics(listens, statsApi = getListeningStats()) {
    if (!statsApi) return { activeDays: 0, durationMs: 0, dailyAverageMs: 0 };
    const days = new Set();
    let durationMs = 0;
    for (const listen of listens || []) {
      if (!statsApi.isValidListen?.(listen)) continue;
      const timestamp = Number(statsApi.listenTimeMs?.(listen));
      if (!Number.isFinite(timestamp)) continue;
      const key = utcDateKey(timestamp);
      if (!key) continue;
      days.add(key);
      const duration = Number(statsApi.validDurationMs?.(listen));
      if (Number.isFinite(duration) && duration > 0) durationMs += duration;
    }
    return {
      activeDays: days.size,
      durationMs,
      dailyAverageMs: days.size ? durationMs / days.size : 0,
    };
  }

  function completedYearActivity(listens, now = currentListeningNow(), statsApi = getListeningStats()) {
    if (!statsApi) return { completedYears: [], activeDaysPerYear: 0, allTime: activityMetrics([], statsApi) };
    const currentYear = new Date(now).getUTCFullYear();
    const byYear = new Map();
    for (const listen of listens || []) {
      if (!statsApi.isValidListen?.(listen)) continue;
      const timestamp = Number(statsApi.listenTimeMs?.(listen));
      if (!Number.isFinite(timestamp)) continue;
      const year = new Date(timestamp).getUTCFullYear();
      if (!Number.isFinite(year) || year >= currentYear) continue;
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(listen);
    }
    const completedYears = [...byYear.entries()].sort(([a], [b]) => a - b).map(([year, yearListens]) => ({
      year,
      ...activityMetrics(yearListens, statsApi),
    }));
    return {
      completedYears,
      activeDaysPerYear: completedYears.length
        ? completedYears.reduce((sum, item) => sum + item.activeDays, 0) / completedYears.length
        : 0,
      allTime: activityMetrics(listens, statsApi),
    };
  }

  function exactSweden(concert) {
    return normalize(concert?.country) === 'sweden';
  }

  function isEurope(concert) {
    try { if (typeof dlIsEuropeCountry === 'function') return dlIsEuropeCountry(concert?.country); } catch (_) {}
    return false;
  }

  function isNearby(concert) {
    try { if (typeof dlIsNearby === 'function') return dlIsNearby(concert); } catch (_) {}
    return false;
  }

  function alertMembers(item) {
    if (!item) return [];
    if (!item.isBatch) return [item];
    return getConcerts().filter((concert) => String(concert.bandId) === String(item.bandId) && String(concert.foundAt || '') === String(item.foundAt || ''));
  }

  function relevanceTag(item) {
    const members = alertMembers(item);
    if (members.some(isNearby)) return 'Nearby';
    if (members.some(exactSweden)) return 'SE';
    if (members.some(isEurope)) return 'EU';
    return '';
  }

  function applyHeaderIcons(doc = root.document) {
    if (!doc) return false;
    const musicTab = doc.querySelector('#tabbar [data-tab="myconcerts"] .tab-icon');
    if (musicTab && musicTab.innerHTML !== EQUALIZER_SVG) musicTab.innerHTML = EQUALIZER_SVG;
    const statsTab = doc.querySelector('#tabbar [data-tab="stats"] .tab-icon');
    if (statsTab && !statsTab.querySelector('.aub1-stats-glyph')) statsTab.innerHTML = STATS_SVG;

    const title = normalize(doc.querySelector('#header-title')?.textContent).replace(/\s+/g, '');
    const headerIcon = doc.querySelector('#header-icon');
    if (!headerIcon) return true;
    if (title === 'mymusic') {
      if (!headerIcon.querySelector('svg path[d="M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5"]')) headerIcon.innerHTML = EQUALIZER_SVG;
    } else if (title.includes('stats')) {
      if (!headerIcon.querySelector('.aub1-stats-glyph')) headerIcon.innerHTML = STATS_SVG;
    }
    return true;
  }

  function installHeaderObserver() {
    if (headerObserver || !root.document || typeof root.MutationObserver !== 'function') return;
    const header = root.document.querySelector('#app-header');
    const tabbar = root.document.querySelector('#tabbar');
    headerObserver = new root.MutationObserver(() => applyHeaderIcons());
    if (header) headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
    if (tabbar) headerObserver.observe(tabbar, { childList: true, subtree: true });
    applyHeaderIcons();
  }

  function decorateNextConcert(doc = root.document) {
    const ticket = doc?.querySelector('#screen-myconcerts #countdown-card:not(.countdown-card-today)');
    if (!ticket) return false;
    ticket.classList.add('aub1-next-concert');
    ticket.querySelector('.countdown-v139-label')?.remove();
    return true;
  }

  function decorateGenreWording(doc = root.document) {
    const card = doc?.querySelector('#screen-stats .genre-card');
    if (!card) return false;
    const note = [...card.querySelectorAll('.listening-card-note')].find((node) => /most listened genre:/i.test(node.textContent || ''));
    if (!note || /all time:/i.test(note.textContent || '')) return !!note;
    for (const node of note.childNodes) {
      if (node.nodeType === 3 && /most listened genre:/i.test(node.textContent || '')) {
        node.textContent = node.textContent.replace(/Most listened genre:/i, 'Most listened genre all time:');
        break;
      }
    }
    return true;
  }

  function selectedYearListens(year, genre) {
    const statsApi = getListeningStats();
    const bandIds = new Set(getBands().filter((band) => band?.id != null).map((band) => String(band.id)));
    return getListeningEvents().filter((listen) => {
      if (!statsApi?.isValidListen?.(listen)) return false;
      if (listen?.localBandId == null || !bandIds.has(String(listen.localBandId))) return false;
      const timestamp = Number(statsApi.listenTimeMs?.(listen));
      if (!Number.isFinite(timestamp) || new Date(timestamp).getUTCFullYear() !== Number(year)) return false;
      return !genre || genre === 'All' || statsApi.genreGroup?.(listen.genre) === genre;
    });
  }

  function metricRow(doc, label, value, className) {
    const row = doc.createElement('span');
    row.className = className;
    const strong = doc.createElement('strong');
    strong.textContent = value;
    const small = doc.createElement('span');
    small.textContent = label;
    row.append(strong, small);
    return row;
  }

  function decorateSelectedYearActivity(doc = root.document) {
    const detail = doc?.querySelector('#screen-stats .yearly-listening-card .year-detail');
    if (!detail || detail.dataset.aub1Activity === 'true') return !!detail;
    const selected = doc.querySelector('#screen-stats .yearly-listening-card [data-v81-year-point].selected');
    const year = Number(selected?.dataset.v81YearPoint);
    if (!Number.isFinite(year)) return false;
    const genre = doc.querySelector('#screen-stats .yearly-listening-card [data-v81-year-genre].active')?.dataset.v81YearGenre || 'All';
    const metrics = activityMetrics(selectedYearListens(year, genre));
    const statsApi = getListeningStats();
    const active = doc.createElement('span');
    active.className = 'aub1-year-activity';
    active.textContent = `Days active: ${metrics.activeDays.toLocaleString()}`;
    const average = doc.createElement('span');
    average.className = 'aub1-year-activity';
    average.textContent = `Daily average: ${statsApi?.formatDuration?.(metrics.dailyAverageMs) || '0 min'}`;
    detail.append(active, average);
    detail.dataset.aub1Activity = 'true';
    return true;
  }

  function decorateAllTimeActivity(doc = root.document) {
    const card = doc?.querySelector('#screen-stats .yearly-listening-card');
    if (!card || card.querySelector('.aub1-alltime-activity')) return !!card;
    const statsApi = getListeningStats();
    const result = completedYearActivity(getListeningEvents(), currentListeningNow(), statsApi);
    const summary = doc.createElement('div');
    summary.className = 'aub1-alltime-activity';
    const heading = doc.createElement('p');
    heading.className = 'aub1-activity-heading';
    heading.textContent = 'ALL-TIME ACTIVITY';
    const grid = doc.createElement('div');
    grid.className = 'aub1-activity-grid';
    const annual = result.completedYears.length ? Math.round(result.activeDaysPerYear).toLocaleString() : '—';
    grid.append(
      metricRow(doc, 'active days per year', annual, 'aub1-activity-metric'),
      metricRow(doc, 'daily average', statsApi?.formatDuration?.(result.allTime.dailyAverageMs) || '0 min', 'aub1-activity-metric'),
    );
    summary.append(heading, grid);
    card.appendChild(summary);
    return true;
  }

  function svgNode(doc, name, attrs = {}) {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function renderYearlyOverview(card, doc = root.document) {
    const statsApi = getListeningStats();
    const svg = card?.querySelector('svg.yearly-line-chart');
    if (!statsApi || !svg) return false;
    const genre = card.querySelector('[data-v81-year-genre].active')?.dataset.v81YearGenre || 'All';
    const values = statsApi.yearlyListening(getListeningEvents(), currentListeningNow(), genre);
    if (!values.length) return false;
    const width = 600, height = 210, left = 66, right = 12, top = 18, bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const nice = root.ListeningV83ChartFix?.niceAxis?.(Math.max(...values.map((item) => item.hours || 0))) || { max: Math.max(1, ...values.map((item) => item.hours || 0)), ticks: [0] };
    const x = (index) => left + (values.length === 1 ? plotWidth / 2 : index * (plotWidth / (values.length - 1)));
    const y = (hours) => top + (nice.max - Math.max(0, Number(hours) || 0)) * (plotHeight / nice.max);
    const labelStep = Math.max(1, Math.ceil(values.length / 6));
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.dataset.aub1Overview = 'true';
    const line = svgNode(doc, 'polyline', { class: 'chart-line', points: values.map((item, index) => `${x(index)},${y(item.hours)}`).join(' ') });
    svg.appendChild(line);
    values.forEach((item, index) => {
      const group = svgNode(doc, 'g', { 'data-v81-year-point': item.year, role: 'button', tabindex: '0', 'aria-label': `${item.year}: ${statsApi.formatDuration(item.durationMs)}` });
      group.appendChild(svgNode(doc, 'circle', { cx: x(index), cy: y(item.hours), r: 4 }));
      const finalIndex = values.length - 1;
      const isFinalLabel = index === finalIndex;
      const isRegularLabel = index % labelStep === 0 && finalIndex - index >= labelStep;
      if (isRegularLabel || isFinalLabel) {
        const text = svgNode(doc, 'text', {
          x: x(index),
          y: height - 12,
          'text-anchor': isFinalLabel ? 'end' : 'middle',
        });
        text.textContent = item.isCurrentYear ? `${item.year} · YTD` : String(item.year);
        group.appendChild(text);
      }
      svg.appendChild(group);
    });
    card.querySelector('.genre-range-controls')?.classList.add('aub1-hidden-focused-controls');
    return true;
  }

  function renderGenreOverview(card, doc = root.document) {
    const statsApi = getListeningStats();
    const bars = card?.querySelector('.genre-bars');
    if (!statsApi || !bars) return false;
    const values = statsApi.genreDistributionByYear(getListeningEvents());
    if (!values.length) return false;
    const colors = { Rock: '#024ddf', Pop: '#7a2fd0', 'Hip-hop/R&B': '#2bb8cf', Electronic: '#d2a62f', Other: '#85868a' };
    const labelStep = Math.max(1, Math.ceil(values.length / 6));
    bars.replaceChildren();
    values.forEach((item, index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'genre-year aub1-genre-overview-year';
      button.dataset.v81GenreYear = String(item.year);
      button.setAttribute('aria-label', `${item.year}: ${statsApi.formatDuration(item.totalDurationMs)}`);
      const stack = doc.createElement('span');
      stack.className = 'genre-stack';
      for (const group of statsApi.GENRE_GROUPS || []) {
        const segment = doc.createElement('span');
        segment.style.height = `${item.percentages?.[group] || 0}%`;
        segment.style.background = colors[group] || '#85868a';
        stack.appendChild(segment);
      }
      const label = doc.createElement('span');
      label.className = 'aub1-overview-year-label';
      label.textContent = (index % labelStep === 0 || index === values.length - 1) ? String(item.year) : '';
      button.append(stack, label);
      bars.appendChild(button);
    });
    card.dataset.aub1Overview = 'true';
    card.querySelector('.genre-range-controls')?.classList.add('aub1-hidden-focused-controls');
    return true;
  }

  function addOverviewControl(card, kind, doc = root.document) {
    const heading = card?.querySelector('.listening-card-heading');
    if (!heading || heading.querySelector(`[data-aub1-overview="${kind}"]`)) return false;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'aub1-overview-control';
    button.dataset.aub1Overview = kind;
    button.textContent = 'Overview';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const active = button.getAttribute('aria-pressed') === 'true';
      if (active) {
        try { if (typeof renderStatsScreen === 'function') renderStatsScreen(); else root.renderStatsScreen?.(); } catch (_) {}
        return;
      }
      const changed = kind === 'yearly' ? renderYearlyOverview(card, doc) : renderGenreOverview(card, doc);
      if (changed) {
        button.textContent = 'Focused';
        button.setAttribute('aria-pressed', 'true');
      }
    });
    const controls = heading.querySelector('.genre-range-controls');
    if (controls) controls.before(button); else heading.appendChild(button);
    return true;
  }

  function decorateStats(doc = root.document) {
    if (!doc) return false;
    decorateGenreWording(doc);
    const yearly = doc.querySelector('#screen-stats .yearly-listening-card');
    const genre = doc.querySelector('#screen-stats .genre-card');
    addOverviewControl(yearly, 'yearly', doc);
    addOverviewControl(genre, 'genre', doc);
    decorateSelectedYearActivity(doc);
    decorateAllTimeActivity(doc);
    applyHeaderIcons(doc);
    return !!(yearly || genre);
  }

  function decorateAlerts(doc = root.document) {
    if (!doc) return false;
    const screen = doc.querySelector('#screen-news');
    if (!screen || !/alerts/i.test(doc.querySelector('#header-title')?.textContent || '')) return false;
    let items = [];
    try { if (typeof getAlertItems === 'function') items = getAlertItems().filter((item) => !item.isReleaseAlert); } catch (_) {}
    const cards = [...screen.querySelectorAll('.row-card.clickable:not(.release-alert-card)')];
    cards.forEach((card, index) => {
      card.querySelector('.aub1-location-tag')?.remove();
      const item = items[index];
      const tag = relevanceTag(item);
      card.classList.toggle('has-aub1-location-tag', !!tag);
      if (!tag) return;
      const badge = doc.createElement('span');
      badge.className = 'aub1-location-tag';
      badge.textContent = tag;
      badge.setAttribute('aria-label', `Concert location: ${tag}`);
      const favorite = card.querySelector('.alert-favorite-badge');
      if (favorite) favorite.after(badge); else card.prepend(badge);
    });
    return true;
  }

  function bandNameForRow(row) {
    const id = String(row?.dataset?.bandId || '');
    const band = getBands().find((item) => String(item?.id) === id);
    return String(band?.name || row?.querySelector('.row-title, .row-top strong, strong')?.textContent || '').trim();
  }

  function applyMyBandsSearch(doc = root.document) {
    const screen = doc?.querySelector('#screen-mybands');
    if (!screen) return false;
    const query = normalize(myBandsQuery);
    let visible = 0;
    screen.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
      const match = !query || normalize(bandNameForRow(row)).includes(query);
      row.classList.toggle('aub1-search-hidden', !match);
      if (match) visible += 1;
    });
    let empty = screen.querySelector('.aub1-no-bands-found');
    if (!empty) {
      empty = doc.createElement('p');
      empty.className = 'listening-empty aub1-no-bands-found';
      empty.textContent = 'No bands found';
      const addCard = screen.querySelector('.add-band-card');
      if (addCard) addCard.before(empty); else screen.appendChild(empty);
    }
    empty.hidden = visible > 0 || !query;
    const clear = screen.querySelector('.aub1-band-search-clear');
    if (clear) clear.hidden = !myBandsQuery;
    return true;
  }

  function decorateMyBands(doc = root.document) {
    const screen = doc?.querySelector('#screen-mybands');
    if (!screen) return false;
    let shell = screen.querySelector('.aub1-band-search');
    if (!shell) {
      const total = screen.querySelector('.bands-total-header');
      if (!total) return false;
      shell = doc.createElement('div');
      shell.className = 'aub1-band-search';
      const input = doc.createElement('input');
      input.type = 'search';
      input.placeholder = 'Search bands';
      input.setAttribute('aria-label', 'Search bands');
      input.autocomplete = 'off';
      input.value = myBandsQuery;
      input.addEventListener('input', () => {
        myBandsQuery = input.value;
        applyMyBandsSearch(doc);
      });
      const clear = doc.createElement('button');
      clear.type = 'button';
      clear.className = 'aub1-band-search-clear';
      clear.setAttribute('aria-label', 'Clear band search');
      clear.textContent = '×';
      clear.hidden = !myBandsQuery;
      clear.addEventListener('click', () => {
        myBandsQuery = '';
        input.value = '';
        input.focus();
        applyMyBandsSearch(doc);
      });
      shell.append(input, clear);
      total.after(shell);
    } else {
      const input = shell.querySelector('input');
      if (input && input.value !== myBandsQuery) input.value = myBandsQuery;
    }
    applyMyBandsSearch(doc);
    return true;
  }

  function wrapGlobal(name, after) {
    let current = null;
    try { current = root[name] || eval(name); } catch (_) {}
    if (typeof current !== 'function' || current.__aub1V153) return false;
    const wrapped = function aub1Wrapped(...args) {
      const result = current.apply(this, args);
      try { after(...args); } catch (_) {}
      return result;
    };
    wrapped.__aub1V153 = true;
    try { root[name] = wrapped; } catch (_) {}
    try { eval(`${name} = wrapped`); } catch (_) {}
    return true;
  }

  function installBoundaries() {
    wrapGlobal('renderMyConcertsScreen', () => decorateNextConcert());
    wrapGlobal('renderStatsScreen', () => decorateStats());
    wrapGlobal('renderNewsScreen', () => decorateAlerts());
    wrapGlobal('renderMyBandsScreen', () => decorateMyBands());
    wrapGlobal('goToTab', (tab) => {
      if (String(tab) !== 'mybands') myBandsQuery = '';
      applyHeaderIcons();
    });
    wrapGlobal('setHeaderChrome', () => applyHeaderIcons());
  }

  function installStatsObserver() {
    if (statsObserver || !root.document || typeof root.MutationObserver !== 'function') return;
    const stats = root.document.querySelector('#screen-stats');
    if (!stats) return;
    let pending = false;
    statsObserver = new root.MutationObserver(() => {
      if (pending) return;
      pending = true;
      (root.requestAnimationFrame || root.setTimeout)(() => {
        pending = false;
        decorateStats();
      }, 0);
    });
    statsObserver.observe(stats, { childList: true, subtree: true });
  }

  function install() {
    if (installing) return true;
    installing = true;
    try {
      installBoundaries();
      installHeaderObserver();
      installStatsObserver();
      decorateNextConcert();
      decorateStats();
      decorateAlerts();
      decorateMyBands();
      if (root.document && !root.__LIVEVAULT_AUB1_V153_READY__) {
        root.__LIVEVAULT_AUB1_V153_READY__ = true;
        root.document.addEventListener('DOMContentLoaded', () => {
          installBoundaries();
          installHeaderObserver();
          installStatsObserver();
          decorateNextConcert();
          decorateStats();
          decorateAlerts();
          decorateMyBands();
        }, { once: true });
        root.setTimeout?.(() => {
          installBoundaries();
          decorateNextConcert();
          decorateStats();
          decorateAlerts();
          decorateMyBands();
        }, 0);
      }
      return true;
    } finally {
      installing = false;
    }
  }

  return Object.freeze({
    EQUALIZER_SVG,
    STATS_SVG,
    utcDateKey,
    activityMetrics,
    completedYearActivity,
    relevanceTag,
    decorateNextConcert,
    decorateStats,
    decorateAlerts,
    decorateMyBands,
    renderYearlyOverview,
    renderGenreOverview,
    install,
  });
});
