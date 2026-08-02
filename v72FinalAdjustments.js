'use strict';

(function attachV72FinalAdjustments(root) {
  function renderTopBandsPreview(stats) {
    return `<section class="listening-card top-bands-card" aria-labelledby="stats-top-bands-title">
      <div class="listening-card-heading"><p id="stats-top-bands-title">TOP BANDS · ${escapeHtml(stats.label.toUpperCase())}</p><button type="button" class="listening-link" data-open-top-bands>View all</button></div>
      <div class="top-bands-list">${topBandRowsHtml(stats.topBands.slice(0, 10), { timeframe: stats.timeframe, showMovement: true })}</div>
      <button type="button" class="listening-card-footer" data-open-top-bands>View full top 100${icon('chevronRight')}</button>
    </section>`;
  }

  function fixEmptyAttribution() {
    const panel = root.document?.querySelector('.band-listening-panel');
    if (!panel || !panel.querySelector('.screen-empty')) return;
    const attribution = panel.querySelector('[data-track-attribution]');
    if (attribution) attribution.textContent = 'Listening data from ListenBrainz';
  }

  function fixConcertDatesHeaderIcon() {
    const title = root.document?.getElementById('header-title');
    const headerIcon = root.document?.getElementById('header-icon');
    if (!title || !headerIcon || typeof icon !== 'function') return;
    const normalizedTitle = String(title.textContent || '').replace(/\s+/g, '').toLowerCase();
    if (normalizedTitle === 'concertdates') headerIcon.innerHTML = icon('calendarPlain');
  }

  function fixNewLabels() {
    root.document?.querySelectorAll('.rank-movement.is-new').forEach((label) => {
      if (label.textContent !== 'NEW') label.textContent = 'NEW';
    });
  }

  function trustedSpotifyReleaseUrlV77(value) {
    try {
      const url = new URL(String(value || ''));
      const parts = url.pathname.split('/').filter(Boolean);
      return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && parts.length === 2 && parts[0] === 'album' && /^[A-Za-z0-9]+$/.test(parts[1]) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function isSpotifyReleaseV77(item) {
    if (!item || item.category !== 'album') return false;
    if (!/^[A-Za-z0-9]+$/.test(String(item.spotifyReleaseId || ''))) return false;
    if (!trustedSpotifyReleaseUrlV77(item.spotifyUrl || item.sourceUrl)) return false;
    const type = item.releaseType || item.type || null;
    return !type || type === 'Album' || type === 'Single';
  }

  function concertAlertItemsV77() {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const raw = concerts
      .filter((concert) => !concert.manuallyAdded && concert.foundAt && bands.some((band) => band.id === concert.bandId))
      .filter((concert) => !bands.find((band) => band.id === concert.bandId)?.muted)
      .filter((concert) => new Date(concert.foundAt).getTime() >= cutoff);
    const byBatch = new Map();
    for (const concert of raw) {
      const key = `${concert.bandId}|${concert.foundAt}`;
      if (!byBatch.has(key)) byBatch.set(key, []);
      byBatch.get(key).push(concert);
    }
    const items = [];
    for (const group of byBatch.values()) {
      if (group.length === 1) {
        items.push(group[0]);
        continue;
      }
      const sorted = [...group].sort((a, b) => new Date(a.date) - new Date(b.date));
      items.push({
        isBatch: true,
        bandId: sorted[0].bandId,
        bandName: sorted[0].bandName,
        foundAt: sorted[0].foundAt,
        count: sorted.length,
        nearbyCount: sorted.filter(dlIsNearby).length,
        europeCount: sorted.filter((concert) => dlIsEuropeCountry(concert.country)).length,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date,
      });
    }
    return items.sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''));
  }

  function releaseItemsV77(bandId = null) {
    return [...news]
      .filter(isSpotifyReleaseV77)
      .filter((item) => !bandId || item.bandId === bandId)
      .filter((item) => bands.some((band) => band.id === item.bandId))
      .filter((item) => !bands.find((band) => band.id === item.bandId)?.muted)
      .sort((a, b) => (b.releaseDate || b.foundAt || '').localeCompare(a.releaseDate || a.foundAt || ''));
  }

  function releaseCardHtmlV77(item) {
    const band = bands.find((candidate) => candidate.id === item.bandId);
    const title = item.releaseTitle || item.headline || 'Untitled release';
    const type = item.releaseType === 'Single' ? 'NEW SINGLE' : 'NEW ALBUM';
    const artwork = releaseArtworkUrl(item.artworkUrl || item.imageUrl);
    const spotifyUrl = trustedSpotifyReleaseUrlV77(item.spotifyUrl || item.sourceUrl);
    const releaseDate = item.releaseDate ? formatShortDate(item.releaseDate) : '';
    return `<div class="row-card clickable release-alert-card${band?.favorite ? ' has-favorite' : ''}" data-band-id="${escapeAttr(item.bandId)}">
      ${band?.favorite ? `<span class="alert-favorite-badge" aria-label="Favorite band">${icon('heartFill')}</span>` : ''}
      <div class="release-alert-artwork${artwork ? '' : ' is-placeholder'}" data-release-artwork>
        ${artwork ? `<img src="${escapeAttr(artwork)}" alt="${escapeAttr(title)} cover artwork" />` : icon('music')}
      </div>
      <div class="alert-row-body">
        <p class="release-alert-tag">${type}</p>
        <p class="alert-title">${escapeHtml(title)}</p>
        <p class="alert-meta">${escapeHtml(item.bandName || 'Unknown artist')}${releaseDate ? ` · Released ${escapeHtml(releaseDate)}` : ''}</p>
        ${spotifyUrl ? `<a class="btn-secondary release-alert-spotify-action" href="${escapeAttr(spotifyUrl)}" target="_blank" rel="noopener" aria-label="Open ${escapeAttr(title)} in Spotify">${icon('spotify')}Open in Spotify</a>` : ''}
        <p class="alert-time">${daysAgoLabel(item.foundAt)}</p>
      </div>
    </div>`;
  }

  function renderFocusedAlertsScreenV77() {
    const container = el('screen-news');
    const switchHtml = `<div class="news-subtab-switch" role="tablist" aria-label="Alert sections">
      <button class="news-subtab-btn${newsSubTab === 'alerts' ? ' active' : ''}" data-subtab="alerts" role="tab" aria-selected="${newsSubTab === 'alerts'}">Concerts</button>
      <button class="news-subtab-btn${newsSubTab === 'news' ? ' active' : ''}" data-subtab="news" role="tab" aria-selected="${newsSubTab === 'news'}">Releases</button>
    </div>`;
    let bodyHtml;
    if (newsSubTab === 'alerts') {
      const alerts = concertAlertItemsV77();
      bodyHtml = alerts.length ? alerts.map(alertRowHtml).join('') : '<p class="screen-empty">No new concerts found in the last 90 days.</p>';
    } else {
      const releases = releaseItemsV77();
      bodyHtml = releases.length ? releases.map(releaseCardHtmlV77).join('') : '<p class="screen-empty">No Spotify releases yet.</p>';
    }
    container.innerHTML = switchHtml + bodyHtml;
    container.querySelectorAll('.news-subtab-btn').forEach((button) => button.addEventListener('click', () => {
      newsSubTab = button.dataset.subtab;
      renderNewsScreen();
      if (newsSubTab === 'alerts') markAlertsSeen();
    }));
    container.querySelectorAll('.row-card[data-band-id]').forEach((row) => row.addEventListener('click', (event) => {
      if (event.target.closest('.release-alert-spotify-action')) return;
      openProfile(row.dataset.bandId, { selectedTab: newsSubTab === 'news' ? 'news' : 'alerts' });
    }));
    wireReleaseAlertArtwork(container);
  }

  function focusedProfileTabsHtmlV77() {
    const tabs = [['concerts', 'Concerts'], ['alerts', 'Alerts'], ['news', 'Releases'], ['listening', 'Listening'], ['data', 'Data']];
    return `<div class="news-subtab-switch profile-tab-switch" role="tablist" aria-label="Band profile sections">${tabs.map(([tab, label]) => `<button type="button" id="profile-tab-${tab}" class="news-subtab-btn profile-tab-btn${profileTab === tab ? ' active' : ''}" data-profile-tab="${tab}" role="tab" aria-selected="${profileTab === tab}" aria-controls="profile-tab-panel"${profileTab === tab ? '' : ' tabindex="-1"'}>${label}</button>`).join('')}</div>`;
  }

  function focusedProfileAlertsHtmlV77(bandId) {
    const alerts = concertAlertItemsV77().filter((item) => item.bandId === bandId);
    return alerts.length ? alerts.map(alertRowHtml).join('') : '<p class="screen-empty profile-tab-empty">No current concert alerts for this band.</p>';
  }

  function focusedProfileReleasesHtmlV77(bandId) {
    const releases = releaseItemsV77(bandId);
    return releases.length ? releases.map(releaseCardHtmlV77).join('') : '<p class="screen-empty profile-tab-empty">No Spotify releases for this band yet.</p>';
  }

  function applyDomFixes() {
    fixEmptyAttribution();
    fixConcertDatesHeaderIcon();
    fixNewLabels();
    if (typeof wireReleaseAlertArtwork === 'function') wireReleaseAlertArtwork(root.document);
  }

  function apply() {
    if (typeof topBandsPreviewHtml === 'function') topBandsPreviewHtml = renderTopBandsPreview;
    if (typeof getAlertItems === 'function') getAlertItems = concertAlertItemsV77;
    if (typeof renderNewsScreen === 'function') renderNewsScreen = renderFocusedAlertsScreenV77;
    if (typeof profileTabsHtml === 'function') profileTabsHtml = focusedProfileTabsHtmlV77;
    if (typeof profileAlertsHtml === 'function') profileAlertsHtml = focusedProfileAlertsHtmlV77;
    if (typeof profileNewsHtml === 'function') profileNewsHtml = focusedProfileReleasesHtmlV77;
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
