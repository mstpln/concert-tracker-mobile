'use strict';

// v82 production correction layer. This loads after the older v72/v81 visual
// compatibility scripts so those layers cannot silently replace the final
// listening-window and genre-detail contracts.
(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  if (!api) return;

  const DAY_MS = 86400000;
  const GROUPS = api.GENRE_GROUPS;
  const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

  function normalizedTimestamp(value) {
    if (value == null || value === '') return NaN;
    const number = Number(value);
    if (!Number.isFinite(number)) return NaN;
    const milliseconds = Math.abs(number) < 100000000000 ? number * 1000 : number;
    return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : NaN;
  }

  function listenTimeMs(listen) {
    const direct = normalizedTimestamp(listen?.listenedAtMs);
    if (Number.isFinite(direct)) return direct;
    const providerValue = normalizedTimestamp(listen?.listenedAtUnix ?? listen?.listenedAtSeconds ?? listen?.timestamp);
    if (Number.isFinite(providerValue)) return providerValue;
    const numericDate = normalizedTimestamp(listen?.listenedAt);
    if (Number.isFinite(numericDate)) return numericDate;
    const parsed = Date.parse(String(listen?.listenedAt || ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function durationMs(listen) {
    const value = Number(listen?.listenedDurationMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function validListen(listen) {
    if (!Number.isFinite(listenTimeMs(listen))) return false;
    if (listen?.listenedDurationMs == null) return true;
    return durationMs(listen) > 0;
  }

  function shiftMonths(value, amount) {
    const date = new Date(value);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date;
  }

  function shiftYears(value, amount) {
    const date = new Date(value);
    const year = date.getUTCFullYear() + amount;
    const day = date.getUTCDate();
    date.setUTCFullYear(year, date.getUTCMonth(), 1);
    const last = new Date(Date.UTC(year, date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date;
  }

  function resolveWindow(timeframe = 'threeMonths', now = new Date(), listens = []) {
    const parsed = new Date(now);
    const end = Number.isFinite(parsed.getTime()) ? parsed : new Date();
    const endMs = end.getTime() + 1;
    if (timeframe === 'twoWeeks') {
      const startMs = end.getTime() - 14 * DAY_MS;
      return { timeframe, label: '2 weeks', bucket: 'day', startMs, endMs, previousStartMs: startMs - 14 * DAY_MS, previousEndMs: startMs };
    }
    if (timeframe === 'threeMonths') {
      const start = shiftMonths(end, -3);
      const previous = shiftMonths(start, -3);
      return { timeframe, label: '3 months', bucket: 'week', startMs: start.getTime(), endMs, previousStartMs: previous.getTime(), previousEndMs: start.getTime() };
    }
    if (timeframe === 'oneYear') {
      const start = shiftYears(end, -1);
      const previous = shiftYears(start, -1);
      return { timeframe, label: '1 year', bucket: 'month', startMs: start.getTime(), endMs, previousStartMs: previous.getTime(), previousEndMs: start.getTime() };
    }
    let earliest = Infinity;
    for (const listen of listens || []) {
      if (!validListen(listen)) continue;
      earliest = Math.min(earliest, listenTimeMs(listen));
    }
    return { timeframe: 'allTime', label: 'All time', bucket: 'year', startMs: earliest === Infinity ? end.getTime() : earliest, endMs, previousStartMs: null, previousEndMs: null };
  }

  function inWindow(listen, startMs, endMs) {
    const value = listenTimeMs(listen);
    return validListen(listen) && value >= startMs && value < endMs;
  }

  function range(listens, window, previous = false) {
    const start = previous ? window.previousStartMs : window.startMs;
    const end = previous ? window.previousEndMs : window.endMs;
    if (start == null || end == null) return [];
    return (listens || []).filter((listen) => inWindow(listen, start, end));
  }

  function bandLookup(appBands) {
    return new Map((appBands || []).filter((band) => band?.id).map((band) => [String(band.id), band]));
  }

  function linkedListens(listens, appBands = typeof bands === 'undefined' ? [] : bands) {
    const lookup = bandLookup(appBands);
    return (listens || []).filter((listen) => listen?.localBandId != null && lookup.has(String(listen.localBandId)) && validListen(listen));
  }

  function aggregateBands(listens, appBands, limit = 100) {
    const lookup = bandLookup(appBands);
    const grouped = new Map();
    for (const listen of listens || []) {
      if (!validListen(listen)) continue;
      const id = listen?.localBandId == null ? null : String(listen.localBandId);
      const band = id ? lookup.get(id) : null;
      if (!band) continue;
      const item = grouped.get(id) || { bandId: id, bandName: band.name || listen.artistCreditName || 'Unknown artist', band, durationMs: 0, listenCount: 0, lastListenedMs: 0, lastListenedAt: null };
      item.durationMs += durationMs(listen);
      item.listenCount += 1;
      const timestamp = listenTimeMs(listen);
      if (timestamp > item.lastListenedMs) {
        item.lastListenedMs = timestamp;
        item.lastListenedAt = listen.listenedAt || new Date(timestamp).toISOString();
      }
      grouped.set(id, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || b.lastListenedMs - a.lastListenedMs || normalize(a.bandName).localeCompare(normalize(b.bandName)))
      .slice(0, limit)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function aggregateItems(listens, kind, limit = 10) {
    const grouped = new Map();
    for (const listen of listens || []) {
      if (!validListen(listen)) continue;
      const title = kind === 'album' ? String(listen?.releaseTitle || '').trim().replace(/\s+/g, ' ') : String(listen?.recordingTitle || '').trim();
      if (!title) continue;
      const stable = kind === 'track' && (listen.musicbrainzRecordingId || listen.stableRecordingId || listen.spotifyTrackId);
      const key = stable ? `stable:${stable}` : `${normalize(listen.artistCreditName)}|${normalize(title)}${kind === 'track' ? `|${normalize(listen.releaseTitle)}` : ''}`;
      const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
      const item = grouped.get(key) || { [titleKey]: title, artistCreditName: listen.artistCreditName || 'Unknown artist', localBandId: listen.localBandId || null, durationMs: 0, listenCount: 0, lastListenedMs: 0, artworkPath: null };
      item.durationMs += durationMs(listen);
      item.listenCount += 1;
      item.lastListenedMs = Math.max(item.lastListenedMs, listenTimeMs(listen));
      if (kind === 'track' && !item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      if (kind === 'album' && !item.artworkPath && listen.artworkPath && (listen.spotifyAlbumId || listen.spotifyTrackId || listen.musicbrainzReleaseId || listen.musicbrainzReleaseGroupId || listen.stableReleaseId)) item.artworkPath = listen.artworkPath;
      grouped.set(key, item);
    }
    const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
    return [...grouped.values()]
      .sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || b.lastListenedMs - a.lastListenedMs || normalize(a[titleKey]).localeCompare(normalize(b[titleKey])))
      .slice(0, limit)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function firstLast(listens, latest) {
    let chosen = null;
    let chosenTime = latest ? -Infinity : Infinity;
    for (const listen of listens || []) {
      if (!validListen(listen)) continue;
      const value = listenTimeMs(listen);
      if ((latest && value > chosenTime) || (!latest && value < chosenTime)) {
        chosen = listen;
        chosenTime = value;
      }
    }
    return chosen;
  }

  function timeBuckets(listens, window, kind = window.bucket) {
    const source = range(listens, window);
    if (typeof api.timeBuckets === 'function') {
      // The existing bucket renderer is safe once it receives a correctly
      // resolved window and normalized timestamps on each selected event.
      const normalized = source.map((listen) => ({ ...listen, listenedAtMs: listenTimeMs(listen) }));
      return api.timeBuckets(normalized, window, kind);
    }
    return [];
  }

  function selectedStats(listens, appBands, timeframe = 'threeMonths', now = new Date()) {
    const source = linkedListens(listens, appBands);
    const window = resolveWindow(timeframe, now, source);
    const selected = range(source, window);
    const previous = range(source, window, true);
    const ranked = api.rankMovement(aggregateBands(selected, appBands), aggregateBands(previous, appBands), timeframe);
    const buckets = timeBuckets(source, window, window.bucket);
    const totalDuration = selected.reduce((sum, listen) => sum + durationMs(listen), 0);
    const topAlbums = aggregateItems(selected, 'album', 10);
    return {
      timeframe,
      label: window.label,
      window,
      listens: selected,
      previousListens: previous,
      durationMs: totalDuration,
      listenCount: selected.length,
      unknownDurationCount: selected.filter((listen) => durationMs(listen) === 0).length,
      hasUnknownDuration: selected.some((listen) => durationMs(listen) === 0),
      firstListened: firstLast(selected, false),
      lastListened: firstLast(selected, true),
      distinctMatchedBands: ranked.length,
      topBands: ranked,
      topTracks: aggregateItems(selected, 'track', 10),
      topAlbums,
      buckets,
      mostActive: buckets.length ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || (b.listenCount || 0) - (a.listenCount || 0) || String(a.startAt).localeCompare(String(b.startAt)))[0] : null,
    };
  }

  function emptyGroups() {
    return Object.fromEntries(GROUPS.map((group) => [group, 0]));
  }

  function genreDistributionByYear(listens) {
    const source = linkedListens(listens);
    const years = new Map();
    for (const listen of source) {
      const year = new Date(listenTimeMs(listen)).getUTCFullYear();
      const item = years.get(year) || { durations: emptyGroups(), listenCounts: emptyGroups(), unknownDurationCounts: emptyGroups() };
      const group = api.genreGroup(listen.genre);
      const duration = durationMs(listen);
      item.durations[group] += duration;
      item.listenCounts[group] += 1;
      if (duration === 0) item.unknownDurationCounts[group] += 1;
      years.set(year, item);
    }
    return [...years.entries()].sort(([a], [b]) => a - b).map(([year, item]) => {
      const totalDurationMs = Object.values(item.durations).reduce((sum, value) => sum + value, 0);
      const totalListenCount = Object.values(item.listenCounts).reduce((sum, value) => sum + value, 0);
      const unknownDurationCount = Object.values(item.unknownDurationCounts).reduce((sum, value) => sum + value, 0);
      const percentages = emptyGroups();
      if (totalDurationMs > 0) GROUPS.forEach((group) => { percentages[group] = Math.round(item.durations[group] / totalDurationMs * 1000) / 10; });
      return { year, totalDurationMs, totalListenCount, unknownDurationCount, percentages, ...item };
    });
  }

  function yearlyListening(listens, now = new Date(), genre = 'All') {
    const source = linkedListens(listens);
    if (!source.length) return [];
    let firstYear = Infinity;
    const values = new Map();
    for (const listen of source) {
      const year = new Date(listenTimeMs(listen)).getUTCFullYear();
      firstYear = Math.min(firstYear, year);
      if (genre !== 'All' && api.genreGroup(listen.genre) !== genre) continue;
      const item = values.get(year) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      item.durationMs += durationMs(listen);
      item.listenCount += 1;
      if (durationMs(listen) === 0) item.unknownDurationCount += 1;
      values.set(year, item);
    }
    const parsed = new Date(now);
    const currentYear = (Number.isFinite(parsed.getTime()) ? parsed : new Date()).getUTCFullYear();
    const output = [];
    for (let year = firstYear; year <= currentYear; year += 1) {
      const item = values.get(year) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      output.push({ year, ...item, hours: item.durationMs / 3600000, isCurrentYear: year === currentYear });
    }
    return output;
  }

  Object.assign(api, {
    listenTimeMs,
    isValidListen: validListen,
    validDurationMs: durationMs,
    resolveWindow,
    listensForWindow: (listens, window) => range(listens, window),
    previousListensForWindow: (listens, window) => range(listens, window, true),
    totalDurationMs: (listens) => (listens || []).reduce((sum, listen) => sum + (validListen(listen) ? durationMs(listen) : 0), 0),
    listenCount: (listens) => (listens || []).reduce((sum, listen) => sum + (validListen(listen) ? 1 : 0), 0),
    firstListened: (listens) => firstLast(listens, false),
    lastListened: (listens) => firstLast(listens, true),
    topBands: aggregateBands,
    topTracks: (listens, limit = 10) => aggregateItems(listens, 'track', limit),
    topAlbums: (listens, limit = 10) => aggregateItems(listens, 'album', limit),
    selectedStats,
    genreDistributionByYear,
    yearlyListening,
  });

  const cleanRefreshSvg = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6v5h-5"/><path d="M19.2 11a7.5 7.5 0 1 0 .2 4"/></svg>';
  function correctRefreshIcon() {
    const button = document.querySelector('.start-refresh-btn');
    if (!button || button.dataset.v82Icon === 'true') return;
    button.dataset.v82Icon = 'true';
    button.innerHTML = cleanRefreshSvg;
  }

  const originalStatsHtml = typeof statsListeningHtml === 'function' ? statsListeningHtml : null;
  if (originalStatsHtml) {
    statsListeningHtml = function statsListeningV82Safe() {
      try {
        return originalStatsHtml();
      } catch (error) {
        console.error('Listening Stats render failed safely.', error);
        const stats = selectedStats(listeningEvents, bands, 'threeMonths', listeningNow());
        return `${listeningSummaryHtml(stats)}${topBandsPreviewHtml(stats)}`;
      }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    correctRefreshIcon();
    const header = document.getElementById('app-header');
    if (header) new MutationObserver(correctRefreshIcon).observe(header, { childList: true, subtree: true });
  });
})();
