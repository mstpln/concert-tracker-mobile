'use strict';

// Focused corrections for the same unreleased AUB1/v153 build. These keep the
// activity summary aligned with the existing linked-listen contract and make
// My Bands search state clear whenever the user actually leaves that screen.
(function attachAppUpdateAub1V153Corrections(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppUpdateAub1V153Corrections = api;
  if (root?.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  let statsObserver = null;
  let myBandsObserver = null;
  let pending = false;

  function getBands() {
    try { if (typeof bands !== 'undefined') return bands; } catch (_) {}
    return root.bands || [];
  }

  function getListeningEvents() {
    try { if (typeof listeningEvents !== 'undefined') return listeningEvents; } catch (_) {}
    return root.listeningEvents || [];
  }

  function getStatsApi() {
    try { if (typeof ListeningStats !== 'undefined') return ListeningStats; } catch (_) {}
    return root.ListeningStats || null;
  }

  function listeningNowValue() {
    try { if (typeof listeningNow === 'function') return listeningNow(); } catch (_) {}
    return new Date();
  }

  function linkedValidListens(listens, bandList = getBands(), statsApi = getStatsApi()) {
    if (!statsApi) return [];
    const bandIds = new Set((bandList || []).filter((band) => band?.id != null).map((band) => String(band.id)));
    return (listens || []).filter((listen) => {
      if (listen?.localBandId == null || !bandIds.has(String(listen.localBandId))) return false;
      return statsApi.isValidListen?.(listen) === true && Number.isFinite(Number(statsApi.listenTimeMs?.(listen)));
    });
  }

  function activityMetrics(listens, statsApi = getStatsApi()) {
    if (!statsApi) return { activeDays: 0, durationMs: 0, dailyAverageMs: 0 };
    const activeDates = new Set();
    let durationMs = 0;
    for (const listen of listens || []) {
      const timestamp = Number(statsApi.listenTimeMs?.(listen));
      if (!statsApi.isValidListen?.(listen) || !Number.isFinite(timestamp)) continue;
      const date = new Date(timestamp);
      if (!Number.isFinite(date.getTime())) continue;
      activeDates.add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
      const duration = Number(statsApi.validDurationMs?.(listen));
      if (Number.isFinite(duration) && duration > 0) durationMs += duration;
    }
    return {
      activeDays: activeDates.size,
      durationMs,
      dailyAverageMs: activeDates.size ? durationMs / activeDates.size : 0,
    };
  }

  function completedYearActivity(listens, now = listeningNowValue(), bandList = getBands(), statsApi = getStatsApi()) {
    const linked = linkedValidListens(listens, bandList, statsApi);
    const currentYear = new Date(now).getUTCFullYear();
    const yearsWithListens = linked.map((listen) => new Date(Number(statsApi.listenTimeMs(listen))).getUTCFullYear()).filter(Number.isFinite);
    const firstYear = yearsWithListens.length ? Math.min(...yearsWithListens) : null;
    const completedYears = [];

    // The yearly chart already represents calendar years continuously from the
    // first valid linked listen. The annual active-days average therefore uses
    // that same represented calendar-year span and excludes only the current
    // incomplete year. A completed year with zero listens contributes zero.
    if (firstYear != null && firstYear < currentYear) {
      for (let year = firstYear; year < currentYear; year += 1) {
        const yearListens = linked.filter((listen) => new Date(Number(statsApi.listenTimeMs(listen))).getUTCFullYear() === year);
        completedYears.push({ year, ...activityMetrics(yearListens, statsApi) });
      }
    }

    return {
      completedYears,
      activeDaysPerYear: completedYears.length
        ? completedYears.reduce((sum, item) => sum + item.activeDays, 0) / completedYears.length
        : 0,
      allTime: activityMetrics(linked, statsApi),
    };
  }

  function applyAllTimeActivity(doc = root.document) {
    const summary = doc?.querySelector('#screen-stats .aub1-alltime-activity');
    const statsApi = getStatsApi();
    if (!summary || !statsApi) return false;
    const metrics = summary.querySelectorAll('.aub1-activity-metric strong');
    if (metrics.length < 2) return false;
    const result = completedYearActivity(getListeningEvents(), listeningNowValue(), getBands(), statsApi);
    const annualText = result.completedYears.length ? Math.round(result.activeDaysPerYear).toLocaleString() : '—';
    const dailyText = statsApi.formatDuration?.(result.allTime.dailyAverageMs) || '0 min';
    if (metrics[0].textContent !== annualText) metrics[0].textContent = annualText;
    if (metrics[1].textContent !== dailyText) metrics[1].textContent = dailyText;
    summary.dataset.aub1CompletedYears = String(result.completedYears.length);
    return true;
  }

  function clearMyBandsSearch(doc = root.document) {
    const input = doc?.querySelector('#screen-mybands .aub1-band-search input');
    if (!input || !input.value) return false;
    input.value = '';
    input.dispatchEvent(new root.Event('input', { bubbles: true }));
    return true;
  }

  function installMyBandsLeaveObserver(doc = root.document) {
    if (myBandsObserver || !doc || typeof root.MutationObserver !== 'function') return false;
    const screen = doc.querySelector('#screen-mybands');
    if (!screen) return false;
    myBandsObserver = new root.MutationObserver(() => {
      if (screen.classList.contains('hidden')) clearMyBandsSearch(doc);
    });
    myBandsObserver.observe(screen, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  function scheduleApply(doc = root.document) {
    if (pending) return;
    pending = true;
    const raf = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
    raf(() => {
      pending = false;
      applyAllTimeActivity(doc);
    });
  }

  function installStatsObserver(doc = root.document) {
    if (statsObserver || !doc || typeof root.MutationObserver !== 'function') return false;
    const screen = doc.querySelector('#screen-stats');
    if (!screen) return false;
    statsObserver = new root.MutationObserver(() => scheduleApply(doc));
    statsObserver.observe(screen, { childList: true, subtree: true });
    return true;
  }

  function install() {
    const doc = root.document;
    if (!doc) return false;
    installStatsObserver(doc);
    installMyBandsLeaveObserver(doc);
    scheduleApply(doc);
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', () => {
        installStatsObserver(doc);
        installMyBandsLeaveObserver(doc);
        scheduleApply(doc);
      }, { once: true });
    }
    return true;
  }

  return Object.freeze({
    linkedValidListens,
    activityMetrics,
    completedYearActivity,
    applyAllTimeActivity,
    clearMyBandsSearch,
    install,
  });
});
