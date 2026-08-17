'use strict';

(function attachProviderReleaseCleanupV135(root) {
  function renderConcertAlertsOnly() {
    const container = typeof el === 'function' ? el('screen-news') : root.document?.getElementById('screen-news');
    if (!container || typeof getAlertItems !== 'function' || typeof alertRowHtml !== 'function') return;
    const alerts = getAlertItems();
    container.innerHTML = alerts.length
      ? alerts.map(alertRowHtml).join('')
      : '<p class="screen-empty">No new concerts found in the last 90 days.</p>';
    container.querySelectorAll('.row-card[data-band-id]').forEach((row) => row.addEventListener('click', () => {
      openProfile(row.dataset.bandId, { selectedTab: 'alerts' });
    }));
  }

  function profileTabsWithoutReleases() {
    if (typeof profileTab !== 'undefined' && profileTab === 'news') profileTab = 'concerts';
    const tabs = [['concerts', 'Concerts'], ['alerts', 'Alerts'], ['listening', 'Listening'], ['data', 'Data']];
    return `<div class="news-subtab-switch profile-tab-switch" role="tablist" aria-label="Band profile sections">${tabs.map(([tab, label]) => `<button type="button" id="profile-tab-${tab}" class="news-subtab-btn profile-tab-btn${profileTab === tab ? ' active' : ''}" data-profile-tab="${tab}" role="tab" aria-selected="${profileTab === tab}" aria-controls="profile-tab-panel"${profileTab === tab ? '' : ' tabindex="-1"'}>${label}</button>`).join('')}</div>`;
  }

  function apply() {
    if (typeof newsSubTab !== 'undefined') newsSubTab = 'alerts';
    if (typeof renderNewsScreen === 'function') renderNewsScreen = renderConcertAlertsOnly;
    if (typeof profileTabsHtml === 'function') profileTabsHtml = profileTabsWithoutReleases;
    if (typeof profileNewsHtml === 'function') profileNewsHtml = () => '';
  }

  root.addEventListener('DOMContentLoaded', apply, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
