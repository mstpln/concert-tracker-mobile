'use strict';

(function installDiscoverFilterPillsV172(root) {
  if (!root?.document) return;

  function decorateRow() {
    const row = root.document.querySelector('.discover-geo-filters-v171');
    if (!row) return;
    row.classList.add('discover-geo-filters-v172');

    const nearby = row.querySelector('[data-discover-geo="nearby"]');
    const sweden = row.querySelector('[data-discover-geo="sweden"]');
    const europe = row.querySelector('[data-discover-geo="europe"]');
    const nearbySource = root.document.getElementById('nearby-toggle-btn');

    if (nearby && nearbySource?.innerHTML && nearby.innerHTML !== nearbySource.innerHTML) {
      nearby.innerHTML = nearbySource.innerHTML;
      nearby.title = nearbySource.title || 'Show nearby only';
    }
    if (sweden && sweden.textContent !== 'SE') sweden.textContent = 'SE';
    if (europe && europe.textContent !== 'EU') europe.textContent = 'EU';
  }

  const target = root.document.getElementById('screen-concerts');
  if (target && root.MutationObserver) {
    const observer = new root.MutationObserver(decorateRow);
    observer.observe(target, { childList: true, subtree: true });
  }

  root.setTimeout(decorateRow, 0);
})(typeof globalThis !== 'undefined' ? globalThis : this);
