'use strict';

// Final v83 boundary: derive chart windows from the selected timeframe rather
// than trusting a window object returned by an older compatibility layer.
(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  const chart = globalThis.ListeningV83ChartFix;
  if (!api || !chart || typeof api.selectedStats !== 'function') return;

  const DAY_MS = 86400000;
  const previousSelectedStats = api.selectedStats;

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

  api.selectedStats = function selectedStatsV83Final(listens, appBands, timeframe = 'threeMonths', now = new Date()) {
    const result = previousSelectedStats.call(this, listens, appBands, timeframe, now);
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
  };

  globalThis.ListeningV83WindowFix = { explicitWindow };
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.ListeningV83WindowFix;
