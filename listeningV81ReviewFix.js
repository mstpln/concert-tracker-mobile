'use strict';

// Focused post-review interaction correction for the independently selectable
// stacked genre chart. The legacy genre aggregate does not expose per-group
// listen counts, so derive the selected-year detail from valid source events
// and keep that selection independent across subsequent Stats redraws.
(() => {
  const KNOWN_NOTE = 'Listening time is based on listens with known duration.';
  let selectedGenreYear = null;
  let restoreQueued = false;

  function countText(value) {
    const count = Number(value || 0);
    return `${count.toLocaleString()} listen${count === 1 ? '' : 's'}`;
  }

  function yearTitle(year) {
    return Number(year) === listeningNow().getUTCFullYear() ? `${year} · Year to date` : String(year);
  }

  function selectedYearData(year) {
    const durations = Object.fromEntries(ListeningStats.GENRE_GROUPS.map((group) => [group, 0]));
    const listenCounts = Object.fromEntries(ListeningStats.GENRE_GROUPS.map((group) => [group, 0]));
    let unknownDurationCount = 0;
    for (const listen of listeningEvents) {
      if (!ListeningStats.isValidListen(listen)) continue;
      const listenedYear = new Date(ListeningStats.listenTimeMs(listen)).getUTCFullYear();
      if (listenedYear !== Number(year)) continue;
      const group = ListeningStats.genreGroup(listen.genre);
      const duration = ListeningStats.validDurationMs(listen);
      durations[group] += duration;
      listenCounts[group] += 1;
      if (duration === 0) unknownDurationCount += 1;
    }
    return {
      year: Number(year),
      durations,
      listenCounts,
      totalDurationMs: Object.values(durations).reduce((sum, value) => sum + value, 0),
      totalListenCount: Object.values(listenCounts).reduce((sum, value) => sum + value, 0),
      unknownDurationCount,
    };
  }

  function renderGenreYearDetail(year) {
    const card = document.querySelector('#screen-stats .genre-card');
    if (!card || year == null) return;
    const item = selectedYearData(year);

    card.querySelectorAll('[data-v81-genre-year]').forEach((button) => {
      const selected = Number(button.dataset.v81GenreYear) === Number(year);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    card.querySelector('.genre-year-detail')?.remove();
    const detail = document.createElement('div');
    detail.className = 'genre-year-detail';
    detail.setAttribute('aria-live', 'polite');
    detail.innerHTML = `<strong>${yearTitle(item.year)}</strong><div><b>Total</b><span>${ListeningStats.formatDuration(item.totalDurationMs)} · ${countText(item.totalListenCount)}</span></div>${ListeningStats.GENRE_GROUPS.map((group) => `<div><b>${escapeHtml(group)}</b><span>${ListeningStats.formatDuration(item.durations[group])} · ${countText(item.listenCounts[group])}</span></div>`).join('')}${item.unknownDurationCount ? `<small>${KNOWN_NOTE}</small>` : ''}`;
    const note = card.querySelector('.listening-card-note');
    if (note) card.insertBefore(detail, note);
    else card.append(detail);
  }

  function queueRestore() {
    if (restoreQueued || selectedGenreYear == null) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      renderGenreYearDetail(selectedGenreYear);
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-v81-genre-year]') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectedGenreYear = Number(button.dataset.v81GenreYear);
    renderGenreYearDetail(selectedGenreYear);
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-v81-genre-range]')) selectedGenreYear = null;
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const screen = document.getElementById('screen-stats');
    if (!screen) return;
    new MutationObserver(() => {
      if (selectedGenreYear != null && !screen.querySelector('.genre-year-detail')) queueRestore();
    }).observe(screen, { childList: true, subtree: true });
  });
})();
