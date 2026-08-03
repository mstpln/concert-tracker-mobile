'use strict';

// Last-resort Stats boundary. The v81 renderer and v82 calculation layer are
// intentionally independent, so a chart-specific failure must never remove
// the entire Stats destination. This wrapper is loaded last and renders a
// calculation-only summary without calling any chart helpers.
(() => {
  if (typeof statsListeningHtml !== 'function' || typeof ListeningStats === 'undefined') return;
  const renderStatsContent = statsListeningHtml;

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fallbackContent() {
    try {
      const now = typeof listeningNow === 'function' ? listeningNow() : new Date();
      const events = typeof listeningEvents === 'undefined' ? [] : listeningEvents;
      const appBands = typeof bands === 'undefined' ? [] : bands;
      const stats = ListeningStats.selectedStats(events, appBands, 'threeMonths', now);
      const duration = ListeningStats.formatDuration(stats.durationMs);
      const rows = stats.topBands.slice(0, 10).map((item) => `
        <div class="top-band-row is-static">
          <span class="top-band-rank">#${Number(item.rank) || '—'}</span>
          <span class="listening-band-avatar" aria-hidden="true">${escapeText(String(item.bandName || '?').slice(0, 1).toUpperCase())}</span>
          <span class="top-band-copy"><strong>${escapeText(item.bandName || 'Unknown artist')}</strong><small>${escapeText(ListeningStats.formatDuration(item.durationMs))} · ${Number(item.listenCount || 0).toLocaleString()} listens</small></span>
          <span></span>
        </div>`).join('');
      const unknownNote = stats.hasUnknownDuration
        ? '<p class="listening-known-time-note">Listening time is based on listens with known duration.</p>'
        : '';
      return `
        <section class="listening-card listening-summary listening-summary-global" aria-label="Listening summary for 3 months">
          <p class="listening-section-title">YOUR LISTENING · 3 MONTHS</p>
          <div class="listening-summary-grid">
            <div class="listening-summary-metric"><strong>${escapeText(duration)}</strong><span>listened</span></div>
            <div class="listening-summary-metric"><strong>${Number(stats.listenCount || 0).toLocaleString()}</strong><span>listens</span></div>
            <div class="listening-summary-metric"><strong>${Number(stats.distinctMatchedBands || 0).toLocaleString()}</strong><span>matched bands</span></div>
          </div>
          ${unknownNote}
        </section>
        <section class="listening-card top-bands-card" aria-label="Top bands fallback">
          <div class="listening-card-heading"><p>TOP BANDS · 3 MONTHS</p></div>
          <div class="top-bands-list">${rows || '<p class="listening-empty">No matched top bands are available for this period.</p>'}</div>
          <p class="listening-known-time-note">Some listening charts could not be displayed. Your listening summary remains available.</p>
        </section>`;
    } catch (fallbackError) {
      console.error('Listening Stats fallback also encountered an error.', fallbackError);
      return `
        <section class="listening-card" role="status">
          <p class="listening-section-title">LISTENING STATISTICS</p>
          <p class="listening-empty">Listening statistics could not be fully displayed. Other app sections remain available.</p>
        </section>`;
    }
  }

  statsListeningHtml = function statsListeningV82FailSafe() {
    try {
      return renderStatsContent();
    } catch (error) {
      console.error('Listening Stats render boundary recovered from an error.', error);
      return fallbackContent();
    }
  };
})();
