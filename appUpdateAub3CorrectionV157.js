'use strict';

(function installAub3CorrectionV157(root) {
  function currentCalendarYear() {
    const now = typeof root?.dlCurrentDate === 'function' ? root.dlCurrentDate() : new Date();
    return now.getFullYear();
  }

  function yearOptionsHtml(currentYear = currentCalendarYear()) {
    let html = '<option value="">Year</option>';
    for (let year = currentYear + 1; year >= 1960; year -= 1) html += `<option value="${year}">${year}</option>`;
    return html;
  }

  function setButtonTextPreservingIcon(button, text) {
    if (!button) return;
    const textNodes = [...button.childNodes].filter((node) => node.nodeType === 3);
    if (textNodes.length) {
      textNodes[0].nodeValue = text;
      for (const node of textNodes.slice(1)) node.remove();
    } else button.append(root.document.createTextNode(text));
  }

  function applyAddConcertCopy(container) {
    if (!container) return;
    const button = container.querySelector('#past-concert-submit');
    if (!button) return;
    const card = button.closest('.add-band-card');
    const heading = card?.querySelector('.section-label');
    if (heading) heading.textContent = 'ADD A CONCERT';
    setButtonTextPreservingIcon(button, 'Add a concert');
  }

  const api = Object.freeze({ yearOptionsHtml, applyAddConcertCopy });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppUpdateAub3CorrectionV157 = api;

  // The v156 manual relationship editor remains in source for backwards
  // compatibility with old persisted eventGroupId data, but v157 removes it
  // from the normal card surface. Automatic grouping lives centrally in the
  // event model and this presentation hook intentionally renders no control.
  if (typeof root?.eventGroupControlsHtml === 'function') root.eventGroupControlsHtml = () => '';

  if (typeof root?.pastConcertYearOptionsHtml === 'function') {
    root.pastConcertYearOptionsHtml = () => yearOptionsHtml(currentCalendarYear());
  }

  if (typeof root?.renderMyConcertsScreen === 'function') {
    const render = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV157(...args) {
      const result = render.apply(this, args);
      applyAddConcertCopy(root.document?.getElementById('screen-myconcerts'));
      return result;
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
