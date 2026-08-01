'use strict';

(function attachV72FinalAdjustments(root) {
  function renderTopBandsPreview(stats) {
    const firstFive = topBandRowsHtml(stats.topBands.slice(0, 5), { timeframe: stats.timeframe, showMovement: true });
    const nextFive = topBandRowsHtml(stats.topBands.slice(5, 10), { timeframe: stats.timeframe, showMovement: true })
      .replaceAll('top-band-row', 'top-band-row-extra');
    return `<section class="listening-card top-bands-card" aria-labelledby="stats-top-bands-title">
      <div class="listening-card-heading"><p id="stats-top-bands-title">TOP BANDS · ${escapeHtml(stats.label.toUpperCase())}</p><button type="button" class="listening-link" data-open-top-bands>View all</button></div>
      <div class="top-bands-list">${firstFive}${nextFive}</div>
      <button type="button" class="listening-card-footer" data-open-top-bands>View full top 100${icon('chevronRight')}</button>
    </section>`;
  }

  function fixEmptyAttribution() {
    const panel = root.document?.querySelector('.band-listening-panel');
    if (!panel || !panel.querySelector('.screen-empty')) return;
    const attribution = panel.querySelector('[data-track-attribution]');
    if (attribution) attribution.textContent = 'Listening data from ListenBrainz';
  }

  function wireExtraRows() {
    root.document?.querySelectorAll('.top-band-row-extra[data-band-id]').forEach((row) => {
      if (row.dataset.v72Wired === 'true') return;
      row.dataset.v72Wired = 'true';
      row.addEventListener('click', () => {
        if (typeof openProfile === 'function') openProfile(row.dataset.bandId, { selectedTab: 'listening' });
      });
    });
  }

  function applyDomFixes() {
    fixEmptyAttribution();
    wireExtraRows();
  }

  function apply() {
    if (typeof topBandsPreviewHtml === 'function') topBandsPreviewHtml = renderTopBandsPreview;
    applyDomFixes();
  }

  function observe() {
    if (!root.document || !root.MutationObserver) return;
    let queued = false;
    const observer = new root.MutationObserver(() => {
      if (queued) return;
      queued = true;
      root.requestAnimationFrame(() => {
        queued = false;
        applyDomFixes();
      });
    });
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
  }

  root.addEventListener('DOMContentLoaded', () => {
    apply();
    observe();
    if (typeof currentScreen !== 'undefined' && currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
  }, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
