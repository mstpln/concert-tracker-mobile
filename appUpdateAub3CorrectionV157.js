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

  function applyAddConcertUi(container) {
    if (!container) return;
    const button = container.querySelector('#past-concert-submit');
    if (button) {
      const card = button.closest('.add-band-card');
      const heading = card?.querySelector('.section-label');
      if (heading) heading.textContent = 'ADD A CONCERT';
      setButtonTextPreservingIcon(button, 'Add a concert');
    }

    const yearSelect = container.querySelector('#past-concert-year');
    if (yearSelect) {
      const selected = yearSelect.value;
      yearSelect.innerHTML = yearOptionsHtml(currentCalendarYear());
      if ([...yearSelect.options].some((option) => option.value === selected)) yearSelect.value = selected;
    }
  }

  function removeEventGroupControls(container) {
    container?.querySelectorAll('.event-group-wrap').forEach((node) => node.remove());
  }

  function applyCurrentScreenCorrections() {
    const container = root.document?.getElementById('screen-myconcerts');
    applyAddConcertUi(container);
    removeEventGroupControls(container);
  }

  const api = Object.freeze({ yearOptionsHtml, applyAddConcertUi, removeEventGroupControls });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppUpdateAub3CorrectionV157 = api;

  // The v156 relationship editor remains implemented for backwards
  // compatibility with existing persisted eventGroupId data, but v157 keeps
  // it off the normal card surface. Automatic grouping lives in the central
  // event model and this presentation hook intentionally renders no control.
  if (typeof root?.eventGroupControlsHtml === 'function') root.eventGroupControlsHtml = () => '';

  if (typeof root?.pastConcertYearOptionsHtml === 'function') {
    root.pastConcertYearOptionsHtml = () => yearOptionsHtml(currentCalendarYear());
  }

  if (typeof root?.renderMyConcertsScreen === 'function') {
    const render = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV157(...args) {
      const result = render.apply(this, args);
      applyCurrentScreenCorrections();
      return result;
    };
  }

  // app.js begins async initialization before this late compatibility layer
  // loads. Patch any already-rendered synthetic/offline screen immediately;
  // later renders go through the wrapper above.
  applyCurrentScreenCorrections();
})(typeof globalThis !== 'undefined' ? globalThis : this);
