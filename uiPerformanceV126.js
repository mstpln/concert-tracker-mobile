'use strict';

// v126 responsiveness layer.
//
// The My Bands renderer asks dlBandActivity once for every stored band. The
// legacy helper obtains each band's latest show by scanning the complete
// concerts array, so one render grows as bands x concerts. With the larger
// production catalogue that repeated synchronous work became visible as tap
// latency.
//
// Keep the existing renderer and data helpers authoritative. For the duration
// of one My Bands render only, build a fresh latest-concert index and let
// dlBandActivity read from it. The index is discarded immediately after the
// render, so there is no cross-render cache, stale-data risk, new stored state,
// or invalidation contract to maintain.
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

  root.renderMyBandsScreen = function renderMyBandsScreenV126(...args) {
    // Build from the live in-memory array every render. This intentionally
    // trades one O(concerts) pass for the previous O(bands * concerts) scans.
    const latestByBand = buildLatestConcertByBand(concerts);
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
      return originalRenderMyBandsScreen.apply(this, args);
    } finally {
      root.dlBandActivity = priorBandActivity;
    }
  };

  root.LiveVaultUiPerformanceV126 = Object.freeze({
    buildLatestConcertByBand,
    indexedEffectiveLastShowDate,
  });
})(globalThis);
