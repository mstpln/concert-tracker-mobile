'use strict';

(function attachDiscoverCorrectionsV171(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultDiscoverCorrectionsV171 = api;
  if (root?.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const Model = root.LiveVaultDiscoverModelV170;
  const Discover = () => root.LiveVaultDiscoverV170;
  let installed = false;
  let headerObserver = null;
  let profileObserver = null;

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en');
  }

  function trustedMbid(band) {
    return Model?.trustedBandMbid?.(band) || null;
  }

  function hasStoredMbid(band) {
    return typeof band?.musicbrainz?.mbid === 'string' && band.musicbrainz.mbid.trim().length > 0;
  }

  function exactNameBands(rows, name) {
    const key = normalizeName(name);
    return (rows || []).filter((band) => normalizeName(band?.name) === key);
  }

  function currentBands() {
    try { if (typeof bands !== 'undefined' && Array.isArray(bands)) return bands; } catch (_) {}
    return [];
  }

  function currentRemote() {
    try { if (typeof remote !== 'undefined' && remote) return remote; } catch (_) {}
    return typeof rsGetConnection === 'function' ? rsGetConnection() : null;
  }

  function findCandidate(mbid) {
    const normalized = Model?.normalizeMbid?.(mbid);
    for (const group of Discover()?.getState?.()?.groups || []) {
      for (const candidate of group.candidates || []) {
        if (Model?.normalizeMbid?.(candidate.artistMbid) === normalized) return candidate;
      }
    }
    return null;
  }

  function buildLinkedBand(existing, candidate, now) {
    const next = JSON.parse(JSON.stringify(existing));
    const priorMusicbrainz = next.musicbrainz && typeof next.musicbrainz === 'object' && !Array.isArray(next.musicbrainz)
      ? next.musicbrainz
      : {};
    next.musicbrainz = {
      ...priorMusicbrainz,
      mbid: candidate.artistMbid,
      artistName: candidate.name,
      area: candidate.area || priorMusicbrainz.area || null,
      country: priorMusicbrainz.country || null,
      artistType: priorMusicbrainz.artistType || null,
      disambiguation: priorMusicbrainz.disambiguation || null,
      confidence: 'user_confirmed',
      status: 'manual_confirmed',
      matchMethod: 'discover_user_add_existing_band',
      source: 'MusicBrainz',
      matchedAt: now,
      reviewedAt: now,
    };
    next.discoverRecommendation = {
      ...(next.discoverRecommendation && typeof next.discoverRecommendation === 'object' ? next.discoverRecommendation : {}),
      source: 'listenbrainz_similar_artists',
      artistMbid: candidate.artistMbid,
      discoveredAt: candidate.discoveredAt || now,
      linkedExistingBandAt: now,
    };
    next._enriching = true;
    root.LiveVaultSecurity?.preparePendingArtistEnrichment?.(next, now);
    return next;
  }

  function reconcileBands(rows) {
    const list = currentBands();
    if (!Array.isArray(list)) return;
    list.splice(0, list.length, ...JSON.parse(JSON.stringify(rows)));
  }

  async function linkExistingBand(candidate, attempts = 3) {
    const connection = currentRemote();
    if (!connection) throw new Error('Connect BANDMARKR storage first.');
    const mbid = Model?.normalizeMbid?.(candidate?.artistMbid);
    if (!mbid) throw new Error('Recommendation identity is invalid.');
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const latest = await dlReadJsonFile(connection, 'bands.json', []);
      if (!Array.isArray(latest)) throw new Error('Stored bands data is invalid.');
      const already = latest.find((band) => trustedMbid(band) === mbid);
      if (already) {
        reconcileBands(latest);
        return already;
      }
      const matches = exactNameBands(latest, candidate.name);
      if (matches.length !== 1) throw new Error(matches.length ? 'More than one existing band has this exact name.' : 'Existing band is no longer available.');
      const existing = matches[0];
      if (trustedMbid(existing)) throw new Error('The existing band has a different confirmed MusicBrainz identity.');
      if (hasStoredMbid(existing)) throw new Error('Review the existing MusicBrainz identity before linking this recommendation.');
      const now = new Date().toISOString();
      const linked = buildLinkedBand(existing, candidate, now);
      const intended = latest.map((band) => band?.id === existing.id ? linked : band);
      const persisted = typeof stripTransient === 'function' ? stripTransient(intended) : intended.map((band) => {
        const copy = { ...band };
        delete copy._enriching;
        return copy;
      });
      try {
        await dlWriteJsonFileIfCurrent(connection, 'bands.json', persisted);
        reconcileBands(persisted);
        return persisted.find((band) => band?.id === existing.id) || linked;
      } catch (error) {
        if (!/changed/i.test(String(error?.message || '')) || attempt === attempts - 1) throw error;
      }
    }
    throw new Error('Band update could not be saved.');
  }

  function showInlineError(button, message) {
    const card = button?.closest?.('.discover-card');
    if (!card) return;
    let error = card.querySelector('.discover-error');
    if (!error) {
      error = root.document.createElement('div');
      error.className = 'discover-error';
      error.setAttribute('role', 'status');
      card.querySelector('.discover-card-copy')?.appendChild(error);
    }
    error.textContent = message;
    button.disabled = false;
  }

  function showAdded(button) {
    const card = button?.closest?.('.discover-card');
    if (!card) return;
    card.querySelector('[data-discover-dismiss]')?.remove();
    button.disabled = true;
    button.classList.add('is-added');
    button.textContent = 'Added ✓';
  }

  async function addExistingBand(candidate, button) {
    const feedback = root.LiveVaultInteractionFeedbackV129;
    const handle = feedback?.begin?.({ key: `discover-link-existing:${candidate.artistMbid}` });
    button.disabled = true;
    try {
      const band = await linkExistingBand(candidate);
      await Discover()?.persistOperation?.((latest) => Model.resolveCandidate(latest, candidate.artistMbid, 'added', {
        now: new Date().toISOString(),
        addedBandId: band.id,
      }));
      showAdded(button);
      root.setTimeout(() => {
        try {
          if (currentTab === 'concerts' && concertsSubTab === 'bands') Discover()?.renderBands?.();
        } catch (_) {}
      }, 700);
    } catch (error) {
      showInlineError(button, error?.message || 'Could not link this existing band.');
    } finally {
      feedback?.end?.(handle, { minVisibleMs: 180 });
    }
  }

  function interceptDiscoverAdd(event) {
    const button = event.target?.closest?.('[data-discover-add]');
    if (!button) return;
    const candidate = findCandidate(button.dataset.discoverAdd);
    if (!candidate) return;
    const matches = exactNameBands(currentBands(), candidate.name);
    if (!matches.length) return;
    if (matches.some((band) => trustedMbid(band) === Model.normalizeMbid(candidate.artistMbid))) return;
    const unidentified = matches.filter((band) => !trustedMbid(band));
    if (matches.length === 1 && unidentified.length === 1 && !hasStoredMbid(unidentified[0])) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void addExistingBand(candidate, button);
      return;
    }
    if (unidentified.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showInlineError(button, matches.length > 1
        ? 'More than one existing band has this name. Review the existing bands first.'
        : 'Review the existing MusicBrainz identity before adding this recommendation.');
    }
  }

  function standardizeHeader() {
    const title = root.document?.getElementById('header-title');
    if (!title) return;
    const normalized = String(title.textContent || '').replace(/\s+/g, '').toUpperCase();
    const expected = normalized === 'MYMUSIC'
      ? 'MY<span class="brand-blue">MUSIC</span>'
      : normalized === 'CONCERTALERTS'
        ? 'CONCERT<span class="brand-blue">ALERTS</span>'
        : null;
    if (expected && title.innerHTML !== expected) title.innerHTML = expected;
  }

  function syncGeoProxyState(row) {
    const pairs = [
      ['nearby', root.document?.getElementById('nearby-toggle-btn')],
      ['sweden', root.document?.getElementById('sweden-toggle-btn')],
      ['europe', root.document?.getElementById('europe-toggle-btn')],
    ];
    for (const [key, source] of pairs) {
      const proxy = row?.querySelector?.(`[data-discover-geo="${key}"]`);
      if (!proxy || !source) continue;
      proxy.classList.toggle('active', source.classList.contains('active'));
      proxy.setAttribute('aria-pressed', String(source.classList.contains('active')));
    }
  }

  function shouldShowGeoRow() {
    try { return currentTab === 'concerts' && currentScreen === 'main' && concertsSubTab === 'concerts'; } catch (_) { return false; }
  }

  function syncGeoFilters() {
    const sources = [
      root.document?.getElementById('nearby-toggle-btn'),
      root.document?.getElementById('sweden-toggle-btn'),
      root.document?.getElementById('europe-toggle-btn'),
    ].filter(Boolean);
    const container = root.document?.getElementById('screen-concerts');
    let row = container?.querySelector?.('.discover-geo-filters-v171');
    if (!shouldShowGeoRow()) {
      sources.forEach((button) => button.classList.remove('discover-v171-source-filter-hidden'));
      row?.remove();
      return;
    }
    sources.forEach((button) => button.classList.add('discover-v171-source-filter-hidden'));
    const tabs = container?.querySelector?.('.discover-subtabs');
    if (!tabs) return;
    if (!row) {
      row = root.document.createElement('div');
      row.className = 'discover-geo-filters-v171';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Concert location filters');
      row.innerHTML = [
        ['nearby', 'Nearby', 'Show nearby only'],
        ['sweden', 'SE', 'Show Sweden only'],
        ['europe', 'EU', 'Show Europe only'],
      ].map(([key, label, aria]) => `<button type="button" class="stats-subtab-btn discover-geo-filter-btn-v171" data-discover-geo="${key}" aria-label="${aria}" aria-pressed="false">${label}</button>`).join('');
      tabs.insertAdjacentElement('afterend', row);
      row.addEventListener('click', (event) => {
        const proxy = event.target.closest('[data-discover-geo]');
        if (!proxy) return;
        const sourceId = proxy.dataset.discoverGeo === 'nearby' ? 'nearby-toggle-btn'
          : proxy.dataset.discoverGeo === 'sweden' ? 'sweden-toggle-btn'
            : 'europe-toggle-btn';
        root.document.getElementById(sourceId)?.click();
        root.setTimeout(() => syncGeoFilters(), 0);
      });
    }
    syncGeoProxyState(row);
  }

  function activeProfileBand() {
    try {
      if (!activeProfileBandId) return null;
      return currentBands().find((band) => String(band?.id) === String(activeProfileBandId)) || null;
    } catch (_) { return null; }
  }

  function correctSetlistfmIdentityCopy() {
    let onData = false;
    try { onData = currentScreen === 'profile' && profileTab === 'data'; } catch (_) {}
    if (!onData) return;
    const band = activeProfileBand();
    if (!band || trustedMbid(band)) return;
    const container = root.document?.getElementById('screen-profile');
    if (!container) return;
    const targetText = 'Linked through the confirmed MusicBrainz MBID';
    for (const node of container.querySelectorAll('*')) {
      if (node.children.length === 0 && String(node.textContent || '').trim() === targetText) {
        node.textContent = 'Waiting for MusicBrainz identity';
      }
    }
  }

  function syncUi() {
    standardizeHeader();
    syncGeoFilters();
    correctSetlistfmIdentityCopy();
  }

  function install() {
    if (installed || !root.document) return;
    installed = true;
    try {
      TAB_BRAND_HTML.myconcerts = 'MY<span class="brand-blue">MUSIC</span>';
      TAB_BRAND_HTML.news = 'CONCERT<span class="brand-blue">ALERTS</span>';
    } catch (_) {}
    root.document.getElementById('screen-concerts')?.addEventListener('click', interceptDiscoverAdd, true);
    if (typeof renderConcertsScreen === 'function') {
      const baseRender = renderConcertsScreen;
      renderConcertsScreen = function renderDiscoverCorrectionsV171(...args) {
        const result = baseRender.apply(this, args);
        root.setTimeout(syncGeoFilters, 0);
        return result;
      };
    }
    const header = root.document.getElementById('app-header');
    if (header && root.MutationObserver) {
      headerObserver = new root.MutationObserver(() => standardizeHeader());
      headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
    }
    const profile = root.document.getElementById('screen-profile');
    if (profile && root.MutationObserver) {
      profileObserver = new root.MutationObserver(() => correctSetlistfmIdentityCopy());
      profileObserver.observe(profile, { childList: true, subtree: true, characterData: true });
    }
    root.addEventListener?.('popstate', () => root.setTimeout(syncUi, 0));
    root.setTimeout(syncUi, 0);
  }

  return Object.freeze({ normalizeName, trustedMbid, hasStoredMbid, exactNameBands, buildLinkedBand, linkExistingBand, correctSetlistfmIdentityCopy, syncGeoFilters, standardizeHeader, install });
});