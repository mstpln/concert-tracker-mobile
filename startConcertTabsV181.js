'use strict';

// v181 is a small DOM finishing layer, not a replacement for the established
// v167/v169 next-event promotion. It runs after both wrappers and relocates
// only the remaining Upcoming list beneath the shared three-way tab strip.
(function installStartConcertTabsV181(root) {
  function organize() {
    const screen = root.document?.getElementById('screen-myconcerts');
    if (!screen) return false;
    const tabs = [...screen.children].find((node) => node.classList?.contains('myconcerts-history-tabs'));
    const upcomingPanel = screen.querySelector('#my-history-upcoming');
    if (!tabs || !upcomingPanel) return false;

    // Existing v167/v169 code still finds the direct-child Upcoming label
    // before this point and promotes the first validated event exactly once.
    const upcomingLabel = [...screen.children].find((node) => node.classList?.contains('section-label-v143-upcoming'));
    if (upcomingLabel) {
      let next = upcomingLabel.nextElementSibling;
      while (next && next !== tabs) {
        const after = next.nextElementSibling;
        upcomingPanel.append(next); // move nodes, keep click/change handlers
        next = after;
      }
      upcomingLabel.remove(); // the 3-way tabs replace this section heading
    }

    const featured = screen.querySelector(':scope > .next-concert-merged-v167');
    if (featured) {
      const yearSpacer = featured.previousElementSibling;
      if (yearSpacer?.classList?.contains('year-divider')) {
        // Keep the original top edge of the promoted card precisely where
        // it was on v180; only the separator content becomes invisible.
        yearSpacer.classList.add('start-featured-year-spacer-v181');
        yearSpacer.setAttribute('aria-hidden', 'true');
      }
    }
    const label = screen.querySelector(':scope > .section-label-v167-next');
    if (label) label.setAttribute('aria-hidden', 'true'); // CSS retains its geometry

    if (!upcomingPanel.children.length) {
      upcomingPanel.innerHTML = '<p class="screen-empty">' +
        (featured ? 'No more upcoming concerts.' : 'No upcoming concerts.') +
        '</p>';
    }

    // The original hidden-attribute bug must never be reintroduced by a
    // post-render relocation, even after switching screens and returning.
    const active = [...tabs.querySelectorAll('[data-my-history-tab]')]
      .find((node) => node.getAttribute('aria-selected') === 'true')?.dataset.myHistoryTab || 'upcoming';
    for (const key of ['upcoming', 'past', 'cancelled']) {
      const panel = screen.querySelector('#my-history-' + key);
      if (panel) panel.hidden = key !== active;
    }
    return true;
  }

  root.StartConcertTabsV181 = Object.freeze({ organize });

  if (typeof root.renderMyConcertsScreen === 'function') {
    const prior = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV181(...args) {
      const result = prior.apply(this, args);
      organize();
      return result;
    };
  }
  organize();
})(typeof globalThis !== 'undefined' ? globalThis : this);
