'use strict';

// Focused post-review interaction correction for the independently selectable
// stacked genre chart. Legacy render wrappers can replace the chart after the
// primary click handler, so retain the selected year and restore its detail
// whenever the final chart DOM settles.
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

  function renderGenreYearDetail(year) {
    const card = document.querySelector('#screen-stats .genre-card');
    if (!card || year == null) return;
    const item = ListeningStats.genreDistributionByYear(listeningEvents).find((candidate) => candidate.year === Number(year));
    if (!item) return;

    card.querySelectorAll('[data-v81-genre-year]').forEach((button) => {
      const selected = Number(button.dataset.v81GenreYear) === Number(year);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    if (card.querySelector('.genre-year-detail')) return;
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
      requestAnimationFrame(() => {
        restoreQueued = false;
        renderGenreYearDetail(selectedGenreYear);
      });
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-v81-genre-year]') : null;
    if (!button) return;
    selectedGenreYear = Number(button.dataset.v81GenreYear);
    queueRestore();
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
