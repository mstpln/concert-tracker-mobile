'use strict';

// v126 responsiveness layer.
//
// Root-tab navigation used to rebuild large DOM trees on every tap even when
// neither the data nor the view state had changed. That work scales with the
// size of bands.json/concerts.json and became visibly expensive as the real
// collection grew. Keep the existing renderers authoritative, but reuse their
// already-rendered DOM until an app write, refresh, filter/subtab change, or
// calendar-day change makes that view stale.
//
// This file deliberately changes no stored data shape and owns no provider
// data. It is loaded after the existing compatibility layers so it wraps the
// final runtime functions rather than bypassing them.
(function installUiPerformanceV126(root) {
  if (root.__LIVEVAULT_UI_PERFORMANCE_V126__) return;
  root.__LIVEVAULT_UI_PERFORMANCE_V126__ = true;

  const cachedTabs = new Set(['myconcerts', 'concerts', 'mybands', 'news']);
  const renderedState = new Map();
  const dirtyTabs = new Set(cachedTabs);
  let activityIndex = null;

  const invalidateTabs = (...tabs) => {
    for (const tab of tabs.flat()) {
      if (cachedTabs.has(tab)) dirtyTabs.add(tab);
    }
  };

  const invalidateAll = () => {
    invalidateTabs([...cachedTabs]);
    activityIndex = null;
  };

  function rootStateKey(tab) {
    if (tab === 'myconcerts') {
      return [
        dlCurrentDate().toDateString(),
        bands.length,
        concerts.length,
        listeningEvents.length,
      ].join('|');
    }
    if (tab === 'concerts') {
      return [
        concertsSubTab,
        europeOnly,
        nearbyOnly,
        venuesNearbyOnly,
        venuesEuropeOnly,
        venuesPastOnly,
        bands.length,
        concerts.length,
      ].join('|');
    }
    if (tab === 'mybands') {
      return [
        hideInactiveBands,
        inactivityYears,
        selectedGenre,
        mutedOnly,
        bands.length,
        concerts.length,
      ].join('|');
    }
    if (tab === 'news') {
      return [newsSubTab, bands.length, concerts.length, news.length].join('|');
    }
    return '';
  }

  function wrapRenderer(name, tab) {
    const original = root[name];
    if (typeof original !== 'function') return;
    const wrapped = function wrappedV126Renderer(...args) {
      const result = original.apply(this, args);
      dirtyTabs.delete(tab);
      renderedState.set(tab, rootStateKey(tab));
      return result;
    };
    wrapped.__liveVaultV126Original = original;
    root[name] = wrapped;
  }

  wrapRenderer('renderMyConcertsScreen', 'myconcerts');
  wrapRenderer('renderConcertsScreen', 'concerts');
  wrapRenderer('renderMyBandsScreen', 'mybands');
  wrapRenderer('renderNewsScreen', 'news');

  const originalGoToTab = root.goToTab;
  if (typeof originalGoToTab === 'function') {
    root.goToTab = function goToTabV126(tab, options = {}) {
      if (!cachedTabs.has(tab)) return originalGoToTab.call(this, tab, options);

      const rendererName = {
        myconcerts: 'renderMyConcertsScreen',
        concerts: 'renderConcertsScreen',
        mybands: 'renderMyBandsScreen',
        news: 'renderNewsScreen',
      }[tab];
      const renderer = root[rendererName];
      const canReuse = !dirtyTabs.has(tab)
        && renderedState.get(tab) === rootStateKey(tab)
        && el(TAB_SCREENS[tab])?.childElementCount > 0;

      if (!canReuse || typeof renderer !== 'function') {
        return originalGoToTab.call(this, tab, options);
      }

      // Let the existing navigation function continue to own header chrome,
      // history, active-tab state, Alerts seen-state and screen visibility.
      // Suppress only the redundant DOM rebuild for this one invocation.
      root[rendererName] = () => {};
      try {
        return originalGoToTab.call(this, tab, options);
      } finally {
        root[rendererName] = renderer;
      }
    };
  }

  // Build the per-band latest-concert date once per in-memory data revision.
  // renderMyBandsScreen asks dlBandActivity once for every band; the previous
  // helper rescanned all concerts for each call (O(bands * concerts)).
  const originalEffectiveLastShowDate = root.dlEffectiveLastShowDate;
  const originalBandActivity = root.dlBandActivity;

  function ensureActivityIndex(concertList) {
    if (activityIndex?.concerts === concertList) return activityIndex.latestByBand;
    const latestByBand = new Map();
    for (const concert of concertList || []) {
      if (!concert?.bandId || !concert.date) continue;
      const date = new Date(concert.date + 'T00:00:00');
      if (Number.isNaN(date.getTime())) continue;
      const current = latestByBand.get(concert.bandId);
      if (!current || date > current) latestByBand.set(concert.bandId, date);
    }
    activityIndex = { concerts: concertList, latestByBand };
    return latestByBand;
  }

  if (typeof originalEffectiveLastShowDate === 'function') {
    root.dlEffectiveLastShowDate = function dlEffectiveLastShowDateV126(band, concertList) {
      let latest = null;
      if (band?.lastKnownConcertDate) {
        const date = new Date(band.lastKnownConcertDate + (band.lastKnownConcertDate.length === 4 ? '-01-01' : '') + 'T00:00:00');
        if (!Number.isNaN(date.getTime())) latest = date;
      }
      const concertDate = ensureActivityIndex(concertList).get(band?.id);
      if (concertDate && (!latest || concertDate > latest)) latest = concertDate;
      return latest;
    };
  }

  if (typeof originalBandActivity === 'function') {
    root.dlBandActivity = function dlBandActivityV126(band, concertList, thresholdYears, today = dlCurrentDate()) {
      const lastDate = root.dlEffectiveLastShowDate(band, concertList);
      if (!lastDate) return { status: 'unknown', lastDate: null, lastYear: null };
      const current = new Date(today);
      current.setHours(0, 0, 0, 0);
      const lastYear = lastDate.getFullYear();
      if (lastDate >= current) return { status: 'active', lastDate, lastYear };
      const yearsAgo = (current - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
      return { status: yearsAgo >= thresholdYears ? 'inactive' : 'active', lastDate, lastYear };
    };
  }

  // Successful data writes are the authoritative invalidation boundary. This
  // also handles in-place mutations (for example attending/favorite toggles)
  // that do not replace the global arrays and therefore cannot be detected by
  // reference equality alone.
  const originalWriteJson = root.dlWriteJsonFile;
  if (typeof originalWriteJson === 'function') {
    root.dlWriteJsonFile = async function dlWriteJsonFileV126(dirHandle, filename, data) {
      const result = await originalWriteJson.call(this, dirHandle, filename, data);
      if (filename === 'bands.json') {
        activityIndex = null;
        invalidateAll();
      } else if (filename === 'concerts.json') {
        activityIndex = null;
        invalidateTabs('myconcerts', 'concerts', 'mybands', 'news');
      } else if (filename === 'news.json') {
        invalidateTabs('news');
      }
      return result;
    };
  }

  const originalLoadData = root.loadDataAndShowApp;
  if (typeof originalLoadData === 'function') {
    root.loadDataAndShowApp = async function loadDataAndShowAppV126(...args) {
      invalidateAll();
      return originalLoadData.apply(this, args);
    };
  }

  // Exposed only for synthetic regression tests and debugging. It contains no
  // user data and performs no I/O.
  root.LiveVaultUiPerformanceV126 = Object.freeze({
    invalidateAll,
    invalidateTabs,
    isDirty: (tab) => dirtyTabs.has(tab),
  });
})(globalThis);
