'use strict';

// Final v83 boundary: derive chart windows from the selected timeframe rather
// than trusting a window object returned by an older compatibility layer.
(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  const chart = globalThis.ListeningV83ChartFix;
  if (!api || !chart) return;

  const DAY_MS = 86400000;

  function explicitWindow(timeframe, now, listens) {
    const parsed = new Date(now);
    const end = Number.isFinite(parsed.getTime()) ? parsed : new Date();
    if (timeframe === 'twoWeeks') {
      const startMs = end.getTime() - 14 * DAY_MS;
      return {
        timeframe: 'twoWeeks',
        label: '2 weeks',
        bucket: 'day',
        startMs,
        endMs: end.getTime() + 1,
        previousStartMs: startMs - 14 * DAY_MS,
        previousEndMs: startMs,
      };
    }
    return api.resolveWindow(timeframe, end, listens || []);
  }

  function finalize(result, listens, timeframe, now) {
    const window = explicitWindow(timeframe, now, listens);
    const buckets = chart.timeBuckets(result?.listens || [], window, window.bucket);
    return {
      ...result,
      timeframe,
      label: window.label,
      window,
      buckets,
      mostActive: buckets.length
        ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || String(a.startAt).localeCompare(String(b.startAt)))[0]
        : null,
    };
  }

  function install() {
    const currentSelectedStats = api.selectedStats;
    if (typeof currentSelectedStats === 'function' && !currentSelectedStats.__liveVaultV83Final) {
      function selectedStatsV83Final(listens, appBands, timeframe = 'threeMonths', now = new Date()) {
        return finalize(currentSelectedStats.call(this, listens, appBands, timeframe, now), listens, timeframe, now);
      }
      selectedStatsV83Final.__liveVaultV83Final = true;
      api.selectedStats = selectedStatsV83Final;
    }

    if (typeof listeningEvents !== 'undefined' && typeof bands !== 'undefined') {
      function globalListeningStatsV83(timeframe = 'threeMonths') {
        const now = typeof listeningNow === 'function' ? listeningNow() : new Date();
        const result = api.selectedStats(listeningEvents, bands, timeframe, now);
        return finalize(result, listeningEvents, timeframe, now);
      }
      globalListeningStatsV83.__liveVaultV83Final = true;
      globalThis.globalListeningStats = globalListeningStatsV83;
      try { globalListeningStats = globalListeningStatsV83; } catch (_) {}
    }
  }

  install();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', install);
    setTimeout(install, 0);
  }

  globalThis.ListeningV83WindowFix = { explicitWindow, finalize, install };
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.ListeningV83WindowFix;
