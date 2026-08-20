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

  if (typeof movementHtml === 'function') {
    movementHtml = function movementHtmlV149(movement) {
      if (!movement) return '';
      if (movement.kind === 'new') return '<span class="rank-movement is-new" aria-label="New ranking entry">New</span>';
      const kind = movement.kind === 'down' ? 'down' : 'up';
      return `<span class="rank-movement is-${kind} rank-movement-v149" aria-label="${escapeAttr(movement.label)}">${movementArrowSvgV149()}<span class="movement-delta">${movement.delta}</span></span>`;
    };
  }

  if (typeof startTopBandsHtml === 'function') {
    startTopBandsHtml = function startTopBandsHtmlV149() {
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
    };
  }

  if (typeof statsTeaserHtml === 'function') {
    statsTeaserHtml = function statsTeaserHtmlV149(stats) {
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
    };
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

  globalThis.StartStatsV149 = {
    movementArrowSvg: movementArrowSvgV149,
    statsHeaderMarkup: statsHeaderMarkupV149,
    applyStatsHeader: applyStatsHeaderV149,
  };
})();
