'use strict';

// Focused post-review interaction correction for the independently selectable
// stacked genre chart. The primary v81 renderer redraws the chart on click;
// capture the selected year before that redraw, then restore its detail.
(() => {
  const KNOWN_NOTE = 'Listening time is based on listens with known duration.';

  function countText(value) {
    const count = Number(value || 0);
    return `${count.toLocaleString()} listen${count === 1 ? '' : 's'}`;
  }

  function yearTitle(year) {
    return Number(year) === listeningNow().getUTCFullYear() ? `${year} · Year to date` : String(year);
  }

  function renderGenreYearDetail(year) {
    const card = document.querySelector('#screen-stats .genre-card');
    if (!card) return;
    const item = ListeningStats.genreDistributionByYear(listeningEvents).find((candidate) => candidate.year === Number(year));
    if (!item) return;

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

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-v81-genre-year]') : null;
    if (!button) return;
    const year = Number(button.dataset.v81GenreYear);
    setTimeout(() => renderGenreYearDetail(year), 0);
  }, true);
})();
