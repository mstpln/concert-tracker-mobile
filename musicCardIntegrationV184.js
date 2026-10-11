'use strict';

// v184 finishes the two approved card integrations by moving existing nodes
// and applying presentation-only classes. No card is cloned or re-rendered;
// all concert actions, chart data, timeframes and user-owned fields remain intact.
(function installMusicCardIntegrationV184(root) {
  function integrateConcertHistory() {
    const screen = root.document?.getElementById('screen-myconcerts');
    if (!screen) return false;
    const tabs = screen.querySelector(':scope > .music-history-tabs-v183');
    if (!tabs) return false;

    // The first actual card in each history panel visually joins the muted
    // selector; subsequent cards and later-year headers keep their own layout.
    // Apply this to all three panels so switching tabs needs no re-render.
    screen.querySelectorAll(':scope > .my-history-panel').forEach(function (panel) {
      const first = [...panel.children].find(function (node) {
        return node.classList?.contains('row-card-mc');
      });
      if (first) first.classList.add('music-history-first-card-v184');
    });
    return true;
  }

  function integrateBandListening() {
    const screen = root.document?.getElementById('screen-profile');
    const panel = screen?.querySelector('.band-listening-panel');
    const summary = panel?.querySelector(':scope > .music-band-summary-v183');
    const chart = panel?.querySelector(':scope > .listening-chart-card');
    if (!summary || !chart) return false;

    // Keep both original <section> elements, chart SVG and listeners. The
    // single neutral wrapper provides the only border/background/radius.
    const wrapper = root.document.createElement('div');
    wrapper.className = 'music-band-combined-v184';
    summary.before(wrapper);
    wrapper.append(summary, chart);
    return true;
  }

  root.MusicCardIntegrationV184 = Object.freeze({
    integrateConcertHistory: integrateConcertHistory,
    integrateBandListening: integrateBandListening,
  });
  if (typeof module === 'object' && module.exports) module.exports = root.MusicCardIntegrationV184;

  if (typeof root.renderMyConcertsScreen === 'function') {
    const previous = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV184() {
      const result = previous.apply(this, arguments);
      integrateConcertHistory();
      return result;
    };
  }

  if (typeof root.renderProfileScreen === 'function') {
    const previous = root.renderProfileScreen;
    root.renderProfileScreen = function renderProfileScreenV184() {
      const result = previous.apply(this, arguments);
      integrateBandListening();
      return result;
    };
  }

  // Also handle an already-rendered screen without altering other sections.
  integrateConcertHistory();
  integrateBandListening();
})(typeof globalThis !== 'undefined' ? globalThis : this);
