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

  function providerIdentityDataRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      if (!Array.isArray(row)) return row;
      const [label, value, ...rest] = row;
      let nextValue = value;
      if (label === 'Confidence' && value === 'user_confirmed%') nextValue = 'User confirmed';
      if (label === 'Match method' && value === 'user approved exact id') nextValue = 'User-approved exact ID';
      return nextValue === value ? row : [label, nextValue, ...rest];
    });
  }

  const api = Object.freeze({
    yearOptionsHtml,
    applyAddConcertUi,
    removeEventGroupControls,
    providerIdentityDataRows,
  });
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

  // v165 compatibility: manually approved provider identities store a
  // semantic confidence marker rather than a numeric percentage. Normalize
  // only the dedicated Data-tab rows so unrelated provider-owned text is
  // never rewritten just because it contains the same words.
  if (typeof root?.profileDataRows === 'function') {
    const renderRows = root.profileDataRows;
    root.profileDataRows = function profileDataRowsV165(rows) {
      return renderRows(providerIdentityDataRows(rows));
    };
  }

  // app.js begins async initialization before this late compatibility layer
  // loads. Patch any already-rendered synthetic/offline screen immediately;
  // later renders go through the wrapper above.
  applyCurrentScreenCorrections();
})(typeof globalThis !== 'undefined' ? globalThis : this);
