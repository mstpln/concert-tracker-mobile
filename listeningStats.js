'use strict';

(function attachListeningStats(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ListeningStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TIMEFRAMES = Object.freeze({
    threeMonths: { key: 'threeMonths', label: '3 months', bucket: 'week' },
    oneYear: { key: 'oneYear', label: '1 year', bucket: 'month' },
    allTime: { key: 'allTime', label: 'All time', bucket: 'year' },
  });
  const GENRE_GROUPS = Object.freeze(['Rock', 'Pop', 'Hip-hop/R&B', 'Electronic', 'Other']);

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function utcMonthShift(value, amount) {
    const date = validDate(value);
    if (!date) return null;
    const target = new Date(date.getTime());
    const day = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + amount);
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target;
  }

  function utcYearShift(value, amount) {
    const date = validDate(value);
    if (!date) return null;
    const targetYear = date.getUTCFullYear() + amount;
    const target = new Date(date.getTime());
    target.setUTCFullYear(targetYear, date.getUTCMonth(), 1);
    const lastDay = new Date(Date.UTC(targetYear, date.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return target;
  }

  function earliestListenMs(listens) {
    const values = (listens || []).map((listen) => listenTimeMs(listen)).filter(Number.isFinite);
    return values.length ? Math.min(...values) : null;
  }

  // Every period is half-open: start is inclusive and end is exclusive.
  // The current-period end is one millisecond after `now`, so an event at
  // exactly the resolved current instant is included consistently.
  function resolveWindow(timeframe = 'threeMonths', now = new Date(), listens = []) {
    const endAt = validDate(now) || new Date();
    const endMs = endAt.getTime() + 1;
    if (timeframe === 'threeMonths') {
      const startAt = utcMonthShift(endAt, -3);
      const previousStartAt = utcMonthShift(startAt, -3);
      return { timeframe, label: TIMEFRAMES.threeMonths.label, bucket: 'week', startMs: startAt.getTime(), endMs, previousStartMs: previousStartAt.getTime(), previousEndMs: startAt.getTime() };
    }
    if (timeframe === 'oneYear') {
      const startAt = utcYearShift(endAt, -1);
      const previousStartAt = utcYearShift(startAt, -1);
      return { timeframe, label: TIMEFRAMES.oneYear.label, bucket: 'month', startMs: startAt.getTime(), endMs, previousStartMs: previousStartAt.getTime(), previousEndMs: startAt.getTime() };
    }
    const earliest = earliestListenMs(listens);
    return { timeframe: 'allTime', label: TIMEFRAMES.allTime.label, bucket: 'year', startMs: earliest ?? endAt.getTime(), endMs, previousStartMs: null, previousEndMs: null };
  }

  function listenTimeMs(listen) {
    if (Number.isFinite(Number(listen?.listenedAtMs))) return Number(listen.listenedAtMs);
    return validDate(listen?.listenedAt)?.getTime() ?? NaN;
  }

  function validDurationMs(listen) {
    const duration = Number(listen?.listenedDurationMs);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function inRange(listen, startMs, endMs) {
    const time = listenTimeMs(listen);
    return Number.isFinite(time) && time >= startMs && time < endMs && validDurationMs(listen) > 0;
  }

  function listensForWindow(listens, window) {
    return (listens || []).filter((listen) => inRange(listen, window.startMs, window.endMs));
  }

  function previousListensForWindow(listens, window) {
    if (window.previousStartMs === null) return [];
    return (listens || []).filter((listen) => inRange(listen, window.previousStartMs, window.previousEndMs));
  }

  function totalDurationMs(listens) {
    return (listens || []).reduce((total, listen) => total + validDurationMs(listen), 0);
  }

  function listenCount(listens) {
    return (listens || []).reduce((count, listen) => count + (validDurationMs(listen) > 0 && Number.isFinite(listenTimeMs(listen)) ? 1 : 0), 0);
  }

  function lastListened(listens) {
    return (listens || []).reduce((latest, listen) => {
      const time = listenTimeMs(listen);
      return Number.isFinite(time) && validDurationMs(listen) > 0 && (!latest || time > listenTimeMs(latest)) ? listen : latest;
    }, null);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function localBandLookup(bands) {
    return new Map((bands || []).filter((band) => band?.id).map((band) => [String(band.id), band]));
  }

  function topBands(listens, bands = [], limit = 100) {
    const lookup = localBandLookup(bands);
    const grouped = new Map();
    for (const listen of listens || []) {
      const id = listen?.localBandId == null ? null : String(listen.localBandId);
      const band = id ? lookup.get(id) : null;
      if (!band || validDurationMs(listen) <= 0) continue;
      const item = grouped.get(id) || { bandId: id, bandName: band.name || listen.artistCreditName || 'Unknown artist', band, durationMs: 0, listenCount: 0, lastListenedAt: null };
      item.durationMs += validDurationMs(listen);
      item.listenCount += 1;
      if (!item.lastListenedAt || listenTimeMs(listen) > new Date(item.lastListenedAt).getTime()) item.lastListenedAt = listen.listenedAt;
      grouped.set(id, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || normalizeText(a.bandName).localeCompare(normalizeText(b.bandName)))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function recordingKey(listen) {
    if (listen?.musicbrainzRecordingId) return `mbid:${listen.musicbrainzRecordingId}`;
    if (listen?.stableRecordingId) return `recording:${listen.stableRecordingId}`;
    return `fallback:${normalizeText(listen?.artistCreditName)}|${normalizeText(listen?.recordingTitle)}|${normalizeText(listen?.releaseTitle)}`;
  }

  function topTracks(listens, limit = 10) {
    const grouped = new Map();
    for (const listen of listens || []) {
      if (validDurationMs(listen) <= 0 || !listen?.recordingTitle) continue;
      const key = recordingKey(listen);
      const item = grouped.get(key) || {
        recordingKey: key,
        recordingTitle: listen.recordingTitle,
        artistCreditName: listen.artistCreditName || 'Unknown artist',
        releaseTitle: listen.releaseTitle || null,
        localBandId: listen.localBandId || null,
        artworkPath: listen.artworkPath || null,
        durationMs: 0,
        listenCount: 0,
      };
      item.durationMs += validDurationMs(listen);
      item.listenCount += 1;
      if (!item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      grouped.set(key, item);
    }
    return [...grouped.values()]
      .sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || normalizeText(a.recordingTitle).localeCompare(normalizeText(b.recordingTitle)))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function rankMovement(current, previous, timeframe = 'threeMonths') {
    const previousRanks = new Map((previous || []).map((item, index) => [item.bandId, item.rank || index + 1]));
    return (current || []).map((item, index) => {
      if (timeframe === 'allTime') return { ...item, movement: null };
      const rank = item.rank || index + 1;
      const previousRank = previousRanks.get(item.bandId);
      if (!previousRank) return { ...item, movement: { kind: 'new', delta: null, label: 'New' } };
      const delta = previousRank - rank;
      if (delta > 0) return { ...item, movement: { kind: 'up', delta, label: `Up ${delta}` } };
      if (delta < 0) return { ...item, movement: { kind: 'down', delta: Math.abs(delta), label: `Down ${Math.abs(delta)}` } };
      return { ...item, movement: null };
    });
  }

  function startOfUtcWeek(value) {
    const date = validDate(value);
    if (!date) return null;
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const mondayOffset = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
    return start;
  }

  function bucketStart(value, kind) {
    const date = validDate(value);
    if (!date) return null;
    if (kind === 'week') return startOfUtcWeek(date);
    if (kind === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  }

  function nextBucket(value, kind) {
    const next = new Date(value.getTime());
    if (kind === 'week') next.setUTCDate(next.getUTCDate() + 7);
    else if (kind === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }

  function bucketLabel(value, kind) {
    if (kind === 'week') {
      const end = new Date(value.getTime() + 6 * DAY_MS);
      const format = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return `${format.format(value)} - ${format.format(end)}`;
    }
    if (kind === 'month') return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
    return String(value.getUTCFullYear());
  }

  function timeBuckets(listens, window, kind = window.bucket) {
    const start = bucketStart(new Date(window.startMs), kind);
    const end = bucketStart(new Date(window.endMs - 1), kind);
    if (!start || !end) return [];
    const values = new Map();
    for (const listen of listensForWindow(listens, window)) {
      const bucket = bucketStart(new Date(listenTimeMs(listen)), kind);
      const key = bucket.toISOString();
      values.set(key, (values.get(key) || 0) + validDurationMs(listen));
    }
    const output = [];
    for (let cursor = start; cursor <= end; cursor = nextBucket(cursor, kind)) {
      const key = cursor.toISOString();
      output.push({ startAt: key, label: bucketLabel(cursor, kind), durationMs: values.get(key) || 0, hours: (values.get(key) || 0) / 3600000 });
    }
    return output;
  }

  function genreGroup(value) {
    const genre = normalizeText(value);
    if (/rock|metal|punk|grunge/.test(genre)) return 'Rock';
    if (/pop/.test(genre)) return 'Pop';
    if (/hip.?hop|rap|r&b|rhythm and blues/.test(genre)) return 'Hip-hop/R&B';
    if (/electronic|dance|house|techno|ambient|synth/.test(genre)) return 'Electronic';
    return 'Other';
  }

  function genreDistributionByYear(listens) {
    const years = new Map();
    for (const listen of listens || []) {
      const time = listenTimeMs(listen);
      const duration = validDurationMs(listen);
      if (!Number.isFinite(time) || duration <= 0) continue;
      const year = new Date(time).getUTCFullYear();
      const groups = years.get(year) || Object.fromEntries(GENRE_GROUPS.map((group) => [group, 0]));
      groups[genreGroup(listen.genre)] += duration;
      years.set(year, groups);
    }
    return [...years.entries()].sort(([a], [b]) => a - b).map(([year, groups]) => {
      const total = Object.values(groups).reduce((sum, value) => sum + value, 0);
      const percentages = {};
      let assigned = 0;
      GENRE_GROUPS.forEach((group, index) => {
        const value = index === GENRE_GROUPS.length - 1 ? 100 - assigned : Math.round((groups[group] / total) * 1000) / 10;
        percentages[group] = value;
        assigned += value;
      });
      return { year, totalDurationMs: total, percentages };
    });
  }

  function dominantGenre(distribution) {
    const totals = Object.fromEntries(GENRE_GROUPS.map((group) => [group, 0]));
    for (const year of distribution || []) for (const group of GENRE_GROUPS) totals[group] += (year.totalDurationMs || 0) * ((year.percentages?.[group] || 0) / 100);
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
    if (!total) return null;
    const [group, durationMs] = Object.entries(totals).sort((a, b) => b[1] - a[1] || GENRE_GROUPS.indexOf(a[0]) - GENRE_GROUPS.indexOf(b[0]))[0];
    return { group, percentage: Math.round((durationMs / total) * 100) };
  }

  function formatDuration(durationMs) {
    const safe = Math.max(0, Number(durationMs) || 0);
    const totalMinutes = Math.round(safe / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours) return `${hours.toLocaleString('en')} h ${minutes.toString().padStart(2, '0')} min`;
    return `${minutes.toLocaleString('en')} min`;
  }

  function selectedStats(listens, bands, timeframe = 'threeMonths', now = new Date()) {
    const window = resolveWindow(timeframe, now, listens);
    const selected = listensForWindow(listens, window);
    const previous = previousListensForWindow(listens, window);
    const ranked = rankMovement(topBands(selected, bands), topBands(previous, bands), timeframe);
    const buckets = timeBuckets(listens, window, window.bucket);
    return {
      timeframe,
      label: window.label,
      window,
      listens: selected,
      previousListens: previous,
      durationMs: totalDurationMs(selected),
      listenCount: listenCount(selected),
      lastListened: lastListened(selected),
      distinctMatchedBands: ranked.length,
      topBands: ranked,
      topTracks: topTracks(selected),
      buckets,
      mostActive: buckets.length ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || a.startAt.localeCompare(b.startAt))[0] : null,
    };
  }

  return {
    DAY_MS,
    TIMEFRAMES,
    GENRE_GROUPS,
    resolveWindow,
    listensForWindow,
    previousListensForWindow,
    validDurationMs,
    totalDurationMs,
    listenCount,
    lastListened,
    topBands,
    topTracks,
    rankMovement,
    timeBuckets,
    genreGroup,
    genreDistributionByYear,
    dominantGenre,
    formatDuration,
    selectedStats,
  };
});
