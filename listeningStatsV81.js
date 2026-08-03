'use strict';

// v81 extends the existing pure calculation API without changing stored records.
(function applyListeningStatsV81(api) {
  if (!api) throw new Error('ListeningStats must load before listeningStatsV81.js');
  const DAY_MS = api.DAY_MS || 86400000;
  const GROUPS = api.GENRE_GROUPS;
  const norm = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const time = (listen) => Number.isFinite(Number(listen?.listenedAtMs)) ? Number(listen.listenedAtMs) : new Date(listen?.listenedAt).getTime();
  const duration = (listen) => { const value = Number(listen?.listenedDurationMs); return Number.isFinite(value) && value > 0 ? value : 0; };
  const valid = (listen) => {
    if (!Number.isFinite(time(listen))) return false;
    const raw = listen?.listenedDurationMs;
    if (raw == null) return true;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0;
  };
  const unknown = (listen) => valid(listen) && duration(listen) === 0;
  const inRange = (listen, start, end) => valid(listen) && time(listen) >= start && time(listen) < end;
  const monthShift = (value, amount) => { const date = new Date(value); const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); return date; };
  const yearShift = (value, amount) => { const date = new Date(value); const year = date.getUTCFullYear() + amount; const day = date.getUTCDate(); date.setUTCFullYear(year, date.getUTCMonth(), 1); const last = new Date(Date.UTC(year, date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(day, last)); return date; };

  function resolveWindow(key = 'threeMonths', now = new Date(), listens = []) {
    const end = Number.isFinite(new Date(now).getTime()) ? new Date(now) : new Date();
    const endMs = end.getTime() + 1;
    if (key === 'twoWeeks') { const startMs = end.getTime() - 14 * DAY_MS; return { timeframe: key, label: '2 weeks', bucket: 'day', startMs, endMs, previousStartMs: startMs - 14 * DAY_MS, previousEndMs: startMs }; }
    if (key === 'threeMonths') { const start = monthShift(end, -3); const previous = monthShift(start, -3); return { timeframe: key, label: '3 months', bucket: 'week', startMs: start.getTime(), endMs, previousStartMs: previous.getTime(), previousEndMs: start.getTime() }; }
    if (key === 'oneYear') { const start = yearShift(end, -1); const previous = yearShift(start, -1); return { timeframe: key, label: '1 year', bucket: 'month', startMs: start.getTime(), endMs, previousStartMs: previous.getTime(), previousEndMs: start.getTime() }; }
    const times = (listens || []).filter(valid).map(time);
    return { timeframe: 'allTime', label: 'All time', bucket: 'year', startMs: times.length ? Math.min(...times) : end.getTime(), endMs, previousStartMs: null, previousEndMs: null };
  }

  const range = (listens, window, previous = false) => {
    const start = previous ? window.previousStartMs : window.startMs;
    const end = previous ? window.previousEndMs : window.endMs;
    return start == null ? [] : (listens || []).filter((listen) => inRange(listen, start, end));
  };
  const totalDurationMs = (listens) => (listens || []).reduce((sum, listen) => sum + (valid(listen) ? duration(listen) : 0), 0);
  const listenCount = (listens) => (listens || []).reduce((sum, listen) => sum + (valid(listen) ? 1 : 0), 0);
  const firstLast = (listens, direction) => (listens || []).reduce((chosen, listen) => valid(listen) && (!chosen || direction * time(listen) > direction * time(chosen)) ? listen : chosen, null);
  const rankedSort = (title) => (a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || b.lastListenedMs - a.lastListenedMs || norm(a[title]).localeCompare(norm(b[title]));

  function topBands(listens, bands = [], limit = 100) {
    const lookup = new Map((bands || []).filter((band) => band?.id).map((band) => [String(band.id), band]));
    const grouped = new Map();
    for (const listen of listens || []) {
      if (!valid(listen)) continue;
      const id = listen?.localBandId == null ? null : String(listen.localBandId);
      const band = id ? lookup.get(id) : null;
      if (!band) continue;
      const item = grouped.get(id) || { bandId: id, bandName: band.name || listen.artistCreditName || 'Unknown artist', band, durationMs: 0, listenCount: 0, lastListenedMs: 0, lastListenedAt: null };
      item.durationMs += duration(listen); item.listenCount += 1;
      if (time(listen) > item.lastListenedMs) { item.lastListenedMs = time(listen); item.lastListenedAt = listen.listenedAt || new Date(time(listen)).toISOString(); }
      grouped.set(id, item);
    }
    return [...grouped.values()].sort(rankedSort('bandName')).slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function aggregate(listens, kind, limit = 10) {
    const grouped = new Map();
    for (const listen of listens || []) {
      if (!valid(listen)) continue;
      const title = kind === 'album' ? String(listen?.releaseTitle || '').trim().replace(/\s+/g, ' ') : String(listen?.recordingTitle || '').trim();
      if (!title) continue;
      const stable = kind === 'track' && (listen.musicbrainzRecordingId || listen.stableRecordingId);
      const key = stable ? `stable:${stable}` : `${norm(listen.artistCreditName)}|${norm(title)}${kind === 'track' ? `|${norm(listen.releaseTitle)}` : ''}`;
      const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
      const item = grouped.get(key) || { [titleKey]: title, artistCreditName: listen.artistCreditName || 'Unknown artist', localBandId: listen.localBandId || null, durationMs: 0, listenCount: 0, lastListenedMs: 0, artworkPath: null };
      item.durationMs += duration(listen); item.listenCount += 1; item.lastListenedMs = Math.max(item.lastListenedMs, time(listen));
      if (kind === 'track' && !item.artworkPath && listen.artworkPath) item.artworkPath = listen.artworkPath;
      if (kind === 'album' && !item.artworkPath && listen.artworkPath && (listen.spotifyAlbumId || listen.spotifyTrackId || listen.musicbrainzReleaseId || listen.musicbrainzReleaseGroupId || listen.stableReleaseId)) item.artworkPath = listen.artworkPath;
      grouped.set(key, item);
    }
    const titleKey = kind === 'album' ? 'releaseTitle' : 'recordingTitle';
    return [...grouped.values()].sort(rankedSort(titleKey)).slice(0, limit).map((item, index) => ({ ...item, rank: index + 1 }));
  }

  const dayStart = (value) => { const date = new Date(value); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
  const bucketStart = (value, kind) => { const date = dayStart(value); if (kind === 'day') return date; if (kind === 'week') { date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date; } if (kind === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); return new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); };
  const nextBucket = (date, kind) => { const next = new Date(date); if (kind === 'day') next.setUTCDate(next.getUTCDate() + 1); else if (kind === 'week') next.setUTCDate(next.getUTCDate() + 7); else if (kind === 'month') next.setUTCMonth(next.getUTCMonth() + 1); else next.setUTCFullYear(next.getUTCFullYear() + 1); return next; };
  const bucketLabel = (date, kind) => { const short = (value) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value); if (kind === 'day') return short(date); if (kind === 'week') return `${short(date)} - ${short(new Date(date.getTime() + 6 * DAY_MS))}`; if (kind === 'month') return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date); return String(date.getUTCFullYear()); };
  function timeBuckets(listens, window, kind = window.bucket) {
    const start = bucketStart(window.startMs, kind); const end = bucketStart(window.endMs - 1, kind); const values = new Map();
    for (const listen of range(listens, window)) { const key = bucketStart(time(listen), kind).toISOString(); const item = values.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 }; item.durationMs += duration(listen); item.listenCount += 1; if (unknown(listen)) item.unknownDurationCount += 1; values.set(key, item); }
    const output = []; for (let cursor = start; cursor <= end; cursor = nextBucket(cursor, kind)) { const key = cursor.toISOString(); const item = values.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 }; output.push({ startAt: key, label: bucketLabel(cursor, kind), ...item, hours: item.durationMs / 3600000 }); } return output;
  }

  const emptyGroups = () => Object.fromEntries(GROUPS.map((group) => [group, 0]));
  function genreDistributionByYear(listens) {
    const years = new Map();
    for (const listen of listens || []) { if (!valid(listen)) continue; const year = new Date(time(listen)).getUTCFullYear(); const item = years.get(year) || { durations: emptyGroups(), listenCounts: emptyGroups(), unknownDurationCounts: emptyGroups() }; const group = api.genreGroup(listen.genre); item.durations[group] += duration(listen); item.listenCounts[group] += 1; if (unknown(listen)) item.unknownDurationCounts[group] += 1; years.set(year, item); }
    return [...years.entries()].sort(([a], [b]) => a - b).map(([year, item]) => { const totalDurationMs = Object.values(item.durations).reduce((a, b) => a + b, 0); const totalListenCount = Object.values(item.listenCounts).reduce((a, b) => a + b, 0); const unknownDurationCount = Object.values(item.unknownDurationCounts).reduce((a, b) => a + b, 0); const percentages = emptyGroups(); if (totalDurationMs) GROUPS.forEach((group) => { percentages[group] = Math.round(item.durations[group] / totalDurationMs * 1000) / 10; }); return { year, totalDurationMs, totalListenCount, unknownDurationCount, percentages, ...item }; });
  }
  function yearlyListening(listens, now = new Date(), genre = 'All') {
    const source = (listens || []).filter(valid); if (!source.length) return [];
    const currentYear = new Date(now).getUTCFullYear(); const firstYear = Math.min(...source.map((listen) => new Date(time(listen)).getUTCFullYear())); const values = new Map();
    for (const listen of source) { if (genre !== 'All' && api.genreGroup(listen.genre) !== genre) continue; const year = new Date(time(listen)).getUTCFullYear(); const item = values.get(year) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 }; item.durationMs += duration(listen); item.listenCount += 1; if (unknown(listen)) item.unknownDurationCount += 1; values.set(year, item); }
    const output = []; for (let year = firstYear; year <= currentYear; year += 1) { const item = values.get(year) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 }; output.push({ year, ...item, hours: item.durationMs / 3600000, isCurrentYear: year === currentYear }); } return output;
  }
  function selectedStats(listens, bands, timeframe = 'threeMonths', now = new Date()) {
    const window = resolveWindow(timeframe, now, listens); const selected = range(listens, window); const previous = range(listens, window, true); const top = api.rankMovement(topBands(selected, bands), topBands(previous, bands), timeframe); const buckets = timeBuckets(listens, window);
    return { timeframe, label: window.label, window, listens: selected, previousListens: previous, durationMs: totalDurationMs(selected), listenCount: listenCount(selected), unknownDurationCount: selected.filter(unknown).length, hasUnknownDuration: selected.some(unknown), firstListened: firstLast(selected, -1), lastListened: firstLast(selected, 1), distinctMatchedBands: top.length, topBands: top, topTracks: aggregate(selected, 'track'), topAlbums: aggregate(selected, 'album'), buckets, mostActive: buckets.length ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || a.startAt.localeCompare(b.startAt))[0] : null };
  }

  Object.assign(api, {
    TIMEFRAMES: Object.freeze({ twoWeeks: { key: 'twoWeeks', label: '2 weeks', bucket: 'day' }, ...api.TIMEFRAMES }),
    listenTimeMs: time, isValidListen: valid, validDurationMs: duration, hasKnownDuration: (listen) => duration(listen) > 0,
    hasUnknownDuration: (listens) => (listens || []).some(unknown), resolveWindow,
    listensForWindow: (listens, window) => range(listens, window), previousListensForWindow: (listens, window) => range(listens, window, true),
    totalDurationMs, listenCount, firstListened: (listens) => firstLast(listens, -1), lastListened: (listens) => firstLast(listens, 1),
    normalizeText: norm, topBands, topTracks: (listens, limit = 10) => aggregate(listens, 'track', limit), topAlbums: (listens, limit = 10) => aggregate(listens, 'album', limit),
    timeBuckets, genreDistributionByYear, yearlyListening, selectedStats,
  });
})(typeof ListeningStats === 'undefined' ? null : ListeningStats);
