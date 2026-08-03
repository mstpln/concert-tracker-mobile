'use strict';

// Keep v82 genre charts grounded in stored LiveVault band genres rather than
// optional source-event metadata. This loads after the main v82 correction.
(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  if (!api) return;
  const groups = api.GENRE_GROUPS;
  const empty = () => Object.fromEntries(groups.map((group) => [group, 0]));

  function lookup() {
    return new Map((typeof bands === 'undefined' ? [] : bands).filter((band) => band?.id).map((band) => [String(band.id), band]));
  }

  function genreValue(band) {
    if (Array.isArray(band?.genres)) return band.genres.join(', ');
    if (Array.isArray(band?.genre)) return band.genre.join(', ');
    return band?.genres || band?.genre || '';
  }

  function linked() {
    const byId = lookup();
    const source = (typeof listeningEvents === 'undefined' ? [] : listeningEvents)
      .filter((listen) => listen?.localBandId != null && byId.has(String(listen.localBandId)) && api.isValidListen(listen));
    return { byId, source };
  }

  api.genreDistributionByYear = function genreDistributionByYearV82(listens) {
    const byId = lookup();
    const years = new Map();
    for (const listen of listens || []) {
      const band = listen?.localBandId == null ? null : byId.get(String(listen.localBandId));
      if (!band || !api.isValidListen(listen)) continue;
      const year = new Date(api.listenTimeMs(listen)).getUTCFullYear();
      const item = years.get(year) || { durations: empty(), listenCounts: empty(), unknownDurationCounts: empty() };
      const group = api.genreGroup(genreValue(band));
      const duration = api.validDurationMs(listen);
      item.durations[group] += duration;
      item.listenCounts[group] += 1;
      if (duration === 0) item.unknownDurationCounts[group] += 1;
      years.set(year, item);
    }
    return [...years.entries()].sort(([a], [b]) => a - b).map(([year, item]) => {
      const totalDurationMs = Object.values(item.durations).reduce((sum, value) => sum + value, 0);
      const totalListenCount = Object.values(item.listenCounts).reduce((sum, value) => sum + value, 0);
      const unknownDurationCount = Object.values(item.unknownDurationCounts).reduce((sum, value) => sum + value, 0);
      const percentages = empty();
      if (totalDurationMs > 0) groups.forEach((group) => { percentages[group] = Math.round(item.durations[group] / totalDurationMs * 1000) / 10; });
      return { year, totalDurationMs, totalListenCount, unknownDurationCount, percentages, ...item };
    });
  };

  api.yearlyListening = function yearlyListeningV82(listens, now = new Date(), selectedGenre = 'All') {
    const byId = lookup();
    const source = (listens || []).filter((listen) => listen?.localBandId != null && byId.has(String(listen.localBandId)) && api.isValidListen(listen));
    if (!source.length) return [];
    let firstYear = Infinity;
    const values = new Map();
    for (const listen of source) {
      const year = new Date(api.listenTimeMs(listen)).getUTCFullYear();
      firstYear = Math.min(firstYear, year);
      const band = byId.get(String(listen.localBandId));
      if (selectedGenre !== 'All' && api.genreGroup(genreValue(band)) !== selectedGenre) continue;
      const item = values.get(year) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      const duration = api.validDurationMs(listen);
      item.durationMs += duration;
      item.listenCount += 1;
      if (duration === 0) item.unknownDurationCount += 1;
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
  };
})();
