'use strict';

// v186: Anchor a static light source at the *first glyph* of an active primary
// tab. Never wrap/replace labels or touch app handlers, data or provider APIs.
(function installBandmarkrLightV186(root) {
  const doc = root.document;
  const SELECTOR = [
    '.stats-subtabs > .stats-subtab-btn.active',
    '.news-subtab-switch > .news-subtab-btn.active',
    '#screen-settings .settings-v123-tabs > .settings-v123-tab.is-selected',
    '.discover-geo-filters-v172 .discover-geo-filter-btn-v171.active',
  ].join(',');

  function firstVisibleTextNode(button) {
    if (!doc || !button || typeof doc.createTreeWalker !== 'function') return null;
    const walker = doc.createTreeWalker(button, root.NodeFilter?.SHOW_TEXT || 4);
    let node;
    while ((node = walker.nextNode())) {
      const first = node.textContent.search(/\S/);
      if (first !== -1) return { node, first };
    }
    return null;
  }

  function firstLetterOrigin(button) {
    const text = firstVisibleTextNode(button);
    const box = button?.getBoundingClientRect?.();
    if (!text || !box || box.width <= 0) return null;
    const range = doc.createRange();
    range.setStart(text.node, text.first);
    range.setEnd(text.node, text.first + 1);
    const glyph = range.getBoundingClientRect();
    range.detach?.();
    if (!glyph.width) return null;
    const x = glyph.left + glyph.width / 2 - box.left;
    return Math.round(Math.min(box.width - 3, Math.max(3, x)) * 10) / 10;
  }

  function positionLights() {
    if (!doc) return 0;
    let positioned = 0;
    doc.querySelectorAll(SELECTOR).forEach(function (button) {
      const x = firstLetterOrigin(button);
      if (x === null) return;
      const value = x + 'px';
      if (button.style.getPropertyValue('--v186-first-letter-x') !== value) {
        button.style.setProperty('--v186-first-letter-x', value);
      }
      positioned++;
    });
    return positioned;
  }

  const api = Object.freeze({ positionLights, firstLetterOrigin, selector: SELECTOR });
  root.BandmarkrLightV186 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!doc) return;

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    root.requestAnimationFrame(function () {
      queued = false;
      positionLights();
    });
  }

  // The app replaces screen DOM on navigation and tab switches. Observe only
  // tab-relevant mutations; a single frame batches any large render.
  function relevant(mutation) {
    if (mutation.type === 'attributes') {
      return mutation.target.matches?.(SELECTOR) ||
        mutation.target.matches?.('.stats-subtab-btn,.news-subtab-btn,.settings-v123-tab,.discover-geo-filter-btn-v171');
    }
    return Array.from(mutation.addedNodes).some(function (node) {
      return node.nodeType === 1 && (node.matches?.(SELECTOR) || node.querySelector?.(SELECTOR));
    });
  }

  if (root.MutationObserver) {
    const observer = new root.MutationObserver(function (mutations) {
      if (mutations.some(relevant)) schedule();
    });
    observer.observe(doc.getElementById('app') || doc.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'aria-selected'],
    });
  }
  // Keyboard/touch navigation and orientation changes keep the beam anchored.
  doc.addEventListener('click', schedule, true);
  doc.addEventListener('keyup', schedule, true);
  root.addEventListener?.('resize', schedule);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})(typeof globalThis !== 'undefined' ? globalThis : this);
