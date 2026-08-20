'use strict';

// v149 is presentation-only. It keeps the existing listening/concert data,
// navigation targets and ranking calculations intact while applying the
// approved Start-card structure, shared ranking-arrow shape and contextual
// Stats header treatment.
(() => {
  const TWO_WEEKS = 'twoWeeks';

  function movementArrowSvgV149() {
    return '<svg class="rank-movement-arrow-v149" viewBox="0 0 34 34" aria-hidden="true" focusable="false"><path d="M16.2 1.8 Q17 1 17.8 1.8 L30.2 13.1 Q31.2 14.1 30.1 15.2 Q29.7 15.6 29.1 15.6 H23.6 V33 H10.4 V15.6 H4.9 Q4.3 15.6 3.9 15.2 Q2.8 14.1 3.8 13.1 Z"/></svg>';
  }

  function movementHtmlV149(movement) {
    if (!movement) return '';
    if (movement.kind === 'new') return '<span class="rank-movement is-new" aria-label="New ranking entry">New</span>';
    const kind = movement.kind === 'down' ? 'down' : 'up';
    return `<span class="rank-movement is-${kind} rank-movement-v149" aria-label="${escapeAttr(movement.label)}">${movementArrowSvgV149()}<span class="movement-delta">${movement.delta}</span></span>`;
  }

  function startTopBandsHtmlV149() {
    const stats = globalListeningStats(TWO_WEEKS);
    const knownTimeNote = ListeningStats.hasUnknownDuration(stats.listens)
      ? '<p class="listening-known-time-note">Listening time is based on listens with known duration.</p>'
      : '';
    return `<section class="listening-card start-top-bands-card start-stats-card-v149" aria-labelledby="start-listening-stats-title">
      <div class="start-stats-card-header-v149"><p id="start-listening-stats-title">Listening stats</p></div>
      <div class="listening-card-heading start-toplist-heading-v149"><p>YOUR TOP BANDS · 2 WEEKS</p><button type="button" id="start-top-bands-view-all" class="listening-link start-toplist-link-v149">TOPLIST</button></div>
      <div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 3), { compact: true, timeframe: TWO_WEEKS, showMovement: true })}</div>
      ${knownTimeNote}
      <button type="button" id="start-listening-stats" class="listening-card-footer">See your listening stats${icon('chevronRight')}</button>
    </section>`;
  }

  function statsTeaserHtmlV149(stats) {
    return `<div class="stats-teaser-card start-stats-card-v149" aria-labelledby="start-concert-stats-title">
      <div class="start-stats-card-header-v149"><p id="start-concert-stats-title">Concert stats</p></div>
      <div class="stats-teaser-row stats-teaser-row-4up">
        <div class="stats-teaser-item"><span class="stats-teaser-value">${stats.totalShows.toLocaleString()}</span><span class="stats-teaser-label">shows</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${stats.countries.toLocaleString()}</span><span class="stats-teaser-label">countries</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${dlCompactNumber(stats.kmTraveled)} km</span><span class="stats-teaser-label">traveled</span></div>
        <div class="stats-teaser-item"><span class="stats-teaser-value">${dlCompactNumber(stats.totalSpend)} kr</span><span class="stats-teaser-label">spent</span></div>
      </div>
      <button type="button" id="stats-teaser-cta" class="stats-teaser-footer">See your full concert stats${icon('chevronRight')}</button>
    </div>`;
  }

  // Several historical correction layers intentionally finalize listening
  // renderers during DOMContentLoaded. Re-assert only the v149 renderers here
  // so those older boot-time fixes cannot restore the superseded Start card.
  function installRenderOverridesV149() {
    if (typeof movementHtml === 'function') movementHtml = movementHtmlV149;
    if (typeof startTopBandsHtml === 'function') startTopBandsHtml = startTopBandsHtmlV149;
    if (typeof statsTeaserHtml === 'function') statsTeaserHtml = statsTeaserHtmlV149;
  }

  function wireStartListeningCardV149(card) {
    card?.querySelector('#start-top-bands-view-all')?.addEventListener('click', () => openTopBandsScreen());
    card?.querySelector('#start-listening-stats')?.addEventListener('click', () => openStatsScreen({ subTab: 'listening' }));
    card?.querySelectorAll('[data-listening-band-id]').forEach((row) => row.addEventListener('click', () => {
      topBandsTimeframe = 'threeMonths';
      openProfile(row.dataset.listeningBandId, { selectedTab: 'listening' });
    }));
    wireListeningImages(card);
  }

  function applyStartListeningCardV149() {
    const screen = document.getElementById('screen-myconcerts');
    const current = screen?.querySelector('.start-top-bands-card');
    if (!current || current.classList.contains('start-stats-card-v149')) return;

    const holder = document.createElement('div');
    holder.innerHTML = startTopBandsHtmlV149().trim();
    const replacement = holder.firstElementChild;
    if (!replacement) return;
    current.replaceWith(replacement);
    wireStartListeningCardV149(replacement);
  }

  function keepStartPresentationV149() {
    installRenderOverridesV149();
    applyStartListeningCardV149();
  }

  function observeStartPresentationV149() {
    const screen = document.getElementById('screen-myconcerts');
    if (!screen || screen.dataset.v149StatsObserved === '1') return;
    screen.dataset.v149StatsObserved = '1';
    let applying = false;
    new MutationObserver(() => {
      if (applying) return;
      applying = true;
      try {
        keepStartPresentationV149();
      } finally {
        applying = false;
      }
    }).observe(screen, { childList: true, subtree: true });
    keepStartPresentationV149();
  }

  function statsHeaderMarkupV149() {
    return statsSubTab === 'concerts'
      ? '<span class="brand-blue">CONCERT</span>STATS'
      : '<span class="brand-blue">LISTENING</span>STATS';
  }

  function applyStatsHeaderV149() {
    if (typeof el !== 'function') return;
    if (currentTab !== 'stats' && currentScreen !== 'stats') return;
    const title = el('header-title');
    if (title) title.innerHTML = statsHeaderMarkupV149();
  }

  installRenderOverridesV149();

  if (typeof TAB_BRAND_HTML === 'object' && TAB_BRAND_HTML) {
    TAB_BRAND_HTML.stats = '<span class="brand-blue">LISTENING</span>STATS';
  }

  if (typeof renderStatsScreen === 'function') {
    const renderStatsScreenBeforeV149 = renderStatsScreen;
    renderStatsScreen = function renderStatsScreenV149(...args) {
      const result = renderStatsScreenBeforeV149(...args);
      applyStatsHeaderV149();
      return result;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      observeStartPresentationV149();
      setTimeout(keepStartPresentationV149, 0);
    }, { once: true });
  } else {
    observeStartPresentationV149();
    setTimeout(keepStartPresentationV149, 0);
  }

  globalThis.StartStatsV149 = {
    movementArrowSvg: movementArrowSvgV149,
    movementHtml: movementHtmlV149,
    startTopBandsHtml: startTopBandsHtmlV149,
    statsHeaderMarkup: statsHeaderMarkupV149,
    applyStatsHeader: applyStatsHeaderV149,
    applyStartListeningCard: applyStartListeningCardV149,
    installRenderOverrides: installRenderOverridesV149,
  };
})();
