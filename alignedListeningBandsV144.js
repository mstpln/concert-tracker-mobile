'use strict';

(function attachAlignedListeningBandsV144(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultAlignedListeningBandsV144 = api;
  if (root?.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const FALLBACK_GROUPS = ['Rock', 'Pop', 'Hip-hop/R&B', 'Electronic', 'Other'];
  let navigationListenersInstalled = false;
  let myBandsReturnSnapshot = null;

  function getBands() {
    try { if (typeof bands !== 'undefined') return bands; } catch (_) {}
    return root.bands || [];
  }

  function getListeningEvents() {
    try { if (typeof listeningEvents !== 'undefined') return listeningEvents; } catch (_) {}
    return root.listeningEvents || [];
  }

  function getStatsApi() {
    try { if (typeof ListeningStats !== 'undefined') return ListeningStats; } catch (_) {}
    return root.ListeningStats || null;
  }

  function storedGenres(band) {
    if (Array.isArray(band?.genres)) return band.genres.filter(Boolean);
    if (Array.isArray(band?.genre)) return band.genre.filter(Boolean);
    return String(band?.genres || band?.genre || '')
      .split(/[,;/|]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function bandGenreGroup(band, statsApi) {
    for (const value of storedGenres(band)) {
      const group = statsApi?.genreGroup?.(value) || 'Other';
      if (group !== 'Other') return group;
    }
    return 'Other';
  }

  function emptyGroups(groups) {
    return Object.fromEntries(groups.map((group) => [group, 0]));
  }

  function percentage(value, total) {
    const numerator = Number(value) || 0;
    const denominator = Number(total) || 0;
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
  }

  function buildGenreDistributionByYear(listens, bandList, statsApi) {
    const groups = statsApi?.GENRE_GROUPS || FALLBACK_GROUPS;
    const byId = new Map((bandList || []).filter((band) => band?.id != null).map((band) => [String(band.id), band]));
    const years = new Map();

    for (const listen of listens || []) {
      const band = listen?.localBandId == null ? null : byId.get(String(listen.localBandId));
      if (!band || !statsApi?.isValidListen?.(listen)) continue;
      const timestamp = Number(statsApi.listenTimeMs?.(listen));
      if (!Number.isFinite(timestamp)) continue;
      const year = new Date(timestamp).getUTCFullYear();
      if (!Number.isFinite(year)) continue;

      const item = years.get(year) || {
        durations: emptyGroups(groups),
        listenCounts: emptyGroups(groups),
        unknownDurationCounts: emptyGroups(groups),
      };
      const group = bandGenreGroup(band, statsApi);
      const duration = Math.max(0, Number(statsApi.validDurationMs?.(listen)) || 0);
      item.durations[group] = (item.durations[group] || 0) + duration;
      item.listenCounts[group] = (item.listenCounts[group] || 0) + 1;
      if (duration === 0) item.unknownDurationCounts[group] = (item.unknownDurationCounts[group] || 0) + 1;
      years.set(year, item);
    }

    return [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, item]) => {
        const totalDurationMs = groups.reduce((sum, group) => sum + (item.durations[group] || 0), 0);
        const totalListenCount = groups.reduce((sum, group) => sum + (item.listenCounts[group] || 0), 0);
        const unknownDurationCount = groups.reduce((sum, group) => sum + (item.unknownDurationCounts[group] || 0), 0);
        const percentages = emptyGroups(groups);
        const listenPercentages = emptyGroups(groups);
        for (const group of groups) {
          percentages[group] = percentage(item.durations[group], totalDurationMs);
          listenPercentages[group] = percentage(item.listenCounts[group], totalListenCount);
        }
        return {
          year,
          totalDurationMs,
          totalListenCount,
          unknownDurationCount,
          percentages,
          listenPercentages,
          ...item,
        };
      });
  }

  function percentText(value) {
    return `${Math.round(Number(value) || 0)} %`;
  }

  function countText(value) {
    const count = Number(value) || 0;
    return `${count.toLocaleString()} listen${count === 1 ? '' : 's'}`;
  }

  function genreDetailRows(item, statsApi) {
    if (!item) return [];
    const groups = statsApi?.GENRE_GROUPS || FALLBACK_GROUPS;
    const rows = [{
      label: 'Total',
      value: `${statsApi.formatDuration(item.totalDurationMs)} · ${countText(item.totalListenCount)}`,
      total: true,
    }];
    for (const group of groups) {
      rows.push({
        label: group,
        value: `${statsApi.formatDuration(item.durations?.[group] || 0)} (${percentText(item.percentages?.[group])}) · ${countText(item.listenCounts?.[group] || 0)} (${percentText(item.listenPercentages?.[group])})`,
        total: false,
      });
    }
    return rows;
  }

  function decorateGenreDetail(doc = root.document) {
    const statsApi = getStatsApi();
    if (!doc || !statsApi) return false;
    const selected = doc.querySelector('#screen-stats [data-v81-genre-year].selected');
    const detail = doc.querySelector('#screen-stats .genre-year-detail');
    if (!selected || !detail) return false;
    const selectedYear = Number(selected.dataset.v81GenreYear);
    const item = buildGenreDistributionByYear(getListeningEvents(), getBands(), statsApi)
      .find((candidate) => candidate.year === selectedYear);
    if (!item) return false;

    const titleText = detail.querySelector('strong')?.textContent || String(selectedYear);
    const existingNote = detail.querySelector('small')?.textContent || '';
    detail.replaceChildren();

    const title = doc.createElement('strong');
    title.textContent = titleText;
    detail.appendChild(title);

    for (const row of genreDetailRows(item, statsApi)) {
      const line = doc.createElement('div');
      const label = doc.createElement('b');
      const value = doc.createElement('span');
      label.textContent = row.label;
      value.textContent = row.value;
      if (!row.total) value.className = 'v144-genre-value';
      line.append(label, value);
      detail.appendChild(line);
    }

    if (item.unknownDurationCount && existingNote) {
      const note = doc.createElement('small');
      note.textContent = existingNote;
      detail.appendChild(note);
    }
    detail.dataset.v144GenreDetail = 'true';
    return true;
  }

  function scheduleGenreDetailDecoration() {
    const raf = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
    raf(() => decorateGenreDetail());
  }

  function statusKinds(band) {
    const kinds = [];
    if (band?.favorite === true) kinds.push('favorite');
    if (band?.muted === true) kinds.push('muted');
    return kinds;
  }

  function iconHtml(name) {
    try { if (typeof icon === 'function') return icon(name); } catch (_) {}
    return typeof root.icon === 'function' ? root.icon(name) : '';
  }

  function decorateMyBands(doc = root.document) {
    if (!doc) return false;
    const screen = doc.querySelector('#screen-mybands');
    if (!screen) return false;
    const bandMap = new Map(getBands().filter((band) => band?.id != null).map((band) => [String(band.id), band]));

    screen.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
      const band = bandMap.get(String(row.dataset.bandId));
      const rowTop = row.querySelector('.row-top');
      const chevron = rowTop?.querySelector('.row-chevron');
      if (!band || !rowTop || !chevron) return;

      row.classList.add('mybands-status-row');
      let trailing = rowTop.querySelector(':scope > .mybands-row-trailing');
      if (!trailing) {
        trailing = doc.createElement('span');
        trailing.className = 'mybands-row-trailing';
        chevron.before(trailing);
        trailing.appendChild(chevron);
      }

      trailing.querySelector('.mybands-status-icons')?.remove();
      const kinds = statusKinds(band);
      if (!kinds.length) return;

      const statusGroup = doc.createElement('span');
      statusGroup.className = 'mybands-status-icons';
      statusGroup.setAttribute('aria-label', 'Band status');
      for (const kind of kinds) {
        const status = doc.createElement('span');
        status.className = 'mybands-status-icon';
        status.dataset.status = kind;
        status.setAttribute('role', 'img');
        status.setAttribute('aria-label', kind === 'favorite' ? 'Favorite band' : 'Alerts off');
        status.innerHTML = iconHtml(kind === 'favorite' ? 'heartFill' : 'bellOff');
        statusGroup.appendChild(status);
      }
      trailing.insertBefore(statusGroup, chevron);
    });
    return true;
  }

  function captureMyBandsPosition(event, doc = root.document) {
    const screen = doc?.querySelector('#screen-mybands');
    if (!screen || screen.classList.contains('hidden')) return false;
    const row = event?.target?.closest?.('#screen-mybands .row-card[data-band-id]');
    const content = doc.querySelector('#content');
    if (!row || !content) return false;
    const rowRect = row.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    myBandsReturnSnapshot = {
      bandId: String(row.dataset.bandId || ''),
      scrollTop: content.scrollTop,
      rowOffset: rowRect.top - contentRect.top,
    };
    return true;
  }

  function restoreMyBandsPosition(doc = root.document) {
    const snapshot = myBandsReturnSnapshot;
    const screen = doc?.querySelector('#screen-mybands');
    const content = doc?.querySelector('#content');
    if (!snapshot || !screen || !content || screen.classList.contains('hidden')) return false;

    content.scrollTop = snapshot.scrollTop;
    const row = [...screen.querySelectorAll('.row-card[data-band-id]')]
      .find((candidate) => String(candidate.dataset.bandId) === snapshot.bandId);
    if (row) {
      const rowRect = row.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      content.scrollTop += (rowRect.top - contentRect.top) - snapshot.rowOffset;
    }
    return true;
  }

  function scheduleMyBandsRestore() {
    const raf = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
    raf(() => raf(() => restoreMyBandsPosition()));
  }

  function installGenreCalculation() {
    const statsApi = getStatsApi();
    if (!statsApi) return false;
    if (statsApi.genreDistributionByYear?.__liveVaultV144) return true;
    function genreDistributionByYearV144(listens) {
      return buildGenreDistributionByYear(listens, getBands(), statsApi);
    }
    genreDistributionByYearV144.__liveVaultV144 = true;
    statsApi.genreDistributionByYear = genreDistributionByYearV144;
    return true;
  }

  function installStatsBoundary() {
    let current = null;
    try { if (typeof renderStatsScreen === 'function') current = renderStatsScreen; } catch (_) {}
    if (typeof current !== 'function' || current.__liveVaultV144) return typeof current === 'function';
    function renderStatsScreenV144(...args) {
      const result = current.apply(this, args);
      decorateGenreDetail();
      return result;
    }
    renderStatsScreenV144.__liveVaultV144 = true;
    try { renderStatsScreen = renderStatsScreenV144; } catch (_) {}
    root.renderStatsScreen = renderStatsScreenV144;
    return true;
  }

  function installMyBandsBoundary() {
    let current = null;
    try { if (typeof renderMyBandsScreen === 'function') current = renderMyBandsScreen; } catch (_) {}
    if (typeof current !== 'function' || current.__liveVaultV144) return typeof current === 'function';
    function renderMyBandsScreenV144(...args) {
      const result = current.apply(this, args);
      decorateMyBands();
      return result;
    }
    renderMyBandsScreenV144.__liveVaultV144 = true;
    try { renderMyBandsScreen = renderMyBandsScreenV144; } catch (_) {}
    root.renderMyBandsScreen = renderMyBandsScreenV144;
    return true;
  }

  function installNavigationListeners() {
    if (navigationListenersInstalled || !root.document) return false;
    navigationListenersInstalled = true;
    root.document.addEventListener('click', (event) => captureMyBandsPosition(event), true);
    root.document.addEventListener('click', (event) => {
      const yearButton = event.target?.closest?.('#screen-stats [data-v81-genre-year]');
      if (yearButton) scheduleGenreDetailDecoration();
    });
    root.addEventListener?.('popstate', (event) => {
      if (event.state?.screen === 'main' && event.state?.tab === 'mybands' && myBandsReturnSnapshot) {
        scheduleMyBandsRestore();
      }
    });
    return true;
  }

  function install() {
    installGenreCalculation();
    installStatsBoundary();
    installMyBandsBoundary();
    installNavigationListeners();
    decorateMyBands();
    decorateGenreDetail();

    if (root.document && !root.__LIVEVAULT_V144_REINSTALL_BOUNDARIES__) {
      root.__LIVEVAULT_V144_REINSTALL_BOUNDARIES__ = true;
      root.document.addEventListener('DOMContentLoaded', () => {
        installGenreCalculation();
        installStatsBoundary();
        installMyBandsBoundary();
        decorateMyBands();
        decorateGenreDetail();
      });
      root.setTimeout?.(() => {
        installGenreCalculation();
        installStatsBoundary();
        installMyBandsBoundary();
      }, 0);
    }
    return true;
  }

  return Object.freeze({
    FALLBACK_GROUPS,
    storedGenres,
    bandGenreGroup,
    percentage,
    buildGenreDistributionByYear,
    percentText,
    countText,
    genreDetailRows,
    statusKinds,
    decorateGenreDetail,
    decorateMyBands,
    captureMyBandsPosition,
    restoreMyBandsPosition,
    install,
  });
});
