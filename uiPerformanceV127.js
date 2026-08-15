'use strict';

(function attachUiPerformanceV127(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultUiPerformanceV127 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  function getBands() {
    try { if (typeof bands !== 'undefined') return bands; } catch (_) {}
    return root.bands;
  }

  function getListeningEvents() {
    try { if (typeof listeningEvents !== 'undefined') return listeningEvents; } catch (_) {}
    return root.listeningEvents;
  }

  function setListeningEvents(value) {
    try {
      if (typeof listeningEvents !== 'undefined') {
        listeningEvents = value;
        return;
      }
    } catch (_) {}
    root.listeningEvents = value;
  }

  function lowerBound(items, target) {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (items[mid].time < target) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function buildListeningIndex(listens, bandList, statsApi) {
    const tracked = new Set((bandList || []).filter((band) => band?.id != null).map((band) => String(band.id)));
    const byBand = new Map();
    let sourceVisits = 0;

    for (const listen of listens || []) {
      sourceVisits += 1;
      const bandId = listen?.localBandId == null ? null : String(listen.localBandId);
      if (!bandId || !tracked.has(bandId)) continue;
      const time = typeof statsApi?.listenTimeMs === 'function' ? statsApi.listenTimeMs(listen) : new Date(listen?.listenedAt).getTime();
      if (!Number.isFinite(time)) continue;
      const durationMs = typeof statsApi?.validDurationMs === 'function'
        ? Number(statsApi.validDurationMs(listen)) || 0
        : Math.max(0, Number(listen?.listenedDurationMs) || 0);
      const valid = typeof statsApi?.isValidListen === 'function'
        ? statsApi.isValidListen(listen)
        : durationMs > 0;
      if (!valid) continue;
      let items = byBand.get(bandId);
      if (!items) {
        items = [];
        byBand.set(bandId, items);
      }
      items.push({ time, durationMs, count: 1 });
    }

    for (const [bandId, items] of byBand) {
      items.sort((a, b) => a.time - b.time);
      let durationTotal = 0;
      let countTotal = 0;
      for (const item of items) {
        durationTotal += item.durationMs;
        countTotal += item.count;
        item.prefixDurationMs = durationTotal;
        item.prefixCount = countTotal;
      }
      byBand.set(bandId, items);
    }

    return { byBand, sourceVisits };
  }

  function aggregateWindow(index, bandId, startMs, endMs) {
    const items = index?.byBand?.get(String(bandId)) || [];
    if (!items.length || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const start = lowerBound(items, startMs);
    const end = lowerBound(items, endMs);
    if (start >= end) return null;
    const last = items[end - 1];
    const before = start > 0 ? items[start - 1] : null;
    return {
      durationMs: last.prefixDurationMs - (before?.prefixDurationMs || 0),
      listenCount: last.prefixCount - (before?.prefixCount || 0),
    };
  }

  function injectBefore(source, marker, html) {
    const index = String(source || '').indexOf(marker);
    if (index < 0) return source;
    return source.slice(0, index) + html + source.slice(index);
  }

  function concertCountdownLabel(dateValue, now = new Date()) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
    const current = now instanceof Date ? now : new Date(now);
    if (!match || !Number.isFinite(current.getTime())) return '';
    const targetDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const currentDay = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
    const days = Math.round((targetDay - currentDay) / 86400000);
    if (days < 0) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days until concert`;
  }

  function decorateUpcomingConcertMeta(source, concert, isPast, now = new Date()) {
    if (isPast) return source;
    const label = concertCountdownLabel(concert?.date, now);
    if (!label) return source;
    let html = String(source || '');
    const rowMarker = '<p class="row-km">';
    const rowStart = html.indexOf(rowMarker);
    if (rowStart >= 0) {
      const rowEnd = html.indexOf('</p>', rowStart + rowMarker.length);
      if (rowEnd >= 0) {
        html = `${html.slice(0, rowEnd)}<span class="concert-countdown-inline"> · ${label}</span>${html.slice(rowEnd)}`;
        return html;
      }
    }
    const countdownRow = `<p class="row-km concert-countdown-only">${label}</p>`;
    if (html.includes('<div class="concert-listening-row">')) return injectBefore(html, '<div class="concert-listening-row">', countdownRow);
    return injectBefore(html, '<div class="concert-prep-group', countdownRow);
  }

  function installNb1Styles() {
    if (typeof document === 'undefined' || document.getElementById('nb1-concert-card-styles')) return;
    const style = document.createElement('style');
    style.id = 'nb1-concert-card-styles';
    style.textContent = `
      .row-card-mc .row-avatar img,
      .profile-avatar img {
        border: 1px solid var(--border-strong);
        border-radius: 50%;
      }
      .row-card-mc .concert-countdown-inline,
      .row-card-mc .concert-countdown-only {
        color: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  function wrapBootstrap(api, onReady) {
    if (!api || typeof api.bootstrap !== 'function' || api.__uiPerformanceV127BootstrapWrapped) return false;
    const original = api.bootstrap;
    api.bootstrap = async function bootstrapWithUiPerformanceV127(...args) {
      try {
        return await original.apply(this, args);
      } finally {
        onReady();
      }
    };
    Object.defineProperty(api, '__uiPerformanceV127BootstrapWrapped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return true;
  }

  let activeIndex = null;
  let activeNow = null;
  let installed = false;

  function fastListeningRow(concert, isPast) {
    if (!activeIndex || !concert?.bandId || !root.LiveVaultV72?.concertListeningWindow || !root.ListeningStats) return '';
    const window = root.LiveVaultV72.concertListeningWindow(concert, isPast, activeNow || new Date());
    if (!window) return '';
    const aggregate = aggregateWindow(activeIndex, concert.bandId, window.startMs, window.endMs);
    if (!aggregate) return '';
    return `<div class="concert-listening-row">${root.icon('headphones')}<span><strong>Your listening</strong><small>${root.ListeningStats.formatDuration(aggregate.durationMs)} · ${aggregate.listenCount.toLocaleString()} listens</small></span></div>`;
  }

  function withRenderIndex(render, thisArg, args) {
    const currentEvents = getListeningEvents();
    const currentBands = getBands();
    if (activeIndex || !Array.isArray(currentEvents) || !Array.isArray(currentBands) || !root.ListeningStats) return render.apply(thisArg, args);
    activeIndex = buildListeningIndex(currentEvents, currentBands, root.ListeningStats);
    activeNow = typeof root.listeningNow === 'function' ? root.listeningNow() : new Date();
    try {
      return render.apply(thisArg, args);
    } finally {
      activeIndex = null;
      activeNow = null;
    }
  }

  function withoutLegacyListeningScan(render) {
    const sourceEvents = getListeningEvents();
    setListeningEvents([]);
    try {
      return render();
    } finally {
      setListeningEvents(sourceEvents);
    }
  }

  function install() {
    if (installed || typeof root.renderMyConcertsScreen !== 'function') return false;
    installed = true;
    installNb1Styles();

    const originalMyConcertRowHtml = root.myConcertRowHtml;
    if (typeof originalMyConcertRowHtml === 'function') {
      root.myConcertRowHtml = function myConcertRowHtmlV127(concert, isPast, options = {}) {
        let html = activeIndex
          ? withoutLegacyListeningScan(() => originalMyConcertRowHtml.call(this, concert, isPast, options))
          : originalMyConcertRowHtml.call(this, concert, isPast, options);
        const now = activeNow || (typeof root.listeningNow === 'function' ? root.listeningNow() : new Date());
        html = decorateUpcomingConcertMeta(html, concert, isPast, now);
        if (activeIndex) {
          const row = fastListeningRow(concert, isPast);
          if (row) html = injectBefore(html, '<div class="concert-prep-group', row);
        }
        return html;
      };
    }

    const originalProfileUpcomingRowHtml = root.profileUpcomingRowHtml;
    if (typeof originalProfileUpcomingRowHtml === 'function') {
      root.profileUpcomingRowHtml = function profileUpcomingRowHtmlV127(concert) {
        if (!activeIndex) return originalProfileUpcomingRowHtml.call(this, concert);
        let html = withoutLegacyListeningScan(() => originalProfileUpcomingRowHtml.call(this, concert));
        const row = fastListeningRow(concert, false);
        if (row) html = injectBefore(html, '<div class="show-buttons">', row);
        return html;
      };
    }

    const originalRenderMyConcertsScreen = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV127(...args) {
      return withRenderIndex(originalRenderMyConcertsScreen, this, args);
    };

    if (typeof root.renderProfileScreen === 'function') {
      const originalRenderProfileScreen = root.renderProfileScreen;
      root.renderProfileScreen = function renderProfileScreenV127(...args) {
        return withRenderIndex(originalRenderProfileScreen, this, args);
      };
    }

    return true;
  }

  // v72 registers its DOMContentLoaded listener before this script is loaded.
  // Wrap that public bootstrap now, so v127 installs only after v72's async
  // compatibility bootstrap has finished owning the concert row renderers.
  // This avoids timing races from storage latency and guarantees one wrapper.
  if (typeof document !== 'undefined') {
    const wrapped = wrapBootstrap(root.LiveVaultV72, install);
    if (!wrapped) document.addEventListener('DOMContentLoaded', install, { once: true });
  }

  return Object.freeze({
    buildListeningIndex,
    aggregateWindow,
    lowerBound,
    concertCountdownLabel,
    decorateUpcomingConcertMeta,
    wrapBootstrap,
    install,
  });
});