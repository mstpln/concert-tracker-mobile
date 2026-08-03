'use strict';

// v80's Start renderer is also wrapped by legacy visual-adjustment scripts.
// Keep the v81 rolling two-week card authoritative after any Start rerender,
// then restore the two existing navigation actions on the replaced markup.
(() => {
  function applyTwoWeekStartCard() {
    const card = document.querySelector('.start-top-bands-card');
    if (!card || card.textContent.includes('YOUR TOP BANDS · 2 WEEKS')) return;
    const stats = globalListeningStats('twoWeeks');
    card.outerHTML = `<section class="listening-card start-top-bands-card" aria-labelledby="start-top-bands-title"><div class="listening-card-heading"><p id="start-top-bands-title">YOUR TOP BANDS · 2 WEEKS</p><button type="button" id="start-top-bands-view-all" class="listening-link">View all</button></div><div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 3), { compact: true, timeframe: 'twoWeeks' })}</div>${ListeningStats.hasUnknownDuration(stats.listens) ? '<p class="listening-known-time-note">Listening time is based on listens with known duration.</p>' : ''}<button type="button" id="start-listening-stats" class="listening-card-footer">See your listening stats${icon('chevronRight')}</button></section>`;
    const replacement = document.querySelector('.start-top-bands-card');
    replacement?.querySelector('#start-top-bands-view-all')?.addEventListener('click', () => openTopBandsScreen());
    replacement?.querySelector('#start-listening-stats')?.addEventListener('click', () => openStatsScreen({ subTab: 'listening' }));
    wireListeningBandRows(replacement);
    wireListeningImages(replacement);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const screen = document.getElementById('screen-myconcerts');
    if (!screen) return;
    new MutationObserver(applyTwoWeekStartCard).observe(screen, { childList: true, subtree: true });
    applyTwoWeekStartCard();
  });
})();
