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
      if (typeof statsApi?.isValidListen === 'function' && !statsApi.isValidListen(listen)) continue;
      const time = typeof statsApi?.listenTimeMs === 'function' ? statsApi.listenTimeMs(listen) : new Date(listen?.listenedAt).getTime();
      if (!Number.isFinite(time)) continue;
      const durationMs = typeof statsApi?.validDurationMs === 'function' ? statsApi.validDurationMs(listen) : Math.max(0, Number(listen?.listenedDurationMs) || 0);
      let items = byBand.get(bandId);
      if (!items) {
        items = [];
        byBand.set(bandId, items);
      }
      items.push({ time, durationMs });
    }

    for (const [bandId, items] of byBand) {
      items.sort((a, b) => a.time - b.time);
      let durationTotal = 0;
      items.forEach((item, index) => {
        durationTotal += item.durationMs;
        item.prefixDurationMs = durationTotal;
        item.prefixCount = index + 1;
      });
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

    const originalMyConcertRowHtml = root.myConcertRowHtml;
    if (typeof originalMyConcertRowHtml === 'function') {
      root.myConcertRowHtml = function myConcertRowHtmlV127(concert, isPast, options = {}) {
        if (!activeIndex) return originalMyConcertRowHtml.call(this, concert, isPast, options);
        let html = withoutLegacyListeningScan(() => originalMyConcertRowHtml.call(this, concert, isPast, options));
        const row = fastListeningRow(concert, isPast);
        if (row) html = injectBefore(html, '<div class="concert-prep-group', row);
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

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', install, { once: true });

  return Object.freeze({ buildListeningIndex, aggregateWindow, lowerBound, install });
});
