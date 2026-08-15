'use strict';

// v126 responsiveness layer.
//
// My Bands was doing two kinds of synchronous work on every visit: rebuilding
// hundreds of row elements and asking dlBandActivity once per stored band,
// where the legacy helper rescans the complete concerts array each time.
// Those costs became visible as the real collection grew.
//
// This layer is intentionally narrow. It optimizes only My Bands, whose render
// dependencies are explicit and small. A compact render key is derived from
// every field that can affect the visible list plus the latest concert date
// for each band. If that key is unchanged, the already-rendered DOM (and its
// listeners) is reused. Otherwise the existing renderer remains authoritative.
// During a real render a fresh latest-concert index also replaces the previous
// bands x concerts scan pattern with one concerts pass. No production data,
// schema, provider state, or browser-local listening state is cached here.
(function installUiPerformanceV126(root) {
  if (root.__LIVEVAULT_UI_PERFORMANCE_V126__) return;
  root.__LIVEVAULT_UI_PERFORMANCE_V126__ = true;

  const originalRenderMyBandsScreen = root.renderMyBandsScreen;
  const originalBandActivity = root.dlBandActivity;
  const originalEffectiveLastShowDate = root.dlEffectiveLastShowDate;

  if (
    typeof originalRenderMyBandsScreen !== 'function'
    || typeof originalBandActivity !== 'function'
    || typeof originalEffectiveLastShowDate !== 'function'
  ) return;

  let lastRenderKey = null;

  function parseStoredDate(value) {
    if (!value) return null;
    const raw = String(value);
    const date = new Date(`${raw}${raw.length === 4 ? '-01-01' : ''}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function buildLatestConcertByBand(concertList) {
    const latestByBand = new Map();
    for (const concert of concertList || []) {
      if (!concert?.bandId || !concert.date) continue;
      const date = parseStoredDate(concert.date);
      if (!date) continue;
      const previous = latestByBand.get(concert.bandId);
      if (!previous || date > previous) latestByBand.set(concert.bandId, date);
    }
    return latestByBand;
  }

  function indexedEffectiveLastShowDate(band, latestByBand) {
    const stored = parseStoredDate(band?.lastKnownConcertDate);
    const concertDate = latestByBand.get(band?.id) || null;
    if (!stored) return concertDate;
    if (!concertDate) return stored;
    return concertDate > stored ? concertDate : stored;
  }

  function buildMyBandsRenderKey(bandList, latestByBand, viewState) {
    // Do not stringify whole band records: production records contain large
    // research/provider histories that never appear on this root list. Only
    // include fields read by renderMyBandsScreen and its activity/genre filters.
    const bandParts = (bandList || []).map((band) => [
      band?.id || '',
      band?.name || '',
      band?.genre || '',
      band?.muted === true ? 1 : 0,
      band?._enriching === true ? 1 : 0,
      band?.lastKnownConcertDate || '',
      latestByBand.get(band?.id)?.getTime() || 0,
    ]);
    return JSON.stringify([
      viewState.dateKey,
      viewState.hideInactiveBands === true ? 1 : 0,
      Number(viewState.inactivityYears) || 0,
      viewState.selectedGenre || 'all',
      viewState.mutedOnly === true ? 1 : 0,
      bandParts,
    ]);
  }

  root.renderMyBandsScreen = function renderMyBandsScreenV126(...args) {
    // Rebuild this small index from live data on every invocation. That makes
    // in-place concert edits observable without any invalidation protocol.
    const latestByBand = buildLatestConcertByBand(concerts);
    const renderKey = buildMyBandsRenderKey(bands, latestByBand, {
      dateKey: dlCurrentDate().toDateString(),
      hideInactiveBands,
      inactivityYears,
      selectedGenre,
      mutedOnly,
    });
    const container = el('screen-mybands');

    if (renderKey === lastRenderKey && container?.childElementCount > 0) return;

    const priorBandActivity = root.dlBandActivity;
    root.dlBandActivity = function dlBandActivityV126(band, _concertList, thresholdYears, today = dlCurrentDate()) {
      const lastDate = indexedEffectiveLastShowDate(band, latestByBand);
      if (!lastDate) return { status: 'unknown', lastDate: null, lastYear: null };

      const current = new Date(today);
      current.setHours(0, 0, 0, 0);
      const lastYear = lastDate.getFullYear();
      if (lastDate >= current) return { status: 'active', lastDate, lastYear };

      const yearsAgo = (current - lastDate) / (1000 * 60 * 60 * 24 * 365.25);
      return {
        status: yearsAgo >= thresholdYears ? 'inactive' : 'active',
        lastDate,
        lastYear,
      };
    };

    try {
      const result = originalRenderMyBandsScreen.apply(this, args);
      lastRenderKey = renderKey;
      return result;
    } finally {
      root.dlBandActivity = priorBandActivity;
    }
  };

  root.LiveVaultUiPerformanceV126 = Object.freeze({
    buildLatestConcertByBand,
    indexedEffectiveLastShowDate,
    buildMyBandsRenderKey,
  });
})(globalThis);
