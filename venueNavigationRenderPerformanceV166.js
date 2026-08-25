'use strict';

// Final v166 render coordinator for Dates. The canonical venue cache lives in
// LiveVaultVenueNavigationPerformanceV166; this layer keeps the normal Dates
// list out of that work entirely and reuses already-rendered DOM when neither
// data nor view state changed.
(function installVenueNavigationRenderPerformanceV166(root) {
  if (root.__LIVEVAULT_VENUE_NAVIGATION_RENDER_PERFORMANCE_V166__) return;
  root.__LIVEVAULT_VENUE_NAVIGATION_RENDER_PERFORMANCE_V166__ = true;

  const venuePerf = root.LiveVaultVenueNavigationPerformanceV166;
  if (!venuePerf || typeof venuePerf.canonicalVenueGroupsFast !== 'function') return;

  let lastRenderKey = null;

  function swedenActive() {
    try { return typeof swedenOnly !== 'undefined' && swedenOnly === true; } catch (_) { return false; }
  }

  function concertsViewDataKey() {
    const bandState = new Map();
    for (const band of (Array.isArray(bands) ? bands : [])) {
      if (band?.id != null) bandState.set(band.id, band?.muted === true ? 1 : 0);
    }
    const parts = [];
    for (const concert of (Array.isArray(concerts) ? concerts : [])) {
      if (!concert?.bandId || !bandState.has(concert.bandId)) continue;
      parts.push([
        concert.id || '', concert.bandId, concert.bandName || '', bandState.get(concert.bandId), concert.date || '', concert.time || '',
        concert.venue || '', concert.city || '', concert.country || '', concert.attending === true ? 1 : 0,
        Number.isFinite(concert.distanceKm) ? concert.distanceKm : null,
      ]);
    }
    return JSON.stringify(parts);
  }

  function renderConcertListHtml() {
    if (!swedenActive()) return concertsListHtml();

    const previousEuropeOnly = europeOnly;
    const previousNearbyOnly = nearbyOnly;
    const previousEuropePredicate = dlIsEuropeCountry;
    europeOnly = true;
    nearbyOnly = false;
    dlIsEuropeCountry = typeof root.v143IsSwedenCountry === 'function'
      ? root.v143IsSwedenCountry
      : (country) => String(country || '').trim().toLowerCase() === 'sweden';
    try {
      return concertsListHtml();
    } finally {
      dlIsEuropeCountry = previousEuropePredicate;
      europeOnly = previousEuropeOnly;
      nearbyOnly = previousNearbyOnly;
    }
  }

  function syncV143Chrome() {
    if (typeof root.v143SyncMainGeoFilterState === 'function') root.v143SyncMainGeoFilterState();
  }

  root.renderConcertsScreen = function renderConcertsScreenV166Final() {
    const container = el('screen-concerts');
    el('nearby-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');
    el('europe-toggle-btn').classList.toggle('hidden', concertsSubTab !== 'concerts');

    const dataKey = concertsSubTab === 'venues'
      ? venuePerf.canonicalVenueGroupsFast().key
      : concertsViewDataKey();
    const renderKey = JSON.stringify([
      concertsSubTab,
      dataKey,
      nearbyOnly === true ? 1 : 0,
      europeOnly === true ? 1 : 0,
      swedenActive() ? 1 : 0,
      venuesNearbyOnly === true ? 1 : 0,
      venuesEuropeOnly === true ? 1 : 0,
      venuesPastOnly === true ? 1 : 0,
      dlCurrentDate().toDateString(),
    ]);

    if (lastRenderKey === renderKey && container?.childElementCount > 0) {
      syncV143Chrome();
      return;
    }

    const switchHtml = `
      <div class="news-subtab-switch">
        <button class="news-subtab-btn${concertsSubTab === 'concerts' ? ' active' : ''}" data-subtab="concerts">Concerts</button>
        <button class="news-subtab-btn${concertsSubTab === 'venues' ? ' active' : ''}" data-subtab="venues">Venues</button>
      </div>`;

    const bodyHtml = concertsSubTab === 'venues' ? root.venuesSubTabHtml() : renderConcertListHtml();
    container.innerHTML = switchHtml + bodyHtml;

    container.querySelectorAll('.news-subtab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        concertsSubTab = button.dataset.subtab;
        root.renderConcertsScreen();
      });
    });

    if (concertsSubTab === 'venues') {
      root.wireVenuesSubTab(container);
    } else {
      container.querySelectorAll('.row-card[data-band-id]').forEach((row) => {
        row.addEventListener('click', () => openProfile(row.dataset.bandId));
      });
      if (swedenActive()) {
        const empty = container.querySelector('.screen-empty');
        if (empty?.textContent.trim() === 'No upcoming European concerts right now.') {
          empty.textContent = 'No upcoming concerts in Sweden right now.';
        }
      }
    }

    lastRenderKey = renderKey;
    syncV143Chrome();
  };

  root.LiveVaultVenueNavigationRenderPerformanceV166 = Object.freeze({
    concertsViewDataKey,
    invalidate() { lastRenderKey = null; },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
