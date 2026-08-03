'use strict';

(function attachListeningV84ChartRenderFix(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ListeningV84ChartRenderFix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DAY_MS = 86400000;

  function resolvedNow(value = new Date()) {
    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }

  function explicitTwoWeekWindow(now = new Date()) {
    const end = resolvedNow(now);
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

  function listenTimeMs(listen, statsApi = root.ListeningStats) {
    const viaApi = statsApi?.listenTimeMs?.(listen);
    if (Number.isFinite(viaApi)) return viaApi;
    const direct = Number(listen?.listenedAtMs);
    if (Number.isFinite(direct)) return Math.abs(direct) < 100000000000 ? direct * 1000 : direct;
    const seconds = Number(listen?.listenedAtUnix ?? listen?.listenedAtSeconds ?? listen?.timestamp);
    if (Number.isFinite(seconds)) return Math.abs(seconds) < 100000000000 ? seconds * 1000 : seconds;
    const parsed = Date.parse(String(listen?.listenedAt || ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function durationMs(listen, statsApi = root.ListeningStats) {
    const viaApi = statsApi?.validDurationMs?.(listen);
    if (Number.isFinite(viaApi) && viaApi > 0) return viaApi;
    const value = Number(listen?.listenedDurationMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function isValidListen(listen, statsApi = root.ListeningStats) {
    if (!Number.isFinite(listenTimeMs(listen, statsApi))) return false;
    if (typeof statsApi?.isValidListen === 'function') return statsApi.isValidListen(listen);
    return listen?.listenedDurationMs == null || durationMs(listen, statsApi) > 0;
  }

  function utcDayStart(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function dayLabel(value) {
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value);
  }

  function buildDailyBuckets(listens, window, statsApi = root.ListeningStats) {
    const startMs = Number(window?.startMs);
    const endMs = Number(window?.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    const first = utcDayStart(startMs);
    const last = utcDayStart(endMs - 1);
    if (!first || !last) return [];

    const grouped = new Map();
    for (const listen of listens || []) {
      const timestamp = listenTimeMs(listen, statsApi);
      if (!isValidListen(listen, statsApi) || timestamp < startMs || timestamp >= endMs) continue;
      const start = utcDayStart(timestamp);
      if (!start) continue;
      const key = start.toISOString();
      const item = grouped.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      const knownDuration = durationMs(listen, statsApi);
      item.durationMs += knownDuration;
      item.listenCount += 1;
      if (knownDuration === 0) item.unknownDurationCount += 1;
      grouped.set(key, item);
    }

    const output = [];
    for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + DAY_MS)) {
      const key = cursor.toISOString();
      const item = grouped.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      output.push({
        startAt: key,
        label: dayLabel(cursor),
        ...item,
        hours: item.durationMs / 3600000,
      });
    }
    return output;
  }

  function inWindow(listen, startMs, endMs, statsApi) {
    const timestamp = listenTimeMs(listen, statsApi);
    return isValidListen(listen, statsApi) && timestamp >= startMs && timestamp < endMs;
  }

  function firstLast(listens, latest, statsApi) {
    let selected = null;
    let selectedTime = latest ? -Infinity : Infinity;
    for (const listen of listens || []) {
      const timestamp = listenTimeMs(listen, statsApi);
      if (!Number.isFinite(timestamp)) continue;
      if ((latest && timestamp > selectedTime) || (!latest && timestamp < selectedTime)) {
        selected = listen;
        selectedTime = timestamp;
      }
    }
    return selected;
  }

  function authoritativeTwoWeekStats(listens, appBands, now = new Date(), statsApi = root.ListeningStats) {
    const window = explicitTwoWeekWindow(now);
    const bandMap = new Map((appBands || []).filter((band) => band?.id != null).map((band) => [String(band.id), band]));
    const source = (listens || []).filter((listen) => listen?.localBandId != null && bandMap.has(String(listen.localBandId)) && isValidListen(listen, statsApi));
    const selected = source.filter((listen) => inWindow(listen, window.startMs, window.endMs, statsApi));
    const previous = source.filter((listen) => inWindow(listen, window.previousStartMs, window.previousEndMs, statsApi));
    const currentBands = statsApi.topBands(selected, appBands, 100);
    const previousBands = statsApi.topBands(previous, appBands, 100);
    const ranked = statsApi.rankMovement(currentBands, previousBands, 'twoWeeks');
    const buckets = buildDailyBuckets(source, window, statsApi);
    const totalDuration = selected.reduce((sum, listen) => sum + durationMs(listen, statsApi), 0);
    const unknownDurationCount = selected.reduce((sum, listen) => sum + (durationMs(listen, statsApi) === 0 ? 1 : 0), 0);
    const mostActive = buckets.length
      ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || String(a.startAt).localeCompare(String(b.startAt)))[0]
      : null;

    return {
      timeframe: 'twoWeeks',
      label: '2 weeks',
      window,
      listens: selected,
      previousListens: previous,
      durationMs: totalDuration,
      listenCount: selected.length,
      unknownDurationCount,
      hasUnknownDuration: unknownDurationCount > 0,
      firstListened: firstLast(selected, false, statsApi),
      lastListened: firstLast(selected, true, statsApi),
      distinctMatchedBands: ranked.length,
      topBands: ranked,
      topTracks: statsApi.topTracks(selected, 10),
      topAlbums: typeof statsApi.topAlbums === 'function' ? statsApi.topAlbums(selected, 10) : [],
      buckets,
      mostActive,
    };
  }

  function escapeHtmlSafe(value) {
    try { if (typeof escapeHtml === 'function') return escapeHtml(value); } catch (_) {}
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function escapeAttrSafe(value) {
    try { if (typeof escapeAttr === 'function') return escapeAttr(value); } catch (_) {}
    return escapeHtmlSafe(value);
  }

  function currentNow() {
    try { if (typeof listeningNow === 'function') return listeningNow(); } catch (_) {}
    return new Date();
  }

  function activeTwoWeekUi(stats) {
    if (stats?.timeframe === 'twoWeeks' || stats?.window?.timeframe === 'twoWeeks') return true;
    try {
      return profileListeningTimeframe === 'twoWeeks' && currentScreen === 'profile' && profileTab === 'listening';
    } catch (_) {
      return false;
    }
  }

  function renderTwoWeekChart(stats, statsApi = root.ListeningStats) {
    const window = explicitTwoWeekWindow(currentNow());
    const buckets = buildDailyBuckets(stats?.listens || [], window, statsApi);
    if (!buckets.length) {
      return '<section class="listening-card"><p class="listening-section-title">LISTENING OVER TIME (hours)</p><p class="listening-empty">Insufficient listening data for this chart.</p></section>';
    }

    const width = 600;
    const height = 210;
    const left = 38;
    const right = 12;
    const top = 16;
    const bottom = 34;
    const maxHours = Math.max(1, ...buckets.map((bucket) => bucket.hours));
    const yMax = Math.max(1, Math.ceil(maxHours * 2) / 2);
    const xFor = (index) => left + (buckets.length === 1 ? (width - left - right) / 2 : index * ((width - left - right) / (buckets.length - 1)));
    const yFor = (hours) => top + (yMax - hours) * ((height - top - bottom) / yMax);
    const points = buckets.map((bucket, index) => `${xFor(index).toFixed(1)},${yFor(bucket.hours).toFixed(1)}`);
    const area = `${left},${height - bottom} ${points.join(' ')} ${xFor(buckets.length - 1)},${height - bottom}`;
    const labelIndexes = new Set([0, buckets.length - 1, Math.floor((buckets.length - 1) / 3), Math.floor((buckets.length - 1) * 2 / 3)]);
    const mostActive = [...buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || String(a.startAt).localeCompare(String(b.startAt)))[0];
    const summary = `2 weeks listening chart with ${buckets.length} day periods. Highest day is ${mostActive?.label || 'not available'} at ${(mostActive?.hours || 0).toFixed(1)} hours.`;
    const durationText = typeof statsApi?.formatDuration === 'function'
      ? statsApi.formatDuration(mostActive?.durationMs || 0)
      : `${Math.round((mostActive?.durationMs || 0) / 60000)} min`;

    return `<section class="listening-card listening-chart-card" data-v84-visible-two-week-chart="true" aria-labelledby="listening-chart-title">
      <p id="listening-chart-title" class="listening-section-title">LISTENING OVER TIME (hours)</p>
      <svg class="listening-line-chart" data-listening-chart-timeframe="twoWeeks" data-listening-bucket-kind="day" data-listening-bucket-count="${buckets.length}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttrSafe(summary)}" preserveAspectRatio="none">
        ${[0, .25, .5, .75, 1].map((step) => { const y = top + step * (height - top - bottom); const label = Math.round((yMax * (1 - step)) * 10) / 10; return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-grid"/><text class="chart-y-label" x="${left - 8}" y="${y + 4}" text-anchor="end">${label}</text>`; }).join('')}
        <polygon points="${area}" class="chart-area"/>
        <polyline points="${points.join(' ')}" class="chart-line"/>
        ${buckets.map((bucket, index) => `<circle data-listening-point="${index}" cx="${xFor(index)}" cy="${yFor(bucket.hours)}" r="3.5"><title>${escapeHtmlSafe(`${bucket.label}: ${bucket.hours.toFixed(1)} hours`)}</title></circle>`).join('')}
        ${buckets.map((bucket, index) => labelIndexes.has(index) ? `<text class="chart-x-label" data-listening-day-label="true" x="${xFor(index)}" y="${height - 10}" text-anchor="middle">${escapeHtmlSafe(bucket.label)}</text>` : '').join('')}
      </svg>
      <p class="listening-card-note">Most active day: ${escapeHtmlSafe(mostActive.label)} · ${escapeHtmlSafe(durationText)}</p>
    </section>`;
  }

  function installCalculations() {
    const statsApi = root.ListeningStats;
    if (!statsApi) return false;

    if (!statsApi.resolveWindow?.__liveVaultV84) {
      const previousResolveWindow = statsApi.resolveWindow;
      function resolveWindowV84(timeframe = 'threeMonths', now = new Date(), listens = []) {
        if (timeframe === 'twoWeeks') return explicitTwoWeekWindow(now);
        return previousResolveWindow.call(this, timeframe, now, listens);
      }
      resolveWindowV84.__liveVaultV84 = true;
      statsApi.resolveWindow = resolveWindowV84;
    }

    if (!statsApi.timeBuckets?.__liveVaultV84) {
      const previousTimeBuckets = statsApi.timeBuckets;
      function timeBucketsV84(listens, window, kind = window?.bucket) {
        if (kind === 'day' || window?.timeframe === 'twoWeeks') return buildDailyBuckets(listens, window, statsApi);
        return previousTimeBuckets.call(this, listens, window, kind);
      }
      timeBucketsV84.__liveVaultV84 = true;
      statsApi.timeBuckets = timeBucketsV84;
    }

    if (!statsApi.selectedStats?.__liveVaultV84) {
      const previousSelectedStats = statsApi.selectedStats;
      function selectedStatsV84(listens, appBands, timeframe = 'threeMonths', now = new Date()) {
        if (timeframe === 'twoWeeks') return authoritativeTwoWeekStats(listens, appBands, now, statsApi);
        return previousSelectedStats.call(this, listens, appBands, timeframe, now);
      }
      selectedStatsV84.__liveVaultV84 = true;
      statsApi.selectedStats = selectedStatsV84;
    }
    return true;
  }

  function installRenderer() {
    let current = null;
    try { if (typeof lineChartHtml === 'function') current = lineChartHtml; } catch (_) {}
    if (!current && typeof root.lineChartHtml === 'function') current = root.lineChartHtml;
    if (typeof current !== 'function') return false;
    if (current.__liveVaultV84) return true;

    const previousLineChartHtml = current;
    function lineChartHtmlV84(stats) {
      if (!activeTwoWeekUi(stats)) return previousLineChartHtml(stats);
      return renderTwoWeekChart(stats, root.ListeningStats);
    }
    lineChartHtmlV84.__liveVaultV84 = true;
    try { lineChartHtml = lineChartHtmlV84; } catch (_) {}
    root.lineChartHtml = lineChartHtmlV84;
    return true;
  }

  function install() {
    installCalculations();
    installRenderer();
  }

  install();
  if (root.document) {
    root.document.addEventListener('DOMContentLoaded', install);
    root.setTimeout?.(install, 0);
    root.addEventListener?.('load', install, { once: true });
  }

  return {
    DAY_MS,
    explicitTwoWeekWindow,
    buildDailyBuckets,
    authoritativeTwoWeekStats,
    renderTwoWeekChart,
    install,
  };
});
